import type { StashEntry } from "../types/git"

const OID_RE = /^[0-9a-f]{40}$/i

/** 40 位 hex OID */
export function isValidOid(value: string): boolean {
  return OID_RE.test(value)
}

/**
 * stash message 必须单行：多行会拆坏 logs/refs/stash，
 * 导致 drop 时把续行里的 "reverts" 等词误当成 OID。
 */
export function sanitizeStashMessage(message: string): string {
  return String(message || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim()
}

/**
 * 是否为幽灵 stash 消息。
 * isomorphic-git 在 reflog 行缺 tab 时会拼出字面 "undefined"。
 */
export function isGhostStashMessage(message: string): boolean {
  const msg = message.trim()
  return !msg || msg === "undefined"
}

/**
 * 合法 stash reflog 行：
 * `<oldOid> <newOid> <name> <email> <ts> <tz>\t<message>`
 * 续行 / 脏行（无 tab 或 OID 非法）一律视为无效。
 */
export function isValidStashReflogLine(line: string): boolean {
  const raw = String(line || "").trimEnd()
  if (!raw) return false
  const tab = raw.indexOf("\t")
  if (tab < 0) return false
  const meta = raw.slice(0, tab).trim()
  const parts = meta.split(/\s+/)
  if (parts.length < 6) return false
  return isValidOid(parts[0]) && isValidOid(parts[1])
}

/** 从合法 reflog 行取出 stash commit oid（第二字段） */
export function oidFromStashReflogLine(line: string): string | null {
  if (!isValidStashReflogLine(line)) return null
  const oid = line.trim().split(/\s+/)[1]
  return isValidOid(oid) ? oid : null
}

/** 清洗 reflog：去掉续行/脏行，返回 { lines, changed, tipOid }（lines 为文件序，旧→新） */
export function repairStashReflogLines(content: string): {
  lines: string[]
  changed: boolean
  tipOid: string | null
} {
  const original = String(content || "")
    .split("\n")
    .filter((line) => line.trim().length > 0)
  const lines = original.filter(isValidStashReflogLine)
  const tipOid =
    lines.length > 0 ? oidFromStashReflogLine(lines[lines.length - 1]) : null
  return {
    lines,
    changed: lines.length !== original.length,
    tipOid,
  }
}

/**
 * 在 newest-first 视角下删除 index 对应项。
 * 输入/输出 lines 均为文件序（旧→新）。
 */
export function dropStashReflogAtIndex(
  chronologicalLines: string[],
  index: number
): { lines: string[]; tipOid: string | null } {
  const valid = chronologicalLines.filter(isValidStashReflogLine)
  const newestFirst = [...valid].reverse()
  if (!Number.isInteger(index) || index < 0 || index >= newestFirst.length) {
    throw new Error("无效的 Stash 索引")
  }
  newestFirst.splice(index, 1)
  const lines = newestFirst.reverse()
  const tipOid =
    lines.length > 0 ? oidFromStashReflogLine(lines[lines.length - 1]) : null
  return { lines, tipOid }
}

/** 从底层 list 原始行提取幽灵 stash 的索引（降序，便于 drop） */
export function collectGhostStashIndices(entries: unknown): number[] {
  if (!Array.isArray(entries)) return []
  const indices: number[] = []
  for (const value of entries) {
    const raw = String(value ?? "").trim()
    if (!raw) continue
    const match = raw.match(/^stash@\{(\d+)\}:\s*(.*)$/)
    if (!match) continue
    const index = Number(match[1])
    if (!Number.isInteger(index) || index < 0) continue
    if (isGhostStashMessage(match[2])) indices.push(index)
  }
  return indices.sort((a, b) => b - a)
}

/**
 * 解析 isomorphic-git stash list 返回的 stash@{N}: message。
 * 幽灵项（空 / 字面 undefined）直接丢弃，不进入 UI。
 */
export function parseStashEntries(entries: unknown): StashEntry[] {
  if (!Array.isArray(entries)) return []

  const parsed: StashEntry[] = []
  for (const value of entries) {
    const raw = String(value ?? "").trim()
    if (!raw) continue
    const match = raw.match(/^stash@\{(\d+)\}:\s*(.*)$/)
    if (!match) continue
    const index = Number(match[1])
    if (!Number.isInteger(index) || index < 0) continue
    const message = match[2].trim()
    if (isGhostStashMessage(message)) continue
    parsed.push({
      index,
      ref: `stash@{${index}}`,
      message,
    })
  }

  return parsed.sort((a, b) => a.index - b.index)
}

/** 应用 Stash 前必须保证 HEAD / 工作区 / 索引一致 */
export function isStatusMatrixClean(
  matrix: readonly (readonly [string, number, number, number])[]
): boolean {
  return matrix.every((row) => row[1] === row[2] && row[2] === row[3])
}
