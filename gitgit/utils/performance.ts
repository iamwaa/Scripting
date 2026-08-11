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

function sanitizeContext(context?: string): string | undefined {
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
}

export function buildPerformanceReport(details?: {
  historyRepoCount?: number
  historyEntryCount?: number
  historyRepoLimit?: number
  historyEntryLimit?: number
}): string {
  const entries = getSlowOperations()
  const lines = [
    "# GitGit 性能诊断",
    "",
    `生成时间：${new Date().toISOString()}`,
    `慢操作阈值：${SLOW_OPERATION_THRESHOLD_MS} ms`,
    `记录数量：${entries.length} / ${SLOW_OPERATION_LIMIT}`,
    "说明：扫描列表仓库状态是读取仓库完整状态的内部阶段；相邻同仓库记录通常属于同一次扫描。",
  ]
  if (details) {
    lines.push(
      `历史缓存：${details.historyRepoCount ?? 0} / ${details.historyRepoLimit ?? 0} 个仓库，${details.historyEntryCount ?? 0} 条记录，单仓上限 ${details.historyEntryLimit ?? 0}`
    )
  }
  lines.push("", "## 慢操作")
  if (entries.length === 0) {
    lines.push("", "暂无超过阈值的操作。")
    return lines.join("\n")
  }
  for (const entry of entries) {
    const status = entry.failed ? "失败" : "完成"
    const context = entry.context ? ` · ${entry.context}` : ""
    lines.push(
      `- ${new Date(entry.timestamp).toISOString()} · ${entry.operation} · ${entry.durationMs} ms · ${status}${context}`
    )
  }
  return lines.join("\n")
}
