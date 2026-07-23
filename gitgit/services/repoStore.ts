/**
 * services/repoStore.ts - 仓库元数据持久化 + 工作目录访问
 *
 * 路径策略：
 *  1. 选目录时创建稳定安全范围书签（accessBookmarkName）
 *  2. 每次 resolve 优先 bookmarkedPath(accessBookmarkName)，再回退 workdir
 *  3. gitdir 使用短 repoId，不把完整路径当目录名
 *  4. 移除仓库时删除 gitdir 缓存 + 访问书签 + 快照，避免旧索引污染新仓库
 */

import type { RepoMeta, RepoSnapshot, RepoSource } from "../types/git"
import {
  readRepos,
  writeRepos,
  readSnapshots as loadAllSnapshots,
  writeSnapshots,
} from "./storage"

const GIT_REPOS_DIR = FileManager.appGroupDocumentsDirectory + "/git-repos"

/** 读取仓库列表 */
export function listRepos(): RepoMeta[] {
  return readRepos()
}

/** 生成短 repoId（作主键 / gitdir 名） */
export function createRepoId(): string {
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 解析仓库稳定 ID */
export function getRepoId(repo: RepoMeta): string {
  if (repo.repoId) return repo.repoId
  // 旧数据：用 bookmarkName 规整，兼容已有 gitdir
  return repo.bookmarkName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "repo"
}

/** gitdir 绝对路径 */
export function getGitdirPath(repo: RepoMeta): string {
  return GIT_REPOS_DIR + "/" + getRepoId(repo)
}

/** 访问书签稳定名 */
function accessBookmarkFor(repoId: string): string {
  return "gitgit-access-" + repoId
}

/**
 * 为目录创建/刷新稳定安全范围书签。
 * 返回书签名；失败时返回 null（路径可能仍临时可访问）。
 */
function ensureAccessBookmark(path: string, repoId: string): string | null {
  const name = accessBookmarkFor(repoId)
  try {
    // 先删同名旧书签，避免指向失效路径
    if (FileManager.bookmarkExists(name)) {
      FileManager.removeFileBookmark(name)
    }
  } catch (_e) {
    /* 忽略 */
  }
  try {
    const created = FileManager.addFileBookmark(path, name)
    return created || name
  } catch (_e) {
    return null
  }
}

/** 通过安全范围书签解析真实路径 */
function pathFromAccessBookmark(bookmarkName?: string | null): string | null {
  if (!bookmarkName) return null
  try {
    if (!FileManager.bookmarkExists(bookmarkName)) return null
    return FileManager.bookmarkedPath(bookmarkName)
  } catch (_e) {
    return null
  }
}

/** 规范化可比较路径 */
function normalizePath(path: string): string {
  return path.replace(/\/+$/, "")
}

/** 判断书签是否仍被其它仓库引用 */
function isAccessBookmarkShared(
  repos: RepoMeta[],
  bookmarkName: string,
  excludedBookmarkName?: string
): boolean {
  return repos.some(
    (item) =>
      item.bookmarkName !== excludedBookmarkName &&
      item.accessBookmarkName === bookmarkName
  )
}

/** 计算子目录相对于书签根目录的稳定路径 */
function relativePathFromRoot(path: string, root: string): string | null {
  const child = normalizePath(path)
  const parent = normalizePath(root)
  if (child === parent) return ""
  if (!child.startsWith(parent + "/")) return null
  return child.slice(parent.length + 1)
}

/** 用当前书签根目录恢复其下的工作目录 */
function resolveRelativeWorkdir(root: string, relative?: string): string {
  const base = normalizePath(root)
  return relative ? base + "/" + relative.replace(/^\/+|\/+$/g, "") : base
}

/**
 * 选择目录并建立安全范围书签（优先 pickDirectoryBookmark）。
 * 同时返回路径与书签名，供后续每次访问解析。
 */
export async function pickDirectory(): Promise<{
  path: string
  name: string
  accessBookmarkName: string | null
} | null> {
  // 优先书签 API：跨会话可恢复安全访问
  try {
    const preferred = "gitgit-pick-" + Date.now().toString(36)
    const result = await DocumentPicker.pickDirectoryBookmark({
      preferredName: preferred,
    })
    if (result) {
      const path = result.path
      const name = path.split("/").filter(Boolean).pop() || "unnamed"
      return {
        path,
        name,
        accessBookmarkName: result.bookmarkName,
      }
    }
    return null
  } catch (_e) {
    // 回退：普通选目录 + 手动 addFileBookmark
  }

  const path = await DocumentPicker.pickDirectory()
  if (!path) return null
  const name = path.split("/").filter(Boolean).pop() || "unnamed"
  const tempId = createRepoId()
  const accessBookmarkName = ensureAccessBookmark(path, tempId)
  return { path, name, accessBookmarkName }
}

/** 选择目录并注册为本地仓库 */
export async function addRepoByPicker(): Promise<RepoMeta | null> {
  const picked = await pickDirectory()
  if (!picked) return null

  const repoId = createRepoId()
  // 把临时书签迁移为稳定 repoId 书签
  let accessBookmarkName = picked.accessBookmarkName
  const stable = ensureAccessBookmark(picked.path, repoId)
  if (stable) accessBookmarkName = stable
  // 清理 pick 产生的临时书签
  if (
    picked.accessBookmarkName &&
    picked.accessBookmarkName !== accessBookmarkName
  ) {
    try {
      FileManager.removeFileBookmark(picked.accessBookmarkName)
    } catch (_e) {
      /* 忽略 */
    }
  }

  const resolved =
    pathFromAccessBookmark(accessBookmarkName) || picked.path

  const repo: RepoMeta = {
    name: picked.name,
    bookmarkName: repoId,
    repoId,
    workdir: resolved,
    accessBookmarkName: accessBookmarkName || undefined,
    source: "local",
    createdAt: Date.now(),
  }

  const repos = readRepos()
  if (
    repos.some((r) => {
      try {
        return normalizePath(resolveStoredWorkdir(r) || "") === normalizePath(resolved)
      } catch {
        return false
      }
    })
  ) {
    throw new Error("该目录已添加")
  }
  repos.push(repo)
  writeRepos(repos)
  return repo
}

/**
 * clone 完成后注册仓库。
 * - existingRepoId：与 clone 时 gitdir 目录一致
 * - parentAccessBookmark：父目录安全书签（workdir 通常是其子目录）
 */
export async function registerRepoByPath(
  path: string,
  name: string,
  remoteUrl?: string,
  existingRepoId?: string,
  parentAccessBookmark?: string | null
): Promise<RepoMeta> {
  const repoId = existingRepoId || createRepoId()

  // 优先沿用父目录书签（克隆场景：选的是父目录，workdir=父/仓库名）
  // 再尝试给 workdir 本身建书签；都失败则仅存明文路径
  let accessBookmarkName: string | undefined
  if (parentAccessBookmark && pathFromAccessBookmark(parentAccessBookmark)) {
    accessBookmarkName = parentAccessBookmark
  } else {
    accessBookmarkName = ensureAccessBookmark(path, repoId) || undefined
  }

  const bookmarkRoot = accessBookmarkName
    ? pathFromAccessBookmark(accessBookmarkName)
    : null
  const workdirRelative = bookmarkRoot
    ? relativePathFromRoot(path, bookmarkRoot)
    : null

  const repo: RepoMeta = {
    name,
    bookmarkName: repoId,
    repoId,
    workdir: path,
    workdirRelative: workdirRelative ?? undefined,
    accessBookmarkName,
    remoteUrl,
    source: "clone",
    createdAt: Date.now(),
  }

  const repos = readRepos()
  const existing = repos.find((r) => {
    try {
      return normalizePath(resolveStoredWorkdir(r) || "") === normalizePath(path)
    } catch {
      return false
    }
  })
  if (existing) return existing

  repos.push(repo)
  writeRepos(repos)
  return repo
}

/** 清理失败的克隆尝试，并按需恢复克隆前已有的空目录 */
export async function cleanupCloneAttempt(
  repoId: string,
  workdir: string,
  restoreEmptyWorkdir: boolean,
  accessBookmarkName?: string | null,
  fileManager: typeof FileManager = FileManager
): Promise<void> {
  const gitdir = GIT_REPOS_DIR + "/" + repoId
  try {
    if (await fileManager.exists(gitdir)) await fileManager.remove(gitdir)
  } catch (_e) {
    /* 清理其它资源后由下一次克隆再次尝试覆盖 */
  }
  try {
    if (await fileManager.exists(workdir)) await fileManager.remove(workdir)
    if (restoreEmptyWorkdir) await fileManager.createDirectory(workdir, true)
  } catch (_e) {
    /* 保留清理失败的目录，下一次重试会执行非空保护 */
  }
  if (
    accessBookmarkName &&
    !isAccessBookmarkShared(readRepos(), accessBookmarkName)
  ) {
    try {
      if (fileManager.bookmarkExists(accessBookmarkName)) {
        fileManager.removeFileBookmark(accessBookmarkName)
      }
    } catch (_e) {
      /* 忽略已失效或已移除的书签 */
    }
  }
}

/** 部分更新仓库元数据 */
export function updateRepo(
  bookmarkName: string,
  patch: Partial<RepoMeta>
): RepoMeta | null {
  const repos = readRepos()
  const idx = repos.findIndex((r) => r.bookmarkName === bookmarkName)
  if (idx < 0) return null
  const next = {
    ...repos[idx],
    ...patch,
    bookmarkName: repos[idx].bookmarkName,
    repoId: repos[idx].repoId,
  }
  repos[idx] = next
  writeRepos(repos)
  return next
}

export function getBranchLastPulledAt(
  repo: RepoMeta | null | undefined,
  branch: string | null | undefined
): number | null {
  const normalized = (branch || "").trim()
  if (!repo || !normalized) return null
  const value = repo.lastPulledAtByBranch?.[normalized]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function branchLastPulledAtPatch(
  repo: RepoMeta,
  branch: string,
  pulledAt: number
): Pick<RepoMeta, "lastPulledAtByBranch"> | null {
  const normalized = branch.trim()
  if (!normalized || !Number.isFinite(pulledAt)) return null
  return {
    lastPulledAtByBranch: {
      ...(repo.lastPulledAtByBranch || {}),
      [normalized]: pulledAt,
    },
  }
}

export function updateBranchLastPulledAt(
  bookmarkName: string,
  branch: string,
  pulledAt: number
): RepoMeta | null {
  const repo = findRepo(bookmarkName)
  if (!repo) return null
  const patch = branchLastPulledAtPatch(repo, branch, pulledAt)
  return patch ? updateRepo(bookmarkName, patch) : null
}

/**
 * 移除仓库：
 *  - 元数据
 *  - 快照
 *  - App Group gitdir 缓存（关键：否则旧 index/HEAD 会污染同路径重装）
 *  - 安全范围访问书签
 * 不删除用户工作区文件
 */
export async function removeRepo(bookmarkName: string): Promise<void> {
  const repos = readRepos()
  const repo = repos.find((r) => r.bookmarkName === bookmarkName)

  // 1) 删 gitdir 缓存
  if (repo) {
    const gitdir = getGitdirPath(repo)
    try {
      if (await FileManager.exists(gitdir)) {
        await FileManager.remove(gitdir)
      }
    } catch (_e) {
      /* 尽量继续清理其它项 */
    }
    // 兼容旧数据：按 bookmarkName 规整名再试一次
    const legacyGitdir =
      GIT_REPOS_DIR +
      "/" +
      bookmarkName.replace(/[^a-zA-Z0-9_-]/g, "_")
    if (legacyGitdir !== gitdir) {
      try {
        if (await FileManager.exists(legacyGitdir)) {
          await FileManager.remove(legacyGitdir)
        }
      } catch (_e) {
        /* 忽略 */
      }
    }
    // 2) 删访问书签
    if (
      repo.accessBookmarkName &&
      !isAccessBookmarkShared(repos, repo.accessBookmarkName, bookmarkName)
    ) {
      try {
        FileManager.removeFileBookmark(repo.accessBookmarkName)
      } catch (_e) {
        /* 忽略 */
      }
    }
    const stable = accessBookmarkFor(getRepoId(repo))
    if (
      stable !== repo.accessBookmarkName &&
      !isAccessBookmarkShared(repos, stable, bookmarkName)
    ) {
      try {
        if (FileManager.bookmarkExists(stable)) {
          FileManager.removeFileBookmark(stable)
        }
      } catch (_e) {
        /* 忽略 */
      }
    }
  }

  // 3) 元数据
  writeRepos(repos.filter((r) => r.bookmarkName !== bookmarkName))

  // 4) 快照
  const snaps = loadAllSnapshots()
  delete snaps[bookmarkName]
  if (repo?.repoId) delete snaps[repo.repoId]
  writeSnapshots(snaps)
}

/** 解析已保存工作目录：先激活书签安全范围，再返回实际 workdir */
function resolveStoredWorkdir(repo: RepoMeta): string | null {
  // 1) 稳定访问书签（跨会话安全访问；必须先解析以激活 scope）
  const fromAccess = pathFromAccessBookmark(repo.accessBookmarkName)
  if (fromAccess) {
    if (repo.workdirRelative !== undefined) {
      return resolveRelativeWorkdir(fromAccess, repo.workdirRelative)
    }
    if (repo.workdir) {
      const w = normalizePath(repo.workdir)
      const b = normalizePath(fromAccess)
      if (w === b || w.startsWith(b + "/")) return repo.workdir
    }
    return fromAccess
  }

  // 2) 旧数据：bookmarkName 本身可能是书签名
  const fromLegacy = pathFromAccessBookmark(repo.bookmarkName)
  if (fromLegacy) {
    if (repo.workdirRelative !== undefined) {
      return resolveRelativeWorkdir(fromLegacy, repo.workdirRelative)
    }
    if (repo.workdir) {
      const w = normalizePath(repo.workdir)
      const b = normalizePath(fromLegacy)
      if (w === b || w.startsWith(b + "/")) return repo.workdir
    }
    return fromLegacy
  }

  // 3) 明文路径回退（可能无安全访问权限）
  if (repo.workdir) return repo.workdir

  // 4) bookmarkName 当路径用（最旧数据）
  if (repo.bookmarkName.startsWith("/")) return repo.bookmarkName

  return null
}

/** 通过主键获取可访问工作目录；必要时刷新书签 */
export function resolveWorkdir(bookmarkName: string): string {
  const repo = findRepo(bookmarkName)
  if (!repo) {
    throw new Error("仓库不存在: " + bookmarkName)
  }
  let dir = resolveStoredWorkdir(repo)
  if (!dir) {
    throw new Error("无法恢复目录路径，请移除仓库后重新选择: " + bookmarkName)
  }

  // 若明文路径可访问但书签缺失，补建书签
  if (!repo.accessBookmarkName || !pathFromAccessBookmark(repo.accessBookmarkName)) {
    const repoId = getRepoId(repo)
    const created = ensureAccessBookmark(dir, repoId)
    if (created) {
      updateRepo(bookmarkName, {
        accessBookmarkName: created,
        workdir: pathFromAccessBookmark(created) || dir,
        repoId: repo.repoId || repoId,
      })
      dir = pathFromAccessBookmark(created) || dir
    }
  }

  // 回写最新解析路径，减少陈旧 workdir
  if (repo.workdir !== dir) {
    updateRepo(bookmarkName, { workdir: dir })
  }

  return dir
}

/** 根据 bookmarkName 查找仓库 */
export function findRepo(bookmarkName: string): RepoMeta | undefined {
  return readRepos().find((r) => r.bookmarkName === bookmarkName)
}

/** 来源文案 */
export function sourceLabel(repo: RepoMeta): string {
  if (repo.source === "clone" || repo.remoteUrl) return "克隆"
  return "本地"
}

// === Widget / 通知用的快照 ===

export async function readSnapshots(): Promise<Record<string, RepoSnapshot>> {
  return loadAllSnapshots()
}

export async function writeSnapshot(
  bookmarkName: string,
  snapshot: RepoSnapshot
): Promise<void> {
  const snaps = loadAllSnapshots()
  snaps[bookmarkName] = snapshot
  writeSnapshots(snaps)
}

export type { RepoSource }
