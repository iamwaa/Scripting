import type { CommitDetail, CommitFileChange } from "../../types/git"
import { getCtx } from "./runtime"

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
    files: compareCommitTrees(parentFiles, currentFiles),
  }
}
