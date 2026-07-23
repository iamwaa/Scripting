/**
 * utils/gitSync.ts - 同步拓扑 / 上传恢复 / 写操作互斥的纯逻辑
 *
 * 供 gitService、UploadGitHubPage 与自动化测试共用，避免把业务规则锁在
 * 依赖完整 Git 引擎或 UI 的路径里。
 */

import type { RepoMeta, RepoSyncState } from "../types/git"

/** 由本地/远端可达提交集合计算 ahead、behind 与同步状态 */
export function computeSyncTopology(
  localOid: string | null | undefined,
  remoteOid: string | null | undefined,
  localReachable: ReadonlySet<string>,
  remoteReachable: ReadonlySet<string>
): { ahead: number; behind: number; syncState: RepoSyncState } {
  if (!localOid || !remoteOid) {
    return { ahead: 0, behind: 0, syncState: "unknown" }
  }
  if (localOid === remoteOid) {
    return { ahead: 0, behind: 0, syncState: "upToDate" }
  }

  let ahead = 0
  let behind = 0
  for (const oid of localReachable) {
    if (!remoteReachable.has(oid)) ahead++
  }
  for (const oid of remoteReachable) {
    if (!localReachable.has(oid)) behind++
  }

  const syncState: RepoSyncState =
    ahead > 0 && behind > 0
      ? "diverged"
      : ahead > 0
        ? "ahead"
        : behind > 0
          ? "behind"
          : "upToDate"

  return { ahead, behind, syncState }
}

/** 由 ahead/behind 计数推导同步状态（merge-base 路径用） */
export function topologyFromCounts(
  ahead: number,
  behind: number
): { ahead: number; behind: number; syncState: RepoSyncState } {
  const a = Math.max(0, Math.floor(ahead) || 0)
  const b = Math.max(0, Math.floor(behind) || 0)
  const syncState: RepoSyncState =
    a > 0 && b > 0
      ? "diverged"
      : a > 0
        ? "ahead"
        : b > 0
          ? "behind"
          : "upToDate"
  return { ahead: a, behind: b, syncState }
}

/** 用 Widget 快照拼列表行状态，供首屏即时展示（冲突字段默认 0） */
export function repoListStatusFromSnapshot(snapshot: {
  branch: string | null
  uncommitted: number
  ahead: number
  behind: number
}): {
  branch: string | null
  uncommitted: number
  ahead: number
  behind: number
  syncState: RepoSyncState
  hasRemote: boolean
  workdirOk: boolean
  conflictCount: number
  mergeInProgress: boolean
} {
  const topology = topologyFromCounts(snapshot.ahead, snapshot.behind)
  return {
    branch: snapshot.branch,
    uncommitted: Math.max(0, snapshot.uncommitted || 0),
    ahead: topology.ahead,
    behind: topology.behind,
    syncState: topology.syncState,
    // 快照无 hasRemote：有 ahead/behind 时暗示曾对过远端
    hasRemote: topology.ahead > 0 || topology.behind > 0,
    workdirOk: true,
    conflictCount: 0,
    mergeInProgress: false,
  }
}

/** 上传时是否复用已创建远端，避免 Push 失败后重复建仓 */
export function resolveUploadRemoteTarget(input: {
  pendingRemoteUrl?: string | null
  pendingRemoteName?: string | null
  requestedName: string
}): {
  shouldCreateRemote: boolean
  remoteUrl: string | null
  remoteName: string
} {
  const requestedName = input.requestedName.trim()
  const pendingUrl = (input.pendingRemoteUrl || "").trim()
  if (pendingUrl) {
    const pendingName = (input.pendingRemoteName || "").trim()
    return {
      shouldCreateRemote: false,
      remoteUrl: pendingUrl,
      remoteName: pendingName || requestedName,
    }
  }
  return {
    shouldCreateRemote: true,
    remoteUrl: null,
    remoteName: requestedName,
  }
}

/** 远端创建成功但尚未推送成功时写入的 pending 字段 */
export function buildUploadPendingPatch(remote: {
  url: string
  name: string
}): Pick<RepoMeta, "pendingRemoteUrl" | "pendingRemoteName"> {
  return {
    pendingRemoteUrl: remote.url,
    pendingRemoteName: remote.name,
  }
}

/** 推送成功后清除 pending 并标记为已绑定远端的仓库 */
export function buildUploadSuccessPatch(input: {
  remoteName: string
  remoteUrl: string
  pushBranch: string
}): Pick<
  RepoMeta,
  | "name"
  | "remoteUrl"
  | "pendingRemoteUrl"
  | "pendingRemoteName"
  | "source"
  | "defaultBranch"
> {
  return {
    name: input.remoteName,
    remoteUrl: input.remoteUrl,
    pendingRemoteUrl: undefined,
    pendingRemoteName: undefined,
    source: "clone",
    defaultBranch: input.pushBranch,
  }
}

/**
 * Push 失败后 origin 应恢复到的目标：
 * - 原先有 origin → 恢复原 URL
 * - 原先无 origin → 删除临时 origin（null）
 */
export function desiredOriginAfterFailedPush(
  originalOrigin: { url: string } | null | undefined
): { url: string } | null {
  if (originalOrigin?.url) return { url: originalOrigin.url }
  return null
}

/** 尝试获取仓库级写锁；已占用时返回 false */
export function acquireRepoMutationLock(
  locks: Set<string>,
  lockKey: string
): boolean {
  if (locks.has(lockKey)) return false
  locks.add(lockKey)
  return true
}

/** 释放仓库级写锁 */
export function releaseRepoMutationLock(
  locks: Set<string>,
  lockKey: string
): void {
  locks.delete(lockKey)
}
