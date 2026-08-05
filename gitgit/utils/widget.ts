import type { RepoSnapshot } from "../types/git"

export const WIDGET_STALE_AFTER_MS = 24 * 60 * 60 * 1000

export interface WidgetSummary {
  snapshots: RepoSnapshot[]
  repoCount: number
  dirtyRepoCount: number
  uncommitted: number
  ahead: number
  behind: number
  latestUpdatedAt: number | null
  isStale: boolean
  parameter: string
  parameterMatched: boolean
}

function normalizeParameter(parameter: string): string {
  return parameter.trim().toLocaleLowerCase()
}

function activityScore(snapshot: RepoSnapshot): number {
  return snapshot.uncommitted * 10000 + snapshot.behind * 100 + snapshot.ahead
}

export function buildWidgetSummary(
  snapshots: RepoSnapshot[],
  parameter = "",
  now = Date.now()
): WidgetSummary {
  const normalizedParameter = normalizeParameter(parameter)
  const selected = normalizedParameter
    ? snapshots.filter(
        (snapshot) =>
          snapshot.name.trim().toLocaleLowerCase() === normalizedParameter
      )
    : snapshots
  const sorted = [...selected].sort((left, right) => {
    const scoreDifference = activityScore(right) - activityScore(left)
    if (scoreDifference !== 0) return scoreDifference
    return right.updatedAt - left.updatedAt
  })
  const latestUpdatedAt = sorted.reduce<number | null>(
    (latest, snapshot) =>
      latest == null || snapshot.updatedAt > latest
        ? snapshot.updatedAt
        : latest,
    null
  )

  return {
    snapshots: sorted,
    repoCount: sorted.length,
    dirtyRepoCount: sorted.filter((snapshot) => snapshot.uncommitted > 0).length,
    uncommitted: sorted.reduce(
      (total, snapshot) => total + snapshot.uncommitted,
      0
    ),
    ahead: sorted.reduce((total, snapshot) => total + snapshot.ahead, 0),
    behind: sorted.reduce((total, snapshot) => total + snapshot.behind, 0),
    latestUpdatedAt,
    isStale:
      latestUpdatedAt != null && now - latestUpdatedAt > WIDGET_STALE_AFTER_MS,
    parameter: parameter.trim(),
    parameterMatched: !normalizedParameter || sorted.length > 0,
  }
}

export function formatWidgetUpdatedAt(
  updatedAt: number | null,
  now = Date.now()
): string {
  if (updatedAt == null) return "暂无更新"
  const elapsed = Math.max(0, now - updatedAt)
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return "刚刚更新"
  if (minutes < 60) return `${minutes} 分钟前更新`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前更新`
  const days = Math.floor(hours / 24)
  return `${days} 天前更新`
}
