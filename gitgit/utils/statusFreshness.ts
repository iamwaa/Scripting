export const REPO_STATUS_FRESHNESS_MS = 30000

export function buildRepoSetSignature(bookmarkNames: string[]): string {
  return bookmarkNames.slice().sort().join("\n")
}

export function shouldRefreshRepoStatuses(options: {
  now: number
  lastCompletedAt: number
  freshnessMs?: number
  repoSignature: string
  lastRepoSignature: string
  latestSnapshotAt: number
  force?: boolean
}): boolean {
  if (options.force) return true
  if (options.repoSignature !== options.lastRepoSignature) return true
  if (options.latestSnapshotAt > options.lastCompletedAt) return true
  const freshnessMs = Math.max(
    0,
    options.freshnessMs ?? REPO_STATUS_FRESHNESS_MS
  )
  return options.now - options.lastCompletedAt >= freshnessMs
}
