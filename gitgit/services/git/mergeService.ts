import { createHttpTransport } from "../gitCore"
import { getAuth, resolveAuthor } from "../authStore"
import { DEFAULT_BRANCH } from "../../constants/git"
import {
  buildConflictFilesFromErrorData,
  defaultMergeCommitMessage,
  getMergeConflictErrorData,
  isMergeConflictError,
} from "../../utils/mergeConflict"
import {
  planMergeIntoCurrent,
  resolvePullTarget,
  type MergeIntoCurrentResult,
  type PullResult,
} from "../../utils/branchMerge"
import { parseUpstreamConfig } from "../../utils/remote"
import {
  checkRemoteCancelled,
  createGitOnProgress,
  emitRemoteProgress,
  type RemoteOpOptions,
} from "../../utils/remoteProgress"
import {
  ensureGitConfigAuthor,
  ensureWorktreeMaterialized,
  forceCheckoutRef,
  getCtx,
  hasAnyCommit,
  readSymbolicHeadBranch,
  runWithEmptyDirCleanup,
} from "./runtime"
import {
  assertNoMergeInProgress,
  clearMergeStateFile,
  listUnmergedPathsFromIndex,
  throwMergeConflictUserError,
  writeMergeStateFile,
} from "./mergeConflictService"

async function runMergeWithConflictHandling(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  options: {
    oursBranch: string
    theirsRef: string
    oursOid: string
    theirsOid: string
    oursLabel: string
    theirsLabel: string
    author: { name: string; email: string }
  }
): Promise<void> {
  const mergeMessage = defaultMergeCommitMessage(
    options.theirsLabel,
    options.oursLabel
  )
  try {
    await runWithEmptyDirCleanup(fs, () =>
      git.merge({
        fs,
        dir,
        gitdir,
        ours: options.oursBranch,
        theirs: options.theirsRef,
        abortOnConflict: false,
        message: mergeMessage,
        author: options.author,
        committer: options.author,
      })
    )
  } catch (error: any) {
    if (!isMergeConflictError(error)) throw error
    const data = getMergeConflictErrorData(error)
    let conflicts = buildConflictFilesFromErrorData(data)
    if (conflicts.length === 0) {
      const unmerged = await listUnmergedPathsFromIndex(git, fs, dir, gitdir)
      conflicts = unmerged.map((filepath) => ({
        filepath,
        kind: "bothModified" as const,
      }))
    }
    if (conflicts.length === 0) {
      throw new Error(
        "合并冲突，但未能识别冲突文件列表：" +
          String(error?.message || error)
      )
    }
    await writeMergeStateFile(gitdir, {
      oursOid: options.oursOid,
      theirsOid: options.theirsOid,
      oursLabel: options.oursLabel,
      theirsLabel: options.theirsLabel,
      message: mergeMessage,
      conflicts,
      startedAt: Date.now(),
    })
    throwMergeConflictUserError(conflicts)
  }

  await clearMergeStateFile(gitdir)
  try {
    await forceCheckoutRef(git, fs, dir, gitdir, options.oursBranch)
  } catch (_e) {
    await ensureWorktreeMaterialized(git, fs, dir, gitdir)
  }
}

async function resolveMergeSourceRef(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  source: string
): Promise<{ ref: string; label: string; oid: string }> {
  const candidates: { ref: string; label: string }[] = []
  if (source.startsWith("origin/")) {
    const short = source.slice("origin/".length)
    candidates.push({
      ref: `refs/remotes/origin/${short}`,
      label: `origin/${short}`,
    })
    candidates.push({ ref: `refs/heads/${short}`, label: short })
  } else if (source.includes("/")) {
    candidates.push({ ref: `refs/remotes/${source}`, label: source })
    candidates.push({ ref: `refs/heads/${source}`, label: source })
  } else {
    candidates.push({ ref: `refs/heads/${source}`, label: source })
    candidates.push({
      ref: `refs/remotes/origin/${source}`,
      label: `origin/${source}`,
    })
  }
  for (const candidate of candidates) {
    try {
      const oid = await git.resolveRef({
        fs,
        dir,
        gitdir,
        ref: candidate.ref,
      })
      if (oid) return { ...candidate, oid: String(oid) }
    } catch (_e) {
      // 继续尝试下一个候选
    }
  }
  throw new Error(
    `找不到分支「${source}」。可先拉取以刷新远端分支列表，或确认本地分支名。`
  )
}

async function readUpstreamForBranch(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  branchName: string
): Promise<{ remote: string; merge: string } | null> {
  if (!branchName) return null
  let remote: string | undefined
  let merge: string | undefined
  try {
    remote = await git.getConfig({
      fs,
      dir,
      gitdir,
      path: `branch.${branchName}.remote`,
    })
  } catch (_e) {
    remote = undefined
  }
  try {
    merge = await git.getConfig({
      fs,
      dir,
      gitdir,
      path: `branch.${branchName}.merge`,
    })
  } catch (_e) {
    merge = undefined
  }
  return parseUpstreamConfig(remote, merge)
}

export async function pullInternal(
  bookmarkName: string,
  remote = "origin",
  ref?: string,
  author?: { name: string; email: string },
  options?: RemoteOpOptions
): Promise<PullResult> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  checkRemoteCancelled(options)
  await assertNoMergeInProgress(gitdir)
  const auth = getAuth()
  const http = createHttpTransport(auth?.username, auth?.password)
  const resolvedAuthor = await resolveAuthor(author)
  await ensureGitConfigAuthor(git, fs, dir, gitdir, resolvedAuthor)
  await emitRemoteProgress(options, "Connecting")

  const explicitRef = (ref || "").trim()
  let currentLocal = ""
  try {
    currentLocal =
      (await git.currentBranch({ fs, dir, gitdir, fullname: false })) || ""
  } catch (_e) {
    currentLocal = ""
  }
  if (!currentLocal) {
    currentLocal = (await readSymbolicHeadBranch(fs)) || DEFAULT_BRANCH
  }
  const upstream = explicitRef
    ? null
    : await readUpstreamForBranch(git, fs, dir, gitdir, currentLocal)
  const target = resolvePullTarget({
    localBranch: explicitRef ? explicitRef : currentLocal,
    remote,
    explicitRef: explicitRef || undefined,
    upstream,
  })
  const pullRemote = target.remote
  const localBranch = target.localBranch
  const remoteBranch = target.remoteBranch
  const trackRef = `refs/remotes/${pullRemote}/${remoteBranch}`

  await git.fetch({
    fs,
    dir,
    gitdir,
    http,
    onAuth: () => (auth ? auth : { username: "anonymous", password: "" }),
    remote: pullRemote,
    ref: remoteBranch,
    singleBranch: false,
    tags: false,
    onProgress: createGitOnProgress(options),
  })
  checkRemoteCancelled(options)
  await emitRemoteProgress(options, "Merging")
  const resultBase = {
    branch: localBranch,
    remote: pullRemote,
    remoteBranch,
    usedUpstream: target.usedUpstream,
  }

  let oursOid: string
  try {
    oursOid = await git.resolveRef({
      fs,
      dir,
      gitdir,
      ref: "refs/heads/" + localBranch,
    })
  } catch (_e) {
    try {
      const remoteOid = await git.resolveRef({ fs, dir, gitdir, ref: trackRef })
      await git.branch({
        fs,
        dir,
        gitdir,
        ref: localBranch,
        object: remoteOid,
        checkout: false,
      })
      await forceCheckoutRef(git, fs, dir, gitdir, localBranch)
      await ensureWorktreeMaterialized(git, fs, dir, gitdir)
      return { status: "updated", ...resultBase }
    } catch (error: any) {
      throw new Error(
        `拉取失败：本地无提交且无法跟踪 ${pullRemote}/${remoteBranch} — ` +
          String(error?.message || error)
      )
    }
  }

  let theirsOid: string
  try {
    theirsOid = await git.resolveRef({ fs, dir, gitdir, ref: trackRef })
  } catch (_e) {
    await ensureWorktreeMaterialized(git, fs, dir, gitdir)
    return { status: "upToDate", ...resultBase }
  }
  if (oursOid === theirsOid) {
    await ensureWorktreeMaterialized(git, fs, dir, gitdir)
    return { status: "upToDate", ...resultBase }
  }
  await runMergeWithConflictHandling(git, fs, dir, gitdir, {
    oursBranch: localBranch,
    theirsRef: trackRef,
    oursOid,
    theirsOid,
    oursLabel: localBranch,
    theirsLabel: `${pullRemote}/${remoteBranch}`,
    author: resolvedAuthor,
  })
  return { status: "updated", ...resultBase }
}

export async function mergeBranchIntoCurrentInternal(
  bookmarkName: string,
  source: string,
  author?: { name: string; email: string }
): Promise<MergeIntoCurrentResult> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  await assertNoMergeInProgress(gitdir)
  let current = ""
  try {
    current =
      (await git.currentBranch({ fs, dir, gitdir, fullname: false })) || ""
  } catch (_e) {
    current = ""
  }
  if (!current) current = (await readSymbolicHeadBranch(fs)) || ""
  const planned = planMergeIntoCurrent(current, source)
  if (!(await hasAnyCommit(git, fs, dir, gitdir))) {
    throw new Error("仓库尚无提交，无法合并分支")
  }

  let oursOid: string
  try {
    oursOid = await git.resolveRef({
      fs,
      dir,
      gitdir,
      ref: "refs/heads/" + planned.current,
    })
  } catch (_e) {
    throw new Error(`当前分支「${planned.current}」无有效提交，无法合并`)
  }
  const resolved = await resolveMergeSourceRef(
    git,
    fs,
    dir,
    gitdir,
    planned.source
  )
  if (oursOid === resolved.oid) {
    await ensureWorktreeMaterialized(git, fs, dir, gitdir)
    return {
      status: "upToDate",
      ours: planned.current,
      theirs: resolved.label,
    }
  }
  const resolvedAuthor = await resolveAuthor(author)
  await ensureGitConfigAuthor(git, fs, dir, gitdir, resolvedAuthor)
  await runMergeWithConflictHandling(git, fs, dir, gitdir, {
    oursBranch: planned.current,
    theirsRef: resolved.ref,
    oursOid,
    theirsOid: resolved.oid,
    oursLabel: planned.current,
    theirsLabel: resolved.label,
    author: resolvedAuthor,
  })
  return {
    status: "merged",
    ours: planned.current,
    theirs: resolved.label,
  }
}
