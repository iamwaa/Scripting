import type {
  CommitDetail,
  CommitFileChange,
  CommitFileStatus,
} from "../../types/git"
import { measureOperation } from "../../utils/performance"
import { getCtx } from "./runtime"

export type CommitReadToken = {
  cancelled: boolean
}

type TreeEntry = {
  path: string
  oid: string
  mode?: string | number
  type?: string
}

function isTreeEntry(entry: TreeEntry): boolean {
  const mode = String(entry.mode || "")
  return entry.type === "tree" || mode === "040000" || Number(entry.mode) === 16384
}

function assertCommitReadActive(token?: CommitReadToken): void {
  if (token?.cancelled) throw new Error("提交详情读取已取消")
}

function joinTreePath(prefix: string, path: string): string {
  return prefix ? prefix + "/" + path : path
}

export async function readTreeFiles(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  oid: string,
  prefix = ""
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const tree = await git.readTree({ fs, dir, gitdir, oid })
  for (const entry of (tree.tree || []) as TreeEntry[]) {
    const path = joinTreePath(prefix, entry.path)
    if (isTreeEntry(entry)) {
      const nested = await readTreeFiles(git, fs, dir, gitdir, entry.oid, path)
      nested.forEach((value, key) => result.set(key, value))
    } else {
      result.set(path, entry.oid)
    }
  }
  return result
}

function mergeTreeChange(
  changes: Map<string, CommitFileStatus>,
  filepath: string,
  status: CommitFileStatus
): void {
  const previous = changes.get(filepath)
  changes.set(
    filepath,
    previous && previous !== status ? "modified" : status
  )
}

async function appendTreeChanges(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  oid: string,
  prefix: string,
  status: "added" | "deleted",
  changes: Map<string, CommitFileStatus>,
  token?: CommitReadToken
): Promise<void> {
  assertCommitReadActive(token)
  const tree = await git.readTree({ fs, dir, gitdir, oid })
  assertCommitReadActive(token)
  for (const entry of (tree.tree || []) as TreeEntry[]) {
    const path = joinTreePath(prefix, entry.path)
    if (isTreeEntry(entry)) {
      await appendTreeChanges(
        git,
        fs,
        dir,
        gitdir,
        entry.oid,
        path,
        status,
        changes,
        token
      )
    } else {
      mergeTreeChange(changes, path, status)
    }
  }
}

async function compareTreeOids(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  parentOid: string | null,
  currentOid: string | null,
  prefix: string,
  changes: Map<string, CommitFileStatus>,
  token?: CommitReadToken
): Promise<void> {
  assertCommitReadActive(token)
  if (parentOid === currentOid) return
  if (!parentOid && currentOid) {
    await appendTreeChanges(
      git,
      fs,
      dir,
      gitdir,
      currentOid,
      prefix,
      "added",
      changes,
      token
    )
    return
  }
  if (parentOid && !currentOid) {
    await appendTreeChanges(
      git,
      fs,
      dir,
      gitdir,
      parentOid,
      prefix,
      "deleted",
      changes,
      token
    )
    return
  }
  if (!parentOid || !currentOid) return

  const [parentTree, currentTree] = await Promise.all([
    git.readTree({ fs, dir, gitdir, oid: parentOid }),
    git.readTree({ fs, dir, gitdir, oid: currentOid }),
  ])
  assertCommitReadActive(token)
  const parentEntries = new Map<string, TreeEntry>(
    ((parentTree.tree || []) as TreeEntry[]).map((entry) => [entry.path, entry])
  )
  const currentEntries = new Map<string, TreeEntry>(
    ((currentTree.tree || []) as TreeEntry[]).map((entry) => [entry.path, entry])
  )
  const names = new Set([...parentEntries.keys(), ...currentEntries.keys()])

  for (const name of names) {
    const parent = parentEntries.get(name)
    const current = currentEntries.get(name)
    if (parent?.oid === current?.oid) continue
    const path = joinTreePath(prefix, name)
    const parentIsTree = parent ? isTreeEntry(parent) : false
    const currentIsTree = current ? isTreeEntry(current) : false
    if (parentIsTree || currentIsTree) {
      await compareTreeOids(
        git,
        fs,
        dir,
        gitdir,
        parentIsTree ? parent!.oid : null,
        currentIsTree ? current!.oid : null,
        path,
        changes,
        token
      )
      if (parent && !parentIsTree) mergeTreeChange(changes, path, "deleted")
      if (current && !currentIsTree) mergeTreeChange(changes, path, "added")
      continue
    }
    mergeTreeChange(
      changes,
      path,
      !parent ? "added" : !current ? "deleted" : "modified"
    )
  }
}

export async function compareTreeOidsByPath(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  parentTreeOid: string | null,
  currentTreeOid: string,
  token?: CommitReadToken
): Promise<CommitFileChange[]> {
  const changes = new Map<string, CommitFileStatus>()
  await compareTreeOids(
    git,
    fs,
    dir,
    gitdir,
    parentTreeOid,
    currentTreeOid,
    "",
    changes,
    token
  )
  return Array.from(changes, ([filepath, status]) => ({ filepath, status }))
    .sort((left, right) => left.filepath.localeCompare(right.filepath))
}

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

export async function getCommitDetail(
  bookmarkName: string,
  oid: string,
  token?: CommitReadToken
): Promise<CommitDetail> {
  assertCommitReadActive(token)
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const current = await git.readCommit({ fs, dir, gitdir, oid })
  const commit = current.commit
  const parentOid = commit.parent?.[0] || null
  const parentTreeOid = parentOid
    ? (await git.readCommit({ fs, dir, gitdir, oid: parentOid })).commit.tree
    : null
  const files = await measureOperation(
    "比较提交文件树",
    () => compareTreeOidsByPath(
      git,
      fs,
      dir,
      gitdir,
      parentTreeOid,
      commit.tree,
      token
    ),
    bookmarkName
  )
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
