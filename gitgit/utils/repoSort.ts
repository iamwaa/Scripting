/**
 * utils/repoSort.ts - 仓库列表排序（纯函数，无副作用）
 *
 * 待处理仓库优先，组内固定按仓库名 A→Z 展示，不改动持久化数组。
 */

import type {
  RepoListStatus,
  RepoMeta,
  RepoSnapshot,
} from "../types/git"

/** 首字符是否为 ASCII（数字/英文等） */
function isAsciiLeading(name: string): boolean {
  return name.length > 0 && name.charCodeAt(0) < 128
}

/**
 * 名称比较：忽略大小写与首尾空格，数字按自然序。
 * ASCII 名在前、中文名按拼音在后（与系统文件 App 一致）；
 * 直接用 zh-Hans localeCompare 会把中文排到最前面。
 */
function compareName(a: RepoMeta, b: RepoMeta): number {
  const left = (a.name || "").trim()
  const right = (b.name || "").trim()
  const leftAscii = isAsciiLeading(left)
  if (leftAscii !== isAsciiLeading(right)) return leftAscii ? -1 : 1
  const result = left.localeCompare(right, "zh-Hans", {
    sensitivity: "base",
    numeric: true,
  })
  if (result !== 0) return result
  // 仅大小写不同时保证顺序稳定
  return left < right ? -1 : left > right ? 1 : 0
}

/** 按仓库名升序返回新数组，不修改入参 */
export function sortReposByName(repos: RepoMeta[]): RepoMeta[] {
  return repos.slice().sort(compareName)
}

function hasPendingStatus(
  status?: RepoListStatus,
  snapshot?: RepoSnapshot
): boolean {
  if (status) {
    return status.uncommitted > 0 ||
      status.ahead > 0 ||
      status.behind > 0 ||
      status.mergeInProgress ||
      status.conflictCount > 0 ||
      !status.workdirOk ||
      !!status.error
  }
  return !!snapshot && (
    snapshot.uncommitted > 0 ||
    snapshot.ahead > 0 ||
    snapshot.behind > 0
  )
}

/** 待处理仓库置顶，待处理组与普通组内仍按名称排序。 */
export function sortReposForList(
  repos: RepoMeta[],
  statuses: Readonly<Record<string, RepoListStatus>>,
  snapshots: Readonly<Record<string, RepoSnapshot>> = {}
): RepoMeta[] {
  return repos.slice().sort((left, right) => {
    const leftPending = hasPendingStatus(
      statuses[left.bookmarkName],
      snapshots[left.bookmarkName]
    )
    const rightPending = hasPendingStatus(
      statuses[right.bookmarkName],
      snapshots[right.bookmarkName]
    )
    if (leftPending !== rightPending) return leftPending ? -1 : 1
    return compareName(left, right)
  })
}
