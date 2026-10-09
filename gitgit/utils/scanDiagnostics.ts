import { sanitizeContext } from "./performance"

/** 扫描详细记录的独立环形上限（与慢操作记录分开，互不淘汰） */
export const SCAN_DIAGNOSTIC_LIMIT = 30

/** 单次扫描的耗时与 I/O 记录：只存计数与统计值，不含原始路径和文件内容 */
export type ScanDiagnosticEntry = {
  scanId: string
  repoId?: string
  repoName: string
  sources: string[]
  queuedAt: number
  startedAt: number
  endedAt: number
  /** 排队等待时长（startedAt - queuedAt） */
  queueMs: number
  /** 扫描时长（endedAt - startedAt） */
  durationMs: number
  rows: number
  failed: boolean
  /** stat 与 lstat 合并计数 */
  statCalls: number
  /** stat 与 lstat 累计耗时，同一路径多次调用会重复计入 */
  statMs: number
  readdirCalls: number
  /** readdir 累计耗时 */
  readdirMs: number
  readFileCalls: number
  /** readFile 累计耗时，同一文件多次读取会重复计入 */
  readFileMs: number
  /** readFile 累计读取字节数 */
  readFileBytes: number
  // 当前队列只执行一个显式矩阵扫描，峰值不包含引擎内部的隐式扫描。
  peakConcurrency: number
}

export type ScanDiagnosticsOptions = {
  scanId: string
  repoId: string
  repoName: string
  source: string
  queuedAt: number
  startedAt: number
  activeScans: number
}

export type ScanDiagnosticsHandle = {
  /** 对象级包装 fs：只追踪 stat/lstat/readdir/readFile，其余成员原样透传 */
  wrapFS(fs: any): any
  addSource(source: string): void
  /** 结束扫描并写入记录；可重复调用，只有第一次生效 */
  finish(rowCount: number, failed?: boolean): void
}

const scanEntries: ScanDiagnosticEntry[] = []

function toFiniteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function toCount(value: unknown): number {
  const count = Math.floor(Number(value))
  return Number.isFinite(count) && count > 0 ? count : 0
}

/** 标签统一脱敏：绝对路径只保留末级（与慢操作上下文同一规则） */
function sanitizeLabel(value?: string): string | undefined {
  return sanitizeContext(value)
}

function dedupeLabels(values: string[]): string[] {
  const labels: string[] = []
  for (const value of values) {
    const safe = sanitizeLabel(value)
    if (safe && !labels.includes(safe)) labels.push(safe)
  }
  return labels
}

/** UTF-8 字节数（string 的 length 不等于字节数） */
function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff &&
      text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4 // 代理对（emoji 等）
      index++
    } else {
      bytes += 3
    }
  }
  return bytes
}

/**
 * 读取字节数：Uint8Array/Buffer/ArrayBuffer 用 byteLength，string 按 UTF-8 计。
 * Scripting 的 Data 没有 byteLength，退回 toUint8Array()/size。
 */
function byteLengthOf(value: any): number {
  if (value == null) return 0
  if (typeof value === "string") return utf8ByteLength(value)
  if (typeof value.byteLength === "number" && Number.isFinite(value.byteLength)) {
    return Math.max(0, value.byteLength)
  }
  if (typeof value.toUint8Array === "function") {
    try {
      const bytes = value.toUint8Array()
      if (bytes && typeof bytes.byteLength === "number") {
        return Math.max(0, bytes.byteLength)
      }
    } catch (_e) {
      // 转换失败按 0 计，不能影响扫描本身
    }
  }
  if (typeof value.size === "number" && Number.isFinite(value.size)) {
    return Math.max(0, value.size)
  }
  return 0
}

/** 写入记录（内部与外部可直接调用），入队前统一脱敏 */
export function recordScanDiagnostic(entry: ScanDiagnosticEntry): void {
  scanEntries.push({
    ...entry,
    repoId: sanitizeLabel(entry.repoId),
    repoName: sanitizeLabel(entry.repoName) || "仓库",
    sources: dedupeLabels(entry.sources),
  })
  if (scanEntries.length > SCAN_DIAGNOSTIC_LIMIT) {
    scanEntries.splice(0, scanEntries.length - SCAN_DIAGNOSTIC_LIMIT)
  }
}

export function getScanDiagnostics(): ScanDiagnosticEntry[] {
  return scanEntries.map((entry) => ({ ...entry, sources: [...entry.sources] }))
}

export function clearScanDiagnostics(): void {
  scanEntries.length = 0
}

/**
 * 创建一次扫描的诊断句柄。所有完成扫描都会记录（不设阈值），
 * 以便轻量扫描也能在报告里给出“为什么快/慢”的依据。
 */
export function createScanDiagnostics(
  options: ScanDiagnosticsOptions
): ScanDiagnosticsHandle {
  const startedAt = toFiniteNumber(options.startedAt, Date.now())
  const queuedAt = toFiniteNumber(options.queuedAt, startedAt)
  const peakConcurrency = toCount(options.activeScans)
  const sources = dedupeLabels([options.source])
  let statCalls = 0
  let statMs = 0
  let readdirCalls = 0
  let readdirMs = 0
  let readFileCalls = 0
  let readFileMs = 0
  let readFileBytes = 0
  let finished = false

  // 每个被追踪方法都写成显式方法并转发到原对象（原对象自己的 this 语义不变，
  // 如 gitCore 的 lstat 内部 this.stat 不会被重复计数）。
  function trackMethod(
    target: any,
    wrapped: any,
    name: string,
    track: (elapsedMs: number) => void
  ): void {
    const original = target[name]
    if (typeof original !== "function") return
    wrapped[name] = async function (filepath: string, opts?: any): Promise<any> {
      const startedAt = Date.now()
      try {
        return await original.call(target, filepath, opts)
      } finally {
        // 失败也计入累计耗时
        track(Date.now() - startedAt)
      }
    }
  }

  function wrapFS(target: any): any {
    if (!target || typeof target !== "object") return target
    const wrapped: any = { ...target }
    trackMethod(target, wrapped, "stat", (elapsedMs) => {
      statCalls++
      statMs += elapsedMs
    })
    trackMethod(target, wrapped, "lstat", (elapsedMs) => {
      statCalls++
      statMs += elapsedMs
    })
    trackMethod(target, wrapped, "readdir", (elapsedMs) => {
      readdirCalls++
      readdirMs += elapsedMs
    })

    const readFile = target.readFile
    if (typeof readFile === "function") {
      wrapped.readFile = async function (filepath: string, opts?: any): Promise<any> {
        readFileCalls++
        const readStartedAt = Date.now()
        try {
          const data = await readFile.call(target, filepath, opts)
          readFileBytes += byteLengthOf(data)
          return data
        } finally {
          readFileMs += Date.now() - readStartedAt
        }
      }
    }
    return wrapped
  }

  function addSource(source: string): void {
    const safe = sanitizeLabel(source)
    if (safe && !sources.includes(safe)) sources.push(safe)
  }

  function finish(rowCount: number, failed = false): void {
    if (finished) return
    finished = true
    const endedAt = Date.now()
    recordScanDiagnostic({
      scanId: String(options.scanId ?? ""),
      repoId: options.repoId,
      repoName: String(options.repoName || options.repoId || ""),
      sources: [...sources],
      queuedAt,
      startedAt,
      endedAt,
      queueMs: Math.max(0, startedAt - queuedAt),
      durationMs: Math.max(0, endedAt - startedAt),
      rows: toCount(rowCount),
      failed: !!failed,
      statCalls,
      statMs,
      readdirCalls,
      readdirMs,
      readFileCalls,
      readFileMs,
      readFileBytes,
      peakConcurrency,
    })
  }

  return { wrapFS, addSource, finish }
}
