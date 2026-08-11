import type {
  MergeConflictState,
  RepoListStatus,
  RepoSyncState,
} from "../../types/git"
import {
  computeSyncTopology,
  topologyFromCounts,
} from "../../utils/gitSync"
import { checkRemoteCancelled, type RemoteOpOptions } from "../../utils/remoteProgress"
import { measureOperation } from "../../utils/performance"
import { findRepo, resolveWorkdir } from "../repoStore"
import { getCtx, resolveGitdir, type GitContext } from "./runtime"
import { matrixToStatus } from "./statusQueryService"

async function readSymbolicHeadBranch(fs: any): Promise<string | null> {
  try {
    const head = await fs.readFile("HEAD", "utf8")
    const match = String(head).match(/^ref:\s*refs\/heads\/(\S+)/m)
    return match ? match[1].trim() : null
  } catch (_e) {
    return null
  }
}

async function collectReachableCommits(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  startOid: string
): Promise<Set<string>> {
  const visited = new Set<string>()
  const pending = [startOid]
  while (pending.length > 0) {
    const oid = pending.pop()!
    if (visited.has(oid)) continue
    visited.add(oid)
    const result = await git.readCommit({ fs, dir, gitdir, oid })
    for (const parent of result.commit.parent || []) pending.push(parent)
  }
  return visited
}

export async function countCommitsUntil(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  tipOid: string,
  stopOid: string | null,
  maxCount = Number.POSITIVE_INFINITY,
  options?: RemoteOpOptions
): Promise<number> {
  if (!tipOid || tipOid === stopOid) return 0
  let count = 0
  let current: string | null = tipOid
  const seen = new Set<string>()
  while (current && current !== stopOid && count < maxCount) {
    checkRemoteCancelled(options)
    if (seen.has(current)) break
    seen.add(current)
    count++
    const result: { commit: { parent?: string[] } } = await git.readCommit({
      fs,
      dir,
      gitdir,
      oid: current,
    })
    current = result.commit.parent?.[0] || null
  }
  return count
}

export async function getSyncTopology(
  bookmarkName: string,
  branch: string,
  ctx?: GitContext
): Promise<{ ahead: number; behind: number; syncState: RepoSyncState }> {
  try {
    const { git, fs, dir, gitdir } = ctx || (await getCtx(bookmarkName))
    const [localOid, remoteOid] = await Promise.all([
      git.resolveRef({ fs, dir, gitdir, ref: "refs/heads/" + branch }),
      git.resolveRef({ fs, dir, gitdir, ref: "refs/remotes/origin/" + branch }),
    ])
    if (!localOid || !remoteOid) {
      return { ahead: 0, behind: 0, syncState: "unknown" }
    }
    if (localOid === remoteOid) {
      return { ahead: 0, behind: 0, syncState: "upToDate" }
    }
    try {
      const bases = (await git.findMergeBase({
        fs,
        dir,
        gitdir,
        oids: [localOid, remoteOid],
      })) as string[]
      const base = bases?.[0] || null
      if (base) {
        const [ahead, behind] = await Promise.all([
          countCommitsUntil(git, fs, dir, gitdir, localOid, base),
          countCommitsUntil(git, fs, dir, gitdir, remoteOid, base),
        ])
        return topologyFromCounts(ahead, behind)
      }
    } catch (_e) {
      // merge-base 失败时回退完整可达集合
    }
    const [localReachable, remoteReachable] = await Promise.all([
      collectReachableCommits(git, fs, dir, gitdir, localOid),
      collectReachableCommits(git, fs, dir, gitdir, remoteOid),
    ])
    return computeSyncTopology(
      localOid,
      remoteOid,
      localReachable,
      remoteReachable
    )
  } catch (_e) {
    return { ahead: 0, behind: 0, syncState: "unknown" }
  }
}

export async function getRepoListStatusInternal(
  bookmarkName: string,
  readMergeState: (bookmarkName: string) => Promise<MergeConflictState | null>,
  knownUncommitted?: number
): Promise<RepoListStatus> {
  try {
    const dir = resolveWorkdir(bookmarkName)
    if (!(await FileManager.exists(dir))) {
      return {
        branch: null,
        uncommitted: 0,
        ahead: 0,
        behind: 0,
        syncState: "unknown",
        hasRemote: false,
        workdirOk: false,
        conflictCount: 0,
        mergeInProgress: false,
        error: "工作区不可访问",
      }
    }
    const gitdir = resolveGitdir(bookmarkName)
    if (!(await FileManager.exists(gitdir + "/HEAD"))) {
      return {
        branch: null,
        uncommitted: 0,
        ahead: 0,
        behind: 0,
        syncState: "upToDate",
        hasRemote: false,
        workdirOk: true,
        conflictCount: 0,
        mergeInProgress: false,
      }
    }

    const ctx = await getCtx(bookmarkName)
    const diagnosticName = findRepo(bookmarkName)?.name || bookmarkName
    const { git, fs, dir: workDir, gitdir: contextGitdir } = ctx
    let uncommitted = Math.max(
      0,
      Math.floor(knownUncommitted ?? 0) || 0
    )
    if (knownUncommitted == null) {
      try {
        const matrix = (await measureOperation(
          "扫描列表仓库状态",
          () => git.statusMatrix({
            fs,
            dir: workDir,
            gitdir: contextGitdir,
          }),
          diagnosticName
        )) as [string, number, number, number][]
        for (const [, head, work, stage] of matrix) {
          if (head === 1 && work === 1 && stage === 1) continue
          if (matrixToStatus(head, work, stage) !== "unmodified") uncommitted++
        }
      } catch (_e) {
        uncommitted = 0
      }
    }

    let current: string | null = null
    try {
      current = await git.currentBranch({
        fs,
        dir: workDir,
        gitdir: contextGitdir,
        fullname: false,
      })
    } catch (_e) {
      current = null
    }
    if (!current) current = await readSymbolicHeadBranch(fs)

    let hasRemote = false
    try {
      const remotes = (await git.listRemotes({
        fs,
        dir: workDir,
        gitdir: contextGitdir,
      })) as { remote: string; url: string }[]
      hasRemote = remotes.length > 0
    } catch (_e) {
      hasRemote = false
    }

    const topology = hasRemote && current
      ? await measureOperation(
          "计算仓库同步拓扑",
          () => getSyncTopology(bookmarkName, current!, ctx),
          diagnosticName
        )
      : { ahead: 0, behind: 0, syncState: "upToDate" as RepoSyncState }
    let conflictCount = 0
    let mergeInProgress = false
    try {
      const merge = await readMergeState(bookmarkName)
      if (merge) {
        mergeInProgress = true
        conflictCount = merge.conflicts.length
      }
    } catch (_e) {
      // 合并摘要失败不阻断列表
    }
    return {
      branch: current,
      uncommitted,
      ahead: topology.ahead,
      behind: topology.behind,
      syncState: topology.syncState,
      hasRemote,
      workdirOk: true,
      conflictCount,
      mergeInProgress,
    }
  } catch (error: any) {
    return {
      branch: null,
      uncommitted: 0,
      ahead: 0,
      behind: 0,
      syncState: "unknown",
      hasRemote: false,
      workdirOk: false,
      conflictCount: 0,
      mergeInProgress: false,
      error: String(error?.message || error),
    }
  }
}
