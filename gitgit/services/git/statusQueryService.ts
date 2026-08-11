import type {
  CommitEntry,
  FileChange,
  FileChangeStatus,
} from "../../types/git"
import { paginateHistory, type HistoryPage } from "../../utils/history"
import { setLruEntry } from "../../utils/lru"
import { measureOperation } from "../../utils/performance"
import { getCtx, type GitContext } from "./runtime"

const HISTORY_INITIAL_DEPTH = 64
const HISTORY_SEARCH_INITIAL_DEPTH = 256
export const HISTORY_CACHE_REPO_LIMIT = 4
export const HISTORY_CACHE_ENTRY_LIMIT = 5000

type LogCache = {
  headOid: string
  remoteOid: string | null
  branch: string | null
  depth: number
  exhausted: boolean
  limited: boolean
  entries: CommitEntry[]
}

const logCaches = new Map<string, LogCache>()

function storeLogCache(bookmarkName: string, cache: LogCache): void {
  setLruEntry(logCaches, bookmarkName, cache, HISTORY_CACHE_REPO_LIMIT)
}

function touchLogCache(bookmarkName: string, cache: LogCache): LogCache {
  storeLogCache(bookmarkName, cache)
  return cache
}

export function getHistoryCacheStats(): {
  repoCount: number
  entryCount: number
  repoLimit: number
  entryLimit: number
} {
  let entryCount = 0
  for (const cache of logCaches.values()) entryCount += cache.entries.length
  return {
    repoCount: logCaches.size,
    entryCount,
    repoLimit: HISTORY_CACHE_REPO_LIMIT,
    entryLimit: HISTORY_CACHE_ENTRY_LIMIT,
  }
}

export function matrixToStatus(head: number, work: number, stage: number): FileChangeStatus {
  const key = `${head}${work}${stage}`
  switch (key) {
    case "003":
    case "020":
    case "023":
      return "*added"
    case "022":
      return "added"
    case "100":
      return "deleted"
    case "101":
    case "110":
      return "*deleted"
    case "111":
      return "unmodified"
    case "120":
    case "121":
    case "123":
      return "*modified"
    case "122":
      return "modified"
    default:
      if (head !== work || head !== stage || work !== stage) {
        return work === 0 ? "*deleted" : head === 0 ? "*added" : "*modified"
      }
      return "unmodified"
  }
}

export async function hasHeadCommit(bookmarkName: string): Promise<boolean> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await FileManager.exists(gitdir + "/HEAD"))) return false
  try {
    await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" })
    return true
  } catch (_e) {
    return false
  }
}

export async function getChanges(bookmarkName: string): Promise<FileChange[]> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await FileManager.exists(gitdir + "/HEAD"))) return []
  try {
    const sample = await FileManager.readDirectory(dir)
    if (!sample) throw new Error("工作区不可读: " + dir)
  } catch (error: any) {
    throw new Error(
      "工作区无法访问（请移除后重新添加/克隆以重建安全访问）: " +
        String(error?.message || error)
    )
  }

  const matrix = await measureOperation(
    "扫描工作区状态",
    () => git.statusMatrix({ fs, dir, gitdir }),
    bookmarkName
  )
  const changes: FileChange[] = []
  for (const row of matrix as [string, number, number, number][]) {
    const filepath = String(row[0] || "").replace(/^\/+/, "")
    if (!filepath) continue
    const [head, work, stage] = row.slice(1) as [number, number, number]
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

async function resolveOptionalRef(
  ctx: GitContext,
  ref: string
): Promise<string | null> {
  try {
    return await ctx.git.resolveRef({
      fs: ctx.fs,
      dir: ctx.dir,
      gitdir: ctx.gitdir,
      ref,
    })
  } catch (_e) {
    return null
  }
}

async function readLogEntries(
  ctx: GitContext,
  depth: number,
  headOid: string,
  branch: string | null,
  remoteOid: string | null
): Promise<CommitEntry[]> {
  const { git, fs, dir, gitdir } = ctx
  const log = await measureOperation<any[]>(
    "读取本地历史",
    () => git.log({ fs, dir, gitdir, depth }),
    `depth=${depth}`
  )
  const remoteOids = new Set<string>()
  if (branch && remoteOid) {
    try {
      const remoteLog = await measureOperation<any[]>(
        "读取远端历史",
        () => git.log({
          fs,
          dir,
          gitdir,
          ref: "refs/remotes/origin/" + branch,
          depth,
        }),
        `depth=${depth}`
      )
      for (const entry of remoteLog as any[]) remoteOids.add(entry.oid)
    } catch (_e) {
      // 远端跟踪历史不可读时保留本地标签。
    }
  }

  return log.map((entry: any) => ({
    oid: entry.oid,
    message: entry.commit.message.trim(),
    author: {
      name: entry.commit.author?.name || "",
      email: entry.commit.author?.email || "",
    },
    date: new Date(entry.commit.author.timestamp * 1000).toISOString(),
    syncStatus: remoteOids.size > 0
      ? (remoteOids.has(entry.oid) ? "remote" : "unpushed")
      : "local",
    isHead: entry.oid === headOid,
  }))
}

async function getLogState(bookmarkName: string): Promise<{
  ctx: GitContext
  headOid: string
  branch: string | null
  remoteOid: string | null
}> {
  const ctx = await getCtx(bookmarkName)
  const headOid = (await resolveOptionalRef(ctx, "HEAD")) || ""
  if (!headOid) return { ctx, headOid, branch: null, remoteOid: null }
  let branch: string | null = null
  try {
    branch = await ctx.git.currentBranch({
      fs: ctx.fs,
      dir: ctx.dir,
      gitdir: ctx.gitdir,
      fullname: false,
    })
  } catch (_e) {
    branch = null
  }
  const remoteOid = branch
    ? await resolveOptionalRef(ctx, "refs/remotes/origin/" + branch)
    : null
  return { ctx, headOid, branch, remoteOid }
}

function cacheMatches(
  cache: LogCache | undefined,
  headOid: string,
  branch: string | null,
  remoteOid: string | null
): cache is LogCache {
  return !!cache &&
    cache.headOid === headOid &&
    cache.branch === branch &&
    cache.remoteOid === remoteOid
}

async function loadCachedLog(
  bookmarkName: string,
  minimumDepth: number,
  expand: boolean
): Promise<LogCache> {
  const state = await getLogState(bookmarkName)
  if (!state.headOid) {
    const empty: LogCache = {
      headOid: "",
      remoteOid: null,
      branch: null,
      depth: 0,
      exhausted: true,
      limited: false,
      entries: [],
    }
    storeLogCache(bookmarkName, empty)
    return empty
  }
  const existing = logCaches.get(bookmarkName)
  const cache = cacheMatches(
    existing,
    state.headOid,
    state.branch,
    state.remoteOid
  )
    ? existing
    : undefined
  if (cache?.exhausted || cache?.limited ||
    (cache && cache.depth >= minimumDepth && !expand)) {
    return touchLogCache(bookmarkName, cache)
  }

  const baseDepth = cache?.depth || 0
  const requestedDepth = Math.max(
    minimumDepth,
    baseDepth > 0 ? baseDepth * 2 : HISTORY_INITIAL_DEPTH
  )
  const depth = Math.min(requestedDepth, HISTORY_CACHE_ENTRY_LIMIT)
  const entries = await readLogEntries(
    state.ctx,
    depth,
    state.headOid,
    state.branch,
    state.remoteOid
  )
  const next: LogCache = {
    headOid: state.headOid,
    remoteOid: state.remoteOid,
    branch: state.branch,
    depth,
    exhausted: entries.length < depth,
    limited: entries.length >= HISTORY_CACHE_ENTRY_LIMIT,
    entries: entries.slice(0, HISTORY_CACHE_ENTRY_LIMIT),
  }
  storeLogCache(bookmarkName, next)
  return next
}

export async function getLog(
  bookmarkName: string,
  depth = 50
): Promise<CommitEntry[]> {
  try {
    const state = await getLogState(bookmarkName)
    if (!state.headOid) return []
    return await readLogEntries(
      state.ctx,
      depth,
      state.headOid,
      state.branch,
      state.remoteOid
    )
  } catch (_e) {
    return []
  }
}

export async function getLogPage(
  bookmarkName: string,
  offset: number,
  limit: number,
  query = ""
): Promise<HistoryPage> {
  const safeOffset = Math.max(0, Math.trunc(offset))
  const safeLimit = Math.max(1, Math.trunc(limit))
  const normalizedQuery = query.trim()
  const requiredDepth = safeOffset + safeLimit + 1
  const initialDepth = normalizedQuery
    ? Math.max(HISTORY_SEARCH_INITIAL_DEPTH, requiredDepth)
    : requiredDepth
  let cache = await loadCachedLog(bookmarkName, initialDepth, false)
  let page = paginateHistory(
    cache.entries,
    safeOffset,
    safeLimit,
    normalizedQuery
  )
  const scannedMatches = normalizedQuery ? page.totalMatches || 0 : cache.entries.length
  if (!cache.exhausted && scannedMatches <= safeOffset + safeLimit) {
    cache = await loadCachedLog(bookmarkName, initialDepth, true)
    page = paginateHistory(
      cache.entries,
      safeOffset,
      safeLimit,
      normalizedQuery
    )
  }
  return {
    entries: page.entries,
    hasMore: page.hasMore || (!cache.exhausted && !cache.limited),
    totalMatches: normalizedQuery && cache.exhausted ? page.totalMatches : null,
    limited: cache.limited,
  }
}

export async function getTrackedFiles(bookmarkName: string): Promise<string[]> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await FileManager.exists(gitdir + "/HEAD"))) return []
  try {
    await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" })
  } catch (error: any) {
    if (error?.code === "NotFoundError" || error?.code === "ENOENT") return []
    throw error
  }
  const files = await git.listFiles({ fs, dir, gitdir, ref: "HEAD" })
  return (files as string[])
    .map(String)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
}
