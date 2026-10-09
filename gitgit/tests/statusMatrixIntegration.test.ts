import { Script } from "scripting"
import { createFS, loadGitEngine } from "../services/gitCore"
import { runStatusRead, runStatusMutation, scanStatusMatrix } from "../services/git/statusScanService"
import { scanMutationMatrix } from "../services/git/matrixScanService"
import { getScanDiagnostics, clearScanDiagnostics } from "../utils/scanDiagnostics"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

/** 索引快路径：stat 与 index 条目一致时未改动文件不重读内容；改动文件仍实时重读 */
async function testIndexFastPath(): Promise<void> {
  const name = `gitgit-scan-fastpath-${Date.now()}`
  const root = FileManager.temporaryDirectory + "/" + name
  const dir = root + "/work"
  const gitdir = root + "/git"
  try {
    await FileManager.createDirectory(dir, true)
    await FileManager.createDirectory(gitdir, true)
    const { git } = await loadGitEngine()
    const fs = createFS(gitdir, dir)
    const ctx = { git, fs, dir, gitdir }
    await git.init({ fs, dir, gitdir, defaultBranch: "main" })
    for (let index = 0; index < 3; index++) {
      await fs.writeFile(`file-${index}.txt`, "x".repeat(64 * 1024))
    }
    await git.add({ fs, dir, gitdir, filepath: "." })
    await git.commit({ fs, dir, gitdir, message: "big files", author: { name: "Test", email: "test@example.invalid" } })

    clearScanDiagnostics()
    await runStatusRead(name, () => scanStatusMatrix(name, ctx, "快路径基线"))
    const baseline = getScanDiagnostics()[0]
    await runStatusRead(name, () => scanStatusMatrix(name, ctx, "快路径复检"))
    const recheck = getScanDiagnostics()[1]
    assert(
      baseline.readFileBytes < 40_000 && recheck.readFileBytes < 40_000,
      "索引快路径生效：未改动文件不再重读工作区内容",
    )
    assert(
      baseline.readFileBytes > 0 && recheck.readFileBytes > 0,
      "Git 元数据（树对象/索引/配置）读取仍计入诊断",
    )

    // 引擎 stat 比较只到秒级且不含纳秒（上游 racy 限制）：同秒同大小的修改会命中快路径
    // 而被漏检；这里用不同长度内容验证“改动文件仍实时重读”的 dirty 路径。
    await fs.writeFile("file-1.txt", "y".repeat(70 * 1024))
    clearScanDiagnostics()
    const matrix = await runStatusRead(name, () => scanStatusMatrix(name, ctx, "快路径脏文件"))
    const dirty = getScanDiagnostics()[0]
    const row = matrix.find((entry) => entry[0] === "file-1.txt")
    assert(!!row && row[1] === 1 && row[2] === 2 && row[3] === 1, "外部修改被实时识别")
    assert(dirty.readFileBytes >= 64 * 1024, "改动的文件仍实时重读内容")
  } finally {
    if (await FileManager.exists(root)) await FileManager.remove(root)
  }
}

async function main() {
  await testIndexFastPath()
  const name = `gitgit-scan-integration-${Date.now()}`
  const root = FileManager.temporaryDirectory + "/" + name
  const dir = root + "/work"
  const gitdir = root + "/git"
  clearScanDiagnostics()
  try {
    await FileManager.createDirectory(dir, true)
    await FileManager.createDirectory(gitdir, true)
    const { git } = await loadGitEngine()
    const fs = createFS(gitdir, dir)
    const ctx = { git, fs, dir, gitdir }
    await git.init({ fs, dir, gitdir, defaultBranch: "main" })
    await fs.writeFile(dir + "/a.txt", "first\n")
    await git.add({ fs, dir, gitdir, filepath: "a.txt" })
    await git.commit({ fs, dir, gitdir, message: "fixture", author: { name: "Test", email: "test@example.invalid" } })
    const read = (source: string) => runStatusRead(name, () => scanStatusMatrix(name, ctx, source))
    const [first, shared] = await Promise.all([read("列表出现"), read("详情出现")])
    assert(first === shared, "真实仓库列表和详情共用同一次矩阵")
    assert(first.length === 1 && first[0].slice(1).every((n) => n === 1), "提交后矩阵干净")
    assert(getScanDiagnostics().length === 1, "共享只记录一条诊断")
    await fs.writeFile(dir + "/a.txt", "second\n")
    const modified = await read("详情下拉")
    assert(modified[0][1] === 1 && modified[0][2] === 2 && modified[0][3] === 1, "外部编辑被实时识别")
    await runStatusMutation(name, async () => {
      const checked = await scanMutationMatrix(ctx, "写操作暂存检查")
      assert(checked[0][2] === 2, "写流程检查实时读取")
      await git.add({ fs, dir, gitdir, filepath: "a.txt" })
    })
    const staged = await read("详情操作后刷新")
    assert(staged[0][1] === 1 && staged[0][2] === 2 && staged[0][3] === 2, "暂存结果保持正确")
    await fs.unlink(dir + "/a.txt")
    const deleted = await read("详情下拉")
    assert(deleted[0][2] === 0, "外部删除不会被缓存掩盖")
    const entries = getScanDiagnostics()
    assert(entries.every((entry) => !entry.failed && entry.peakConcurrency === 1), "所有显式矩阵扫描完成且串行")
    assert(entries.some((entry) => entry.statCalls > 0 && entry.readFileBytes > 0 && entry.readdirCalls > 0), "真实原生 FS 统计非空")
  } finally {
    if (await FileManager.exists(root)) await FileManager.remove(root)
  }
}

main().then(
  () => Script.exit("status matrix integration tests passed"),
  (error) => {
    console.error(error)
    Script.exit("status matrix integration tests failed: " + error)
    throw error
  }
)
