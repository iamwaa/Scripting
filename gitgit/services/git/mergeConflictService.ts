import { resolveAuthor } from "../authStore"
import type { ConflictFile, MergeConflictState } from "../../types/git"
import {
  buildMergeState,
  defaultMergeCommitMessage,
  mergeCommitParents,
  normalizeConflictPath,
  parseMergeState,
  removeResolvedConflict,
  resolutionActionForConflict,
  serializeMergeState,
  type ConflictResolution,
} from "../../utils/mergeConflict"
import {
  ensureGitConfigAuthor,
  forceCheckoutRef,
  getCtx,
} from "./runtime"

const MERGE_STATE_FILE = "gitgit-merge-state.json"

function mergeStatePath(gitdir: string): string {
  return gitdir.replace(/\/+$/, "") + "/" + MERGE_STATE_FILE
}

export async function readMergeStateFile(
  gitdir: string
): Promise<MergeConflictState | null> {
  const path = mergeStatePath(gitdir)
  try {
    if (!(await FileManager.exists(path))) return null
    const parsed = parseMergeState(await FileManager.readAsString(path))
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

export async function writeMergeStateFile(
  gitdir: string,
  state: MergeConflictState
): Promise<void> {
  const path = mergeStatePath(gitdir)
  try {
    await FileManager.writeAsString(
      path,
      serializeMergeState(buildMergeState(state))
    )
  } catch (error: any) {
    throw new Error("无法写入合并状态文件：" + String(error?.message || error))
  }
}

export async function clearMergeStateFile(gitdir: string): Promise<void> {
  const path = mergeStatePath(gitdir)
  try {
    if (await FileManager.exists(path)) await FileManager.remove(path)
  } catch (_e) {
    // 清理失败不阻断主流程
  }
}

export async function listUnmergedPathsFromIndex(
  git: any,
  fs: any,
  dir: string,
  gitdir: string
): Promise<string[]> {
  try {
    const paths = new Set<string>()
    await git.walk({
      fs,
      dir,
      gitdir,
      trees: [git.STAGE()],
      map: async (filepath: string, [entry]: any[]) => {
        if (!filepath || filepath === "." || !entry) return
        try {
          const stages = entry.stages || null
          if (stages && (stages[1] || stages[2] || stages[3])) {
            paths.add(normalizeConflictPath(filepath))
          }
        } catch (_e) {
          // 忽略单条目读取失败
        }
      },
    })
    return Array.from(paths).filter(Boolean).sort()
  } catch (_e) {
    return []
  }
}

export function throwMergeConflictUserError(conflicts: ConflictFile[]): never {
  const names = conflicts.map((item) => item.filepath).slice(0, 8)
  const more = conflicts.length > names.length
    ? ` 等 ${conflicts.length} 个文件`
    : ""
  const error = new Error(
    `合并冲突：请解决后提交，或中止合并。冲突文件：${names.join(", ")}${more}`
  )
  ;(error as any).code = "MergeConflictError"
  ;(error as any).conflicts = conflicts
  throw error
}

export async function assertNoMergeInProgress(gitdir: string): Promise<void> {
  const existing = await readMergeStateFile(gitdir)
  if (!existing) return
  if (existing.conflicts.length > 0) {
    throwMergeConflictUserError(existing.conflicts)
  }
  throw new Error("存在未完成的合并：请先「完成合并提交」或「中止合并」后再继续")
}

export async function getMergeConflictState(
  bookmarkName: string
): Promise<MergeConflictState | null> {
  const { gitdir } = await getCtx(bookmarkName)
  return readMergeStateFile(gitdir)
}

export async function listConflictFiles(
  bookmarkName: string
): Promise<ConflictFile[]> {
  const state = await getMergeConflictState(bookmarkName)
  return state?.conflicts || []
}

async function readBlobTextAtCommit(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  oid: string,
  filepath: string
): Promise<string | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir, gitdir, oid, filepath })
    if (blob == null) return null
    if (typeof blob === "string") return blob
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

async function writeWorktreeAndAdd(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  filepath: string,
  content: string
): Promise<void> {
  const parts = filepath.split("/").filter(Boolean)
  if (parts.length > 1) {
    let current = ""
    for (let index = 0; index < parts.length - 1; index++) {
      current = current ? current + "/" + parts[index] : parts[index]
      try {
        await fs.mkdir(current)
      } catch (_e) {
        // 目录已存在
      }
    }
  }
  await fs.writeFile(filepath, content)
  await git.add({ fs, dir, gitdir, filepath })
}

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
    // 工作区已无此文件
  }
  try {
    await git.remove({ fs, dir, gitdir, filepath })
  } catch (_e) {
    throw new Error(`无法从索引移除冲突文件 ${filepath}`)
  }
}

export async function resolveConflictFileInternal(
  bookmarkName: string,
  filepath: string,
  resolution: ConflictResolution
): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const state = await readMergeStateFile(gitdir)
  if (!state) throw new Error("当前没有进行中的合并冲突")
  const path = normalizeConflictPath(filepath)
  const item = state.conflicts.find((conflict) => conflict.filepath === path)
  if (!item) throw new Error(`「${path}」不在冲突列表中`)

  if (resolution === "manual") {
    try {
      if (await fs.exists(path)) {
        await git.add({ fs, dir, gitdir, filepath: path })
      } else {
        await git.remove({ fs, dir, gitdir, filepath: path })
      }
    } catch (error: any) {
      throw new Error(
        `标记已解决失败：${String(error?.message || error)}。请确认工作区内容正确后重试。`
      )
    }
  } else {
    const action = resolutionActionForConflict(item.kind, resolution)
    if (action === "none") throw new Error("该冲突类型不支持此解决策略")
    const sourceOid = resolution === "ours" ? state.oursOid : state.theirsOid
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
        await removeWorktreeAndIndex(git, fs, dir, gitdir, path)
      } else {
        await writeWorktreeAndAdd(git, fs, dir, gitdir, path, text)
      }
    }
  }

  const next = removeResolvedConflict({ version: 1, ...state }, path)
  await writeMergeStateFile(
    gitdir,
    next
      ? {
          oursOid: next.oursOid,
          theirsOid: next.theirsOid,
          oursLabel: next.oursLabel,
          theirsLabel: next.theirsLabel,
          message: next.message,
          conflicts: next.conflicts,
          startedAt: next.startedAt,
        }
      : { ...state, conflicts: [] }
  )
}

export async function completeMergeInternal(
  bookmarkName: string,
  message?: string,
  author?: { name: string; email: string }
): Promise<string> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const state = await readMergeStateFile(gitdir)
  if (!state) throw new Error("当前没有进行中的合并")
  if (state.conflicts.length > 0) {
    throw new Error(`仍有 ${state.conflicts.length} 个未解决冲突，请全部解决后再完成合并`)
  }
  const resolvedAuthor = await resolveAuthor(author)
  await ensureGitConfigAuthor(git, fs, dir, gitdir, resolvedAuthor)
  const oid = await git.commit({
    fs,
    dir,
    gitdir,
    message:
      (message && message.trim()) ||
      state.message ||
      defaultMergeCommitMessage(state.theirsLabel, state.oursLabel),
    author: resolvedAuthor,
    committer: resolvedAuthor,
    parent: mergeCommitParents(state.oursOid, state.theirsOid),
  })
  await clearMergeStateFile(gitdir)
  return oid
}

export async function abortMergeInternal(bookmarkName: string): Promise<void> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const state = await readMergeStateFile(gitdir)
  try {
    await git.abortMerge({ fs, dir, gitdir, commit: "HEAD" })
  } catch (error: any) {
    if (!state) {
      throw new Error("中止合并失败：" + String(error?.message || error))
    }
    try {
      await forceCheckoutRef(git, fs, dir, gitdir, "HEAD")
    } catch (_checkoutError) {
      throw new Error(
        "中止合并失败：" +
          String(error?.message || error) +
          "；强制恢复工作区也失败"
      )
    }
  }
  await clearMergeStateFile(gitdir)
}
