import {
  clearScanDiagnostics,
  getScanDiagnostics,
  SCAN_DIAGNOSTIC_LIMIT,
  type ScanDiagnosticEntry,
} from "./scanDiagnostics"

export const SLOW_OPERATION_THRESHOLD_MS = 2000
export const SLOW_OPERATION_LIMIT = 30

export type SlowOperationEntry = {
  operation: string
  durationMs: number
  timestamp: number
  context?: string
  failed?: boolean
}

const slowOperations: SlowOperationEntry[] = []

export function sanitizeContext(context?: string): string | undefined {
  const value = context?.trim()
  if (!value) return undefined
  if (!value.includes("/")) return value
  const segments = value.split("/").filter(Boolean)
  return segments[segments.length - 1] || undefined
}

export async function measureOperation<T>(
  operation: string,
  task: () => Promise<T>,
  context?: string
): Promise<T> {
  const startedAt = Date.now()
  let failed = false
  try {
    return await task()
  } catch (error) {
    failed = true
    throw error
  } finally {
    recordSlowOperation(operation, Date.now() - startedAt, context, failed)
  }
}

export function recordSlowOperation(
  operation: string,
  durationMs: number,
  context?: string,
  failed = false
): void {
  if (durationMs < SLOW_OPERATION_THRESHOLD_MS) return
  const safeContext = sanitizeContext(context)
  const previous = slowOperations[slowOperations.length - 1]
  if (
    previous?.operation === operation &&
    previous.durationMs === durationMs &&
    previous.context === safeContext &&
    previous.failed === failed
  ) {
    return
  }
  slowOperations.push({
    operation,
    durationMs,
    timestamp: Date.now(),
    context: safeContext,
    failed,
  })
  if (slowOperations.length > SLOW_OPERATION_LIMIT) {
    slowOperations.splice(0, slowOperations.length - SLOW_OPERATION_LIMIT)
  }
  console.warn(`[性能] ${operation} ${durationMs}ms${safeContext ? ` · ${safeContext}` : ""}`)
}

export function getSlowOperations(): SlowOperationEntry[] {
  return slowOperations.map((entry) => ({ ...entry }))
}

export function clearSlowOperations(): void {
  slowOperations.length = 0
  // 设置页「清除记录」只调用本函数，扫描详细记录一并清空
  clearScanDiagnostics()
}

export function buildPerformanceReport(details?: {
  historyRepoCount?: number
  historyEntryCount?: number
  historyRepoLimit?: number
  historyEntryLimit?: number
}): string {
  const entries = getSlowOperations()
  const scans = getScanDiagnostics()
  const lines = [
    "# GitGit 性能诊断",
    "",
    `生成时间：${new Date().toISOString()}`,
    `慢操作阈值：${SLOW_OPERATION_THRESHOLD_MS} ms`,
    `记录数量：${entries.length} / ${SLOW_OPERATION_LIMIT}`,
    `扫描记录：${scans.length} / ${SCAN_DIAGNOSTIC_LIMIT}`,
    "说明：矩阵扫描是状态读取的内部阶段，可被列表与详情共享；通过 scanId 与来源识别，内外耗时不能相加。",
    "说明：扫描记录来自 statusMatrix 扫描，不等于仓库完整状态；I/O 次数与耗时是整次扫描的累计值（同一文件多次读取会重复计入），耗时可重叠，不等于墙钟耗时。",
  ]
  if (details) {
    lines.push(
      `历史缓存：${details.historyRepoCount ?? 0} / ${details.historyRepoLimit ?? 0} 个仓库，${details.historyEntryCount ?? 0} 条记录，单仓上限 ${details.historyEntryLimit ?? 0}`
    )
  }
  lines.push("", "## 慢操作")
  if (entries.length === 0) {
    lines.push("", "暂无超过阈值的操作。")
  } else {
    for (const entry of entries) {
      const status = entry.failed ? "失败" : "完成"
      const context = entry.context ? ` · ${entry.context}` : ""
      lines.push(
        `- ${new Date(entry.timestamp).toISOString()} · ${entry.operation} · ${entry.durationMs} ms · ${status}${context}`
      )
    }
  }
  lines.push("", "## 扫描明细", "说明：以下为每次已结束扫描的详细记录，与上方慢操作记录分开保存。")
  if (scans.length === 0) {
    lines.push("", "暂无扫描记录。")
  } else {
    for (const scan of scans) lines.push(formatScanDiagnostic(scan))
  }
  return lines.join("\n")
}

function formatScanDiagnostic(scan: ScanDiagnosticEntry): string {
  const identity = scan.repoId
    ? `${scan.repoName} · ${scan.repoId}`
    : scan.repoName || "未知仓库"
  const sources = scan.sources.length > 0 ? scan.sources.join("、") : "未标注"
  return [
    `- 开始 ${new Date(scan.startedAt).toISOString()} · 结束 ${new Date(scan.endedAt).toISOString()} · ${scan.scanId} · ${identity}`,
    `扫描 ${scan.durationMs} ms（排队 ${scan.queueMs} ms）`,
    `rows ${scan.rows}`,
    `受调度矩阵并发 ${scan.peakConcurrency}`,
    `stat/lstat ${scan.statCalls} 次 / ${scan.statMs} ms`,
    `readdir ${scan.readdirCalls} 次 / ${scan.readdirMs} ms`,
    `readFile ${scan.readFileCalls} 次 / ${scan.readFileMs} ms / ${scan.readFileBytes} B`,
    `来源 ${sources}`,
    scan.failed ? "失败" : "完成",
  ].join(" · ")
}
