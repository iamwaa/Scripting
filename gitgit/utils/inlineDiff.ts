/**
 * utils/inlineDiff.ts - 行内（词级）diff 片段
 *
 * 对配对的 del/add 行做词级 LCS（非纯字符），产出 same/changed 片段，
 * 避免长正则/代码行因 |、\\s 等碎片公共子序列而大面积误高亮。
 * 行为接近 GitHub word-diff。
 */

/** 行内片段：same 为公共词，changed 为增/删词 */
export type InlineSegmentType = "same" | "changed"

export interface InlineSegment {
  text: string
  type: InlineSegmentType
}

/** 词级 LCS 单元格上限 */
const MAX_TOKEN_LCS_CELLS = 40_000

/** 过短的 same 若夹在 changed 之间则并入 changed（仅标点/空白等） */
const TINY_SAME_MAX = 2

/**
 * 对两条文本做词级差分。
 */
export function computeInlineDiff(
  oldText: string,
  newText: string
): { oldSegments: InlineSegment[]; newSegments: InlineSegment[] } {
  if (oldText === newText) {
    return {
      oldSegments: oldText ? [{ text: oldText, type: "same" }] : [],
      newSegments: newText ? [{ text: newText, type: "same" }] : [],
    }
  }
  if (!oldText) {
    return {
      oldSegments: [],
      newSegments: newText ? [{ text: newText, type: "changed" }] : [],
    }
  }
  if (!newText) {
    return {
      oldSegments: [{ text: oldText, type: "changed" }],
      newSegments: [],
    }
  }

  const a = tokenize(oldText)
  const b = tokenize(newText)

  // 公共前后缀词先剥掉
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix++
  }
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++
  }

  const aMid = a.slice(prefix, a.length - suffix)
  const bMid = b.slice(prefix, b.length - suffix)
  const m = aMid.length
  const n = bMid.length

  let midOld: InlineSegment[]
  let midNew: InlineSegment[]

  if (m === 0 && n === 0) {
    midOld = []
    midNew = []
  } else if (m * n > MAX_TOKEN_LCS_CELLS) {
    midOld = m > 0 ? [{ text: aMid.join(""), type: "changed" }] : []
    midNew = n > 0 ? [{ text: bMid.join(""), type: "changed" }] : []
  } else {
    const pair = tokenLcsSegments(aMid, bMid)
    midOld = pair.oldSegments
    midNew = pair.newSegments
  }

  let oldSegments = mergeAdjacent([
    ...(prefix > 0
      ? [{ text: a.slice(0, prefix).join(""), type: "same" as const }]
      : []),
    ...midOld,
    ...(suffix > 0
      ? [{ text: a.slice(a.length - suffix).join(""), type: "same" as const }]
      : []),
  ])
  let newSegments = mergeAdjacent([
    ...(prefix > 0
      ? [{ text: b.slice(0, prefix).join(""), type: "same" as const }]
      : []),
    ...midNew,
    ...(suffix > 0
      ? [{ text: b.slice(b.length - suffix).join(""), type: "same" as const }]
      : []),
  ])

  // 吸收夹在 changed 之间的过短 same（标点碎片），减少碎块
  oldSegments = absorbTinySame(oldSegments)
  newSegments = absorbTinySame(newSegments)

  return { oldSegments, newSegments }
}

/**
 * 分词：标识符 / 中文连续段 / 空白 / 转义对 / 其余单字符。
 * 比纯字符 LCS 更接近 GitHub 的 word-diff。
 */
export function tokenize(text: string): string[] {
  // 标识符、CJK 段、空白、\\x 转义、其它单码点
  const re =
    /[A-Za-z0-9_]+|[\u3400-\u9fff\uf900-\ufaff]+|\s+|\\.|./gu
  return text.match(re) ?? []
}

/** 词数组 LCS 回溯 → 两侧片段 */
function tokenLcsSegments(
  a: string[],
  b: string[]
): { oldSegments: InlineSegment[]; newSegments: InlineSegment[] } {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  type Tok = { side: "old" | "new" | "both"; t: string }
  const toks: Tok[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      toks.push({ side: "both", t: a[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      toks.push({ side: "new", t: b[j - 1] })
      j--
    } else {
      toks.push({ side: "old", t: a[i - 1] })
      i--
    }
  }
  toks.reverse()

  const oldSegments: InlineSegment[] = []
  const newSegments: InlineSegment[] = []
  for (const t of toks) {
    if (t.side === "both") {
      pushTok(oldSegments, t.t, "same")
      pushTok(newSegments, t.t, "same")
    } else if (t.side === "old") {
      pushTok(oldSegments, t.t, "changed")
    } else {
      pushTok(newSegments, t.t, "changed")
    }
  }
  return {
    oldSegments: mergeAdjacent(oldSegments),
    newSegments: mergeAdjacent(newSegments),
  }
}

function pushTok(
  segs: InlineSegment[],
  text: string,
  type: InlineSegmentType
): void {
  const last = segs[segs.length - 1]
  if (last && last.type === type) {
    last.text += text
  } else {
    segs.push({ text, type })
  }
}

/**
 * 夹在 changed 之间、或贴边且极短的 same（仅空白/标点）并入 changed，
 * 避免「|」「\\s」等碎片把高亮切得又碎又大。
 */
function absorbTinySame(segs: InlineSegment[]): InlineSegment[] {
  if (segs.length < 2) return segs
  const out: InlineSegment[] = segs.map((s) => ({ ...s }))
  for (let i = 0; i < out.length; i++) {
    if (out[i].type !== "same") continue
    if (!isTinySameCandidate(out[i].text)) continue
    const prev = i > 0 ? out[i - 1] : null
    const next = i + 1 < out.length ? out[i + 1] : null
    const betweenChanged =
      prev?.type === "changed" && next?.type === "changed"
    const edgeTiny =
      (prev?.type === "changed" && !next) ||
      (next?.type === "changed" && !prev)
    if (betweenChanged || edgeTiny) {
      out[i] = { text: out[i].text, type: "changed" }
    }
  }
  return mergeAdjacent(out)
}

function isTinySameCandidate(text: string): boolean {
  if (text.length === 0) return true
  // 显示宽度近似：过长则不吸收
  if (Array.from(text).length > TINY_SAME_MAX) return false
  // 含字母数字或汉字则视为有意义 same，保留
  if (/[A-Za-z0-9_\u3400-\u9fff]/.test(text)) return false
  return true
}

/** 是否为局部改动（同时含公共与变更片段） */
function isPartialChange(segs: InlineSegment[]): boolean {
  let hasSame = false
  let hasChanged = false
  for (const s of segs) {
    if (s.type === "same") hasSame = true
    else hasChanged = true
    if (hasSame && hasChanged) return true
  }
  return false
}

/**
 * 改动占比过高时不做行内高亮（整行底色即可），
 * 避免「几乎整行都是 changed」时仍碎块标色。
 */
function isUsefulInline(segs: InlineSegment[]): boolean {
  if (!isPartialChange(segs)) return false
  let sameLen = 0
  let changedLen = 0
  for (const s of segs) {
    const n = Array.from(s.text).length
    if (s.type === "same") sameLen += n
    else changedLen += n
  }
  const total = sameLen + changedLen
  if (total === 0) return false
  // 变更超过约 85% 时，行内高亮意义不大
  if (changedLen / total > 0.85) return false
  return true
}

/** 合并相邻同类型片段 */
function mergeAdjacent(segs: InlineSegment[]): InlineSegment[] {
  const out: InlineSegment[] = []
  for (const s of segs) {
    if (!s.text) continue
    const last = out[out.length - 1]
    if (last && last.type === s.type) {
      last.text += s.text
    } else {
      out.push({ text: s.text, type: s.type })
    }
  }
  return out
}

/** 估算显示宽度：全角/emoji 计 2，其余计 1（Menlo 近似） */
function charDisplayWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
  ) {
    return 2
  }
  return 1
}

/**
 * 将行内片段按最大显示宽度切成多行，供 HStack 软换行渲染
 *（Scripting Text 不支持嵌套拼接，只能用 HStack）。
 */
export function wrapSegments(
  segments: InlineSegment[],
  maxWidth: number
): InlineSegment[][] {
  if (segments.length === 0) return []
  const limit = Math.max(8, maxWidth)
  const rows: InlineSegment[][] = []
  let row: InlineSegment[] = []
  let used = 0

  const flush = () => {
    if (row.length > 0) {
      rows.push(row)
      row = []
      used = 0
    }
  }

  for (const seg of segments) {
    if (!seg.text) continue
    const chars = Array.from(seg.text)
    let buf = ""
    let bufW = 0
    for (const ch of chars) {
      const w = charDisplayWidth(ch)
      if (used + bufW + w > limit && (used > 0 || bufW > 0)) {
        if (buf) {
          row.push({ text: buf, type: seg.type })
          buf = ""
          bufW = 0
        }
        flush()
      }
      if (used === 0 && bufW === 0 && w > limit) {
        row.push({ text: ch, type: seg.type })
        flush()
        continue
      }
      buf += ch
      bufW += w
    }
    if (buf) {
      row.push({ text: buf, type: seg.type })
      used += bufW
    }
  }
  flush()
  return rows.length > 0 ? rows : [[]]
}

/**
 * 两行之间的相似度（Jaccard token 重叠），0~1
 */
function lineSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  let inter = 0
  for (const t of ta) {
    if (tb.has(t)) inter++
  }
  const union = ta.size + tb.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * 在行级 diff 结果上，为连续变更块中的 del/add 按相似度配对并写入 segments。
 * 使用贪心最高相似度匹配（O(m*n) 但块通常很小），比顺序 1:1 更准。
 * context / skip 不动；未配对的纯增/纯删行不写 segments。
 */
export function attachInlineHighlights<
  T extends { type: string; content: string; segments?: InlineSegment[] },
>(lines: T[]): T[] {
  if (lines.length === 0) return lines
  const out = lines.map((line) => ({ ...line }))
  let i = 0
  while (i < out.length) {
    const t = out[i].type
    if (t !== "del" && t !== "add") {
      i++
      continue
    }
    const dels: number[] = []
    const adds: number[] = []
    while (i < out.length && (out[i].type === "del" || out[i].type === "add")) {
      if (out[i].type === "del") dels.push(i)
      else adds.push(i)
      i++
    }
    // 贪心按相似度配对
    const pairs = greedySimilarityPair(dels, adds, out)
    for (const [di, ai] of pairs) {
      const { oldSegments, newSegments } = computeInlineDiff(
        out[di].content,
        out[ai].content
      )
      if (isUsefulInline(oldSegments) || isUsefulInline(newSegments)) {
        out[di] = { ...out[di], segments: oldSegments }
        out[ai] = { ...out[ai], segments: newSegments }
      }
    }
  }
  return out
}

/** 贪心最高相似度配对：每轮选全局最高的 (del, add) 配对 */
function greedySimilarityPair<
  T extends { content: string },
>(
  dels: number[],
  adds: number[],
  lines: T[]
): [number, number][] {
  if (dels.length === 0 || adds.length === 0) return []
  // 小规模：直接 O(m*n) 打分
  const scores: { di: number; ai: number; score: number }[] = []
  for (const di of dels) {
    for (const ai of adds) {
      const s = lineSimilarity(lines[di].content, lines[ai].content)
      if (s > 0.1) scores.push({ di, ai, score: s })
    }
  }
  scores.sort((a, b) => b.score - a.score)
  const usedDel = new Set<number>()
  const usedAdd = new Set<number>()
  const pairs: [number, number][] = []
  for (const { di, ai } of scores) {
    if (usedDel.has(di) || usedAdd.has(ai)) continue
    usedDel.add(di)
    usedAdd.add(ai)
    pairs.push([di, ai])
  }
  return pairs
}
