/**
 * utils/mergeConflict.ts - 合并冲突分类、状态与解决策略纯逻辑
 *
 * isomorphic-git 在 abortOnConflict=false 时会把冲突写入 index stage 1/2/3，
 * 并抛出 MergeConflictError（含 filepaths / bothModified / deleteByUs / deleteByTheirs）。
 * 本模块把这些数据整理成 UI/服务层可用的结构，并管理 gitdir 侧的合并状态文件内容。
 */

/** 冲突类型：双方改 / 我方删对方改 / 对方删我方改 */
export type ConflictKind = "bothModified" | "deleteByUs" | "deleteByTheirs"

/** 解决策略：保留我方 / 保留对方 / 手动编辑后标记已解决 */
export type ConflictResolution = "ours" | "theirs" | "manual"

/** 单个冲突文件 */
export interface ConflictFile {
  filepath: string
  kind: ConflictKind
}

/** gitdir 中持久化的进行中合并状态（JSON） */
export interface MergeState {
  /** 固定版本号，便于以后迁移 */
  version: 1
  oursOid: string
  theirsOid: string
  oursLabel: string
  theirsLabel: string
  message: string
  conflicts: ConflictFile[]
  startedAt: number
}

/** MergeConflictError.data 的最小形状 */
export interface MergeConflictErrorData {
  filepaths?: unknown
  bothModified?: unknown
  deleteByUs?: unknown
  deleteByTheirs?: unknown
}

const MERGE_STATE_VERSION = 1 as const

/** 规范化仓库内相对路径 */
export function normalizeConflictPath(filepath: unknown): string {
  return String(filepath || "").replace(/^\/+/, "").trim()
}

function asPathList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const path = normalizeConflictPath(item)
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

/** 从 MergeConflictError.data 构建冲突文件列表（按路径排序） */
export function buildConflictFilesFromErrorData(
  data: MergeConflictErrorData | null | undefined
): ConflictFile[] {
  const both = new Set(asPathList(data?.bothModified))
  const delUs = new Set(asPathList(data?.deleteByUs))
  const delTheirs = new Set(asPathList(data?.deleteByTheirs))
  // filepaths 是全集；分类集合可能更精确
  const all = new Set<string>([
    ...asPathList(data?.filepaths),
    ...both,
    ...delUs,
    ...delTheirs,
  ])

  const files: ConflictFile[] = []
  for (const filepath of all) {
    let kind: ConflictKind = "bothModified"
    if (delUs.has(filepath)) kind = "deleteByUs"
    else if (delTheirs.has(filepath)) kind = "deleteByTheirs"
    else if (both.has(filepath)) kind = "bothModified"
    files.push({ filepath, kind })
  }
  return files.sort((a, b) => a.filepath.localeCompare(b.filepath))
}

/** 冲突类型中文标签 */
export function conflictKindLabel(kind: ConflictKind): string {
  switch (kind) {
    case "bothModified":
      return "双方修改"
    case "deleteByUs":
      return "我方删除 · 对方修改"
    case "deleteByTheirs":
      return "对方删除 · 我方修改"
    default:
      return "冲突"
  }
}

/**
 * 生成面向 Agent 的合并冲突清单文本（Markdown）。
 * 复制到剪贴板后粘贴给 Agent，包含定位仓库与逐文件处理所需的信息。
 */
export function buildConflictReport(input: {
  repoName: string
  workdir?: string | null
  oursLabel: string
  theirsLabel: string
  oursOid?: string
  theirsOid?: string
  conflicts: readonly ConflictFile[]
}): string {
  const conflicts = Array.isArray(input.conflicts) ? input.conflicts : []
  const short = (oid?: string) => {
    const v = String(oid || "").trim()
    return v ? v.slice(0, 7) : ""
  }
  const oursOid = short(input.oursOid)
  const theirsOid = short(input.theirsOid)
  const oursLabel = String(input.oursLabel || "ours").trim() || "ours"
  const theirsLabel = String(input.theirsLabel || "theirs").trim() || "theirs"
  const ours = oursOid ? `${oursLabel} (${oursOid})` : oursLabel
  const theirs = theirsOid ? `${theirsLabel} (${theirsOid})` : theirsLabel

  const lines: string[] = [
    "# 合并冲突清单",
    "",
    `- 仓库：${String(input.repoName || "").trim() || "未命名仓库"}`,
    `- 目录：${String(input.workdir || "").trim() || "（无法解析工作目录）"}`,
    `- 合并：${theirs} → ${ours}`,
    `- 待解决：${conflicts.length} 个文件`,
    "",
    "## 冲突文件",
    "",
  ]
  conflicts.forEach((file, index) => {
    lines.push(
      `${index + 1}. \`${file.filepath}\` — ${conflictKindLabel(file.kind)}`
    )
  })
  lines.push(
    "",
    "## 执行约束",
    "",
    "- 文本冲突文件：删除 `<<<<<<<` / `=======` / `>>>>>>>` 冲突标记，合并代码并保持代码语法正确。",
    "- 删除类冲突（我方删除 · 对方修改 / 对方删除 · 我方修改）：按改动意图决定保留或删除该文件。",
    "- Git 命令限制：**严禁**执行 `git add`、`git commit`、`git rebase` 或 `git merge --continue`（该目录无 .git，Git 状态由 gitgit 管理）；仅对文件进行编辑/删除操作。",
    "- 解决完成后，提醒用户在 gitgit 界面点击「标记已解决」及「完成合并提交」。"
  )
  return lines.join("\n")
}

// 标准 Git 冲突标记（7 字符）的行首匹配：
// <<<<<<< / >>>>>>> 后跟空格或行尾；======= 恰好 7 个且独占一行（兼容 CRLF），
// 排除 Markdown setext 下划线（更短/更长串）与嵌套冲突的 8+ 字符标记
const CONFLICT_MARKER_RES = [
  /^<{7}(?=[ \t]|$)/m,
  /^>{7}(?=[ \t]|$)/m,
  /^={7}\r?$/m,
]

/** 文本内容是否仍含 Git 冲突标记 */
export function containsConflictMarkers(text: string): boolean {
  if (!text) return false
  return CONFLICT_MARKER_RES.some((re) => re.test(text))
}

/** 冲突自动标记结果（扫描工作区后批量标记） */
export interface AutoMarkConflictsResult {
  /** 已自动标记为已解决的文件 */
  marked: string[]
  /** 仍含冲突标记、未自动标记的文件 */
  markerFiles: string[]
  /** 读取或标记失败、未处理的文件 */
  failedFiles: string[]
}

const AUTO_MARK_LIST_LIMIT = 10

/** 自动标记结果的弹窗摘要文案 */
export function formatAutoMarkSummary(result: AutoMarkConflictsResult): {
  title: string
  message: string
} {
  const markedCount = result.marked.length
  const pending = [
    ...result.markerFiles.map((path) => `${path}（仍含冲突标记）`),
    ...result.failedFiles.map((path) => `${path}（读取或标记失败）`),
  ]
  if (pending.length === 0) {
    return {
      title: "检测完成",
      message: `已自动标记 ${markedCount} 个文件为已解决，无残留冲突，可点击「完成合并提交」。`,
    }
  }
  const lines: string[] = []
  if (markedCount > 0) lines.push(`已标记 ${markedCount} 个文件。`)
  lines.push(`以下 ${pending.length} 个文件仍需处理：`)
  const shown = pending.slice(0, AUTO_MARK_LIST_LIMIT)
  for (const item of shown) lines.push(`· ${item}`)
  if (pending.length > shown.length) {
    lines.push(`… 等 ${pending.length} 个文件`)
  }
  lines.push("请处理后再次点击「检测冲突状态」，或左滑手动标记。")
  return {
    title: markedCount > 0 ? "部分文件未解决" : "未能自动标记",
    message: lines.join("\n"),
  }
}

/**
 * 判断异常是否为 isomorphic-git MergeConflictError。
 * 兼容 code/name 与 data.filepaths 形态。
 */
export function isMergeConflictError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as {
    code?: unknown
    name?: unknown
    data?: MergeConflictErrorData
  }
  const code = String(e.code || e.name || "")
  if (code === "MergeConflictError") return true
  // 部分包装后只保留 data
  if (e.data && Array.isArray(e.data.filepaths) && e.data.filepaths.length > 0) {
    return true
  }
  return false
}

/** 从异常提取 MergeConflictError.data */
export function getMergeConflictErrorData(
  error: unknown
): MergeConflictErrorData | null {
  if (!isMergeConflictError(error)) return null
  const data = (error as { data?: MergeConflictErrorData }).data
  return data && typeof data === "object" ? data : null
}

/** 组装写入 gitdir 的合并状态 */
export function buildMergeState(input: {
  oursOid: string
  theirsOid: string
  oursLabel?: string
  theirsLabel?: string
  message?: string
  conflicts: ConflictFile[]
  startedAt?: number
}): MergeState {
  const oursOid = String(input.oursOid || "").trim()
  const theirsOid = String(input.theirsOid || "").trim()
  if (!oursOid || !theirsOid) {
    throw new Error("合并状态缺少 ours/theirs 提交")
  }
  // conflicts 允许为空：全部解决后、完成合并提交前仍需保留 ours/theirs
  const conflicts = Array.isArray(input.conflicts)
    ? input.conflicts
        .map((c) => ({
          filepath: normalizeConflictPath(c.filepath),
          kind: c.kind,
        }))
        .filter((c) => !!c.filepath)
    : []
  return {
    version: MERGE_STATE_VERSION,
    oursOid,
    theirsOid,
    oursLabel: String(input.oursLabel || "ours").trim() || "ours",
    theirsLabel: String(input.theirsLabel || "theirs").trim() || "theirs",
    message:
      String(input.message || "").trim() ||
      `Merge ${input.theirsLabel || "theirs"}`,
    conflicts,
    startedAt: input.startedAt || Date.now(),
  }
}

/** 解析 gitdir 中的合并状态 JSON；非法则 null */
export function parseMergeState(raw: unknown): MergeState | null {
  try {
    const obj =
      typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw
    if (!obj || typeof obj !== "object") return null
    const o = obj as Record<string, unknown>
    if (o.version !== 1) return null
    const oursOid = String(o.oursOid || "").trim()
    const theirsOid = String(o.theirsOid || "").trim()
    if (!oursOid || !theirsOid) return null
    const conflictsRaw = Array.isArray(o.conflicts) ? o.conflicts : []
    const conflicts: ConflictFile[] = []
    for (const item of conflictsRaw) {
      if (!item || typeof item !== "object") continue
      const c = item as Record<string, unknown>
      const filepath = normalizeConflictPath(c.filepath)
      const kind = String(c.kind || "") as ConflictKind
      if (!filepath) continue
      if (
        kind !== "bothModified" &&
        kind !== "deleteByUs" &&
        kind !== "deleteByTheirs"
      ) {
        continue
      }
      conflicts.push({ filepath, kind })
    }
    // 允许 conflicts 为空（待完成合并提交）
    return buildMergeState({
      oursOid,
      theirsOid,
      oursLabel: String(o.oursLabel || "ours"),
      theirsLabel: String(o.theirsLabel || "theirs"),
      message: String(o.message || ""),
      conflicts,
      startedAt: Number(o.startedAt) || Date.now(),
    })
  } catch (_e) {
    return null
  }
}

/** 序列化合并状态 */
export function serializeMergeState(state: MergeState): string {
  return JSON.stringify(state)
}

/**
 * 从当前状态中移除已解决路径；若全部解决返回 null。
 * 用于 UI/服务在「标记已解决」后更新状态文件。
 */
export function removeResolvedConflict(
  state: MergeState,
  filepath: string
): MergeState | null {
  const path = normalizeConflictPath(filepath)
  const next = state.conflicts.filter((c) => c.filepath !== path)
  if (next.length === 0) return null
  return { ...state, conflicts: next }
}

/**
 * 某冲突文件在选择 ours/theirs 时的动作：
 * - write：从对应 stage/blob 写出内容并 add
 * - remove：从工作区与索引删除
 * - none：策略对该类型不适用（应拒绝）
 */
export function resolutionActionForConflict(
  kind: ConflictKind,
  resolution: ConflictResolution
): "write" | "remove" | "none" {
  if (resolution === "manual") return "none"
  if (kind === "bothModified") return "write"
  if (kind === "deleteByUs") {
    // 我方删对方改：ours=删除，theirs=保留对方内容
    return resolution === "ours" ? "remove" : "write"
  }
  if (kind === "deleteByTheirs") {
    // 对方删我方改：ours=保留我方，theirs=删除
    return resolution === "ours" ? "write" : "remove"
  }
  return "none"
}

/**
 * 选择 ours/theirs 时读取 index 的哪一 stage：
 * stage1=base, stage2=ours, stage3=theirs
 */
export function stageForResolution(
  resolution: Exclude<ConflictResolution, "manual">
): 2 | 3 {
  return resolution === "ours" ? 2 : 3
}

/** 是否仍有未解决冲突（路径列表非空） */
export function hasUnresolvedConflicts(
  conflicts: readonly ConflictFile[] | null | undefined
): boolean {
  return Array.isArray(conflicts) && conflicts.length > 0
}

/**
 * 仓库列表右侧：合并冲突摘要文案。
 * 有未解决冲突 →「N 冲突」；冲突已清但仍在合并 →「待完成合并」；否则 null（走普通改动摘要）。
 */
export function formatRepoListMergeSummary(input: {
  conflictCount: number
  mergeInProgress: boolean
}): string | null {
  const conflictCount = Math.max(0, Math.floor(Number(input.conflictCount) || 0))
  if (conflictCount > 0) return `${conflictCount} 冲突`
  if (input.mergeInProgress) return "待完成合并"
  return null
}

/**
 * 完成合并提交的 parent 列表： [oursOid, theirsOid]
 * 与 git merge 双亲约定一致。
 */
export function mergeCommitParents(
  oursOid: string,
  theirsOid: string
): [string, string] {
  const ours = String(oursOid || "").trim()
  const theirs = String(theirsOid || "").trim()
  if (!ours || !theirs) {
    throw new Error("合并提交缺少父提交")
  }
  return [ours, theirs]
}

/** 默认合并提交说明 */
export function defaultMergeCommitMessage(
  theirsLabel: string,
  oursLabel?: string
): string {
  const theirs = String(theirsLabel || "theirs").trim() || "theirs"
  const ours = String(oursLabel || "").trim()
  if (ours) return `Merge ${theirs} into ${ours}`
  return `Merge ${theirs}`
}
