import { Script } from "scripting"
import { buildPerformanceReport, clearSlowOperations, getSlowOperations, recordSlowOperation } from "../utils/performance"
import {
  clearScanDiagnostics,
  createScanDiagnostics,
  getScanDiagnostics,
  SCAN_DIAGNOSTIC_LIMIT,
  type ScanDiagnosticEntry,
} from "../utils/scanDiagnostics"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function lastScan(): ScanDiagnosticEntry {
  const entries = getScanDiagnostics()
  const entry = entries[entries.length - 1]
  assert(entry, "存在扫描记录")
  return entry
}

/** 模拟 gitCore 的 fs：lstat 内部委托 this.stat，用于检验 this 语义不被包装破坏 */
function createFakeFS(readFileResult?: (opts?: any) => any) {
  const calls = { stat: 0, lstat: 0, readdir: 0, readFile: 0 }
  const fs: any = {
    marker: "fs-marker",
    calls,
    async stat(this: any, _filepath: string) {
      calls.stat++
      return { type: "file", size: 1, marker: this.marker }
    },
    async lstat(this: any, filepath: string) {
      calls.lstat++
      return this.stat(filepath)
    },
    async readdir(_filepath: string) {
      calls.readdir++
      return ["a.txt", "b.txt"]
    },
    async readFile(_filepath: string, opts?: any) {
      calls.readFile++
      if (readFileResult) return readFileResult(opts)
      const encoding = typeof opts === "string" ? opts : opts?.encoding
      return encoding === "utf8" ? "中文abc" : new Uint8Array([1, 2, 3, 4])
    },
    async untouched() {
      return "untouched"
    },
  }
  return fs
}

async function testWrapFSCounts(): Promise<void> {
  clearScanDiagnostics()
  const handle = createScanDiagnostics({
    scanId: "scan-1",
    repoId: "/private/var/mobile/git-repos/repo-abc",
    repoName: "demo",
    source: "repo-list",
    queuedAt: 500,
    startedAt: 700,
    activeScans: 1,
  })
  const fs = createFakeFS()
  const wrapped = handle.wrapFS(fs)

  assert(wrapped !== fs, "wrapFS 返回包装对象")
  assert(wrapped.calls === fs.calls, "未追踪成员按引用透传")
  const info = await wrapped.stat("README.md")
  assert(info.marker === "fs-marker", "原方法仍以原对象为 this 调用")
  await wrapped.lstat("dir")
  assert(fs.calls.stat === 2 && fs.calls.lstat === 1, "底层真实调用次数")
  await wrapped.readdir(".")
  const text = await wrapped.readFile("a.txt", "utf8")
  const bytes = await wrapped.readFile("b.bin")
  assert(text === "中文abc" && bytes instanceof Uint8Array, "readFile 结果原样透传")
  assert((await wrapped.untouched()) === "untouched", "未追踪方法原样透传")

  handle.addSource("repo-detail")
  handle.addSource("repo-detail")
  handle.addSource("/private/var/mobile/scan/inner")
  handle.finish(12)

  const entry = lastScan()
  assert(entry.scanId === "scan-1" && entry.repoName === "demo", "扫描标识与仓库名")
  assert(entry.repoId === "repo-abc", "repoId 脱敏只保留末级")
  assert(!JSON.stringify(entry).includes("/private/"), "记录不含任何原始路径")
  assert(entry.sources.join("|") === "repo-list|repo-detail|inner", "参与来源去重并脱敏")
  assert(entry.statCalls === 2, "stat 与 lstat 合并计数，内部委托不重复计")
  assert(entry.statMs >= 0, "累计 stat/lstat 耗时")
  assert(entry.readdirCalls === 1, "readdir 次数")
  assert(entry.readdirMs >= 0, "累计 readdir 耗时")
  assert(entry.readFileCalls === 2, "readFile 次数")
  assert(entry.readFileBytes === 9 + 4, "字符串按 UTF-8 计，Uint8Array 按 byteLength 计")
  assert(entry.rows === 12, "记录 rows")
  assert(entry.queueMs === 200, "记录排队时长")
  assert(entry.durationMs >= 0 && entry.endedAt >= entry.startedAt, "记录扫描时长")
  assert(entry.peakConcurrency === 1, "记录峰值并发")
  assert(entry.failed === false, "默认未失败")
}

async function testByteCounting(): Promise<void> {
  clearScanDiagnostics()
  const handle = createScanDiagnostics({
    scanId: "scan-bytes",
    repoId: "repo-abc",
    repoName: "demo",
    source: "repo-list",
    queuedAt: 0,
    startedAt: 0,
    activeScans: 1,
  })
  let nextResult: any = null
  const fs: any = {
    async readFile() {
      return nextResult
    },
  }
  const wrapped = handle.wrapFS(fs)

  nextResult = new Uint8Array(5)
  await wrapped.readFile("a")
  nextResult = new ArrayBuffer(7)
  await wrapped.readFile("b")
  nextResult = "abc"
  await wrapped.readFile("c")
  nextResult = "中文"
  await wrapped.readFile("d")
  // 模拟 Scripting 的 Data：没有 byteLength，只能靠 toUint8Array()/size
  nextResult = { size: 11, toUint8Array: () => new Uint8Array(11) }
  await wrapped.readFile("e")
  nextResult = { size: 13 }
  await wrapped.readFile("f")
  nextResult = { mimeType: "text/plain" }
  await wrapped.readFile("g")
  nextResult = null
  await wrapped.readFile("h")
  handle.finish(0)

  const entry = lastScan()
  assert(entry.readFileCalls === 8, "每次 readFile 都计数")
  assert(entry.readFileBytes === 5 + 7 + 3 + 6 + 11 + 13, "各类返回值字节数")
  assert(entry.readFileMs >= 0, "累计读取耗时")
  assert(entry.failed === false, "默认未失败")
}

/** stat/lstat、readdir、readFile 的累计耗时必须是真实测量值（不是恒 0） */
async function testIoDurations(): Promise<void> {
  clearScanDiagnostics()
  const delay = 6
  const handle = createScanDiagnostics({
    scanId: "scan-durations",
    repoId: "repo-abc",
    repoName: "demo",
    source: "repo-list",
    queuedAt: Date.now(),
    startedAt: Date.now(),
    activeScans: 1,
  })
  const fs: any = {
    // 与 gitCore 一致：lstat 委托 this.stat（委托走原对象，不应重复计入耗时）
    async stat() {
      await sleep(delay)
      return { type: "file" }
    },
    async lstat(this: any, filepath: string) {
      return this.stat(filepath)
    },
    async readdir() {
      await sleep(delay)
      return []
    },
    async readFile() {
      await sleep(delay)
      return new Uint8Array(2)
    },
  }
  const wrapped = handle.wrapFS(fs)
  await wrapped.stat("a")
  await wrapped.lstat("b")
  await wrapped.readdir(".")
  await wrapped.readFile("c")
  handle.finish(1)

  const entry = lastScan()
  assert(entry.statCalls === 2, "stat 与 lstat 合并计数，lstat 委托不重复计")
  assert(entry.statMs >= delay * 2, "stat/lstat 累计真实耗时")
  assert(entry.readdirMs >= delay, "readdir 累计真实耗时")
  assert(entry.readFileMs >= delay, "readFile 累计真实耗时")
  // 三项顺序执行，累计值均不应超过整次扫描的墙钟时长
  assert(
    entry.durationMs >= entry.statMs && entry.durationMs >= entry.readdirMs,
    "累计耗时不大于扫描时长"
  )
}

function testRingAndSeparation(): void {  clearScanDiagnostics()
  clearSlowOperations()
  for (let index = 0; index < SCAN_DIAGNOSTIC_LIMIT + 5; index++) {
    const handle = createScanDiagnostics({
      scanId: `scan-${index}`,
      repoId: "repo-abc",
      repoName: "demo",
      source: "repo-list",
      queuedAt: 0,
      startedAt: 0,
      activeScans: 1,
    })
    handle.finish(index)
  }
  const entries = getScanDiagnostics()
  const first = entries[0]
  const newest = entries[entries.length - 1]
  assert(first && newest, "存在扫描记录")
  assert(entries.length === SCAN_DIAGNOSTIC_LIMIT, "扫描记录独立环形上限 30")
  assert(first.scanId === "scan-5", "超限后淘汰最早记录")
  assert(newest.scanId === `scan-${SCAN_DIAGNOSTIC_LIMIT + 4}`, "保留最新记录")
  assert(getSlowOperations().length === 0, "扫描记录不进入慢操作列表")
  assert(first.durationMs >= 0, "轻量扫描同样入账以便解释原因")

  const failed = createScanDiagnostics({
    scanId: "scan-failed",
    repoId: "repo-abc",
    repoName: "demo",
    source: "repo-detail",
    queuedAt: 100,
    startedAt: 100,
    activeScans: 1,
  })
  failed.finish(0, true)
  failed.finish(99, false)
  const entry = lastScan()
  assert(entry.failed === true && entry.rows === 0, "finish 只生效一次且保留失败标记")
}

function testClearTogether(): void {
  clearScanDiagnostics()
  clearSlowOperations()
  recordSlowOperation("慢操作", 2500, "demo")
  const handle = createScanDiagnostics({
    scanId: "scan-clear",
    repoId: "repo-abc",
    repoName: "demo",
    source: "repo-list",
    queuedAt: 0,
    startedAt: 0,
    activeScans: 1,
  })
  handle.finish(1)
  assert(getScanDiagnostics().length === 1 && getSlowOperations().length === 1, "两类记录各自入账")

  clearSlowOperations()
  assert(getSlowOperations().length === 0, "慢操作已清空")
  assert(getScanDiagnostics().length === 0, "清除慢操作时扫描记录一并清空")

  const again = createScanDiagnostics({
    scanId: "scan-clear-2",
    repoId: "repo-abc",
    repoName: "demo",
    source: "repo-list",
    queuedAt: 0,
    startedAt: 0,
    activeScans: 1,
  })
  again.finish(1)
  clearScanDiagnostics()
  assert(getScanDiagnostics().length === 0, "clearScanDiagnostics 单独可用")
}

async function testReportFields(): Promise<void> {
  clearScanDiagnostics()
  clearSlowOperations()
  const handle = createScanDiagnostics({
    scanId: "scan-report",
    repoId: "/private/var/mobile/git-repos/repo-abc",
    repoName: "demo-repo",
    source: "repo-list",
    queuedAt: 1000,
    startedAt: 1100,
    activeScans: 2,
  })
  const wrapped = handle.wrapFS(createFakeFS())
  await wrapped.stat("a")
  await wrapped.readdir(".")
  await wrapped.readFile("x", "utf8")
  handle.addSource("repo-detail")
  handle.finish(7, true)

  const report = buildPerformanceReport()
  assert(report.includes("# GitGit 性能诊断"), "报告标题")
  assert(report.includes("内部阶段"), "保留原有嵌套阶段说明")
  assert(report.includes("扫描记录：1 / 30"), "报告统计扫描记录数")
  assert(report.includes("## 扫描明细"), "报告包含扫描明细")
  assert(report.includes("statusMatrix") && report.includes("不等于墙钟耗时"), "注明状态来源与累计 I/O 语义")
  assert(report.includes("scan-report") && report.includes("demo-repo · repo-abc"), "报告含扫描标识与脱敏仓库")
  assert(report.includes("排队 100 ms"), "报告含排队时长")
  assert(report.includes("rows 7") && report.includes("并发 2"), "报告含 rows 与峰值并发")
  assert(report.includes("stat/lstat 1 次 /"), "报告含 stat/lstat 次数与累计耗时")
  assert(/readdir 1 次 \/ \d+ ms/.test(report), "报告含 readdir 次数与累计耗时")
  assert(report.includes("readFile 1 次"), "报告含 readFile 次数与字节")
  assert(report.includes("来源 repo-list、repo-detail"), "报告列出参与来源")
  assert(report.includes("失败"), "报告含失败状态")
  assert(!report.includes("/private/"), "报告不含原始路径")
}

async function main(): Promise<void> {
  await testWrapFSCounts()
  await testIoDurations()
  await testByteCounting()
  testRingAndSeparation()
  testClearTogether()
  await testReportFields()
  clearScanDiagnostics()
  console.log("scan diagnostics tests passed")
  Script.exit("scan diagnostics tests passed")
}

main().then(
  () => Script.exit("scan diagnostics tests passed"),
  (error) => {
    console.error(error)
    // 必须显式结束运行，否则运行会挂到超时；失败信息写进结果再抛出，保留失败语义
    Script.exit("scan diagnostics tests failed: " + String((error as Error)?.message ?? error))
    throw error
  }
)
