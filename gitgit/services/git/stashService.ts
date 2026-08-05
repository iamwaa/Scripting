import type { StashEntry } from "../../types/git"
import {
  collectGhostStashIndices,
  dropStashReflogAtIndex,
  isStatusMatrixClean,
  isValidOid,
  pairStashEntriesWithOids,
  parseStashEntries,
  repairStashReflogLines,
  stashOidsNewestFirst,
} from "../../utils/stash"
import { getCtx } from "./runtime"

const STASH_REFLOG = "logs/refs/stash"
const STASH_REF = "refs/stash"

async function readStashReflogRaw(fs: any): Promise<string> {
  try {
    if (!(await fs.exists(STASH_REFLOG))) return ""
    const raw = await fs.readFile(STASH_REFLOG, "utf8")
    return typeof raw === "string" ? raw : String(raw || "")
  } catch (_e) {
    return ""
  }
}

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

export async function repairStashReflog(fs: any): Promise<void> {
  const raw = await readStashReflogRaw(fs)
  if (!raw) {
    if (await fs.exists(STASH_REF)) {
      try {
        const tip = String(await fs.readFile(STASH_REF, "utf8")).trim()
        if (!isValidOid(tip)) await fs.unlink(STASH_REF)
      } catch (_e) {
        try {
          await fs.unlink(STASH_REF)
        } catch (__e) {
          // 清理失败不覆盖原始读取结果
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

async function withStashOids(
  fs: any,
  entries: StashEntry[]
): Promise<StashEntry[]> {
  if (entries.length === 0) return entries
  const raw = await readStashReflogRaw(fs)
  if (!raw.trim()) return entries
  const chronological = raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
  return pairStashEntriesWithOids(entries, stashOidsNewestFirst(chronological))
}

export async function listStashes(bookmarkName: string): Promise<StashEntry[]> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  await repairStashReflog(fs)
  const entries = await git.stash({ fs, dir, gitdir, op: "list" })
  const ghostIndices = collectGhostStashIndices(entries)
  if (ghostIndices.length === 0) {
    return withStashOids(fs, parseStashEntries(entries))
  }

  for (const refIdx of ghostIndices) {
    try {
      await safeDropStash(fs, refIdx)
    } catch (error) {
      console.warn("清理幽灵 Stash 失败 (index=" + refIdx + "): " + error)
    }
  }
  const cleaned = await git.stash({ fs, dir, gitdir, op: "list" })
  return withStashOids(fs, parseStashEntries(cleaned))
}

export async function applyStashInternal(
  bookmarkName: string,
  index: number
): Promise<void> {
  if (!Number.isInteger(index) || index < 0) throw new Error("无效的 Stash 索引")
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
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

export async function dropStashInternal(
  bookmarkName: string,
  index: number
): Promise<void> {
  if (!Number.isInteger(index) || index < 0) throw new Error("无效的 Stash 索引")
  const { fs } = await getCtx(bookmarkName)
  await safeDropStash(fs, index)
}
