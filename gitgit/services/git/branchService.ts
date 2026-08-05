import { createHttpTransport } from "../gitCore"
import { getAuth } from "../authStore"
import {
  planDeleteBranch,
  planDeleteRemoteBranch,
  planRenameBranch,
} from "../../utils/branch"
import {
  checkRemoteCancelled,
  createGitOnProgress,
  emitRemoteProgress,
  type RemoteOpOptions,
} from "../../utils/remoteProgress"
import type { RenameBranchResult } from "../../types/git"
import {
  assertWorktreeCleanForCheckout,
  forceCheckoutRef,
  getCtx,
  hasAnyCommit,
  writeUnbornHead,
} from "./runtime"

export type PushBranchOperation = (
  bookmarkName: string,
  remote: string,
  ref?: string,
  force?: boolean,
  options?: RemoteOpOptions,
  remoteRef?: string
) => Promise<void>

function requireAuth(): { username: string; password: string } {
  const auth = getAuth()
  if (!auth) throw new Error("未配置 GitHub Token，请在设置页添加")
  return auth
}

export async function createBranchInternal(
  bookmarkName: string,
  name: string,
  checkout = true
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await hasAnyCommit(git, fs, dir, gitdir))) {
    await writeUnbornHead(fs, name)
    return
  }
  if (checkout) {
    await assertWorktreeCleanForCheckout(git, fs, dir, gitdir)
  }
  await git.branch({ fs, dir, gitdir, ref: name, checkout: false })
  if (checkout) await forceCheckoutRef(git, fs, dir, gitdir, name)
}

export async function checkoutBranchInternal(
  bookmarkName: string,
  ref: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await hasAnyCommit(git, fs, dir, gitdir))) {
    await writeUnbornHead(fs, ref)
    return
  }
  const name = ref.replace(/^origin\//, "").trim()
  if (!name) throw new Error("分支名称无效")
  await assertWorktreeCleanForCheckout(git, fs, dir, gitdir)

  let locals: string[] = []
  try {
    locals = await git.listBranches({ fs, dir, gitdir })
  } catch (_e) {
    locals = []
  }
  if (locals.includes(name)) {
    await forceCheckoutRef(git, fs, dir, gitdir, name)
    return
  }

  let remoteOid: string | null = null
  try {
    remoteOid = await git.resolveRef({
      fs,
      dir,
      gitdir,
      ref: "refs/remotes/origin/" + name,
    })
  } catch (_e) {
    remoteOid = null
  }
  if (!remoteOid) {
    throw new Error(`本地与 origin 均无分支「${name}」。可先拉取以刷新远端分支列表。`)
  }
  await git.branch({
    fs,
    dir,
    gitdir,
    ref: name,
    object: remoteOid,
    checkout: false,
  })
  await forceCheckoutRef(git, fs, dir, gitdir, name)
  try {
    await git.setConfig({
      fs,
      dir,
      gitdir,
      path: `branch.${name}.remote`,
      value: "origin",
    })
    await git.setConfig({
      fs,
      dir,
      gitdir,
      path: `branch.${name}.merge`,
      value: `refs/heads/${name}`,
    })
  } catch (_e) {
    // 跟踪配置失败不阻断切换
  }
}

export async function deleteBranchInternal(
  bookmarkName: string,
  target: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  let locals: string[] = []
  try {
    locals = await git.listBranches({ fs, dir, gitdir })
  } catch (_e) {
    locals = []
  }
  let current: string | null = null
  try {
    current = await git.currentBranch({ fs, dir, gitdir, fullname: false })
  } catch (_e) {
    current = null
  }
  const planned = planDeleteBranch(locals, current, target)
  await git.deleteBranch({ fs, dir, gitdir, ref: planned.branch })
  try {
    await git.setConfig({
      fs,
      dir,
      gitdir,
      path: `branch.${planned.branch}.remote`,
      value: undefined,
    })
    await git.setConfig({
      fs,
      dir,
      gitdir,
      path: `branch.${planned.branch}.merge`,
      value: undefined,
    })
  } catch (_e) {
    // 跟踪配置清理失败不阻断删除
  }
}

export async function deleteRemoteBranchInternal(
  bookmarkName: string,
  remote: string,
  branch: string,
  options?: RemoteOpOptions
): Promise<void> {
  const planned = planDeleteRemoteBranch(remote, branch)
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
    remote: planned.remote,
    ref: `refs/remotes/${planned.remote}/${planned.branch}`,
    remoteRef: `refs/heads/${planned.branch}`,
    delete: true,
    onProgress: createGitOnProgress(options),
  })
  checkRemoteCancelled(options)
  try {
    await git.deleteRef({
      fs,
      dir,
      gitdir,
      ref: `refs/remotes/${planned.remote}/${planned.branch}`,
    })
  } catch (_e) {
    // 无对应跟踪 ref 时忽略
  }
}

export async function renameBranchInternal(
  bookmarkName: string,
  from: string,
  to: string,
  pushBranch: PushBranchOperation,
  options?: RemoteOpOptions
): Promise<RenameBranchResult> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  let locals: string[] = []
  try {
    locals = await git.listBranches({ fs, dir, gitdir })
  } catch (_e) {
    locals = []
  }
  let current: string | null = null
  try {
    current = await git.currentBranch({ fs, dir, gitdir, fullname: false })
  } catch (_e) {
    current = null
  }
  const planned = planRenameBranch(locals, current, from, to)
  let oldRemote: string | null = null
  try {
    oldRemote =
      ((await git.getConfig({
        fs,
        dir,
        gitdir,
        path: `branch.${planned.from}.remote`,
      })) as string | undefined) ?? null
  } catch (_e) {
    oldRemote = null
  }
  await git.renameBranch({
    fs,
    dir,
    gitdir,
    oldref: planned.from,
    ref: planned.to,
  })
  if (oldRemote) {
    try {
      await git.setConfig({
        fs,
        dir,
        gitdir,
        path: `branch.${planned.to}.remote`,
        value: oldRemote,
      })
      await git.setConfig({
        fs,
        dir,
        gitdir,
        path: `branch.${planned.to}.merge`,
        value: `refs/heads/${planned.to}`,
      })
      await git.setConfig({
        fs,
        dir,
        gitdir,
        path: `branch.${planned.from}.remote`,
        value: undefined,
      })
      await git.setConfig({
        fs,
        dir,
        gitdir,
        path: `branch.${planned.from}.merge`,
        value: undefined,
      })
    } catch (_e) {
      // 跟踪配置迁移失败不阻断本地重命名
    }
  }

  const result: RenameBranchResult = {
    from: planned.from,
    to: planned.to,
    oldRemote,
    pushedNewBranch: false,
    deletedOldRemoteBranch: false,
    remoteError: null,
  }
  if (oldRemote) {
    try {
      await pushBranch(
        bookmarkName,
        oldRemote,
        planned.to,
        false,
        options,
        `refs/heads/${planned.to}`
      )
      result.pushedNewBranch = true
      await deleteRemoteBranchInternal(
        bookmarkName,
        oldRemote,
        planned.from,
        options
      )
      result.deletedOldRemoteBranch = true
    } catch (error: any) {
      result.remoteError = String(error?.message || error)
    }
  }
  return result
}
