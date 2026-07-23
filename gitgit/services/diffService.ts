/**
 * services/diffService.ts - 行级 diff 计算
 *
 * isomorphic-git 不内置行级 diff，这里实现一个轻量 LCS 算法，
 * 对比 HEAD 版本与工作区当前版本，输出逐行增删改。
 *
 * 数据源：
 *  - HEAD 版本：git.readBlob({ fs, dir, gitdir, oid }) 取 blob 内容
 *  - 工作区版本：FileManager 直接读磁盘文件
 */

import { loadGitEngine, createFS } from "./gitCore"
import { resolveWorkdir, findRepo, getGitdirPath } from "./repoStore"

const MAX_LCS_CELLS = 1_000_000
const MAX_CONTEXT_LINES = 3

/** 单行 diff 类型（skip = 中间折叠的未改动区） */
export type DiffLineType = "add" | "del" | "context" | "skip"

/** 单行 diff 数据 */
export interface DiffLine {
  type: DiffLineType
  content: string
  oldLineNo?: number
  newLineNo?: number
}

/** 一个文件的完整 diff */
export interface FileDiff {
  filepath: string
  /** 是否为新增文件（HEAD 中不存在） */
  added: boolean
  /** 是否为删除文件（工作区中不存在） */
  deleted: boolean
  /** 二进制文件不产生行级 diff */
  binary: boolean
  lines: DiffLine[]
}

/** 操作上下文 */
interface Ctx {
  git: any
  fs: any
  dir: string
  gitdir: string
}

async function getCtx(bookmarkName: string): Promise<Ctx> {
  const dir = resolveWorkdir(bookmarkName)
  const repo = findRepo(bookmarkName)
  if (!repo) throw new Error("仓库不存在: " + bookmarkName)
  const gitdir = getGitdirPath(repo)
  const { git } = await loadGitEngine()
  const fs = createFS(gitdir, dir)
  return { git, fs, dir, gitdir }
}

/**
 * LCS 行级 diff 算法
 * 输入旧/新文本的行数组，返回 DiffLine[]
 * 算法：经典动态规划求最长公共子序列，再回溯标注增删
 */
export function lineDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  let prefixLength = 0
  while (
    prefixLength < oldLines.length &&
    prefixLength < newLines.length &&
    oldLines[prefixLength] === newLines[prefixLength]
  ) {
    prefixLength++
  }

  let suffixLength = 0
  while (
    suffixLength < oldLines.length - prefixLength &&
    suffixLength < newLines.length - prefixLength &&
    oldLines[oldLines.length - 1 - suffixLength] ===
      newLines[newLines.length - 1 - suffixLength]
  ) {
    suffixLength++
  }

  const prefix = oldLines.slice(0, prefixLength).map((content, index) => ({
    type: "context" as DiffLineType,
    content,
    oldLineNo: index + 1,
    newLineNo: index + 1,
  }))
  const oldMiddle = oldLines.slice(prefixLength, oldLines.length - suffixLength)
  const newMiddle = newLines.slice(prefixLength, newLines.length - suffixLength)
  const middle = lineDiffMiddle(oldMiddle, newMiddle, prefixLength, prefixLength)
  const suffix = oldLines.slice(oldLines.length - suffixLength).map((content, index) => ({
    type: "context" as DiffLineType,
    content,
    oldLineNo: oldLines.length - suffixLength + index + 1,
    newLineNo: newLines.length - suffixLength + index + 1,
  }))
  return trimContext([...prefix, ...middle, ...suffix])
}

/** 只保留变更附近的少量上下文，避免大文件一次性创建和渲染全部行 */
function trimContext(lines: DiffLine[]): DiffLine[] {
  const changed = lines
    .map((line, index) => (line.type === "context" ? -1 : index))
    .filter((index) => index >= 0)
  if (changed.length === 0) return lines
  const keep = new Set<number>()
  for (const index of changed) {
    for (
      let cursor = Math.max(0, index - MAX_CONTEXT_LINES);
      cursor <= Math.min(lines.length - 1, index + MAX_CONTEXT_LINES);
      cursor++
    ) {
      keep.add(cursor)
    }
  }
  const result: DiffLine[] = []
  let previous = -2
  for (const index of Array.from(keep).sort((a, b) => a - b)) {
    if (index > previous + 1) {
      // 独立类型，UI 可做成分隔条，避免与普通上下文行混淆
      result.push({ type: "skip", content: "省略未改动的行" })
    }
    result.push(lines[index])
    previous = index
  }
  return result
}

function lineDiffMiddle(
  oldLines: string[],
  newLines: string[],
  oldOffset: number,
  newOffset: number
): DiffLine[] {
  const m = oldLines.length
  const n = newLines.length

  // 大文件先用唯一行建立低内存锚点，再对锚点之间的小区间做精确 LCS
  if (m * n > MAX_LCS_CELLS) {
    const anchored = lineDiffByUniqueAnchors(
      oldLines,
      newLines,
      oldOffset,
      newOffset
    )
    if (anchored) return anchored
    return lineDiffGreedy(oldLines, newLines, oldOffset, newOffset)
  }

  // dp[i][j] = oldLines[0..i) 与 newLines[0..j) 的 LCS 长度
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // 回溯生成 diff
  const result: DiffLine[] = []
  let i = m
  let j = n
  // 临时栈（回溯顺序是从后往前，最后反转）
  const stack: DiffLine[] = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({
        type: "context",
        content: oldLines[i - 1],
        oldLineNo: oldOffset + i,
        newLineNo: newOffset + j,
      })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({
        type: "add",
        content: newLines[j - 1],
        newLineNo: newOffset + j,
      })
      j--
    } else {
      stack.push({
        type: "del",
        content: oldLines[i - 1],
        oldLineNo: oldOffset + i,
      })
      i--
    }
  }
  // 反转得到正确顺序
  for (let k = stack.length - 1; k >= 0; k--) {
    result.push(stack[k])
  }
  return result
}

function lineDiffByUniqueAnchors(
  oldLines: string[],
  newLines: string[],
  oldOffset: number,
  newOffset: number
): DiffLine[] | null {
  const oldPositions = new Map<string, number>()
  const newPositions = new Map<string, number>()
  for (let i = 0; i < oldLines.length; i++) {
    oldPositions.set(oldLines[i], oldPositions.has(oldLines[i]) ? -1 : i)
  }
  for (let i = 0; i < newLines.length; i++) {
    newPositions.set(newLines[i], newPositions.has(newLines[i]) ? -1 : i)
  }
  const candidates: Array<[number, number]> = []
  for (const [line, oldIndex] of oldPositions) {
    const newIndex = newPositions.get(line)
    if (oldIndex !== undefined && oldIndex >= 0 && newIndex !== undefined && newIndex >= 0) {
      candidates.push([oldIndex, newIndex])
    }
  }
  candidates.sort((a, b) => a[0] - b[0])
  if (candidates.length === 0) return null

  const anchors: Array<[number, number]> = []
  let lastNew = -1
  for (const candidate of candidates) {
    if (candidate[1] > lastNew) {
      anchors.push(candidate)
      lastNew = candidate[1]
    }
  }
  if (anchors.length === 0) return null

  const result: DiffLine[] = []
  let oldStart = 0
  let newStart = 0
  for (const [oldIndex, newIndex] of anchors) {
    result.push(
      ...lineDiffMiddle(
        oldLines.slice(oldStart, oldIndex),
        newLines.slice(newStart, newIndex),
        oldOffset + oldStart,
        newOffset + newStart
      )
    )
    result.push({
      type: "context",
      content: oldLines[oldIndex],
      oldLineNo: oldOffset + oldIndex + 1,
      newLineNo: newOffset + newIndex + 1,
    })
    oldStart = oldIndex + 1
    newStart = newIndex + 1
  }
  result.push(
    ...lineDiffMiddle(
      oldLines.slice(oldStart),
      newLines.slice(newStart),
      oldOffset + oldStart,
      newOffset + newStart
    )
  )
  return result
}

/** 无锚点时逐行配对，避免生成两份完整大文件内容 */
function lineDiffGreedy(
  oldLines: string[],
  newLines: string[],
  oldOffset: number,
  newOffset: number
): DiffLine[] {
  const result: DiffLine[] = []
  const length = Math.min(oldLines.length, newLines.length)
  for (let i = 0; i < length; i++) {
    if (oldLines[i] === newLines[i]) {
      result.push({
        type: "context",
        content: oldLines[i],
        oldLineNo: oldOffset + i + 1,
        newLineNo: newOffset + i + 1,
      })
    } else {
      result.push({ type: "del", content: oldLines[i], oldLineNo: oldOffset + i + 1 })
      result.push({ type: "add", content: newLines[i], newLineNo: newOffset + i + 1 })
    }
  }
  for (let i = length; i < oldLines.length; i++) {
    result.push({ type: "del", content: oldLines[i], oldLineNo: oldOffset + i + 1 })
  }
  for (let i = length; i < newLines.length; i++) {
    result.push({ type: "add", content: newLines[i], newLineNo: newOffset + i + 1 })
  }
  return result
}

/** 判断是否为文本内容（粗略：含 NUL 字节视为二进制） */
function isBinary(bytes: Uint8Array): boolean {
  const checkLen = Math.min(bytes.length, 8000)
  for (let i = 0; i < checkLen; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

/**
 * 计算单个文件的工作区 vs HEAD diff
 */
export async function getFileDiff(
  bookmarkName: string,
  filepath: string
): Promise<FileDiff> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)

  // 读工作区当前版本
  let workBytes: Uint8Array | null = null
  const workPath = dir + "/" + filepath
  if (await FileManager.exists(workPath)) {
    const isFile = await FileManager.isFile(workPath)
    if (isFile) {
      workBytes = await FileManager.readAsBytes(workPath)
    }
  }

  // 读 HEAD 版本（可能不存在：新增文件）
  let oldBytes: Uint8Array | null = null
  try {
    const headOid = await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" })
    const blob = await git.readBlob({
      fs,
      dir,
      gitdir,
      oid: headOid,
      filepath,
    })
    oldBytes = new Uint8Array(blob.blob)
  } catch (e: any) {
    const code = e?.code
    if (code !== "NotFoundError" && code !== "ENOENT" && code !== "ENOTDIR") {
      throw e
    }
    // HEAD 或 blob 明确不存在时，才按新增文件处理
  }

  // 纯新增
  if (!oldBytes && workBytes) {
    return buildAdded(filepath, workBytes)
  }
  // 纯删除
  if (oldBytes && !workBytes) {
    return buildDeleted(filepath, oldBytes)
  }
  // 两者都无（理论不应发生）
  if (!oldBytes && !workBytes) {
    return { filepath, added: false, deleted: false, binary: false, lines: [] }
  }

  // 都存在：行级 diff
  return buildModified(filepath, oldBytes!, workBytes!)
}

function textLines(text: string): string[] {
  // 去掉文件末尾换行产生的虚假空行，避免 Diff 多计一行
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""))
  if (text.endsWith("\n")) lines.pop()
  return lines
}

function buildAdded(filepath: string, bytes: Uint8Array): FileDiff {
  if (isBinary(bytes)) {
    return { filepath, added: true, deleted: false, binary: true, lines: [] }
  }
  const text = decodeUtf8(bytes)
  const lines = textLines(text)
  return {
    filepath,
    added: true,
    deleted: false,
    binary: false,
    lines: lines.map((content, idx) => ({
      type: "add" as DiffLineType,
      content,
      newLineNo: idx + 1,
    })),
  }
}

/** 构建删除文件 diff */
function buildDeleted(filepath: string, bytes: Uint8Array): FileDiff {
  if (isBinary(bytes)) {
    return { filepath, added: false, deleted: true, binary: true, lines: [] }
  }
  const text = decodeUtf8(bytes)
  const lines = textLines(text)
  return {
    filepath,
    added: false,
    deleted: true,
    binary: false,
    lines: lines.map((content, idx) => ({
      type: "del" as DiffLineType,
      content,
      oldLineNo: idx + 1,
    })),
  }
}

/** 构建修改文件 diff */
function buildModified(
  filepath: string,
  oldBytes: Uint8Array,
  newBytes: Uint8Array
): FileDiff {
  const oldBin = isBinary(oldBytes)
  const newBin = isBinary(newBytes)
  if (oldBin || newBin) {
    return { filepath, added: false, deleted: false, binary: true, lines: [] }
  }
  const oldLines = textLines(decodeUtf8(oldBytes))
  const newLines = textLines(decodeUtf8(newBytes))
  return {
    filepath,
    added: false,
    deleted: false,
    binary: false,
    lines: lineDiff(oldLines, newLines),
  }
}

export async function getCommitFileDiff(
  bookmarkName: string,
  targetOid: string,
  parentOid: string | null,
  filepath: string
): Promise<FileDiff> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)

  async function readVersion(oid: string | null): Promise<Uint8Array | null> {
    if (!oid) return null
    try {
      const result = await git.readBlob({ fs, dir, gitdir, oid, filepath })
      return new Uint8Array(result.blob)
    } catch (e: any) {
      const code = e?.code
      if (code === "NotFoundError" || code === "ENOENT" || code === "ENOTDIR") {
        return null
      }
      throw e
    }
  }

  const [oldBytes, newBytes] = await Promise.all([
    readVersion(parentOid),
    readVersion(targetOid),
  ])
  if (!oldBytes && newBytes) return buildAdded(filepath, newBytes)
  if (oldBytes && !newBytes) return buildDeleted(filepath, oldBytes)
  if (oldBytes && newBytes) return buildModified(filepath, oldBytes, newBytes)
  return { filepath, added: false, deleted: false, binary: false, lines: [] }
}

/** UTF-8 解码（复用 polyfill 的 TextDecoder） */
function decodeUtf8(bytes: Uint8Array): string {
  const TD = (globalThis as any).TextDecoder
  if (TD) {
    return new TD().decode(bytes)
  }
  // 退化为 fromCharCode（仅 ASCII 正确）
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return s
}
