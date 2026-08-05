import type {
  CommitEntry,
  CommitSyncStatus,
  FileChange,
  FileChangeStatus,
} from "../../types/git"
import { paginateHistory, type HistoryPage } from "../../utils/history"
import { getCtx } from "./runtime"

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

  const matrix = await git.statusMatrix({ fs, dir, gitdir })
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

export async function getLog(
  bookmarkName: string,
  depth = 50
): Promise<CommitEntry[]> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await FileManager.exists(gitdir + "/HEAD"))) return []
  try {
    const log = await git.log({ fs, dir, gitdir, depth })
    let headOid: string | null = null
    try {
      headOid = await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" })
    } catch (_e) {
      headOid = null
    }

    let remoteOid: string | null = null
    let current: string | null = null
    try {
      current = await git.currentBranch({ fs, dir, gitdir, fullname: false })
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

    const unpushed = new Set<string>()
    if (remoteOid && headOid && remoteOid !== headOid) {
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
            const commitResult: { commit: { parent?: string[] } } =
              await git.readCommit({ fs, dir, gitdir, oid })
            for (const parent of commitResult.commit.parent || []) {
              if (parent !== base && !seen.has(parent)) pending.push(parent)
            }
          }
        } else {
          const [localReachable, remoteReachable] = await Promise.all([
            collectReachableCommits(git, fs, dir, gitdir, headOid),
            collectReachableCommits(git, fs, dir, gitdir, remoteOid),
          ])
          for (const oid of localReachable) {
            if (!remoteReachable.has(oid)) unpushed.add(oid)
          }
        }
      } catch (_e) {
        // 同步标记失败不影响历史展示
      }
    }

    return log.map((entry: any) => {
      let syncStatus: CommitSyncStatus = "local"
      if (remoteOid) syncStatus = unpushed.has(entry.oid) ? "unpushed" : "remote"
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
  const depth = query.trim().length > 0
    ? Number.MAX_SAFE_INTEGER
    : safeOffset + safeLimit + 1
  const entries = await getLog(bookmarkName, depth)
  return paginateHistory(entries, safeOffset, safeLimit, query)
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
