import { Script } from "scripting"
import { createFS, loadGitEngine } from "../gitCore"
import {
  findRepo,
  getGitdirPath,
  resolveWorkdir,
} from "../repoStore"
import { isStatusMatrixClean } from "../../utils/stash"

const GIT_REPOS_DIR = FileManager.appGroupDocumentsDirectory + "/git-repos"

export interface GitContext {
  git: any
  fs: any
  dir: string
  gitdir: string
}

export function resolveGitdir(bookmarkName: string): string {
  const repo = findRepo(bookmarkName)
  if (repo) return getGitdirPath(repo)
  const safe = bookmarkName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "repo"
  return GIT_REPOS_DIR + "/" + safe
}

export async function getCtx(bookmarkName: string): Promise<GitContext> {
  const dir = resolveWorkdir(bookmarkName)
  const gitdir = resolveGitdir(bookmarkName)
  if (!(await FileManager.exists(gitdir))) {
    await FileManager.createDirectory(gitdir, true)
  }
  if (!(await FileManager.exists(dir))) {
    throw new Error("工作区无法访问，请移除后重新添加目录: " + dir)
  }
  const { git } = await loadGitEngine()
  const fs = createFS(gitdir, dir)
  return { git, fs, dir, gitdir }
}

export async function runWithBackgroundKeepAlive<T>(
  operation: () => Promise<T>
): Promise<T> {
  let keepAliveStarted = false
  try {
    if (Script.env === "index") {
      keepAliveStarted = await BackgroundKeeper.keepAlive()
    }
    return await operation()
  } finally {
    if (keepAliveStarted) {
      await BackgroundKeeper.stopKeepAlive()
    }
  }
}

export async function isWorkdirEffectivelyEmpty(dir: string): Promise<boolean> {
  try {
    const items = await FileManager.readDirectory(dir)
    return !items.some((item) => {
      const name = String(item || "")
        .split("/")
        .filter(Boolean)
        .pop()
      return !!name && name !== ".DS_Store" && name !== ".git"
    })
  } catch (_e) {
    return true
  }
}

export async function runWithEmptyDirCleanup(
  fs: any,
  operation: () => Promise<void>
): Promise<void> {
  fs.clearEmptyWorkdirParentCandidates?.()
  try {
    await operation()
    await fs.pruneEmptyWorkdirParents?.()
  } catch (error) {
    fs.clearEmptyWorkdirParentCandidates?.()
    throw error
  }
}

export async function checkoutWithEmptyDirCleanup(
  git: any,
  fs: any,
  options: Record<string, unknown>
): Promise<void> {
  await runWithEmptyDirCleanup(fs, () => git.checkout({ fs, ...options }))
}

export async function ensureWorktreeMaterialized(
  git: any,
  fs: any,
  dir: string,
  gitdir: string
): Promise<void> {
  if (!(await FileManager.exists(gitdir + "/HEAD"))) return
  if (!(await isWorkdirEffectivelyEmpty(dir))) return
  try {
    await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" })
  } catch (_e) {
    return
  }
  await checkoutWithEmptyDirCleanup(git, fs, {
    dir,
    gitdir,
    force: true,
  })
}

/** 写空仓符号 HEAD */
export async function writeUnbornHead(fs: any, branch: string): Promise<void> {
  try {
    await fs.writeFile("HEAD", `ref: refs/heads/${branch}\n`)
  } catch (_e) {
    // HEAD 写失败不阻断主流程
  }
}

/**
 * 把 HEAD 写成符号引用指向 refs/heads/<branch>。
 * isomorphic-git 的 writeRef(symbolic:true) 会自己补 `ref: ` 前缀，
 * 直接写文件避免双重 `ref:` 前缀损坏 HEAD。
 */
export async function writeSymbolicHead(fs: any, branch: string): Promise<void> {
  await fs.writeFile("HEAD", `ref: refs/heads/${branch}\n`)
}

/** 从 HEAD 解析当前分支名（含空仓 unborn） */
export async function readSymbolicHeadBranch(fs: any): Promise<string | null> {
  try {
    const head = await fs.readFile("HEAD", "utf8")
    const match = String(head).match(/^ref:\s*refs\/heads\/(\S+)/m)
    return match ? match[1].trim() : null
  } catch (_e) {
    return null
  }
}

/** 是否已有至少一次提交 */
export async function hasAnyCommit(
  git: any,
  fs: any,
  dir: string,
  gitdir: string
): Promise<boolean> {
  try {
    const log = await git.log({ fs, dir, gitdir, depth: 1 })
    return Array.isArray(log) && log.length > 0
  } catch (_e) {
    return false
  }
}

/** 把身份写入仓库 git config */
export async function ensureGitConfigAuthor(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  author: { name: string; email: string }
): Promise<void> {
  try {
    await git.setConfig({ fs, dir, gitdir, path: "user.name", value: author.name })
    await git.setConfig({ fs, dir, gitdir, path: "user.email", value: author.email })
  } catch (_e) {
    // 身份配置失败不阻断主流程
  }
}

/** 分支切换前确认工作区干净 */
export async function assertWorktreeCleanForCheckout(
  git: any,
  fs: any,
  dir: string,
  gitdir: string
): Promise<void> {
  const matrix = (await git.statusMatrix({ fs, dir, gitdir })) as [
    string,
    number,
    number,
    number,
  ][]
  if (!isStatusMatrixClean(matrix)) {
    throw new Error("请先提交、暂存到 Stash 或丢弃当前改动，再切换分支")
  }
}

/** 强制 checkout 到目标 ref，使工作区与 index 与 ref 完全一致 */
export async function forceCheckoutRef(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  ref: string
): Promise<void> {
  await checkoutWithEmptyDirCleanup(git, fs, {
    dir,
    gitdir,
    ref,
    force: true,
  })
}
