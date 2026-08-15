/**
 * utils/actionsLog.ts - GitHub Actions 日志分段解析
 *
 * 将 Job 的完整纯文本日志按步骤拆分为多段，支持点击对应步骤查看对应日志。
 *
 * GitHub Actions 日志格式：
 * - 每行以时间戳前缀开头：YYYY-MM-DDTHH:MM:SS.NNNNNNNZ
 * - 步骤输出由 ##[group] / ##[endgroup] 包裹
 * - 系统段落：Set up job、Complete job、Post Run X 等
 *
 * 解析策略：
 * Runner 对每个用户步骤（run: 或 uses:）都会输出一行 `##[group]Run xxx`，
 * 以它作为唯一的步骤起始锚点：
 * - 第一个 `##[group]Run` 之前的内容 = Set up job（含 Operating System /
 *   Runner Image / Prepare all required actions 等子 group，它们不是用户步骤）
 * - 相邻两个 `##[group]Run` 之间 = 一个用户步骤
 * - 出现过用户步骤后遇到 `Post job cleanup.` / `Cleaning up orphan processes`
 *   等后置锚点 = 后置段
 * 块按出现顺序依次对应 API 返回的用户步骤列表（跳过 skipped 步骤，它们无输出）。
 */

import type { ActionStep } from "../types/github"

/** 单个日志分段 */
export interface LogSegment {
  /** 对应的步骤编号（0=系统/前置, -1=后置, 1..N=用户步骤） */
  stepNumber: number
  /** 分段显示名称 */
  label: string
  /** 该分段的原始日志行 */
  lines: string[]
  /** 去除时间戳后的纯文本 */
  text: string
}

/** 步骤选项（用于 UI 渲染） */
export interface StepOption {
  /** null=全部；数字=对应步骤编号 */
  stepNumber: number | null
  /** 显示名称 */
  label: string
  /** 状态图标 */
  icon: string
  /** 状态颜色 */
  color: string
  /** 行数 */
  lineCount: number
  /** 错误行数 */
  errors: number
  /** 警告行数 */
  warnings: number
  /** 耗时显示文本（如 "43s"） */
  duration?: string
}

/** 时间戳前缀正则 */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/

/** ##[group] 标记 */
const GROUP_START = "##[group]"

/** 前置系统步骤名（出现在所有用户步骤之前） */
const PRE_SYSTEM_STEPS = [
  "set up job",
]

/** 用户步骤起始的 group 标题：Runner 统一输出 "Run <命令或 action>" */
const RUN_GROUP_RE = /^Run\s+\S/

/**
 * 后置阶段起始锚点（仅在已出现至少一个用户步骤后才生效）。
 * 注意不能用 "complete job" 前缀匹配：Set up job 段里有一行
 * `Complete job name: build`，会把全部用户步骤误判成后置段。
 */
const POST_ANCHOR_RE =
  /^(post job cleanup\b|post run\b|cleaning up orphan processes\b|cleanup runner\b|stop containers\b|finishing job\b|uploading runner script results\b|downloading runner script\b|complete job\s*$)/i

/** 参数块（with:/env: 等），归入当前步骤而非新步骤 */
const PARAM_BLOCK_RE =
  /^(with|env|set-env|add-path|set-output|add-matcher|remove-matcher|save-state|stop-commands|add-step-summary|echo|debug)\s*:/i

/** 后置系统步骤名（仅用于过滤 API 步骤名，不用于扫描日志行） */
const POST_SYSTEM_STEPS = [
  "complete job",
  "cleanup runner",
  "uploading runner script results",
  "downloading runner script",
  "finishing job",
  "cleaning up orphan processes",
]

/** 日志行级别 */
export type LogLevel = "error" | "warning" | "success" | "info"

/** Runner 注解标记：优先级最高，直接决定级别 */
const MARKER_ERROR_RE = /##\[error\]/i
const MARKER_WARNING_RE = /##\[warning\]/i

/** ANSI 控制序列（CSI），展示前必须剥除，否则会看到 [36;1m 之类乱码 */
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g
/** ANSI 颜色序列（SGR） */
const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g

/** 剥除 ANSI 转义序列 */
function stripAnsi(line: string): string {
  return line.replace(ANSI_CSI_RE, "")
}

/**
 * 从 ANSI 前景色推导级别（网页版的主要上色依据）：
 * 红 31/91 → error，黄 33/93 → warning，绿 32/92 → success；红色优先。
 * 行内无颜色序列时返回 undefined。
 */
function detectAnsiLevel(raw: string): LogLevel | undefined {
  const seqs = raw.match(ANSI_SGR_RE)
  if (!seqs) return undefined
  let level: LogLevel | undefined
  for (const seq of seqs) {
    for (const part of seq.slice(2, -1).split(";")) {
      const code = parseInt(part, 10)
      if (code === 31 || code === 91) return "error"
      if ((code === 33 || code === 93) && level === undefined) level = "warning"
      if ((code === 32 || code === 92) && level === undefined) level = "success"
    }
  }
  return level
}

/**
 * 关键字判定前先移除「只是提到关键字」的 token，避免误判：
 * - URL
 * - 命令行开关：-Werror、--error-format
 * - 含斜杠的路径：src/error/Handler.ts
 * - 文件名：error.log、warning.txt
 * 编译器诊断形如 `/path/f.m:12:3: error: msg`，整段路径被移除后仍保留 `error:`。
 */
function stripNoiseTokens(content: string): string {
  return content
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/(^|\s)-{1,2}[A-Za-z][\w-]*/g, " ")
    .replace(/(^|\s)\S*\/\S*/g, " ")
    .replace(/(^|\s)[\w.-]+\.[A-Za-z]{1,8}\b/g, " ")
}

/** 移除计数为 0 的汇总短语，避免 "0 errors, 2 warnings" 被判成错误 */
function stripZeroCounts(content: string): string {
  return content.replace(/\b(0|no)\s+(errors?|warnings?|failures?|failed)\b/gi, " ")
}

/** 退出码：非 0 为错误，0 为成功 */
const EXIT_CODE_RE = /exit\s+code\s*[:=]?\s*(\d+)/i

/** 结构化错误前缀：error:、fatal error:、error CS1234:、error MSB3073: */
const ERROR_PREFIX_RE = /(^|\s)(fatal\s+)?error(\s+[A-Za-z]{1,5}\d{2,5})?\s*:/i
/** 错误关键字（需独立成词） */
const ERROR_WORD_RE =
  /\b(errors?|failed|failing|failure|fatal|panic|traceback|aborted|abort trap|segmentation fault|killed)\b/i
/** 异常仅在明确抛出/未捕获时才算错误，避免 "exception handling" 之类误判 */
const EXCEPTION_RE = /(\bexception\s*:|\b(unhandled|uncaught|raised|threw|throwing)\b[^.]{0,20}\bexception)/i
/** TAP 失败行 */
const TAP_FAIL_RE = /^not\s+ok\b/i

/** 结构化警告前缀：warning:、warn:、warning CS0168: */
const WARNING_PREFIX_RE = /(^|\s)warn(ing)?(\s+[A-Za-z]{1,5}\d{2,5})?\s*:/i
/** 警告关键字 */
const WARNING_WORD_RE = /\b(warnings?|deprecated|deprecation)\b|⚠/i

/** 成功关键字 */
const SUCCESS_RE = /\bsuccess(ful|fully)?\b|\bsucceed(ed|s)?\b|\bpassed\b|[✓✔✅]/i
/** 独立的 OK（行首或行尾），如 "ok 1 - case"、"Signing... OK" */
const OK_RE = /(^ok\b|\bok[.!]?$)/i

/**
 * 判定单行日志的级别
 *
 * 优先级：Runner 注解标记 > ANSI 颜色 > 退出码 > 错误 > 警告 > 成功 > info。
 * 前两级是网页版依赖的硬信号（工具/Runner 自己声明的级别），其余是本项目
 * 的关键字启发式补充：多数 CI 工具在非 TTY 下不输出颜色，只看硬信号会一片灏。
 * @param raw 原始行（可能含时间戳、ANSI 序列与 ##[xxx] 标记）
 * @param content 已剥离时间戳/序列/标记的内容；省略时内部计算
 */
export function detectLogLevel(raw: string, content?: string): LogLevel {
  // 标记与颜色在展示前被剥离，必须先看原始行
  if (MARKER_ERROR_RE.test(raw)) return "error"
  if (MARKER_WARNING_RE.test(raw)) return "warning"
  const ansiLevel = detectAnsiLevel(raw)
  if (ansiLevel) return ansiLevel

  const text = content !== undefined ? content : stripMarkers(raw)
  if (text.length === 0) return "info"

  const exit = text.match(EXIT_CODE_RE)
  if (exit) return exit[1] === "0" ? "success" : "error"

  if (TAP_FAIL_RE.test(text)) return "error"

  const clean = stripZeroCounts(stripNoiseTokens(text))
  if (ERROR_PREFIX_RE.test(clean) || ERROR_WORD_RE.test(clean) || EXCEPTION_RE.test(clean)) {
    return "error"
  }
  if (WARNING_PREFIX_RE.test(clean) || WARNING_WORD_RE.test(clean)) return "warning"
  if (SUCCESS_RE.test(clean) || OK_RE.test(text.trim())) return "success"
  return "info"
}

/** 去除行首时间戳前缀 */
function stripTimestamp(line: string): string {
  return line.replace(TIMESTAMP_RE, "")
}

/** 去除时间戳、ANSI 序列和 ## 命令标记 */
function stripMarkers(line: string): string {
  return stripAnsi(stripTimestamp(line)).replace(/^##\[[\w]+\]\s*/i, "").trim()
}

/** 判断内容是否为前置系统步骤 */
function isPreSystemStep(content: string): boolean {
  const lower = content.toLowerCase().trim()
  return PRE_SYSTEM_STEPS.some((s) => lower === s || lower.startsWith(s))
}

/** 判断步骤名是否为后置系统步骤 */
function isPostSystemStep(content: string): boolean {
  const lower = content.toLowerCase().trim()
  return POST_SYSTEM_STEPS.some((s) => lower === s || lower.startsWith(s))
}

/** 判断内容是否以 "Post " 开头（后置 action 步骤） */
function isPostActionStep(content: string): boolean {
  return /^post\s+/i.test(content.trim())
}

/** 步骤状态图标 */
function stepStatusIcon(step: ActionStep): { icon: string; color: string } {
  if (step.status === "in_progress") {
    return { icon: "arrow.triangle.2.circlepath", color: "systemOrange" }
  }
  if (step.status === "queued") {
    return { icon: "clock", color: "systemOrange" }
  }
  switch (step.conclusion) {
    case "success":
      return { icon: "checkmark.circle.fill", color: "systemGreen" }
    case "failure":
      return { icon: "xmark.circle.fill", color: "systemRed" }
    case "cancelled":
      return { icon: "minus.circle.fill", color: "secondaryLabel" }
    case "skipped":
      return { icon: "forward.circle.fill", color: "secondaryLabel" }
    case "timed_out":
      return { icon: "exclamationmark.triangle.fill", color: "systemRed" }
    default:
      return { icon: "circle.fill", color: "secondaryLabel" }
  }
}

/** 计算步骤耗时显示文本 */
export function formatStepDuration(startedAt?: string, completedAt?: string): string | undefined {
  if (!startedAt || !completedAt) return undefined
  const start = new Date(startedAt).getTime()
  const end = new Date(completedAt).getTime()
  if (isNaN(start) || isNaN(end) || end < start) return undefined
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  if (minutes < 60) return remain > 0 ? `${minutes}m ${remain}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainMin = minutes % 60
  return `${hours}h ${remainMin}m`
}

/**
 * 将完整 Job 日志按步骤解析为多段
 *
 * 策略：
 * 1. 扫描所有 `##[group]Run xxx` 行作为用户步骤起始锚点。
 * 2. 第一个锚点之前 = Set up job；出现锚点后遇到后置锚点 = 后置段。
 * 3. 相邻锚点之间的行构成一个块，按顺序对应 API 用户步骤（跳过 skipped）。
 * 不依赖步骤名与日志内容的匹配（步骤名通常不出现在日志中）。
 *
 * @param rawLog 完整日志文本
 * @param steps Job 的步骤列表（来自 API）
 * @returns 日志分段数组
 */
export function parseStepSegments(
  rawLog: string,
  steps: ActionStep[]
): LogSegment[] {
  if (!rawLog || rawLog.length === 0) return []
  if (!steps || steps.length === 0) {
    const lines = rawLog.split("\n")
    return [{
      stepNumber: 0,
      label: "完整日志",
      lines,
      text: lines.map(stripMarkers).join("\n").trim(),
    }]
  }

  const lines = rawLog.split("\n")

  // API 返回的 steps：Set up job(1) / 用户步骤 / Post xxx / Complete job
  const sortedSteps = [...steps].sort((a, b) => a.number - b.number)

  // 扫描锚点：用户步骤起始（##[group]Run ...）与后置阶段起始
  const runStarts: number[] = []
  let postStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (postStart >= 0) break
    const content = stripAnsi(stripTimestamp(lines[i])).trim()
    const isGroup = content.startsWith(GROUP_START)
    const body = isGroup ? content.slice(GROUP_START.length).trim() : content
    if (isGroup && RUN_GROUP_RE.test(body) && !PARAM_BLOCK_RE.test(body)) {
      runStarts.push(i)
      continue
    }
    // 后置阶段只在出现过用户步骤后才判定
    if (runStarts.length > 0 && POST_ANCHOR_RE.test(body)) postStart = i
  }

  const preLines = runStarts.length > 0 ? lines.slice(0, runStarts[0]) : []
  const userEnd = postStart >= 0 ? postStart : lines.length
  const postLines = postStart >= 0 ? lines.slice(postStart) : []

  // 相邻锚点之间构成一个用户步骤块
  const blocks: { lines: string[] }[] = []
  for (let k = 0; k < runStarts.length; k++) {
    const start = runStarts[k]
    const end = k + 1 < runStarts.length ? Math.min(runStarts[k + 1], userEnd) : userEnd
    if (end > start) blocks.push({ lines: lines.slice(start, end) })
  }
  // 没有识别到任何 Run 锚点：整段日志作为单块兜底
  if (blocks.length === 0) blocks.push({ lines })

  // 将块按顺序分配给用户步骤：API 步骤列表含系统步骤，先排除
  const userSteps = sortedSteps.filter((s) => {
    if (isPreSystemStep(s.name)) return false
    if (isPostSystemStep(s.name)) return false
    // 排除 Post Run 类后置 action 步骤
    if (isPostActionStep(s.name)) return false
    return true
  })

  // 跳过的步骤不会在日志里输出任何内容，映射时需排除
  const loggedSteps = userSteps.filter((s) => s.conclusion !== "skipped")
  const targets =
    loggedSteps.length === blocks.length
      ? loggedSteps
      : userSteps.length === blocks.length
        ? userSteps
        : loggedSteps.length > 0
          ? loggedSteps
          : userSteps

  const segments: LogSegment[] = []

  // 前置系统段（Set up job）：尽量挂到 API 中同名步骤上
  const setupStep = sortedSteps.find((s) => isPreSystemStep(s.name))
  if (preLines.length > 0) {
    segments.push({
      stepNumber: setupStep ? setupStep.number : 0,
      label: setupStep ? setupStep.name : "系统步骤",
      lines: preLines,
      text: preLines.map(stripMarkers).join("\n").trim(),
    })
  }

  // 用户步骤段：块与步骤按顺序一一对应
  const paired = Math.min(targets.length, blocks.length)
  for (let i = 0; i < paired; i++) {
    const step = targets[i]
    const block = blocks[i]
    segments.push({
      stepNumber: step.number,
      label: step.name,
      lines: block.lines,
      text: block.lines.map(stripMarkers).join("\n").trim(),
    })
  }

  // 块比步骤多：多余的块归入最后一个已匹配步骤，避免日志丢失
  if (blocks.length > paired && paired > 0) {
    const last = targets[paired - 1]
    for (let i = paired; i < blocks.length; i++) {
      segments.push({
        stepNumber: last.number,
        label: last.name,
        lines: blocks[i].lines,
        text: blocks[i].lines.map(stripMarkers).join("\n").trim(),
      })
    }
  }

  // 后置系统段
  if (postLines.length > 0) {
    segments.push({
      stepNumber: -1,
      label: "后置步骤",
      lines: postLines,
      text: postLines.map(stripMarkers).join("\n").trim(),
    })
  }

  return segments
}

/**
 * 从分段中提取指定步骤的原始日志行（含时间戳前缀）
 * 用于 UI 显示行号和时间戳。
 */
export function getSegmentRawLines(
  segments: LogSegment[],
  stepNumber: number | null
): string[] {
  if (stepNumber === null) {
    return segments.flatMap((s) => s.lines)
  }
  const matched = segments.filter((s) => s.stepNumber === stepNumber)
  return matched.flatMap((s) => s.lines)
}

/** 解析单行日志：提取时间戳和纯内容 */
export interface ParsedLogLine {
  /** 原始行 */
  raw: string
  /** 去除时间戳和 ## 标记后的内容 */
  content: string
  /** ISO 时间戳（如 "2026-08-14T14:50:51.1234567Z"） */
  timestamp?: string
}

/** 解析单行日志：剥离时间戳前缀与行首 ##[xxx] 标记 */
export function parseLogLine(raw: string): ParsedLogLine {
  const match = raw.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s?(.*)$/)
  if (match) {
    const content = stripAnsi(match[2]).replace(/^##\[[\w]+\]\s*/i, "").trim()
    return { raw, content, timestamp: match[1] }
  }
  return { raw, content: stripMarkers(raw) }
}

/**
 * 从分段中提取指定步骤的日志文本
 */
export function getSegmentText(
  segments: LogSegment[],
  stepNumber: number | null
): string {
  if (stepNumber === null) {
    return segments.map((s) => s.text).join("\n\n")
  }
  const matched = segments.filter((s) => s.stepNumber === stepNumber)
  if (matched.length === 0) return ""
  return matched.map((s) => s.text).join("\n\n")
}

/**
 * 统计文本中的错误和警告行数（与日志行着色共用 detectLogLevel，保证计数与颜色一致）
 */
export function countSegmentLevels(
  text: string
): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const line of text.split("\n")) {
    const level = detectLogLevel(line)
    if (level === "error") errors++
    else if (level === "warning") warnings++
  }
  return { errors, warnings }
}

/**
 * 构建步骤选项列表（基于原始 steps 列表，确保所有步骤都出现）
 */
export function buildStepOptions(
  segments: LogSegment[],
  steps: ActionStep[],
  logText: string
): StepOption[] {
  const options: StepOption[] = []

  // 「全部」选项
  const allCounts = countSegmentLevels(logText)
  options.push({
    stepNumber: null,
    label: "全部日志",
    icon: "list.bullet",
    color: "systemBlue",
    lineCount: logText.split("\n").length,
    errors: allCounts.errors,
    warnings: allCounts.warnings,
  })

  // 系统段落
  const systemSegs = segments.filter((s) => s.stepNumber === 0)
  if (systemSegs.length > 0) {
    const systemText = systemSegs.map((s) => s.text).join("\n\n")
    const sysCounts = countSegmentLevels(systemText)
    const sysLineCount = systemSegs.reduce((sum, s) => sum + s.lines.length, 0)
    options.push({
      stepNumber: 0,
      label: "系统步骤",
      icon: "gearshape",
      color: "secondaryLabel",
      lineCount: sysLineCount,
      errors: sysCounts.errors,
      warnings: sysCounts.warnings,
    })
  }

  // 用户步骤（按编号排序）
  const sortedSteps = [...steps].sort((a, b) => a.number - b.number)
  for (const step of sortedSteps) {
    const segs = segments.filter((s) => s.stepNumber === step.number)
    const text = segs.map((s) => s.text).join("\n\n")
    const counts = countSegmentLevels(text)
    const lineCount = segs.reduce((sum, s) => sum + s.lines.length, 0)
    const v = stepStatusIcon(step)

    options.push({
      stepNumber: step.number,
      label: step.name,
      icon: v.icon,
      color: v.color,
      lineCount,
      errors: counts.errors,
      warnings: counts.warnings,
      duration: formatStepDuration(step.startedAt, step.completedAt),
    })
  }

  // 后置段落
  const postSegs = segments.filter((s) => s.stepNumber === -1)
  if (postSegs.length > 0) {
    const postText = postSegs.map((s) => s.text).join("\n\n")
    const postCounts = countSegmentLevels(postText)
    const postLineCount = postSegs.reduce((sum, s) => sum + s.lines.length, 0)
    options.push({
      stepNumber: -1,
      label: "后置步骤",
      icon: "arrow.uturn.backward.circle",
      color: "secondaryLabel",
      lineCount: postLineCount,
      errors: postCounts.errors,
      warnings: postCounts.warnings,
    })
  }

  return options
}
