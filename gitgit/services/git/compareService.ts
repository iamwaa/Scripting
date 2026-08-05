import type { CommitEntry, RefCompareResult } from "../../types/git"
import { resolvePullTarget } from "../../utils/branchMerge"
import { topologyFromCounts } from "../../utils/gitSync"
import { parseUpstreamConfig } from "../../utils/remote"
import {
  checkRemoteCancelled,
  emitRemoteProgress,
  type RemoteOpOptions,
} from "../../utils/remoteProgress"
import { getCtx, type GitContext } from "./runtime"

const COMPARE_COMMITS_LIMIT = 200

async function findFirstParentMergeBase(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  leftOid: string,
  rightOid: string,
  options?: RemoteOpOptions,
  maxSteps = 500
): Promise<string | null> {
  let left: string | null = leftOid
  let right: string | null = rightOid
  const leftSeen = new Set<string>()
  const rightSeen = new Set<string>()
  for (let step = 0; step < maxSteps && (left || right); step++) {
    checkRemoteCancelled(options)
    if (left) {
      if (rightSeen.has(left)) return left
      if (leftSeen.has(left)) left = null
      else {
        leftSeen.add(left)
        const result: { commit: { parent?: string[] } } =
          await git.readCommit({ fs, dir, gitdir, oid: left })
        left = result.commit.parent?.[0] || null
      }
    }
    if (right) {
      if (leftSeen.has(right)) return right
      if (rightSeen.has(right)) right = null
      else {
        rightSeen.add(right)
        const result: { commit: { parent?: string[] } } =
          await git.readCommit({ fs, dir, gitdir, oid: right })
        right = result.commit.parent?.[0] || null
      }
    }
  }
  return null
}

async function withCompareTimeout<T>(
  task: Promise<T>,
  timeoutMs = 15000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("提交历史过大，对比超时；请先拉取刷新后重试")),
          timeoutMs
        )
      }),
    ])
  } finally {
    if (timer != null) clearTimeout(timer)
  }
}

async function countCommitsUntil(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  tipOid: string,
  stopOid: string | null,
  maxCount: number,
  options?: RemoteOpOptions
): Promise<number> {
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

async function collectCompareCommits(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  tipOid: string,
  stopOid: string | null,
  limit: number,
  options?: RemoteOpOptions
): Promise<CommitEntry[]> {
  const entries: CommitEntry[] = []
  let current: string | null = tipOid
  const seen = new Set<string>()
  while (current && current !== stopOid && entries.length < limit) {
    checkRemoteCancelled(options)
    if (seen.has(current)) break
    seen.add(current)
    const result: {
      commit: {
        message?: string
        author?: { name?: string; email?: string; timestamp?: number }
        parent?: string[]
      }
    } = await git.readCommit({ fs, dir, gitdir, oid: current })
    entries.push({
      oid: current,
      message: String(result.commit.message || "").trim(),
      author: {
        name: result.commit.author?.name || "",
        email: result.commit.author?.email || "",
      },
      date: new Date((result.commit.author?.timestamp || 0) * 1000).toISOString(),
    })
    current = result.commit.parent?.[0] || null
  }
  return entries
}

async function compareWithUpstreamInternal(
  bookmarkName: string,
  ctx?: GitContext,
  options?: RemoteOpOptions
): Promise<RefCompareResult | null> {
  await emitRemoteProgress(options, "读取远端配置", 5, 100)
  const { git, fs, dir, gitdir } = ctx || (await getCtx(bookmarkName))
  const branch = await git.currentBranch({ fs, dir, gitdir, fullname: false })
  if (!branch) throw new Error("当前处于分离 HEAD，无法对比")

  let remoteName: string | undefined
  let mergeRef: string | undefined
  try {
    remoteName = await git.getConfig({
      fs,
      dir,
      gitdir,
      path: `branch.${branch}.remote`,
    })
  } catch (_e) {
    remoteName = undefined
  }
  try {
    mergeRef = await git.getConfig({
      fs,
      dir,
      gitdir,
      path: `branch.${branch}.merge`,
    })
  } catch (_e) {
    mergeRef = undefined
  }
  const target = resolvePullTarget({
    localBranch: branch,
    upstream: parseUpstreamConfig(remoteName, mergeRef),
  })
  const baseTrack = `origin/${branch}`
  const targetTrack = target.track

  let baseOid: string | null = null
  let targetOid: string | null = null
  try {
    baseOid = await git.resolveRef({
      fs,
      dir,
      gitdir,
      ref: `refs/remotes/origin/${branch}`,
    })
  } catch (_e) {
    baseOid = null
  }
  try {
    targetOid = await git.resolveRef({
      fs,
      dir,
      gitdir,
      ref: `refs/remotes/${target.remote}/${target.remoteBranch}`,
    })
  } catch (_e) {
    targetOid = null
  }
  if (!baseOid || !targetOid) return null
  await emitRemoteProgress(options, "查找共同祖先", 15, 100)

  let mergeBaseOid: string | null = baseOid === targetOid ? baseOid : null
  if (!mergeBaseOid) {
    mergeBaseOid = await findFirstParentMergeBase(
      git,
      fs,
      dir,
      gitdir,
      baseOid,
      targetOid,
      options
    )
    if (!mergeBaseOid) {
      checkRemoteCancelled(options)
      try {
        const bases = (await withCompareTimeout(
          git.findMergeBase({ fs, dir, gitdir, oids: [baseOid, targetOid] })
        )) as string[]
        mergeBaseOid = bases?.[0] || null
        checkRemoteCancelled(options)
      } catch (error: any) {
        if (String(error?.message || error).includes("对比超时")) throw error
        mergeBaseOid = null
      }
    }
  }

  await emitRemoteProgress(options, "统计领先与落后", 45, 100)
  const [ahead, behind] = await Promise.all([
    countCommitsUntil(
      git,
      fs,
      dir,
      gitdir,
      baseOid,
      mergeBaseOid,
      COMPARE_COMMITS_LIMIT + 1,
      options
    ),
    countCommitsUntil(
      git,
      fs,
      dir,
      gitdir,
      targetOid,
      mergeBaseOid,
      COMPARE_COMMITS_LIMIT + 1,
      options
    ),
  ])
  await emitRemoteProgress(options, "加载差异提交", 70, 100)
  const [aheadCommits, behindCommits] = await Promise.all([
    collectCompareCommits(
      git,
      fs,
      dir,
      gitdir,
      baseOid,
      mergeBaseOid,
      COMPARE_COMMITS_LIMIT,
      options
    ),
    collectCompareCommits(
      git,
      fs,
      dir,
      gitdir,
      targetOid,
      mergeBaseOid,
      COMPARE_COMMITS_LIMIT,
      options
    ),
  ])
  await emitRemoteProgress(options, "完成对比", 100, 100)

  return {
    localBranch: branch,
    track: targetTrack,
    baseTrack,
    targetTrack,
    localOid: baseOid,
    remoteOid: targetOid,
    baseOid,
    targetOid,
    mergeBaseOid,
    syncState: topologyFromCounts(ahead, behind).syncState,
    ahead,
    behind,
    aheadCommits,
    behindCommits,
    localFiles: [],
    remoteFiles: [],
  }
}

export function compareWithUpstream(
  bookmarkName: string,
  ctx?: GitContext,
  options?: RemoteOpOptions
): Promise<RefCompareResult | null> {
  return withCompareTimeout(
    compareWithUpstreamInternal(bookmarkName, ctx, options),
    30000
  )
}
