import type { BranchInfo, ManagedBranches } from "../../types/git"
import { ensureWorktreeMaterialized, getCtx } from "./runtime"

async function readSymbolicHeadBranch(fs: any): Promise<string | null> {
  try {
    const head = await fs.readFile("HEAD", "utf8")
    const match = String(head).match(/^ref:\s*refs\/heads\/(\S+)/m)
    return match ? match[1].trim() : null
  } catch (_e) {
    return null
  }
}

async function hasHead(gitdir: string): Promise<boolean> {
  return FileManager.exists(gitdir + "/HEAD")
}

export function normalizeRemoteBranches(
  branches: string[],
  remote: string
): string[] {
  const prefix = `${remote}/`
  return Array.from(
    new Set(
      branches
        .map((branch) => {
          const name = String(branch || "")
          return name.startsWith(prefix) ? name.slice(prefix.length) : name
        })
        .filter((branch) => !!branch && branch !== "HEAD")
    )
  ).sort((left, right) => left.localeCompare(right))
}

export async function getRemoteBranches(
  bookmarkName: string,
  remote: string
): Promise<string[]> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  try {
    const branches = await git.listBranches({ fs, dir, gitdir, remote })
    return normalizeRemoteBranches(branches, remote)
  } catch (_e) {
    return []
  }
}

export async function getBranches(bookmarkName: string): Promise<BranchInfo> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await hasHead(gitdir))) return { branches: [], current: null }
  try {
    await ensureWorktreeMaterialized(git, fs, dir, gitdir)
  } catch (_e) {
    // 分支查询不因工作区修复失败而中止
  }
  let localBranches: string[] = []
  try {
    localBranches = await git.listBranches({ fs, dir, gitdir })
  } catch (_e) {
    localBranches = []
  }
  let remoteBranches: string[] = []
  try {
    remoteBranches = await git.listBranches({ fs, dir, gitdir, remote: "origin" })
  } catch (_e) {
    remoteBranches = []
  }
  remoteBranches = normalizeRemoteBranches(remoteBranches, "origin")

  const branchSet = new Set<string>([...localBranches, ...remoteBranches])
  let current: string | null = null
  try {
    current = await git.currentBranch({ fs, dir, gitdir, fullname: false })
  } catch (_e) {
    current = null
  }
  if (!current) current = await readSymbolicHeadBranch(fs)
  if (current) branchSet.add(current)
  const branches = Array.from(branchSet).sort((left, right) => {
    if (left === current) return -1
    if (right === current) return 1
    return left.localeCompare(right)
  })
  return { branches, current }
}

export async function getManagedBranches(
  bookmarkName: string
): Promise<ManagedBranches> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  if (!(await hasHead(gitdir))) {
    return { current: null, locals: [], remotes: [], remoteNames: [], hasRemote: false }
  }
  try {
    await ensureWorktreeMaterialized(git, fs, dir, gitdir)
  } catch (_e) {
    // 分支查询不因工作区修复失败而中止
  }
  let locals: string[] = []
  try {
    locals = await git.listBranches({ fs, dir, gitdir })
  } catch (_e) {
    locals = []
  }
  let hasRemote = false
  try {
    const remotes = (await git.listRemotes({ fs, dir, gitdir })) as {
      remote: string
    }[]
    hasRemote = remotes.some((remote) => remote.remote === "origin")
  } catch (_e) {
    hasRemote = false
  }
  let remoteBranches: string[] = []
  try {
    remoteBranches = await git.listBranches({ fs, dir, gitdir, remote: "origin" })
  } catch (_e) {
    remoteBranches = []
  }
  remoteBranches = normalizeRemoteBranches(remoteBranches, "origin")

  let current: string | null = null
  try {
    current = await git.currentBranch({ fs, dir, gitdir, fullname: false })
  } catch (_e) {
    current = null
  }
  if (!current) current = await readSymbolicHeadBranch(fs)

  const localSet = new Set<string>(locals)
  if (current) localSet.add(current)
  const sortedLocals = Array.from(localSet).sort((left, right) => {
    if (left === current) return -1
    if (right === current) return 1
    return left.localeCompare(right)
  })
  const remoteNames = Array.from(new Set<string>(remoteBranches)).sort((left, right) =>
    left.localeCompare(right)
  )
  return {
    current,
    locals: sortedLocals,
    remotes: remoteNames.filter((branch) => !localSet.has(branch)),
    remoteNames,
    hasRemote,
  }
}
