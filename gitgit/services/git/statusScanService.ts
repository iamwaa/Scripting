import type { RepoListStatus, FileChange } from "../../types/git"
import { statusCoordinator as coordinator } from "./matrixScanService"
export { scanStatusMatrix } from "./matrixScanService"
export type { StatusMatrix } from "./matrixScanService"
import { isRepoStatusFresh } from "../../utils/statusFreshness"
import { resolveGitdir } from "./runtime"

export type StatusReadOptions = { source?: string; force?: boolean }

type CachedStatus = {
  status: RepoListStatus
  completedAt: number
  revision: number
}

type CachedChanges = {
  changes: FileChange[]
  completedAt: number
  revision: number
}

const statusCache = new Map<string, CachedStatus>()
const changesCache = new Map<string, CachedChanges>()
const changesCounts = new Map<string, { count: number; revision: number; completedAt: number }>()

export function statusRevision(bookmarkName: string): number {
  return coordinator.revision(resolveGitdir(bookmarkName))
}

export function canPublishStatus(bookmarkName: string, revision: number): boolean {
  const key = resolveGitdir(bookmarkName)
  return !coordinator.isWriting(key) && revision === coordinator.revision(key)
}

export async function runStatusRead<T>(bookmarkName: string, task: () => Promise<T>): Promise<T> {
  const key = resolveGitdir(bookmarkName)
  for (;;) {
    const result = await coordinator.read(key, async () => {
      const revision = coordinator.revision(key)
      return { revision, value: await task() }
    })
    // 等待旧读取期间出现写入时，不把旧工作区状态交给页面；屏障释放后重读。
    if (!coordinator.isWriting(key) && result.revision === coordinator.revision(key)) return result.value
  }
}

export async function runStatusMutation<T>(
  bookmarkName: string,
  task: () => Promise<T>
): Promise<T> {
  const key = resolveGitdir(bookmarkName)
  return coordinator.mutate(key, async () => {
    statusCache.delete(key)
    changesCounts.delete(key)
    changesCache.delete(key)
    try {
      return await task()
    } finally {
      statusCache.delete(key)
      changesCounts.delete(key)
      changesCache.delete(key)
    }
  })
}

export function getCachedRepoStatus(bookmarkName: string, freshOnly = false): RepoListStatus | undefined {
  const key = resolveGitdir(bookmarkName)
  const cached = statusCache.get(key)
  if (!cached || coordinator.isWriting(key) || cached.revision !== coordinator.revision(key)) return undefined
  if (freshOnly && !isRepoStatusFresh({
    now: Date.now(), completedAt: cached.completedAt,
    revision: cached.revision, currentRevision: coordinator.revision(key),
  })) return undefined
  return { ...cached.status }
}

export function cacheRepoStatus(bookmarkName: string, status: RepoListStatus, revision: number): void {
  const key = resolveGitdir(bookmarkName)
  if (!canPublishStatus(bookmarkName, revision)) return
  // 扫描错误不能成为“无改动”的新鲜缓存。
  if (status.error || !status.workdirOk) {
    statusCache.delete(key)
    return
  }
  statusCache.set(key, { status: { ...status }, completedAt: Date.now(), revision })
}

/** 详情“出现”可复用的按仓改动列表；下拉、写后与代次变化仍实时扫描 */
export function getCachedRepoChanges(bookmarkName: string): FileChange[] | undefined {
  const key = resolveGitdir(bookmarkName)
  const cached = changesCache.get(key)
  if (!cached || coordinator.isWriting(key) || cached.revision !== coordinator.revision(key)) return undefined
  if (!isRepoStatusFresh({
    now: Date.now(), completedAt: cached.completedAt,
    revision: cached.revision, currentRevision: coordinator.revision(key),
  })) return undefined
  return cached.changes.map((change) => ({ ...change }))
}

export function cacheRepoChanges(bookmarkName: string, changes: FileChange[], revision: number): void {
  const key = resolveGitdir(bookmarkName)
  if (!canPublishStatus(bookmarkName, revision)) return
  changesCache.set(key, {
    changes: changes.map((change) => ({ ...change })),
    completedAt: Date.now(), revision,
  })
}

export function rememberChangesCount(bookmarkName: string, count: number, revision: number): void {
  const key = resolveGitdir(bookmarkName)
  if (canPublishStatus(bookmarkName, revision)) {
    changesCounts.set(key, { count, revision, completedAt: Date.now() })
  }
}

export function validatedChangesCount(bookmarkName: string, count?: number): number | undefined {
  if (count == null) return undefined
  const key = resolveGitdir(bookmarkName)
  const known = changesCounts.get(key)
  return known && known.count === count && isRepoStatusFresh({
    now: Date.now(), completedAt: known.completedAt,
    revision: known.revision, currentRevision: coordinator.revision(key),
  }) ? count : undefined
}

