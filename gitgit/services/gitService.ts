/**
 * services/gitService.ts - 高层 Git 操作封装
 *
 * 基于 gitCore（引擎 + fs）与 repoStore，向上提供面向 bookmarkName 的语义化 Git 操作。
 * .git 分离存储：gitdir 放 App Group git-repos/<repoId>/，工作区走安全范围书签解析。
 */

import { Widget, Script } from "scripting"
import { loadGitEngine, createFS, createHttpTransport } from "./gitCore"
import {
  resolveWorkdir,
  findRepo,
  getGitdirPath,
  getRepoId,
  writeSnapshot,
  updateRepo,
} from "./repoStore"
import { getAuth, resolveAuthor, DEFAULT_GIT_IDENTITY } from "./authStore"
import { DEFAULT_BRANCH } from "../constants/git"
import {
  acquireRepoMutationLock,
  computeSyncTopology,
  desiredOriginAfterFailedPush,
  releaseRepoMutationLock,
  topologyFromCounts,
} from "../utils/gitSync"
import {
  normalizeMatrixPath,
  pathsNeedingUnstage,
  stageActionForRow,
} from "../utils/stageSelection"
import {
  collectGhostStashIndices,
  dropStashReflogAtIndex,
  isStatusMatrixClean,
  isValidOid,
  parseStashEntries,
  repairStashReflogLines,
  sanitizeStashMessage,
} from "../utils/stash"
import {
  assertCanAddRemote,
  parseUpstreamConfig,
  planDeleteRemote,
  planSetRemoteUrl,
  planSetUpstream,
  repoRemoteUrlMetaAfterChange,
  shouldClearRepoRemoteUrlMeta,
  type UpstreamConfig,
} from "../utils/remote"
import {
  buildConflictFilesFromErrorData,
  buildMergeState,
  defaultMergeCommitMessage,
  getMergeConflictErrorData,
  isMergeConflictError,
  mergeCommitParents,
  normalizeConflictPath,
  parseMergeState,
  removeResolvedConflict,
  resolutionActionForConflict,
  serializeMergeState,
  type ConflictResolution,
} from "../utils/mergeConflict"
import {
  planMergeIntoCurrent,
  resolvePullTarget,
  type MergeIntoCurrentResult,
  type PullResult,
} from "../utils/branchMerge"
import {
  checkRemoteCancelled,
  createGitOnProgress,
  emitRemoteProgress,
  type RemoteOpOptions,
} from "../utils/remoteProgress"
import {
  paginateHistory,
  type HistoryPage,
} from "../utils/history"
import type {
  FileChange,
  FileChangeStatus,
  CommitEntry,
  BranchInfo,
  RepoListStatus,
  MergeConflictState,
  ConflictFile,
  CommitSyncStatus,
  RepoSyncState,
  CommitDetail,
  CommitFileChange,
  StashEntry,
} from "../types/git"

const GIT_REPOS_DIR = FileManager.appGroupDocumentsDirectory + "/git-repos"

const repoMutationLocks = new Set<string>()

async function runRepoMutation<T>(
  bookmarkName: string,
  operation: () => Promise<T>
): Promise<T> {
  const lockKey = resolveGitdir(bookmarkName)
  if (!acquireRepoMutationLock(repoMutationLocks, lockKey)) {
    throw new Error("该仓库正在执行其它写操作，请稍后再试")
  }
  try {
    return await operation()
  } finally {
    releaseRepoMutationLock(repoMutationLocks, lockKey)
    await refreshRepoSnapshot(bookmarkName)
  }
}

async function runWithBackgroundKeepAlive<T>(
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

async function refreshRepoSnapshot(bookmarkName: string): Promise<void> {
  const repo = findRepo(bookmarkName)
  if (!repo) return
  try {
    const status = await getRepoListStatus(bookmarkName)
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
    console.warn("⚠️ 仓库快照刷新失败: " + e)
  }
}

/** 操作上下文：git 引擎 + fs + 工作目录 + gitdir */
interface GitContext {
  git: any
  fs: any
  dir: string
  gitdir: string
}

/** 解析 gitdir：优先仓库 repoId，避免完整路径当目录名 */
function resolveGitdir(bookmarkName: string): string {
  const repo = findRepo(bookmarkName)
  if (repo) return getGitdirPath(repo)
  // 尚未注册时（clone 过程中）用规整名
  const safe = bookmarkName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "repo"
  return GIT_REPOS_DIR + "/" + safe
}

/** 解析并组装单个仓库的操作上下文 */
async function getCtx(bookmarkName: string): Promise<GitContext> {
  const dir = resolveWorkdir(bookmarkName)
  const gitdir = resolveGitdir(bookmarkName)
  if (!(await FileManager.exists(gitdir))) {
    await FileManager.createDirectory(gitdir, true)
  }
  // 工作区必须可访问，否则 statusMatrix 会把 HEAD 文件全判删除
  if (!(await FileManager.exists(dir))) {
    throw new Error("工作区无法访问，请移除后重新添加目录: " + dir)
  }
  const { git } = await loadGitEngine()
  const fs = createFS(gitdir, dir)
  return { git, fs, dir, gitdir }
}

/** 工作区是否没有任何可见文件（忽略 .DS_Store 等） */
async function isWorkdirEffectivelyEmpty(dir: string): Promise<boolean> {
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

async function runWithEmptyDirCleanup(
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

async function checkoutWithEmptyDirCleanup(
  git: any,
  fs: any,
  options: Record<string, unknown>
): Promise<void> {
  await runWithEmptyDirCleanup(fs, () => git.checkout({ fs, ...options }))
}

/**
 * 若 gitdir 已有提交但工作区为空，强制 checkout 落盘。
 * 兼容历史坏路径映射：clone/pull 只更新了 refs，未写出工作区文件。
 */
async function ensureWorktreeMaterialized(
  git: any,
  fs: any,
  dir: string,
  gitdir: string
): Promise<void> {
  if (!(await FileManager.exists(gitdir + "/HEAD"))) return
  if (!(await isWorkdirEffectivelyEmpty(dir))) return
  // 无提交的空仓无需 checkout
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

/** 仓库是否已初始化（gitdir 下存在 HEAD 且 config 可读） */
export async function isInitialized(bookmarkName: string): Promise<boolean> {
  try {
    const { fs, gitdir } = await getCtx(bookmarkName)
    return await fs.exists("HEAD") || (await FileManager.exists(gitdir + "/HEAD"))
  } catch (e) {
    return false
  }
}

/** 初始化仓库（默认分支 main，写入默认身份；已初始化则只补缺 HEAD） */
async function initRepoInternal(bookmarkName: string): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const already = await isInitialized(bookmarkName)
  if (!already) {
    // defaultBranch 与 GitHub 对齐；旧引擎不支持时再强制写 HEAD
    try {
      await git.init({ fs, dir, gitdir, defaultBranch: DEFAULT_BRANCH })
    } catch (_e) {
      await git.init({ fs, dir, gitdir })
    }
    // 新建空仓强制 main（覆盖引擎默认 master）
    await writeUnbornHead(fs, DEFAULT_BRANCH)
  } else {
    // 已有仓：仅在 HEAD 无符号分支时补 main，不覆盖用户已设空仓分支
    await ensureUnbornDefaultBranch(fs, git, dir, gitdir)
  }

  // 仅在未设置时写入默认身份，避免覆盖用户后续配置
  const existingName = await git
    .getConfig({ fs, dir, gitdir, path: "user.name" })
    .catch(() => undefined)
  const existingEmail = await git
    .getConfig({ fs, dir, gitdir, path: "user.email" })
    .catch(() => undefined)
  // 未配置时写入默认身份（与设置页说明一致）
  if (!existingName) {
    await git.setConfig({
      fs,
      dir,
      gitdir,
      path: "user.name",
      value: DEFAULT_GIT_IDENTITY.name,
    })
  }
  if (!existingEmail) {
    await git.setConfig({
      fs,
      dir,
      gitdir,
      path: "user.email",
      value: DEFAULT_GIT_IDENTITY.email,
    })
  }
}

/** 写空仓符号 HEAD */
async function writeUnbornHead(fs: any, branch: string): Promise<void> {
  try {
    await fs.writeFile("HEAD", `ref: refs/heads/${branch}\n`)
  } catch (_e) {
    /* HEAD 写失败不阻断主流程 */
  }
}

/**
 * 把 HEAD 写成符号引用指向 refs/heads/<branch>。
 * 注意：isomorphic-git 的 writeRef(symbolic:true) 会自己补 `ref: ` 前缀，
 * 若再传入 `ref: refs/heads/...` 会得到 `ref: ref: refs/heads/...` 损坏 HEAD。
 * 这里直接写文件，保持与 writeUnbornHead 一致的语义。
 */
async function writeSymbolicHead(fs: any, branch: string): Promise<void> {
  await fs.writeFile("HEAD", `ref: refs/heads/${branch}\n`)
}

/** 从 HEAD 解析当前分支名（含空仓 unborn） */
async function readSymbolicHeadBranch(fs: any): Promise<string | null> {
  try {
    const head = await fs.readFile("HEAD", "utf8")
    const m = String(head).match(/^ref:\s*refs\/heads\/(\S+)/m)
    return m ? m[1].trim() : null
  } catch (_e) {
    return null
  }
}

/** 是否已有至少一次提交 */
async function hasAnyCommit(
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

/**
 * 空仓补默认分支：
 * - 无符号 HEAD → main
 * - 仍是旧默认 master → main（与 GitHub 对齐）
 * - 用户已设其它 unborn 名 → 不改
 * 已有提交不改。
 */
async function ensureUnbornDefaultBranch(
  fs: any,
  git: any,
  dir: string,
  gitdir: string
): Promise<void> {
  if (await hasAnyCommit(git, fs, dir, gitdir)) return
  const existing = await readSymbolicHeadBranch(fs)
  if (existing && existing !== "master") return
  await writeUnbornHead(fs, DEFAULT_BRANCH)
}

/** 暂存文件（filepath="." 表示全部，含删除语义） */
async function addFilesInternal(
  bookmarkName: string,
  filepath: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (filepath === ".") {
    const matrix = (await git.statusMatrix({
      fs,
      dir,
      gitdir,
    })) as [string, number, number, number][]
    for (const row of matrix) {
      const path = normalizeMatrixPath(row[0])
      const action = stageActionForRow(row)
      if (!path || action === "skip") continue
      if (action === "remove") {
        await git.remove({ fs, dir, gitdir, filepath: path })
      } else {
        await git.add({ fs, dir, gitdir, filepath: path })
      }
    }
    return
  }
  // isomorphic-git 的 exists 应传相对路径；fs 适配器会拼 workdir
  const exists = await fs.exists(filepath)
  if (!exists) {
    // 文件已不存在 → 暂存删除操作
    try {
      await git.remove({ fs, dir, gitdir, filepath })
      return
    } catch (_e) {
      // remove 失败则回退到 add
    }
  }
  await git.add({ fs, dir, gitdir, filepath })
}

/** 是否存在可解析的 HEAD（空仓 unborn 为 false） */
async function hasResolvedHead(
  git: any,
  fs: any,
  dir: string,
  gitdir: string
): Promise<boolean> {
  try {
    await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" })
    return true
  } catch (_e) {
    return false
  }
}

/** 取消暂存单个路径：有 HEAD 用 resetIndex；空仓用 remove 清索引 */
async function unstagePath(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  filepath: string,
  hasHead: boolean
): Promise<void> {
  if (hasHead) {
    await git.resetIndex({ fs, dir, gitdir, filepath, ref: "HEAD" })
    return
  }
  // 空仓只能有「新增已暂存」：从索引移除即可，不碰工作区文件
  await git.remove({ fs, dir, gitdir, filepath }).catch(() => undefined)
}

/** 取消暂存（filepath="." 或省略表示全部已暂存项） */
async function unstageFilesInternal(
  bookmarkName: string,
  filepath: string = "."
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const hasHead = await hasResolvedHead(git, fs, dir, gitdir)
  if (filepath !== ".") {
    await unstagePath(git, fs, dir, gitdir, filepath, hasHead)
    return
  }
  const matrix = (await git.statusMatrix({
    fs,
    dir,
    gitdir,
  })) as [string, number, number, number][]
  // 仅处理索引相对 HEAD 有差异的路径，避免无意义 reset
  for (const path of pathsNeedingUnstage(matrix)) {
    await unstagePath(git, fs, dir, gitdir, path, hasHead)
  }
}

/** 解析当前分支名，detached HEAD / 异常时返回 null（绝不返回 undefined，避免拼出 "WIP on undefined"） */
async function safeCurrentBranch(
  git: any,
  fs: any,
  dir: string,
  gitdir: string
): Promise<string | null> {
  try {
    const branch = await git.currentBranch({ fs, dir, gitdir, fullname: false })
    const trimmed = typeof branch === "string" ? branch.trim() : ""
    return trimmed || null
  } catch (_e) {
    return null
  }
}

/** 创建 Stash，并将工作区/索引恢复到 HEAD */
async function createStashInternal(
  bookmarkName: string,
  message: string = ""
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await hasResolvedHead(git, fs, dir, gitdir))) {
    throw new Error("首次提交前无法创建 Stash")
  }
  const resolvedAuthor = await resolveAuthor()
  await ensureGitConfigAuthor(git, fs, dir, gitdir, resolvedAuthor)
  // 1) message 必须单行，否则 logs/refs/stash 会被拆坏
  // 2) 空 message 兜底，避免底层写出字面 undefined
  const branch = await safeCurrentBranch(git, fs, dir, gitdir)
  const safeMessage =
    sanitizeStashMessage(message) ||
    (branch ? `WIP on ${branch}` : "WIP")
  await git.stash({
    fs,
    dir,
    gitdir,
    op: "push",
    message: safeMessage,
  })
  // push 后顺手清洗可能已有的脏续行
  await repairStashReflog(fs)
}

const STASH_REFLOG = "logs/refs/stash"
const STASH_REF = "refs/stash"

/** 读取 stash reflog 原文（不存在则空串） */
async function readStashReflogRaw(fs: any): Promise<string> {
  try {
    if (!(await fs.exists(STASH_REFLOG))) return ""
    const raw = await fs.readFile(STASH_REFLOG, "utf8")
    return typeof raw === "string" ? raw : String(raw || "")
  } catch (_e) {
    return ""
  }
}

/** 将合法 reflog 行写回，并同步 tip 到 refs/stash */
async function writeStashReflogAndTip(
  fs: any,
  lines: string[],
  tipOid: string | null
): Promise<void> {
  if (lines.length === 0) {
    if (await fs.exists(STASH_REFLOG)) await fs.unlink(STASH_REFLOG)
    if (await fs.exists(STASH_REF)) await fs.unlink(STASH_REF)
    return
  }
  await fs.writeFile(STASH_REFLOG, lines.join("\n") + "\n", "utf8")
  if (tipOid && isValidOid(tipOid)) {
    await fs.writeFile(STASH_REF, tipOid + "\n", "utf8")
  } else if (await fs.exists(STASH_REF)) {
    await fs.unlink(STASH_REF)
  }
}

/**
 * 清洗 logs/refs/stash：去掉无 tab / 非法 OID 的续行，
 * 并保证 refs/stash 指向合法 tip（修复 "saw reverts" 类脏状态）。
 */
async function repairStashReflog(fs: any): Promise<void> {
  const raw = await readStashReflogRaw(fs)
  if (!raw) {
    // reflog 已空：清掉可能残留的非法 refs/stash
    if (await fs.exists(STASH_REF)) {
      try {
        const tip = String(await fs.readFile(STASH_REF, "utf8")).trim()
        if (!isValidOid(tip)) await fs.unlink(STASH_REF)
      } catch (_e) {
        try {
          await fs.unlink(STASH_REF)
        } catch (__e) {
          /* ignore */
        }
      }
    }
    return
  }
  const repaired = repairStashReflogLines(raw)
  let tipBroken = false
  if (await fs.exists(STASH_REF)) {
    try {
      const tip = String(await fs.readFile(STASH_REF, "utf8")).trim()
      tipBroken = !isValidOid(tip)
    } catch (_e) {
      tipBroken = true
    }
  }
  if (!repaired.changed && !tipBroken) return
  await writeStashReflogAndTip(fs, repaired.lines, repaired.tipOid)
}

/** 安全删除 stash@{index}：只操作合法 reflog 行，绝不把续行词当 OID */
async function safeDropStash(fs: any, index: number): Promise<void> {
  await repairStashReflog(fs)
  const raw = await readStashReflogRaw(fs)
  if (!raw.trim()) throw new Error("没有可删除的 Stash")
  const chronological = raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
  const { lines, tipOid } = dropStashReflogAtIndex(chronological, index)
  await writeStashReflogAndTip(fs, lines, tipOid)
}

/**
 * 读取 Stash 列表。
 * 先修复脏 reflog，再过滤/清理幽灵条目。
 */
export async function listStashes(bookmarkName: string): Promise<StashEntry[]> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  await repairStashReflog(fs)
  const entries = await git.stash({ fs, dir, gitdir, op: "list" })
  const ghostIndices = collectGhostStashIndices(entries)
  if (ghostIndices.length === 0) return parseStashEntries(entries)

  // 从大到小 drop，避免索引前移导致误删有效项
  for (const refIdx of ghostIndices) {
    try {
      await safeDropStash(fs, refIdx)
    } catch (e) {
      console.warn("清理幽灵 Stash 失败 (index=" + refIdx + "): " + e)
    }
  }
  const cleaned = await git.stash({ fs, dir, gitdir, op: "list" })
  return parseStashEntries(cleaned)
}

/** 应用 Stash；保留列表项，且拒绝覆盖现有改动 */
async function applyStashInternal(
  bookmarkName: string,
  index: number
): Promise<void> {
  if (!Number.isInteger(index) || index < 0) throw new Error("无效的 Stash 索引")
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  // 应用前先修脏 reflog，避免底层读到非法 tip
  await repairStashReflog(fs)
  const matrix = (await git.statusMatrix({
    fs,
    dir,
    gitdir,
  })) as [string, number, number, number][]
  if (!isStatusMatrixClean(matrix)) {
    throw new Error("请先提交、暂存到 Stash 或丢弃当前改动，再应用 Stash")
  }
  await git.stash({ fs, dir, gitdir, op: "apply", refIdx: index })
}

/** 删除指定 Stash（自实现，绕过 isomorphic-git drop 的非法 OID 收尾 bug） */
async function dropStashInternal(
  bookmarkName: string,
  index: number
): Promise<void> {
  if (!Number.isInteger(index) || index < 0) throw new Error("无效的 Stash 索引")
  const { fs } = await getCtx(bookmarkName)
  await safeDropStash(fs, index)
}

/** 获取所有改动的文件列表（基于 statusMatrix） */
export async function getChanges(
  bookmarkName: string
): Promise<FileChange[]> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  // 直接查 gitdir，避免 isInitialized 再次 getCtx
  if (!(await FileManager.exists(gitdir + "/HEAD"))) return []

  // 抽样检查工作区是否真能读到文件；读不到时 statusMatrix 会全量 *deleted
  try {
    const sample = await FileManager.readDirectory(dir)
    if (!sample) {
      throw new Error("工作区不可读: " + dir)
    }
  } catch (e: any) {
    throw new Error(
      "工作区无法访问（请移除后重新添加/克隆以重建安全访问）: " +
        String(e?.message || e)
    )
  }

  const matrix = await git.statusMatrix({ fs, dir, gitdir })
  const changes: FileChange[] = []
  for (const row of matrix as [string, number, number, number][]) {
    const filepath = String(row[0] || "").replace(/^\/+/, "")
    if (!filepath) continue
    const head = row[1]
    const work = row[2]
    const stage = row[3]
    // 111 = 无变化，跳过
    if (head === 1 && work === 1 && stage === 1) continue
    const status = matrixToStatus(head, work, stage)
    if (status === "unmodified") continue
    changes.push({
      filepath,
      status,
      staged: head !== stage,
      unstaged: work !== stage,
    })
  }
  return changes
}

/**
 * statusMatrix [head, work, stage] 元组 → 语义化状态名
 * 对齐 isomorphic-git 官方状态矩阵文档
 */
function matrixToStatus(head: number, work: number, stage: number): FileChangeStatus {
  const key = `${head}${work}${stage}`
  switch (key) {
    case "003":
      return "*added" // 新增已暂存后从工作区删除
    case "020":
      return "*added" // 未跟踪新增
    case "022":
      return "added" // 新增已暂存
    case "023":
      return "*added" // 新增已暂存后又改
    case "100":
      return "deleted" // 删除已暂存
    case "101":
      return "*deleted" // 删除未暂存
    case "110":
      return "*deleted" // 删除后部分状态
    case "111":
      return "unmodified"
    case "120":
      return "*modified" // 修改后暂存被清
    case "121":
      return "*modified" // 修改未暂存
    case "122":
      return "modified" // 修改已暂存
    case "123":
      return "*modified" // 修改已暂存后又改
    default:
      // 未知组合：有差异时按 modified 暴露，避免静默吞掉
      if (head !== work || head !== stage || work !== stage) {
        return work === 0 ? "*deleted" : head === 0 ? "*added" : "*modified"
      }
      return "unmodified"
  }
}

/** 提交当前暂存区（作者未填时默认 gitgit） */
async function commitInternal(
  bookmarkName: string,
  message: string,
  author?: { name: string; email: string }
): Promise<string> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const resolvedAuthor = await resolveAuthor(author)
  // 同步写入 git config，避免 pull 合并时再缺 author
  await ensureGitConfigAuthor(git, fs, dir, gitdir, resolvedAuthor)
  const oid = await git.commit({
    fs,
    dir,
    gitdir,
    message,
    author: resolvedAuthor,
  })
  return oid
}

/** 把身份写入仓库 git config（不覆盖已有非空配置时仍强制写当前解析结果） */
async function ensureGitConfigAuthor(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  author: { name: string; email: string }
): Promise<void> {
  try {
    await git.setConfig({
      fs,
      dir,
      gitdir,
      path: "user.name",
      value: author.name,
    })
    await git.setConfig({
      fs,
      dir,
      gitdir,
      path: "user.email",
      value: author.email,
    })
  } catch (_e) {
    /* 配置失败不阻断主流程 */
  }
}

/** 获取提交历史（附带待推送 / 远端标识） */
export async function getLog(
  bookmarkName: string,
  depth = 50
): Promise<CommitEntry[]> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await isInitialized(bookmarkName))) return []
  try {
    const log = await git.log({ fs, dir, gitdir, depth })
    let headOid: string | null = null
    try {
      headOid = await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" })
    } catch (_e) {
      headOid = null
    }

    // 远端跟踪分支 tip：用于区分「待推送」与「远端历史」
    let remoteOid: string | null = null
    let current: string | null = null
    try {
      current = await git.currentBranch({
        fs,
        dir,
        gitdir,
        fullname: false,
      })
    } catch (_e) {
      current = null
    }
    if (current) {
      try {
        remoteOid = await git.resolveRef({
          fs,
          dir,
          gitdir,
          ref: "refs/remotes/origin/" + current,
        })
      } catch (_e) {
        remoteOid = null
      }
    }

    // 仅从 HEAD 走到 merge-base 标记待推送，避免全量可达集合（大仓库极慢）
    const unpushed = new Set<string>()
    if (remoteOid && headOid) {
      if (remoteOid === headOid) {
        /* 已同步 */
      } else {
        try {
          const bases = (await git.findMergeBase({
            fs,
            dir,
            gitdir,
            oids: [headOid, remoteOid],
          })) as string[]
          const base = bases?.[0] || null
          if (base) {
            const pending: string[] = [headOid]
            const seen = new Set<string>()
            while (pending.length > 0) {
              const oid = pending.pop()!
              if (oid === base || seen.has(oid)) continue
              seen.add(oid)
              unpushed.add(oid)
              const commitResult: {
                commit: { parent?: string[] }
              } = await git.readCommit({ fs, dir, gitdir, oid })
              for (const parent of commitResult.commit.parent || []) {
                if (parent !== base && !seen.has(parent)) pending.push(parent)
              }
            }
          } else {
            // 无共同祖先时退回完整可达差集（极罕见）
            const [localReachable, remoteReachable] = await Promise.all([
              collectReachableCommits(git, fs, dir, gitdir, headOid),
              collectReachableCommits(git, fs, dir, gitdir, remoteOid),
            ])
            for (const oid of localReachable) {
              if (!remoteReachable.has(oid)) unpushed.add(oid)
            }
          }
        } catch (_e) {
          /* 标记失败时保持空集，历史仍可展示 */
        }
      }
    }

    return log.map((entry: any) => {
      let syncStatus: CommitSyncStatus = "local"
      if (remoteOid) {
        syncStatus = unpushed.has(entry.oid) ? "unpushed" : "remote"
      }
      return {
        oid: entry.oid,
        message: entry.commit.message.trim(),
        author: {
          name: entry.commit.author?.name || "",
          email: entry.commit.author?.email || "",
        },
        date: new Date(entry.commit.author.timestamp * 1000).toISOString(),
        syncStatus,
        isHead: headOid != null && entry.oid === headOid,
      }
    })
  } catch (e: any) {
    // 空仓库没有 HEAD，log 会报错
    return []
  }
}

/** 分页读取历史；搜索时扫描当前 HEAD 的完整可达历史后再切页 */
export async function getLogPage(
  bookmarkName: string,
  offset: number,
  limit: number,
  query = ""
): Promise<HistoryPage> {
  const safeOffset = Math.max(0, Math.trunc(offset))
  const safeLimit = Math.max(1, Math.trunc(limit))
  const hasQuery = query.trim().length > 0
  const depth = hasQuery
    ? Number.MAX_SAFE_INTEGER
    : safeOffset + safeLimit + 1
  const entries = await getLog(bookmarkName, depth)
  return paginateHistory(entries, safeOffset, safeLimit, query)
}

/** 获取当前 HEAD 已跟踪文件（不包含工作区未跟踪文件） */
export async function getTrackedFiles(bookmarkName: string): Promise<string[]> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await isInitialized(bookmarkName))) return []
  try {
    await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" })
  } catch (e: any) {
    if (e?.code === "NotFoundError" || e?.code === "ENOENT") return []
    throw e
  }
  const files = await git.listFiles({ fs, dir, gitdir, ref: "HEAD" })
  return (files as string[])
    .map(String)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}

/** 递归读取提交树，返回 filepath -> blob oid */
async function readTreeFiles(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  oid: string,
  prefix = ""
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const tree = await git.readTree({ fs, dir, gitdir, oid })
  for (const entry of (tree.tree || []) as any[]) {
    const path = prefix ? prefix + "/" + entry.path : entry.path
    const mode = String(entry.mode || "")
    const isTree =
      entry.type === "tree" || mode === "040000" || Number(entry.mode) === 16384
    if (isTree) {
      const nested = await readTreeFiles(git, fs, dir, gitdir, entry.oid, path)
      nested.forEach((value, key) => result.set(key, value))
    } else {
      result.set(path, entry.oid)
    }
  }
  return result
}

/** 比较两棵文件树，生成稳定排序的文件变化 */
export function compareCommitTrees(
  parentFiles: ReadonlyMap<string, string>,
  currentFiles: ReadonlyMap<string, string>
): CommitFileChange[] {
  const paths = new Set<string>([...currentFiles.keys(), ...parentFiles.keys()])
  return Array.from(paths)
    .filter((filepath) => currentFiles.get(filepath) !== parentFiles.get(filepath))
    .map((filepath): CommitFileChange => ({
      filepath,
      status: !parentFiles.has(filepath)
        ? "added"
        : !currentFiles.has(filepath)
          ? "deleted"
          : "modified",
    }))
    .sort((a, b) => a.filepath.localeCompare(b.filepath))
}

/** 获取提交元数据及相对第一父提交的文件变化 */
export async function getCommitDetail(
  bookmarkName: string,
  oid: string
): Promise<CommitDetail> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const current = await git.readCommit({ fs, dir, gitdir, oid })
  const commit = current.commit
  const parentOid = commit.parent?.[0] || null
  const currentFiles = await readTreeFiles(git, fs, dir, gitdir, commit.tree)
  const parentFiles = parentOid
    ? await readTreeFiles(
        git,
        fs,
        dir,
        gitdir,
        (await git.readCommit({ fs, dir, gitdir, oid: parentOid })).commit.tree
      )
    : new Map<string, string>()
  const files = compareCommitTrees(parentFiles, currentFiles)
  return {
    oid,
    message: String(commit.message || "").trim(),
    author: {
      name: commit.author?.name || "",
      email: commit.author?.email || "",
    },
    committer: {
      name: commit.committer?.name || "",
      email: commit.committer?.email || "",
    },
    date: new Date((commit.author?.timestamp || 0) * 1000).toISOString(),
    parentOid,
    parentCount: Array.isArray(commit.parent) ? commit.parent.length : 0,
    files,
  }
}

export async function getBranches(
  bookmarkName: string
): Promise<BranchInfo> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await isInitialized(bookmarkName))) {
    return { branches: [], current: null }
  }
  // 详情页加载分支时顺带修复「有提交但工作区为空」的历史仓
  try {
    await ensureWorktreeMaterialized(git, fs, dir, gitdir)
  } catch (_e) {
    /* 不阻断分支列表 */
  }
  let localBranches: string[] = []
  try {
    localBranches = await git.listBranches({ fs, dir, gitdir })
  } catch (_e) {
    localBranches = []
  }
  // 合并 origin 跟踪分支短名，否则 singleBranch 历史仓/仅本地列表看不到其它远端分支
  let remoteBranches: string[] = []
  try {
    remoteBranches = await git.listBranches({
      fs,
      dir,
      gitdir,
      remote: "origin",
    })
  } catch (_e) {
    remoteBranches = []
  }
  remoteBranches = remoteBranches
    .map((b: string) => String(b || "").replace(/^origin\//, ""))
    .filter((b: string) => !!b && b !== "HEAD")

  const branchSet = new Set<string>([...localBranches, ...remoteBranches])
  let current: string | null = null
  try {
    current = await git.currentBranch({ fs, dir, gitdir, fullname: false })
  } catch (_e) {
    current = null
  }
  // 空仓：listBranches 为空，currentBranch 也可能 null，回退读 HEAD
  if (!current) {
    current = await readSymbolicHeadBranch(fs)
  }
  if (current) branchSet.add(current)
  const branches = Array.from(branchSet).sort((a, b) => {
    if (a === current) return -1
    if (b === current) return 1
    return a.localeCompare(b)
  })
  return { branches, current }
}

/**
 * 分支切换前确认工作区干净。
 * 后续会 force checkout：不干净时继续会覆盖用户未提交改动。
 */
async function assertWorktreeCleanForCheckout(
  git: any,
  fs: any,
  dir: string,
  gitdir: string
): Promise<void> {
  const matrix = (await git.statusMatrix({
    fs,
    dir,
    gitdir,
  })) as [string, number, number, number][]
  if (!isStatusMatrixClean(matrix)) {
    throw new Error("请先提交、暂存到 Stash 或丢弃当前改动，再切换分支")
  }
}

/**
 * 强制 checkout 到目标分支，使工作区与 index 与 ref 完全一致。
 * 自定义 FileManager FS 下，非 force 的 checkout 常跳过删除/覆盖，
 * 克隆后切分支会把上一分支文件当成 *added/*deleted 假改动；重启后
 * 若碰巧再次 materialize 才看似恢复。force 与桌面 Git 在干净树上切换等价。
 */
async function forceCheckoutRef(
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

/** 创建分支并切换；空仓无提交时改为改写 HEAD 指向新分支名 */
async function createBranchInternal(
  bookmarkName: string,
  name: string,
  checkout = true
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await hasAnyCommit(git, fs, dir, gitdir))) {
    // 尚无提交无法 branch/checkout，仅重命名空仓目标分支
    await writeUnbornHead(fs, name)
    return
  }
  // 需要切换时先确认干净，再建分支并 force checkout（与 checkoutBranch 同因）
  if (checkout) {
    await assertWorktreeCleanForCheckout(git, fs, dir, gitdir)
  }
  await git.branch({ fs, dir, gitdir, ref: name, checkout: false })
  if (checkout) {
    await forceCheckoutRef(git, fs, dir, gitdir, name)
  }
}

/** 切换到指定分支；空仓无提交时仅改写 HEAD；仅远端存在时从 origin 建本地跟踪分支 */
async function checkoutBranchInternal(
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

  // force 会覆盖工作区：仅允许在干净状态下切换
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

  // 本地无此分支：若有 origin/<name> 则基于远端创建并切换，避免只能看到远端却切不过去
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
    throw new Error(
      `本地与 origin 均无分支「${name}」。可先拉取以刷新远端分支列表。`
    )
  }
  // 先建本地分支再 force checkout（branch 的 checkout:true 不保证 force）
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
    /* 跟踪配置失败不阻断切换 */
  }
}

/** 撤销单个文件到 HEAD（丢弃工作区改动） */
async function restoreFileInternal(
  bookmarkName: string,
  filepath: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  let hasHead = true
  try {
    await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" })
  } catch (e) {
    hasHead = false
  }

  if (!hasHead) {
    const fullPath = dir + "/" + filepath
    if (await FileManager.exists(fullPath)) {
      await FileManager.remove(fullPath)
    }
    await git.remove({ fs, dir, gitdir, filepath }).catch(() => undefined)
    return
  }

  await checkoutWithEmptyDirCleanup(git, fs, {
    dir,
    gitdir,
    filepaths: [filepath],
    ref: "HEAD",
    force: true,
  })
}

// === 远端操作 ===

/** 远端仓库信息 */
export interface RemoteInfo {
  remote: string
  url: string
}

/** 列出已配置的远端 */
export async function listRemotes(
  bookmarkName: string
): Promise<RemoteInfo[]> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  return await git.listRemotes({ fs, dir, gitdir })
}

/** 判断远端跟踪分支是否已存在 */
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

/** 添加远端；名称冲突或非法 URL 在纯函数层拒绝 */
async function addRemoteInternal(
  bookmarkName: string,
  remote: string,
  url: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const remotes = (await git.listRemotes({
    fs,
    dir,
    gitdir,
  })) as { remote: string; url: string }[]
  const planned = assertCanAddRemote(remotes, remote, url)
  await git.addRemote({
    fs,
    dir,
    gitdir,
    remote: planned.remote,
    url: planned.url,
  })
  // origin 变更同步 RepoMeta，上传/列表展示与真实 config 一致
  const metaUrl = repoRemoteUrlMetaAfterChange(planned.remote, planned.url)
  if (metaUrl) {
    try {
      updateRepo(bookmarkName, { remoteUrl: metaUrl })
    } catch (_e) {
      /* meta 失败不回滚 git config */
    }
  }
}

/**
 * 修改已有 remote 的 URL：delete + add，失败时按 plan 回滚。
 * isomorphic-git 无 setRemoteUrl，与 setOriginAndPush 同策略。
 */
async function setRemoteUrlInternal(
  bookmarkName: string,
  remote: string,
  url: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const remotes = (await git.listRemotes({
    fs,
    dir,
    gitdir,
  })) as { remote: string; url: string }[]
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
  } catch (e) {
    try {
      const current = (await git.listRemotes({
        fs,
        dir,
        gitdir,
      })) as { remote: string; url: string }[]
      if (current.some((r) => r.remote === planned.remote)) {
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
      throw new Error(
        `修改远端 URL 失败且回滚失败：${String(e)}`
      )
    }
    throw e
  }

  const metaUrl = repoRemoteUrlMetaAfterChange(planned.remote, planned.nextUrl)
  if (metaUrl) {
    try {
      updateRepo(bookmarkName, { remoteUrl: metaUrl })
    } catch (_e) {
      /* meta 失败不阻断 */
    }
  }
}

/** 删除远端；失败时尽量恢复原 URL */
async function deleteRemoteInternal(
  bookmarkName: string,
  remote: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const remotes = (await git.listRemotes({
    fs,
    dir,
    gitdir,
  })) as { remote: string; url: string }[]
  const planned = planDeleteRemote(remotes, remote)

  try {
    await git.deleteRemote({ fs, dir, gitdir, remote: planned.remote })
  } catch (e) {
    // 删除失败：若 remote 已不在列表则按回滚目标尝试恢复
    try {
      const current = (await git.listRemotes({
        fs,
        dir,
        gitdir,
      })) as { remote: string; url: string }[]
      const stillThere = current.some((r) => r.remote === planned.remote)
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
      throw new Error(`删除远端失败且回滚失败：${String(e)}`)
    }
    throw e
  }

  if (shouldClearRepoRemoteUrlMeta(planned.remote)) {
    try {
      updateRepo(bookmarkName, {
        remoteUrl: undefined,
        pendingRemoteUrl: undefined,
        pendingRemoteName: undefined,
      })
    } catch (_e) {
      /* meta 失败不阻断 */
    }
  }
}

/** 读取某本地分支的 upstream（branch.<name>.remote / .merge） */
export async function getBranchUpstream(
  bookmarkName: string,
  branch?: string
): Promise<UpstreamConfig | null> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  let branchName = (branch || "").trim()
  if (!branchName) {
    try {
      branchName =
        (await git.currentBranch({ fs, dir, gitdir, fullname: false })) || ""
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

/** 设置/变更本地分支 upstream；remote 必须已存在 */
async function setBranchUpstreamInternal(
  bookmarkName: string,
  branch: string,
  remote: string,
  merge?: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const remotes = (await git.listRemotes({
    fs,
    dir,
    gitdir,
  })) as { remote: string; url: string }[]
  // merge 缺省与本地分支同名
  const planned = planSetUpstream(
    remotes,
    branch,
    remote,
    merge && String(merge).trim() ? merge : branch
  )

  // 确认本地分支存在（有提交后）；空仓仅写 config 也允许，便于首次推送前绑定
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

/** 获取认证（未配置则抛出友好错误） */
function requireAuth(): { username: string; password: string } {
  const auth = getAuth()
  if (!auth) {
    throw new Error("未配置 GitHub Token，请在设置页添加")
  }
  return auth
}

/** 推送到远端 */
async function pushInternal(
  bookmarkName: string,
  remote = "origin",
  ref?: string,
  force = false,
  options?: RemoteOpOptions
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  checkRemoteCancelled(options)
  // push 几乎不发 git 进度，先给 UI 连接/上传阶段
  await emitRemoteProgress(options, "Connecting")
  const auth = requireAuth()
  const http = createHttpTransport(auth.username, auth.password)
  const onProgress = createGitOnProgress(options)
  await emitRemoteProgress(options, "Uploading")
  await git.push({
    fs,
    dir,
    gitdir,
    http,
    onAuth: () => auth,
    remote,
    ref,
    force,
    onProgress,
  })
  checkRemoteCancelled(options)
  await emitRemoteProgress(options, "Finalizing")
  // 更新本地 origin 跟踪指针，历史「待推送」标识才能变「远端」
  await updateRemoteTrackingRef(git, fs, dir, gitdir, remote, ref)
}

/** push 后同步 refs/remotes/<remote>/<branch> */
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
    // 首次发布本地分支后补齐 upstream，后续 pull/push 才有稳定跟踪关系
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
    /* 忽略 */
  }
}

/** gitdir 内合并状态文件名（非标准 git，供 UI 恢复冲突列表） */
const MERGE_STATE_FILE = "gitgit-merge-state.json"

function mergeStatePath(gitdir: string): string {
  return gitdir.replace(/\/+$/, "") + "/" + MERGE_STATE_FILE
}

/** 读取进行中的合并状态；无则 null */
async function readMergeStateFile(
  gitdir: string
): Promise<MergeConflictState | null> {
  const path = mergeStatePath(gitdir)
  try {
    if (!(await FileManager.exists(path))) return null
    const raw = await FileManager.readAsString(path)
    const parsed = parseMergeState(raw)
    if (!parsed) return null
    return {
      oursOid: parsed.oursOid,
      theirsOid: parsed.theirsOid,
      oursLabel: parsed.oursLabel,
      theirsLabel: parsed.theirsLabel,
      message: parsed.message,
      conflicts: parsed.conflicts,
      startedAt: parsed.startedAt,
    }
  } catch (_e) {
    return null
  }
}

async function writeMergeStateFile(
  gitdir: string,
  state: MergeConflictState
): Promise<void> {
  const built = buildMergeState(state)
  const path = mergeStatePath(gitdir)
  try {
    await FileManager.writeAsString(path, serializeMergeState(built))
  } catch (e: any) {
    throw new Error("无法写入合并状态文件：" + String(e?.message || e))
  }
}

async function clearMergeStateFile(gitdir: string): Promise<void> {
  const path = mergeStatePath(gitdir)
  try {
    if (await FileManager.exists(path)) {
      await FileManager.remove(path)
    }
  } catch (_e) {
    /* 清理失败不阻断主流程 */
  }
}

/** 是否存在未合并 index 条目（stage != 0） */
async function listUnmergedPathsFromIndex(
  git: any,
  fs: any,
  dir: string,
  gitdir: string
): Promise<string[]> {
  // 通过 statusMatrix 无法直接得 stage1/2/3；用 listFiles + 尝试读冲突标记不可靠。
  // isomorphic-git 在冲突后 index 含多 stage；walk STAGE 可枚举。
  try {
    const paths = new Set<string>()
    await git.walk({
      fs,
      dir,
      gitdir,
      trees: [git.STAGE()],
      map: async (filepath: string, [entry]: any[]) => {
        if (!filepath || filepath === ".") return
        if (!entry) return
        // 多 stage 时 entry 可能代表 unmerged
        try {
          const stages = entry.stages || null
          if (stages && (stages[1] || stages[2] || stages[3])) {
            paths.add(normalizeConflictPath(filepath))
          }
        } catch (_e) {
          /* 忽略单条目 */
        }
      },
    })
    return Array.from(paths).filter(Boolean).sort()
  } catch (_e) {
    return []
  }
}

/** 抛出带冲突列表的友好错误，便于 UI 识别 */
function throwMergeConflictUserError(conflicts: ConflictFile[]): never {
  const names = conflicts.map((c) => c.filepath).slice(0, 8)
  const more =
    conflicts.length > names.length
      ? ` 等 ${conflicts.length} 个文件`
      : ""
  const err = new Error(
    `合并冲突：请解决后提交，或中止合并。冲突文件：${names.join(", ")}${more}`
  )
  ;(err as any).code = "MergeConflictError"
  ;(err as any).conflicts = conflicts
  throw err
}

/** 已有进行中合并时拒绝新的 pull/merge */
async function assertNoMergeInProgress(gitdir: string): Promise<void> {
  const existing = await readMergeStateFile(gitdir)
  if (!existing) return
  if (existing.conflicts.length > 0) {
    throwMergeConflictUserError(existing.conflicts)
  }
  throw new Error(
    "存在未完成的合并：请先「完成合并提交」或「中止合并」后再继续"
  )
}

/**
 * 执行 merge(abortOnConflict=false)；冲突时写状态并抛友好错误。
 * 干净合并后 force checkout 当前分支以对齐工作区。
 */
async function runMergeWithConflictHandling(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  opts: {
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
    opts.theirsLabel,
    opts.oursLabel
  )
  try {
    await runWithEmptyDirCleanup(fs, () =>
      git.merge({
        fs,
        dir,
        gitdir,
        ours: opts.oursBranch,
        theirs: opts.theirsRef,
        abortOnConflict: false,
        message: mergeMessage,
        author: opts.author,
        committer: opts.author,
      })
    )
  } catch (e: any) {
    if (!isMergeConflictError(e)) throw e
    const data = getMergeConflictErrorData(e)
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
        "合并冲突，但未能识别冲突文件列表：" + String(e?.message || e)
      )
    }
    await writeMergeStateFile(gitdir, {
      oursOid: opts.oursOid,
      theirsOid: opts.theirsOid,
      oursLabel: opts.oursLabel,
      theirsLabel: opts.theirsLabel,
      message: mergeMessage,
      conflicts,
      startedAt: Date.now(),
    })
    throwMergeConflictUserError(conflicts)
  }

  await clearMergeStateFile(gitdir)
  try {
    await forceCheckoutRef(git, fs, dir, gitdir, opts.oursBranch)
  } catch (_e) {
    await ensureWorktreeMaterialized(git, fs, dir, gitdir)
  }
}

/**
 * 解析合并源为可 resolve 的 ref 与展示标签。
 * 支持：本地分支名、origin/xxx、仅有远端跟踪时的短名。
 */
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
    // 其它 remote/branch 形态：先当 remotes，再当本地名
    candidates.push({
      ref: `refs/remotes/${source}`,
      label: source,
    })
    candidates.push({ ref: `refs/heads/${source}`, label: source })
  } else {
    candidates.push({ ref: `refs/heads/${source}`, label: source })
    candidates.push({
      ref: `refs/remotes/origin/${source}`,
      label: `origin/${source}`,
    })
  }

  for (const c of candidates) {
    try {
      const oid = await git.resolveRef({ fs, dir, gitdir, ref: c.ref })
      if (oid) return { ref: c.ref, label: c.label, oid: String(oid) }
    } catch (_e) {
      /* 试下一个候选 */
    }
  }
  throw new Error(
    `找不到分支「${source}」。可先拉取以刷新远端分支列表，或确认本地分支名。`
  )
}

/** 读取当前分支的 upstream 配置（供 pull 解析目标） */
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

/**
 * 从远端拉取：fetch + merge(abortOnConflict=false)。
 * - 无 explicit ref：优先 branch.*.upstream，否则 remote/同名
 * - 有 explicit ref（如 push 前先拉）：固定 remote + 同名，忽略 upstream
 * Push 仍固定 origin/同名，不读 upstream。
 */
async function pullInternal(
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
  const onProgress = createGitOnProgress(options)
  const resolvedAuthor = await resolveAuthor(author)
  await ensureGitConfigAuthor(git, fs, dir, gitdir, resolvedAuthor)
  // fetch 前先给 UI 连接态；网络等待期间由 HTTP 层补充下载进度
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

  // 显式 ref 时忽略 upstream；否则读当前分支 upstream
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

  // 1) fetch 该 remote 的全部远端分支（刷新 tracking refs）
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
    onProgress,
  })
  checkRemoteCancelled(options)
  await emitRemoteProgress(options, "Merging")

  const resultBase = {
    branch: localBranch,
    remote: pullRemote,
    remoteBranch,
    usedUpstream: target.usedUpstream,
  }

  // 2) 解析 ours / theirs
  let oursOid: string
  try {
    oursOid = await git.resolveRef({
      fs,
      dir,
      gitdir,
      ref: "refs/heads/" + localBranch,
    })
  } catch (_e) {
    // 无本地提交时无法 merge，尝试直接 checkout 远端跟踪分支
    try {
      const remoteOid = await git.resolveRef({
        fs,
        dir,
        gitdir,
        ref: trackRef,
      })
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
    } catch (e2: any) {
      throw new Error(
        `拉取失败：本地无提交且无法跟踪 ${pullRemote}/${remoteBranch} — ` +
          String(e2?.message || e2)
      )
    }
  }

  let theirsOid: string
  try {
    theirsOid = await git.resolveRef({
      fs,
      dir,
      gitdir,
      ref: trackRef,
    })
  } catch (_e) {
    // 远端无该跟踪分支：fetch 已更新其它 refs，视为无事可合并
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

/**
 * 将指定分支（本地或 origin/xxx）合并进当前分支。
 * 冲突路径与 Pull 相同：写 merge-state + 抛 MergeConflictError。
 */
async function mergeBranchIntoCurrentInternal(
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
  if (!current) {
    current = (await readSymbolicHeadBranch(fs)) || ""
  }
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

/** 查询当前合并冲突状态 */
export async function getMergeConflictState(
  bookmarkName: string
): Promise<MergeConflictState | null> {
  const { gitdir } = await getCtx(bookmarkName)
  return readMergeStateFile(gitdir)
}

/** 列出冲突文件（无进行中合并则空数组） */
export async function listConflictFiles(
  bookmarkName: string
): Promise<ConflictFile[]> {
  const state = await getMergeConflictState(bookmarkName)
  return state?.conflicts || []
}

/** 从提交树读取文本 blob；缺失返回 null */
async function readBlobTextAtCommit(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  oid: string,
  filepath: string
): Promise<string | null> {
  try {
    const { blob } = await git.readBlob({
      fs,
      dir,
      gitdir,
      oid,
      filepath,
    })
    if (blob == null) return null
    if (typeof blob === "string") return blob
    // Uint8Array / Buffer
    if (blob instanceof Uint8Array) {
      return new TextDecoder("utf-8", { fatal: false }).decode(blob)
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(blob)) {
      return blob.toString("utf8")
    }
    return String(blob)
  } catch (_e) {
    return null
  }
}

/** 写出文本到工作区并 add（标记冲突已解决） */
async function writeWorktreeAndAdd(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  filepath: string,
  content: string
): Promise<void> {
  // 确保父目录存在
  const parts = filepath.split("/").filter(Boolean)
  if (parts.length > 1) {
    let acc = ""
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? acc + "/" + parts[i] : parts[i]
      try {
        await fs.mkdir(acc)
      } catch (_e) {
        /* 已存在 */
      }
    }
  }
  await fs.writeFile(filepath, content)
  await git.add({ fs, dir, gitdir, filepath })
}

/** 删除工作区文件并从索引 remove */
async function removeWorktreeAndIndex(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  filepath: string
): Promise<void> {
  try {
    await fs.unlink(filepath)
  } catch (_e) {
    /* 工作区已无此文件 */
  }
  try {
    await git.remove({ fs, dir, gitdir, filepath })
  } catch (_e) {
    // 若仍 unmerged，remove 可能失败；再试 add 空？直接抛给上层
    throw new Error(`无法从索引移除冲突文件 ${filepath}`)
  }
}

/**
 * 按策略解决单个冲突文件。
 * - ours/theirs：从对应提交取内容或删除
 * - manual：要求工作区已是最终内容，仅 git add 标记解决
 */
async function resolveConflictFileInternal(
  bookmarkName: string,
  filepath: string,
  resolution: ConflictResolution
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const state = await readMergeStateFile(gitdir)
  if (!state) throw new Error("当前没有进行中的合并冲突")

  const path = normalizeConflictPath(filepath)
  const item = state.conflicts.find((c) => c.filepath === path)
  if (!item) throw new Error(`「${path}」不在冲突列表中`)

  if (resolution === "manual") {
    // 手动：工作区已编辑好，add 标记解决（删除类需用户先删文件再 add/remove）
    try {
      const exists = await fs.exists(path)
      if (exists) {
        await git.add({ fs, dir, gitdir, filepath: path })
      } else {
        await git.remove({ fs, dir, gitdir, filepath: path })
      }
    } catch (e: any) {
      throw new Error(
        `标记已解决失败：${String(e?.message || e)}。请确认工作区内容正确后重试。`
      )
    }
  } else {
    const action = resolutionActionForConflict(item.kind, resolution)
    if (action === "none") {
      throw new Error("该冲突类型不支持此解决策略")
    }
    const sourceOid =
      resolution === "ours" ? state.oursOid : state.theirsOid
    if (action === "remove") {
      await removeWorktreeAndIndex(git, fs, dir, gitdir, path)
    } else {
      const text = await readBlobTextAtCommit(
        git,
        fs,
        dir,
        gitdir,
        sourceOid,
        path
      )
      if (text == null) {
        // 源侧无此文件 → 按删除处理
        await removeWorktreeAndIndex(git, fs, dir, gitdir, path)
      } else {
        await writeWorktreeAndAdd(git, fs, dir, gitdir, path, text)
      }
    }
  }

  const next = removeResolvedConflict(
    {
      version: 1,
      ...state,
    },
    path
  )
  if (next) {
    await writeMergeStateFile(gitdir, {
      oursOid: next.oursOid,
      theirsOid: next.theirsOid,
      oursLabel: next.oursLabel,
      theirsLabel: next.theirsLabel,
      message: next.message,
      conflicts: next.conflicts,
      startedAt: next.startedAt,
    })
  } else {
    // 列表已空，但须等用户显式「完成合并提交」；保留状态仅清空 conflicts
    await writeMergeStateFile(gitdir, {
      ...state,
      conflicts: [],
    })
  }
}

/** 完成合并：要求冲突列表已空，创建双亲合并提交 */
async function completeMergeInternal(
  bookmarkName: string,
  message?: string,
  author?: { name: string; email: string }
): Promise<string> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const state = await readMergeStateFile(gitdir)
  if (!state) throw new Error("当前没有进行中的合并")
  if (state.conflicts.length > 0) {
    throw new Error(
      `仍有 ${state.conflicts.length} 个未解决冲突，请全部解决后再完成合并`
    )
  }

  const resolvedAuthor = await resolveAuthor(author)
  await ensureGitConfigAuthor(git, fs, dir, gitdir, resolvedAuthor)
  const parents = mergeCommitParents(state.oursOid, state.theirsOid)
  const msg =
    (message && message.trim()) ||
    state.message ||
    defaultMergeCommitMessage(state.theirsLabel, state.oursLabel)

  const oid = await git.commit({
    fs,
    dir,
    gitdir,
    message: msg,
    author: resolvedAuthor,
    committer: resolvedAuthor,
    parent: parents,
  })
  await clearMergeStateFile(gitdir)
  return oid
}

/** 中止合并：abortMerge 复位 index/工作区冲突文件，并清除状态 */
async function abortMergeInternal(bookmarkName: string): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const state = await readMergeStateFile(gitdir)
  try {
    await git.abortMerge({ fs, dir, gitdir, commit: "HEAD" })
  } catch (e: any) {
    // 无 unmerged 时 abortMerge 可能失败；若仅有状态文件则强制 checkout
    if (state) {
      try {
        await forceCheckoutRef(git, fs, dir, gitdir, "HEAD")
      } catch (_e2) {
        throw new Error(
          "中止合并失败：" +
            String(e?.message || e) +
            "；强制恢复工作区也失败"
        )
      }
    } else {
      throw new Error("中止合并失败：" + String(e?.message || e))
    }
  }
  await clearMergeStateFile(gitdir)
}

/**
 * 只 fetch 不 merge：刷新 refs/remotes/<remote>/<branch>，不改动工作区/索引。
 * 用于重编/回退前让「未推送」安全判定基于最新的远端 tip，
 * 避免因远端跟踪引用陈旧把「远端已领先」误判为「未推送」。
 */
async function fetchRemoteInternal(
  bookmarkName: string,
  remote = "origin",
  ref?: string
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
    // 获取全部远端分支，供分支列表与切换使用
    singleBranch: false,
    tags: false,
  })
}

/**
 * 克隆远端仓库到指定工作目录
 * @param url 远端地址
 * @param dir 目标工作目录（绝对路径）
 * @param gitdirKey 用于定位 gitdir 的短键（优先 repoId）
 * @param ref 指定分支
 * @param depth 浅克隆深度
 */
interface CloneOptions extends RemoteOpOptions {
  upstream?: {
    url: string
  }
}

async function cloneInternal(
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
  // clone 时若已有同名 gitdir 残留，先清掉，避免旧 index 套到新工作区
  const gitdir = resolveGitdir(gitdirKey)
  if (await FileManager.exists(gitdir)) {
    try {
      await FileManager.remove(gitdir)
    } catch (_e) {
      /* 忽略 */
    }
  }
  await FileManager.createDirectory(gitdir, true)
  checkRemoteCancelled(options)

  const { git } = await loadGitEngine()
  const fs = createFS(gitdir, dir)
  const auth = getAuth()
  const username = auth?.username
  const password = auth?.password
  const http = createHttpTransport(username, password)
  const onProgress = createGitOnProgress(options)
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
    // 克隆时拉取全部远端分支，否则 listBranches(remote) 只有默认分支
    singleBranch: false,
    onProgress,
  })
  checkRemoteCancelled(options)
  await emitRemoteProgress(options, "Finalizing")
  // fork：自己的仓库保留为 origin，源仓库仅作为可选的 upstream 远端。
  if (options?.upstream) {
    await git.addRemote({
      fs,
      dir,
      gitdir,
      remote: "upstream",
      url: options.upstream.url,
    })
  }
  // clone 后若工作区仍空，强制 checkout（避免历史路径映射问题导致只更新 gitdir）
  await ensureWorktreeMaterialized(git, fs, dir, gitdir)
}

/**
 * 仓库列表用轻量状态：改动数 + 是否领先远端（待推送）+ 合并冲突
 * 单次 getCtx，避免 getChanges/getBranches/listRemotes 重复装载引擎。
 * ahead 计算失败时记 0，不阻断列表渲染。
 */
export async function getRepoListStatus(
  bookmarkName: string
): Promise<RepoListStatus> {
  try {
    const dir = resolveWorkdir(bookmarkName)
    const workdirOk = await FileManager.exists(dir)
    if (!workdirOk) {
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
    const { git, fs, dir: workDir, gitdir: gdir } = ctx

    // 改动数：直接 statusMatrix，不走 getChanges 的二次 getCtx
    let uncommitted = 0
    try {
      const matrix = (await git.statusMatrix({
        fs,
        dir: workDir,
        gitdir: gdir,
      })) as [string, number, number, number][]
      for (const row of matrix) {
        const head = row[1]
        const work = row[2]
        const stage = row[3]
        if (head === 1 && work === 1 && stage === 1) continue
        if (matrixToStatus(head, work, stage) !== "unmodified") uncommitted++
      }
    } catch (_e) {
      uncommitted = 0
    }

    // 当前分支：列表不需要完整分支表，也不做 materialize
    let current: string | null = null
    try {
      current = await git.currentBranch({
        fs,
        dir: workDir,
        gitdir: gdir,
        fullname: false,
      })
    } catch (_e) {
      current = null
    }
    if (!current) {
      current = await readSymbolicHeadBranch(fs)
    }

    let hasRemote = false
    try {
      const remotes = (await git.listRemotes({
        fs,
        dir: workDir,
        gitdir: gdir,
      })) as { remote: string; url: string }[]
      hasRemote = remotes.length > 0
    } catch (_e) {
      hasRemote = false
    }

    let topology: {
      ahead: number
      behind: number
      syncState: RepoSyncState
    } = { ahead: 0, behind: 0, syncState: "upToDate" }
    if (hasRemote && current) {
      topology = await getSyncTopology(bookmarkName, current, ctx)
    }

    // 读 merge-state：有未解决冲突或待完成合并时列表优先展示
    let conflictCount = 0
    let mergeInProgress = false
    try {
      const merge = await getMergeConflictState(bookmarkName)
      if (merge) {
        mergeInProgress = true
        conflictCount = merge.conflicts.length
      }
    } catch (_e) {
      /* 列表摘要失败不阻断 */
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
  } catch (e: any) {
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
      error: String(e?.message || e),
    }
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

/**
 * 从 tip 沿第一父提交走到 stopOid（不含），计数提交数。
 * ahead/behind 通常沿主线，与桌面 Git 的 N commits ahead 一致。
 */
async function countCommitsUntil(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  tipOid: string,
  stopOid: string | null
): Promise<number> {
  if (!tipOid || tipOid === stopOid) return 0
  let count = 0
  let current: string | null = tipOid
  const seen = new Set<string>()
  while (current && current !== stopOid) {
    if (seen.has(current)) break
    seen.add(current)
    count++
    const result = await git.readCommit({ fs, dir, gitdir, oid: current })
    const parents: string[] = result.commit.parent || []
    current = parents[0] || null
  }
  return count
}

/** 计算本地与 origin 跟踪分支的 ahead/behind/diverged */
async function getSyncTopology(
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
    // 优先 merge-base + 沿第一父计数，避免大仓库全量可达图
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
    } catch (_mergeBaseErr) {
      /* 回退全量可达差集 */
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

// === 历史撤回 / 重编 ===

/** 读取当前 HEAD oid */
async function resolveHeadOid(
  git: any,
  fs: any,
  dir: string,
  gitdir: string
): Promise<string> {
  return await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" })
}

/**
 * 撤销提交（创建反向提交，不改写历史）。
 * 简化策略（移动端可用）：
 *  - 仅支持撤销「当前 HEAD」且为单父提交
 *  - 把工作区/索引恢复为父提交内容后，在原分支上新建 Revert 提交
 * 更早的历史提交请在桌面端处理，避免复杂三路合并。
 */
async function revertCommitInternal(
  bookmarkName: string,
  oid: string,
  author?: { name: string; email: string }
): Promise<string> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const resolvedAuthor = await resolveAuthor(author)
  await ensureGitConfigAuthor(git, fs, dir, gitdir, resolvedAuthor)

  const headOid = await resolveHeadOid(git, fs, dir, gitdir)
  if (oid !== headOid) {
    throw new Error("目前仅支持撤销最新提交（HEAD）。更早的提交请在电脑上操作。")
  }

  const target = await git.readCommit({ fs, dir, gitdir, oid })
  const parents: string[] = target.commit.parent || []
  if (parents.length > 1) {
    throw new Error("暂不支持撤销合并提交")
  }
  const parentOid = parents[0]
  if (!parentOid) {
    throw new Error("无法撤销初始提交（无父提交）")
  }

  let branch: string | null = null
  try {
    branch = await git.currentBranch({ fs, dir, gitdir, fullname: false })
  } catch (_e) {
    branch = null
  }
  if (!branch) {
    throw new Error("当前不在命名分支上，无法撤销")
  }

  // statusMatrix 无法可靠确认清洁状态时必须阻止强制 checkout，避免丢失用户改动。
  const matrix = (await git.statusMatrix({ fs, dir, gitdir })) as [
    string,
    number,
    number,
    number
  ][]
  const dirty = matrix.filter(
    (row) => !(row[1] === 1 && row[2] === 1 && row[3] === 1)
  )
  if (dirty.length > 0) {
    throw new Error(
      "工作区有未提交改动，撤销前请先提交或暂存（stash），以免丢失改动。"
    )
  }

  // 强制工作区+索引 = 父提交内容，HEAD 仍停在原分支 tip
  await checkoutWithEmptyDirCleanup(git, fs, {
    dir,
    gitdir,
    ref: parentOid,
    force: true,
  })
  // checkout 到 oid 会 detached：把分支 tip 写回原 headOid，HEAD 指回分支
  await git.writeRef({
    fs,
    dir,
    gitdir,
    ref: "refs/heads/" + branch,
    value: headOid,
    force: true,
  })
  // 正确写符号 HEAD（不能传 `ref: refs/heads/...`，否则会双重前缀损坏 HEAD）
  await writeSymbolicHead(fs, branch)

  // 暂存父树内容并提交反向变更
  await git.add({ fs, dir, gitdir, filepath: "." })
  // 父树中不存在、HEAD 中存在的文件需 remove（checkout 到父应已删，双保险）
  try {
    const matrix = await git.statusMatrix({ fs, dir, gitdir })
    for (const row of matrix as [string, number, number, number][]) {
      const filepath = row[0]
      const head = row[1]
      const work = row[2]
      // HEAD 有、工作区无 → 暂存删除
      if (head === 1 && work === 0) {
        await git.remove({ fs, dir, gitdir, filepath }).catch(() => undefined)
      }
    }
  } catch (_e) {
    /* 忽略 */
  }

  const title = (target.commit.message || "").split("\n")[0].trim()
  const message = `Revert "${title}"\n\nThis reverts commit ${oid}.`
  const newOid = await git.commit({
    fs,
    dir,
    gitdir,
    message,
    author: resolvedAuthor,
  })
  return newOid
}

/**
 * 未推送 HEAD：soft 回退到父提交（保留工作区与暂存改动）。
 * 仅允许当前 HEAD 且该提交为 unpushed。
 */
async function softResetHeadInternal(
  bookmarkName: string
): Promise<{ parentOid: string }> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const headOid = await resolveHeadOid(git, fs, dir, gitdir)
  const commit = await git.readCommit({ fs, dir, gitdir, oid: headOid })
  const parentOid = (commit.commit.parent || [])[0]
  if (!parentOid) {
    throw new Error("没有父提交，无法回退")
  }

  // 安全：若已在远端跟踪上，禁止 soft reset
  let branch: string | null = null
  try {
    branch = await git.currentBranch({ fs, dir, gitdir, fullname: false })
  } catch (_e) {
    branch = null
  }
  if (branch) {
    try {
      const remoteOid = await git.resolveRef({
        fs,
        dir,
        gitdir,
        ref: "refs/remotes/origin/" + branch,
      })
      // HEAD 若正好等于 remote tip，视为已推送
      if (remoteOid === headOid) {
        throw new Error("该提交已在远端，请使用「撤销提交」生成反向提交")
      }
      // 只有 remote tip 是 HEAD 的祖先时，HEAD 才真的是未推送的新提交
      // （旧实现用 log 遍历，在分叉/远端领先时会误判为未推送）
      let remoteIsAncestor = false
      try {
        remoteIsAncestor = await git.isDescendent({
          fs,
          dir,
          gitdir,
          oid: headOid,
          ancestor: remoteOid,
          depth: -1,
        })
      } catch (_e) {
        remoteIsAncestor = false
      }
      if (!remoteIsAncestor) {
        throw new Error(
          "本地与远端已分叉或远端领先，为避免改写已发布历史，请使用「撤销提交」"
        )
      }
    } catch (e: any) {
      if (e?.code !== "NotFoundError") throw e
      // 没有远端跟踪引用时，HEAD 尚未发布，允许回退。
    }
  }

  if (!branch) {
    throw new Error("当前不在命名分支上，无法回退")
  }

  // soft：只移动分支指针，不改 index/workdir
  await git.writeRef({
    fs,
    dir,
    gitdir,
    ref: "refs/heads/" + branch,
    value: parentOid,
    force: true,
  })
  // 确保 HEAD 仍指向该分支（正确写符号引用，避免双重 `ref:` 前缀）
  await writeSymbolicHead(fs, branch)
  return { parentOid }
}

/**
 * 未推送 HEAD：amend 重写最近一次提交信息（可选保留原树）。
 * 若有新的暂存改动，会一并纳入。
 */
async function amendHeadCommitInternal(
  bookmarkName: string,
  message: string,
  author?: { name: string; email: string }
): Promise<string> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const resolvedAuthor = await resolveAuthor(author)
  await ensureGitConfigAuthor(git, fs, dir, gitdir, resolvedAuthor)

  const headOid = await resolveHeadOid(git, fs, dir, gitdir)
  // 与 softReset 相同的已推送检查
  let branch: string | null = null
  try {
    branch = await git.currentBranch({ fs, dir, gitdir, fullname: false })
  } catch (_e) {
    branch = null
  }
  if (branch) {
    try {
      const remoteOid = await git.resolveRef({
        fs,
        dir,
        gitdir,
        ref: "refs/remotes/origin/" + branch,
      })
      if (remoteOid === headOid) {
        throw new Error("该提交已推送，不能重编；请新建提交或使用撤销")
      }
      // 只有 remote tip 是 HEAD 祖先时才允许 amend
      let remoteIsAncestor = false
      try {
        remoteIsAncestor = await git.isDescendent({
          fs,
          dir,
          gitdir,
          oid: headOid,
          ancestor: remoteOid,
          depth: -1,
        })
      } catch (_e) {
        remoteIsAncestor = false
      }
      if (!remoteIsAncestor) {
        throw new Error("本地与远端已分叉或远端领先，不能重编；请新建提交")
      }
    } catch (e: any) {
      if (e?.code !== "NotFoundError") throw e
      // 没有远端跟踪引用时，HEAD 尚未发布，允许重编。
    }
  }

  const oid = await git.commit({
    fs,
    dir,
    gitdir,
    message,
    author: resolvedAuthor,
    amend: true,
  })
  return oid
}

/**
 * 绑定 origin 并推送当前分支（上传 GitHub 用）。
 * 若已有 origin 则更新 URL。
 */
async function setOriginAndPushInternal(
  bookmarkName: string,
  remoteUrl: string,
  ref?: string
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const remotes = await git.listRemotes({ fs, dir, gitdir })
  const originalOrigin = remotes.find((r: any) => r.remote === "origin")

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
          /* 已有提交但无当前分支时再试 */
        }
      }
    }

    const auth = requireAuth()
    const http = createHttpTransport(auth.username, auth.password)
    await git.push({
      fs,
      dir,
      gitdir,
      http,
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
      /* 跟踪配置失败不阻断推送结果 */
    }
  } catch (e) {
    try {
      const current = await git.listRemotes({ fs, dir, gitdir })
      if (current.some((r: any) => r.remote === "origin")) {
        await git.deleteRemote({ fs, dir, gitdir, remote: "origin" })
      }
      // 原先有 origin 则恢复 URL；原先无 origin 则保持删除后的状态
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
      throw new Error(`设置 origin 失败且回滚失败：${String(e)}`)
    }
    throw e
  }
}

export async function initRepo(bookmarkName: string): Promise<void> {
  return runRepoMutation(bookmarkName, () => initRepoInternal(bookmarkName))
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

/** 冲突全部解决后创建合并提交 */
export async function completeMerge(
  bookmarkName: string,
  message?: string,
  author?: { name: string; email: string }
): Promise<string> {
  return runRepoMutation(bookmarkName, () =>
    completeMergeInternal(bookmarkName, message, author)
  )
}

/** 中止合并并恢复冲突前工作区 */
export async function abortMerge(bookmarkName: string): Promise<void> {
  return runRepoMutation(bookmarkName, () => abortMergeInternal(bookmarkName))
}

export async function fetchRemote(
  bookmarkName: string,
  remote = "origin",
  ref?: string
): Promise<void> {
  return runWithBackgroundKeepAlive(() =>
    runRepoMutation(bookmarkName, () =>
      fetchRemoteInternal(bookmarkName, remote, ref)
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
export { getRepoId }
