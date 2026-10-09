export const REPO_STATUS_FRESHNESS_MS = 30000

// 新鲜期只认本仓库的成功读取与写入代次，不把 Widget 快照更新时间当变更信号。
export function isRepoStatusFresh(options: {
  now: number
  completedAt: number
  revision: number
  currentRevision: number
  force?: boolean
}): boolean {
  const age = options.now - options.completedAt
  return !options.force &&
    options.revision === options.currentRevision &&
    Number.isFinite(age) && age >= 0 && age < REPO_STATUS_FRESHNESS_MS
}
