import {
  assertCanAddRemote,
  parseUpstreamConfig,
  planDeleteRemote,
  planSetRemoteUrl,
  planSetUpstream,
  repoRemoteUrlMetaAfterChange,
  shouldClearRepoRemoteUrlMeta,
  type UpstreamConfig,
} from "../../utils/remote"
import { updateRepo } from "../repoStore"
import { getCtx } from "./runtime"

export interface RemoteInfo {
  remote: string
  url: string
}

export async function listRemotes(bookmarkName: string): Promise<RemoteInfo[]> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  return git.listRemotes({ fs, dir, gitdir })
}

export async function hasRemoteBranch(
  bookmarkName: string,
  branch: string,
  remote = "origin"
): Promise<boolean> {
  const prefix = remote + "/"
  const name = (branch.startsWith(prefix) ? branch.slice(prefix.length) : branch).trim()
  if (!name) return false
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  try {
    await git.resolveRef({
      fs,
      dir,
      gitdir,
      ref: `refs/remotes/${remote}/${name}`,
    })
    return true
  } catch (_e) {
    return false
  }
}

export async function addRemoteInternal(
  bookmarkName: string,
  remote: string,
  url: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const remotes = (await git.listRemotes({ fs, dir, gitdir })) as RemoteInfo[]
  const planned = assertCanAddRemote(remotes, remote, url)
  await git.addRemote({
    fs,
    dir,
    gitdir,
    remote: planned.remote,
    url: planned.url,
  })
  const metaUrl = repoRemoteUrlMetaAfterChange(planned.remote, planned.url)
  if (metaUrl) {
    try {
      updateRepo(bookmarkName, { remoteUrl: metaUrl })
    } catch (_e) {
      // 元数据失败不回滚 Git 配置
    }
  }
}

export async function setRemoteUrlInternal(
  bookmarkName: string,
  remote: string,
  url: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const remotes = (await git.listRemotes({ fs, dir, gitdir })) as RemoteInfo[]
  const planned = planSetRemoteUrl(remotes, remote, url)
  try {
    await git.deleteRemote({ fs, dir, gitdir, remote: planned.remote })
    await git.addRemote({
      fs,
      dir,
      gitdir,
      remote: planned.remote,
      url: planned.nextUrl,
    })
  } catch (error) {
    try {
      const current = (await git.listRemotes({ fs, dir, gitdir })) as RemoteInfo[]
      if (current.some((item) => item.remote === planned.remote)) {
        await git.deleteRemote({ fs, dir, gitdir, remote: planned.remote })
      }
      if (planned.rollback.action === "restore") {
        await git.addRemote({
          fs,
          dir,
          gitdir,
          remote: planned.rollback.remote,
          url: planned.rollback.url,
        })
      }
    } catch (_rollbackError) {
      throw new Error(`修改远端 URL 失败且回滚失败：${String(error)}`)
    }
    throw error
  }
  const metaUrl = repoRemoteUrlMetaAfterChange(planned.remote, planned.nextUrl)
  if (metaUrl) {
    try {
      updateRepo(bookmarkName, { remoteUrl: metaUrl })
    } catch (_e) {
      // 元数据失败不阻断配置变更
    }
  }
}

export async function deleteRemoteInternal(
  bookmarkName: string,
  remote: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const remotes = (await git.listRemotes({ fs, dir, gitdir })) as RemoteInfo[]
  const planned = planDeleteRemote(remotes, remote)
  try {
    await git.deleteRemote({ fs, dir, gitdir, remote: planned.remote })
  } catch (error) {
    try {
      const current = (await git.listRemotes({ fs, dir, gitdir })) as RemoteInfo[]
      const stillThere = current.some((item) => item.remote === planned.remote)
      if (!stillThere && planned.rollback.action === "restore") {
        await git.addRemote({
          fs,
          dir,
          gitdir,
          remote: planned.rollback.remote,
          url: planned.rollback.url,
        })
      }
    } catch (_rollbackError) {
      throw new Error(`删除远端失败且回滚失败：${String(error)}`)
    }
    throw error
  }
  if (shouldClearRepoRemoteUrlMeta(planned.remote)) {
    try {
      updateRepo(bookmarkName, {
        remoteUrl: undefined,
        pendingRemoteUrl: undefined,
        pendingRemoteName: undefined,
      })
    } catch (_e) {
      // 元数据失败不阻断配置变更
    }
  }
}

export async function getBranchUpstream(
  bookmarkName: string,
  branch?: string
): Promise<UpstreamConfig | null> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  let branchName = (branch || "").trim()
  if (!branchName) {
    try {
      branchName = (await git.currentBranch({ fs, dir, gitdir, fullname: false })) || ""
    } catch (_e) {
      branchName = ""
    }
  }
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

export async function setBranchUpstreamInternal(
  bookmarkName: string,
  branch: string,
  remote: string,
  merge?: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const remotes = (await git.listRemotes({ fs, dir, gitdir })) as RemoteInfo[]
  const planned = planSetUpstream(
    remotes,
    branch,
    remote,
    merge && String(merge).trim() ? merge : branch
  )
  let locals: string[] = []
  try {
    locals = await git.listBranches({ fs, dir, gitdir })
  } catch (_e) {
    locals = []
  }
  if (locals.length > 0 && !locals.includes(planned.branch)) {
    throw new Error(`本地分支「${planned.branch}」不存在`)
  }
  await git.setConfig({
    fs,
    dir,
    gitdir,
    path: `branch.${planned.branch}.remote`,
    value: planned.remote,
  })
  await git.setConfig({
    fs,
    dir,
    gitdir,
    path: `branch.${planned.branch}.merge`,
    value: planned.merge,
  })
}
