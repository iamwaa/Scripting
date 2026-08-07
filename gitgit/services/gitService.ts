/**
 * services/gitService.ts - 高层 Git 操作封装
 *
 * 基于 gitCore（引擎 + fs）与 repoStore，向上提供面向 bookmarkName 的语义化 Git 操作。
 * .git 分离存储：gitdir 放 App Group git-repos/<repoId>/，工作区走安全范围书签解析。
 */

import { Widget } from "scripting"
import {
  resolveGitdir,
  runWithBackgroundKeepAlive,
} from "./git/runtime"
import {
  applyStashInternal,
  dropStashInternal,
  listStashes,
} from "./git/stashService"
import {
  compareCommitTrees,
  getCommitDetail,
} from "./git/commitService"
import { compareWithUpstream } from "./git/compareService"
import {
  getBranches,
  getManagedBranches,
  getRemoteBranches,
} from "./git/branchQueryService"
import {
  getChanges,
  getLog,
  getLogPage,
  hasHeadCommit,
  getTrackedFiles,
} from "./git/statusQueryService"
import { getRepoListStatusInternal } from "./git/repoStatusService"
import {
  amendHeadCommitInternal,
  revertCommitInternal,
  softResetHeadInternal,
} from "./git/historyMutationService"
import {
  addRemoteInternal,
  deleteRemoteInternal,
  getBranchUpstream,
  hasRemoteBranch,
  listRemotes,
  setBranchUpstreamInternal,
  setRemoteUrlInternal,
} from "./git/remoteConfigService"
export type { RemoteInfo } from "./git/remoteConfigService"
import {
  checkoutBranchInternal,
  createBranchInternal,
  deleteBranchInternal,
  deleteRemoteBranchInternal,
  renameBranchInternal,
} from "./git/branchService"
import {
  abortMergeInternal,
  autoMarkResolvedConflictsInternal,
  completeMergeInternal,
  getMergeConflictState,
  listConflictFiles,
  resolveConflictFileInternal,
} from "./git/mergeConflictService"
import {
  mergeBranchIntoCurrentInternal,
  pullInternal,
} from "./git/mergeService"
import {
  cloneInternal,
  fetchRemoteInternal,
  pushInternal,
  setOriginAndPushInternal,
  type CloneOptions,
} from "./git/remoteService"
import {
  addFilesInternal,
  commitInternal,
  createStashInternal,
  initRepoInternal,
  isInitialized,
  restoreFileInternal,
  unstageFilesInternal,
} from "./git/worktreeService"
import {
  findRepo,
  getRepoId,
  writeSnapshot,
} from "./repoStore"
import {
  acquireRepoMutationLock,
  releaseRepoMutationLock,
} from "../utils/gitSync"
import type {
  AutoMarkConflictsResult,
  ConflictResolution,
} from "../utils/mergeConflict"
import type {
  MergeIntoCurrentResult,
  PullResult,
} from "../utils/branchMerge"
import type { RemoteOpOptions } from "../utils/remoteProgress"
import type {
  RenameBranchResult,
  RepoListStatus,
} from "../types/git"


const repoMutationLocks = new Set<string>()

async function runRepoMutation<T>(
  bookmarkName: string,
  operation: () => Promise<T>,
  refreshSnapshot = true
): Promise<T> {
  const lockKey = resolveGitdir(bookmarkName)
  if (!acquireRepoMutationLock(repoMutationLocks, lockKey)) {
    throw new Error("该仓库正在执行其它写操作，请稍后再试")
  }
  try {
    return await operation()
  } finally {
    releaseRepoMutationLock(repoMutationLocks, lockKey)
    if (refreshSnapshot) await refreshRepoSnapshot(bookmarkName)
  }
}

async function persistRepoSnapshot(
  bookmarkName: string,
  status: RepoListStatus
): Promise<void> {
  const repo = findRepo(bookmarkName)
  if (!repo) return
  try {
    await writeSnapshot(bookmarkName, {
      name: repo.name,
      branch: status.branch,
      uncommitted: status.uncommitted,
      ahead: status.ahead,
      behind: status.behind,
      updatedAt: Date.now(),
    })
    Widget.reloadAll()
  } catch (e) {
    console.warn("⚠️ 仓库快照写入失败: " + e)
  }
}

async function refreshRepoSnapshot(bookmarkName: string): Promise<void> {
  try {
    await getRepoListStatus(bookmarkName)
  } catch (e) {
    console.warn("⚠️ 仓库快照刷新失败: " + e)
  }
}

/** 仓库是否已初始化（gitdir 下存在 HEAD 且 config 可读） */

/** 获取认证（未配置则抛出友好错误） */

/** gitdir 内合并状态文件名（非标准 git，供 UI 恢复冲突列表） */

/**
 * 执行 merge(abortOnConflict=false)；冲突时写状态并抛友好错误。
 * 干净合并后 force checkout 当前分支以对齐工作区。
 */

/** 查询当前合并冲突状态 */

/**
 * 只 fetch 不 merge：刷新 refs/remotes/<remote>/<branch>，不改动工作区/索引。
 * 用于重编/回退前让「未推送」安全判定基于最新的远端 tip，
 * 避免因远端跟踪引用陈旧把「远端已领先」误判为「未推送」。
 */

/**
 * 仓库列表用轻量状态：改动数 + 是否领先远端（待推送）+ 合并冲突
 * 单次 getCtx，避免 getChanges/getBranches/listRemotes 重复装载引擎。
 * ahead 计算失败时记 0，不阻断列表渲染。
 */

export async function getRepoListStatus(
  bookmarkName: string,
  knownUncommitted?: number
): Promise<RepoListStatus> {
  const status = await getRepoListStatusInternal(
    bookmarkName,
    getMergeConflictState,
    knownUncommitted
  )
  await persistRepoSnapshot(bookmarkName, status)
  return status
}


/**
 * 绑定 origin 并推送当前分支（上传 GitHub 用）。
 * 若已有 origin 则更新 URL。
 */

export async function initRepo(bookmarkName: string): Promise<void> {
  return runRepoMutation(bookmarkName, () => initRepoInternal(bookmarkName), false)
}

export async function addFiles(
  bookmarkName: string,
  filepath: string
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    addFilesInternal(bookmarkName, filepath)
  )
}

/** 全部暂存：复用 addFiles(".") 含删除语义 */
export async function stageAll(bookmarkName: string): Promise<void> {
  return addFiles(bookmarkName, ".")
}

/** 取消暂存；filepath="." 或省略表示全部 */
export async function unstageFiles(
  bookmarkName: string,
  filepath: string = "."
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    unstageFilesInternal(bookmarkName, filepath)
  )
}

/** 全部取消暂存 */
export async function unstageAll(bookmarkName: string): Promise<void> {
  return unstageFiles(bookmarkName, ".")
}

/** 创建 Stash */
export async function createStash(
  bookmarkName: string,
  message: string = ""
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    createStashInternal(bookmarkName, message)
  )
}

/** 应用 Stash，保留列表项 */
export async function applyStash(
  bookmarkName: string,
  index: number
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    applyStashInternal(bookmarkName, index)
  )
}

/** 删除 Stash */
export async function dropStash(
  bookmarkName: string,
  index: number
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    dropStashInternal(bookmarkName, index)
  )
}

export async function commit(
  bookmarkName: string,
  message: string,
  author?: { name: string; email: string }
): Promise<string> {
  return runRepoMutation(bookmarkName, () =>
    commitInternal(bookmarkName, message, author)
  )
}

export async function createBranch(
  bookmarkName: string,
  name: string,
  checkout = true
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    createBranchInternal(bookmarkName, name, checkout)
  )
}

export async function checkoutBranch(
  bookmarkName: string,
  ref: string
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    checkoutBranchInternal(bookmarkName, ref)
  )
}

/** 删除本地分支（不能删当前分支） */
export async function deleteBranch(
  bookmarkName: string,
  target: string
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    deleteBranchInternal(bookmarkName, target)
  )
}

/** 重命名本地分支；旧分支发布过时自动同步远端（推新分支 + 删远端旧分支） */
export async function renameBranch(
  bookmarkName: string,
  from: string,
  to: string,
  options?: RemoteOpOptions
): Promise<RenameBranchResult> {
  return runWithBackgroundKeepAlive(() =>
    runRepoMutation(bookmarkName, () =>
      renameBranchInternal(bookmarkName, from, to, pushInternal, options)
    )
  )
}

/** 删除远端分支（push --delete） */
export async function deleteRemoteBranch(
  bookmarkName: string,
  remote: string,
  branch: string,
  options?: RemoteOpOptions
): Promise<void> {
  return runWithBackgroundKeepAlive(() =>
    runRepoMutation(bookmarkName, () =>
      deleteRemoteBranchInternal(bookmarkName, remote, branch, options)
    )
  )
}

export async function restoreFile(
  bookmarkName: string,
  filepath: string
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    restoreFileInternal(bookmarkName, filepath)
  )
}

export async function addRemote(
  bookmarkName: string,
  remote: string,
  url: string
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    addRemoteInternal(bookmarkName, remote, url)
  )
}

/** 修改已有 remote 的 URL（失败回滚） */
export async function setRemoteUrl(
  bookmarkName: string,
  remote: string,
  url: string
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    setRemoteUrlInternal(bookmarkName, remote, url)
  )
}

/** 删除 remote（失败尽量回滚） */
export async function deleteRemote(
  bookmarkName: string,
  remote: string
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    deleteRemoteInternal(bookmarkName, remote)
  )
}

/** 设置当前或指定分支的 upstream */
export async function setBranchUpstream(
  bookmarkName: string,
  branch: string,
  remote: string,
  merge?: string
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    setBranchUpstreamInternal(bookmarkName, branch, remote, merge)
  )
}

export async function push(
  bookmarkName: string,
  remote = "origin",
  ref?: string,
  force = false,
  options?: RemoteOpOptions
): Promise<void> {
  return runWithBackgroundKeepAlive(() =>
    runRepoMutation(bookmarkName, () =>
      pushInternal(bookmarkName, remote, ref, force, options)
    )
  )
}

export async function pull(
  bookmarkName: string,
  remote = "origin",
  ref?: string,
  author?: { name: string; email: string },
  options?: RemoteOpOptions
): Promise<PullResult> {
  return runWithBackgroundKeepAlive(() =>
    runRepoMutation(bookmarkName, () =>
      pullInternal(bookmarkName, remote, ref, author, options)
    )
  )
}

/** 将指定分支合并进当前分支（本地名或 origin/xxx） */
export async function mergeBranchIntoCurrent(
  bookmarkName: string,
  source: string,
  author?: { name: string; email: string }
): Promise<MergeIntoCurrentResult> {
  return runRepoMutation(bookmarkName, () =>
    mergeBranchIntoCurrentInternal(bookmarkName, source, author)
  )
}

/** 解决单个冲突文件：ours / theirs / manual */
export async function resolveConflictFile(
  bookmarkName: string,
  filepath: string,
  resolution: ConflictResolution
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    resolveConflictFileInternal(bookmarkName, filepath, resolution)
  )
}

/**
 * 扫描工作区冲突文件并批量标记已解决：
 * 无残留冲突标记（或文件已删除）的自动标记，其余保留并回报。
 */
export async function autoMarkResolvedConflicts(
  bookmarkName: string
): Promise<AutoMarkConflictsResult> {
  return runRepoMutation(bookmarkName, () =>
    autoMarkResolvedConflictsInternal(bookmarkName)
  )
}

/** 冲突全部解决后创建合并提交 */
export async function completeMerge(
  bookmarkName: string,
  message?: string,
  author?: { name: string; email: string }
): Promise<string> {
  return runRepoMutation(
    bookmarkName,
    () => completeMergeInternal(bookmarkName, message, author),
    false
  )
}

/** 中止合并并恢复冲突前工作区 */
export async function abortMerge(bookmarkName: string): Promise<void> {
  return runRepoMutation(bookmarkName, () => abortMergeInternal(bookmarkName))
}

export async function fetchRemote(
  bookmarkName: string,
  remote = "origin",
  ref?: string,
  prune = false
): Promise<void> {
  return runWithBackgroundKeepAlive(() =>
    runRepoMutation(bookmarkName, () =>
      fetchRemoteInternal(bookmarkName, remote, ref, prune)
    )
  )
}

export async function clone(
  url: string,
  dir: string,
  gitdirKey: string,
  ref?: string,
  depth?: number,
  options?: CloneOptions
): Promise<void> {
  return runWithBackgroundKeepAlive(() =>
    runRepoMutation(gitdirKey, () =>
      cloneInternal(url, dir, gitdirKey, ref, depth, options)
    )
  )
}

/** 重导给 UI：远程操作进度/取消选项 */
export type { RemoteOpOptions } from "../utils/remoteProgress"
export {
  RemoteCancelToken,
  isRemoteOperationCancelled,
} from "../utils/remoteProgress"

export async function revertCommit(
  bookmarkName: string,
  oid: string,
  author?: { name: string; email: string }
): Promise<string> {
  return runRepoMutation(bookmarkName, () =>
    revertCommitInternal(bookmarkName, oid, author)
  )
}

export async function softResetHead(
  bookmarkName: string
): Promise<{ parentOid: string }> {
  return runRepoMutation(bookmarkName, () => softResetHeadInternal(bookmarkName))
}

export async function amendHeadCommit(
  bookmarkName: string,
  message: string,
  author?: { name: string; email: string }
): Promise<string> {
  return runRepoMutation(bookmarkName, () =>
    amendHeadCommitInternal(bookmarkName, message, author)
  )
}

export async function setOriginAndPush(
  bookmarkName: string,
  remoteUrl: string,
  ref?: string
): Promise<void> {
  return runRepoMutation(bookmarkName, () =>
    setOriginAndPushInternal(bookmarkName, remoteUrl, ref)
  )
}

/** 导出 repoId 辅助，供 clone 页预分配 gitdir */
export {
  getRepoId,
  listStashes,
  compareCommitTrees,
  getCommitDetail,
  compareWithUpstream,
  getBranches,
  getManagedBranches,
  getRemoteBranches,
  getChanges,
  getLog,
  getLogPage,
  hasHeadCommit,
  getTrackedFiles,
  listRemotes,
  hasRemoteBranch,
  getBranchUpstream,
  getMergeConflictState,
  listConflictFiles,
  isInitialized,
}
