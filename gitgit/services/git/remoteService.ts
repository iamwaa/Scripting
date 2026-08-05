import { createHttpTransport, createFS, loadGitEngine } from "../gitCore"
import { getAuth } from "../authStore"
import { DEFAULT_BRANCH } from "../../constants/git"
import { desiredOriginAfterFailedPush } from "../../utils/gitSync"
import {
  checkRemoteCancelled,
  createGitOnProgress,
  emitRemoteProgress,
  type RemoteOpOptions,
} from "../../utils/remoteProgress"
import {
  ensureWorktreeMaterialized,
  getCtx,
  hasAnyCommit,
  readSymbolicHeadBranch,
  resolveGitdir,
  writeUnbornHead,
} from "./runtime"

export interface CloneOptions extends RemoteOpOptions {
  upstream?: { url: string }
}

function requireAuth(): { username: string; password: string } {
  const auth = getAuth()
  if (!auth) throw new Error("未配置 GitHub Token，请在设置页添加")
  return auth
}

async function updateRemoteTrackingRef(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  remote: string,
  ref?: string
): Promise<void> {
  try {
    let branch = ref
    if (!branch) {
      branch = await git.currentBranch({ fs, dir, gitdir, fullname: false })
    }
    if (!branch) return
    const headOid = await git.resolveRef({
      fs,
      dir,
      gitdir,
      ref: "refs/heads/" + branch,
    })
    await git.writeRef({
      fs,
      dir,
      gitdir,
      ref: `refs/remotes/${remote}/${branch}`,
      value: headOid,
      force: true,
    })
    await git.setConfig({
      fs,
      dir,
      gitdir,
      path: `branch.${branch}.remote`,
      value: remote,
    })
    await git.setConfig({
      fs,
      dir,
      gitdir,
      path: `branch.${branch}.merge`,
      value: `refs/heads/${branch}`,
    })
  } catch (_e) {
    // tracking 同步失败不影响远端操作结果
  }
}

export async function pushInternal(
  bookmarkName: string,
  remote = "origin",
  ref?: string,
  force = false,
  options?: RemoteOpOptions,
  remoteRef?: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  checkRemoteCancelled(options)
  await emitRemoteProgress(options, "Connecting")
  const auth = requireAuth()
  const http = createHttpTransport(auth.username, auth.password)
  await emitRemoteProgress(options, "Uploading")
  await git.push({
    fs,
    dir,
    gitdir,
    http,
    onAuth: () => auth,
    remote,
    ref,
    remoteRef,
    force,
    onProgress: createGitOnProgress(options),
  })
  checkRemoteCancelled(options)
  await emitRemoteProgress(options, "Finalizing")
  await updateRemoteTrackingRef(git, fs, dir, gitdir, remote, ref)
}

export async function fetchRemoteInternal(
  bookmarkName: string,
  remote = "origin",
  ref?: string,
  prune = false
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const auth = requireAuth()
  const http = createHttpTransport(auth.username, auth.password)
  await git.fetch({
    fs,
    dir,
    gitdir,
    http,
    onAuth: () => auth,
    remote,
    ref,
    singleBranch: false,
    tags: false,
    prune,
  })
}

export async function cloneInternal(
  url: string,
  dir: string,
  gitdirKey: string,
  ref?: string,
  depth?: number,
  options?: CloneOptions
): Promise<void> {
  checkRemoteCancelled(options)
  if (!(await FileManager.exists(dir))) {
    await FileManager.createDirectory(dir, true)
  }
  const gitdir = resolveGitdir(gitdirKey)
  if (await FileManager.exists(gitdir)) {
    try {
      await FileManager.remove(gitdir)
    } catch (_e) {
      // 残留目录删除失败时由后续 clone 返回实际错误
    }
  }
  await FileManager.createDirectory(gitdir, true)
  checkRemoteCancelled(options)

  const { git } = await loadGitEngine()
  const fs = createFS(gitdir, dir)
  const auth = getAuth()
  const http = createHttpTransport(auth?.username, auth?.password)
  await emitRemoteProgress(options, "Connecting")
  await git.clone({
    fs,
    dir,
    gitdir,
    http,
    onAuth: () => (auth ? auth : { username: "anonymous", password: "" }),
    url,
    remote: "origin",
    ref,
    depth,
    singleBranch: false,
    onProgress: createGitOnProgress(options),
  })
  checkRemoteCancelled(options)
  await emitRemoteProgress(options, "Finalizing")
  if (options?.upstream) {
    await git.addRemote({
      fs,
      dir,
      gitdir,
      remote: "upstream",
      url: options.upstream.url,
    })
  }
  await ensureWorktreeMaterialized(git, fs, dir, gitdir)
}

export async function setOriginAndPushInternal(
  bookmarkName: string,
  remoteUrl: string,
  ref?: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const remotes = await git.listRemotes({ fs, dir, gitdir })
  const originalOrigin = remotes.find((item: any) => item.remote === "origin")
  try {
    if (originalOrigin) {
      await git.deleteRemote({ fs, dir, gitdir, remote: "origin" })
    }
    await git.addRemote({ fs, dir, gitdir, remote: "origin", url: remoteUrl })

    let branch = ref
    if (!branch) {
      try {
        branch =
          (await git.currentBranch({ fs, dir, gitdir, fullname: false })) ||
          undefined
      } catch (_e) {
        branch = undefined
      }
    }
    if (!branch) {
      branch = (await readSymbolicHeadBranch(fs)) || DEFAULT_BRANCH
      if (!(await hasAnyCommit(git, fs, dir, gitdir))) {
        await writeUnbornHead(fs, branch)
      } else {
        try {
          await git.branch({ fs, dir, gitdir, ref: branch, checkout: true })
        } catch (_e) {
          // 已有提交但无当前分支时继续尝试 push
        }
      }
    }

    const auth = requireAuth()
    await git.push({
      fs,
      dir,
      gitdir,
      http: createHttpTransport(auth.username, auth.password),
      onAuth: () => auth,
      remote: "origin",
      ref: branch,
    })
    await updateRemoteTrackingRef(git, fs, dir, gitdir, "origin", branch)
    try {
      await git.setConfig({
        fs,
        dir,
        gitdir,
        path: `branch.${branch}.remote`,
        value: "origin",
      })
      await git.setConfig({
        fs,
        dir,
        gitdir,
        path: `branch.${branch}.merge`,
        value: `refs/heads/${branch}`,
      })
    } catch (_e) {
      // 跟踪配置失败不阻断推送结果
    }
  } catch (error) {
    try {
      const current = await git.listRemotes({ fs, dir, gitdir })
      if (current.some((item: any) => item.remote === "origin")) {
        await git.deleteRemote({ fs, dir, gitdir, remote: "origin" })
      }
      const desired = desiredOriginAfterFailedPush(originalOrigin)
      if (desired) {
        await git.addRemote({
          fs,
          dir,
          gitdir,
          remote: "origin",
          url: desired.url,
        })
      }
    } catch (_rollbackError) {
      throw new Error(`设置 origin 失败且回滚失败：${String(error)}`)
    }
    throw error
  }
}
