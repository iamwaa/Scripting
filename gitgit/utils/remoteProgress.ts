/**
 * utils/remoteProgress.ts - 远程操作进度格式化与协作式取消
 *
 * isomorphic-git 提供 onProgress（phase/loaded/total），无 AbortSignal。
 * 取消：在 onProgress 与关键步骤抛出带 code 的错误，由上层清理并释放写锁。
 */

/** isomorphic-git onProgress 事件的最小形状 */
export interface GitProgressEvent {
  phase?: string
  loaded?: number
  total?: number
}

/** 供 UI 展示的进度快照 */
export interface RemoteProgressInfo {
  phase: string
  loaded: number
  total: number
  /** 0–100；无法计算时为 null */
  percent: number | null
  /** 已格式化的单行文案 */
  label: string
}

/** 远程操作可选回调与取消令牌 */
export interface RemoteOpOptions {
  /** 可返回 Promise，便于 UI 让出事件循环以刷新进度 */
  onProgress?: (
    info: RemoteProgressInfo
  ) => void | Promise<void>
  cancelToken?: RemoteCancelToken
}

/** 取消错误 code，与 MergeConflictError 一样挂在 Error 上 */
export const REMOTE_OPERATION_CANCELLED = "RemoteOperationCancelled"

/** 常见 phase 中文映射（未知 phase 原样展示） */
const PHASE_LABELS: Record<string, string> = {
  "Receiving objects": "接收对象",
  "Resolving deltas": "解析增量",
  "Updating workdir": "更新工作区",
  "Counting objects": "统计对象",
  "Compressing objects": "压缩对象",
  "Writing objects": "写入对象",
  "Analyzing workdir": "分析工作区",
  "Downloading metadata": "下载元数据",
  // HTTP / 协作式检查点（isomorphic-git push 几乎不发 onProgress）
  Downloading: "下载中",
  Connecting: "连接远端",
  Uploading: "上传对象",
  Merging: "合并中",
  Finalizing: "收尾中",
}

/** 协作式取消令牌（非 AbortSignal） */
export class RemoteCancelToken {
  private cancelled = false

  /** 请求取消；已进行中的网络请求可能仍跑完，但会在下一检查点中止 */
  cancel(): void {
    this.cancelled = true
  }

  get isCancelled(): boolean {
    return this.cancelled
  }

  /** 若已取消则抛出 RemoteOperationCancelled */
  throwIfCancelled(): void {
    if (this.cancelled) {
      throw createRemoteCancelledError()
    }
  }
}

/** 构造标准取消错误 */
export function createRemoteCancelledError(
  message = "操作已取消"
): Error {
  const err = new Error(message)
  ;(err as any).code = REMOTE_OPERATION_CANCELLED
  ;(err as any).name = REMOTE_OPERATION_CANCELLED
  return err
}

/** 判断是否为用户取消 */
export function isRemoteOperationCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as { code?: unknown; name?: unknown; message?: unknown }
  const code = String(e.code || e.name || "")
  if (code === REMOTE_OPERATION_CANCELLED) return true
  const msg = String(e.message || "")
  return msg.includes("操作已取消")
}

/** 计算百分比；total 无效时返回 null */
export function progressPercent(
  loaded?: number,
  total?: number
): number | null {
  const l = Number(loaded)
  const t = Number(total)
  if (!Number.isFinite(l) || !Number.isFinite(t) || t <= 0) return null
  const pct = Math.round((Math.max(0, l) / t) * 100)
  return Math.min(100, Math.max(0, pct))
}

/** phase 英文 → 中文展示名 */
export function localizeProgressPhase(phase: unknown): string {
  const raw = String(phase ?? "").trim()
  if (!raw) return "进行中"
  return PHASE_LABELS[raw] || raw
}

/** 将 git 进度事件格式化为单行文案 */
export function formatRemoteProgress(
  event: GitProgressEvent | null | undefined
): string {
  const phase = localizeProgressPhase(event?.phase)
  const pct = progressPercent(event?.loaded, event?.total)
  if (pct == null) return phase
  return `${phase} ${pct}%`
}

/**
 * 操作按钮忙态文案：推送中…（50%）
 * percent 无效时仅「推送中…」
 */
export function formatBusyWithPercent(
  base: string,
  percent?: number | null
): string {
  const head = String(base || "").trim() || "进行中"
  const bare = head.replace(/…+$/, "").replace(/\.\.\.$/, "")
  if (percent == null || !Number.isFinite(percent)) return `${bare}…`
  const pct = Math.min(100, Math.max(0, Math.round(percent)))
  return `${bare}…（${pct}%）`
}

/**
 * 忙态按钮完整文案：优先百分比，否则附 phase（均用括号）
 * 例：推送中…（50%）、推送中…（先拉取最新）、拉取中…（接收对象）
 */
export function formatBusyActionLabel(
  base: string,
  info?: { percent?: number | null; phase?: string | null } | null
): string {
  const head = String(base || "").trim() || "进行中"
  const bare = head.replace(/…+$/, "").replace(/\.\.\.$/, "")
  if (info?.percent != null && Number.isFinite(info.percent)) {
    const pct = Math.min(100, Math.max(0, Math.round(info.percent)))
    return `${bare}…（${pct}%）`
  }
  const phase = String(info?.phase || "").trim()
  if (phase && phase !== "进行中") return `${bare}…（${phase}）`
  return `${bare}…`
}

/** 让出事件循环，便于 Scripting UI 在长任务中刷新进度 */
export function yieldForUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 事件 → UI 进度快照 */
export function toRemoteProgressInfo(
  event: GitProgressEvent | null | undefined
): RemoteProgressInfo {
  const loaded = Number(event?.loaded)
  const total = Number(event?.total)
  const safeLoaded = Number.isFinite(loaded) ? Math.max(0, loaded) : 0
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0
  const phase = localizeProgressPhase(event?.phase)
  const percent = progressPercent(safeLoaded, safeTotal)
  return {
    phase,
    loaded: safeLoaded,
    total: safeTotal,
    percent,
    label: formatRemoteProgress(event),
  }
}

/**
 * 组装传给 isomorphic-git 的 onProgress：
 * 先检查取消，再回调 UI。从 onProgress 抛出会中止当前 git 调用。
 */
export function createGitOnProgress(
  options?: RemoteOpOptions | null
): ((event: GitProgressEvent) => void | Promise<void>) | undefined {
  if (!options?.onProgress && !options?.cancelToken) return undefined
  return async (event: GitProgressEvent) => {
    options.cancelToken?.throwIfCancelled()
    if (options.onProgress) {
      await options.onProgress(toRemoteProgressInfo(event))
    }
    options.cancelToken?.throwIfCancelled()
  }
}

/** 在非 onProgress 检查点调用（fetch 与 merge 之间等） */
export function checkRemoteCancelled(
  options?: RemoteOpOptions | null
): void {
  options?.cancelToken?.throwIfCancelled()
}

/**
 * 手动上报进度（push 无 git 进度、HTTP 等待、merge 前后等）。
 * 会检查取消并让出事件循环，便于 UI 刷新。
 */
export async function emitRemoteProgress(
  options: RemoteOpOptions | null | undefined,
  phase: string,
  loaded = 0,
  total = 0
): Promise<void> {
  checkRemoteCancelled(options)
  if (options?.onProgress) {
    await options.onProgress(
      toRemoteProgressInfo({ phase, loaded, total })
    )
    await yieldForUi()
  }
  checkRemoteCancelled(options)
}
