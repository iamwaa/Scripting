// 正则生成核心算法
import { AdItem, GenOptions, GenResult } from "./types"

// CJK 汉字范围
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/
const LATIN_DIGIT_RE = /[A-Za-z0-9]/
// 中文短语最长截取长度（连续汉字段一般较短，此上限只作防御）
const MAX_CJK_LEN = 40
// 英文噪声词（多来自链接协议，域名已单独提取）
const LATIN_STOP = new Set(["https", "http", "www", "com", "cn", "net", "org"])

// 宽松匹配时，关键词字符之间允许插入的分隔符（空格 / 零宽 / emoji / 常见标点 / 数字）
const LOOSE_SEP =
  "[\\s\\u200b-\\u200f\\u2060\\ufe00-\\ufe0f\\ud800-\\udfff\\u2190-\\u2bff·|｜~～\\-—.。,，、!！?？:：;；]*"

function isCJK(ch: string): boolean {
  return CJK_RE.test(ch)
}
function isLatinDigit(ch: string): boolean {
  return LATIN_DIGIT_RE.test(ch)
}

// 转义正则元字符
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// 把关键词转成正则片段；宽松匹配时在字符间插入分隔符容忍
function toPattern(keyword: string, loose: boolean): string {
  if (!loose) return escapeRegex(keyword)
  // 逐字符转义后用分隔符占位连接，容忍字符间的空格 / emoji 等
  return [...keyword].map(escapeRegex).join(LOOSE_SEP)
}

// 从单条文本抽取候选关键词（去重后的集合）
// - 汉字连续段：按 [minLen, 段长] 生成 n-gram（含整段，便于后续合并成最长短语）
// - 英文/数字连续段：整词，长度 >=4 且非纯数字
function extractCandidates(text: string, minLen: number): Set<string> {
  const set = new Set<string>()
  const n = text.length
  let i = 0
  while (i < n) {
    const ch = text[i]
    if (isCJK(ch)) {
      let j = i
      while (j < n && isCJK(text[j])) j++
      const run = text.slice(i, j)
      const max = Math.min(MAX_CJK_LEN, run.length)
      for (let len = minLen; len <= max; len++) {
        for (let s = 0; s + len <= run.length; s++) {
          set.add(run.slice(s, s + len))
        }
      }
      i = j
    } else if (isLatinDigit(ch)) {
      let j = i
      while (j < n && isLatinDigit(text[j])) j++
      const run = text.slice(i, j).toLowerCase()
      if (run.length >= 4 && !/^\d+$/.test(run) && !LATIN_STOP.has(run)) set.add(run)
      i = j
    } else {
      i++
    }
  }
  return set
}

// 从文本抽取 Telegram 用户名（@handle）
function extractUsernames(text: string): string[] {
  const out: string[] = []
  const re = /@[A-Za-z0-9_]{4,32}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[0])
  return out
}

// 从文本抽取域名（含链接里的 host 与裸域名）
function extractDomains(text: string): string[] {
  const out: string[] = []
  const urlRe = /https?:\/\/([^\s/]+)/gi
  let m: RegExpExecArray | null
  while ((m = urlRe.exec(text)) !== null) out.push(m[1].toLowerCase())
  const bareRe = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi
  while ((m = bareRe.exec(text)) !== null) {
    const d = m[1].toLowerCase()
    if (/\.[a-z]{2,}$/.test(d)) out.push(d)
  }
  return out
}

// 生成正则
export function generateRegex(
  ads: AdItem[],
  opt: GenOptions,
  customKeywords: string[] = [],
  excludeKeywords: string[] = []
): GenResult {
  const texts = ads.map(a => a.text).filter(t => t.trim().length > 0)
  const total = texts.length

  // 统计文档频率（每条广告内去重后计数）
  const df = new Map<string, number>()
  for (const t of texts) {
    const cands = extractCandidates(t, Math.max(2, opt.minLen))
    for (const c of cands) df.set(c, (df.get(c) ?? 0) + 1)
  }

  // 一条广告时阈值降为 1，否则不超过总数
  const minDF = total <= 1 ? 1 : Math.min(Math.max(1, opt.minDocFreq), total)

  const kept = [...df.entries()]
    .filter(([, f]) => f >= minDF)
    .map(([k, f]) => ({ k, f }))

  // 合并成最长短语：按长度降序，若已保留更长词包含当前词则丢弃（消除重叠的滑窗碎片）
  kept.sort((a, b) => b.k.length - a.k.length || b.f - a.f)
  const maximal: { k: string; f: number }[] = []
  for (const cand of kept) {
    if (!maximal.some(x => x.k.includes(cand.k))) maximal.push(cand)
  }

  // 排除词过滤：命中排除子串的自动关键词剔除（不区分大小写）
  const excludes = excludeKeywords.map(s => s.trim().toLowerCase()).filter(Boolean)
  const passExclude = (kw: string) => {
    const low = kw.toLowerCase()
    return !excludes.some(ex => low.includes(ex))
  }

  // 排序：先按文档频率，再按长度，取上限
  maximal.sort((a, b) => b.f - a.f || b.k.length - a.k.length)
  const keywords = maximal
    .filter(x => passExclude(x.k))
    .slice(0, Math.max(1, opt.maxKeywords))
    .map(x => x.k)

  // 用户名与域名
  const usernameSet = new Set<string>()
  const domainSet = new Set<string>()
  for (const t of texts) {
    for (const u of extractUsernames(t)) usernameSet.add(u)
    for (const d of extractDomains(t)) domainSet.add(d)
  }
  const usernames = [...usernameSet].filter(passExclude)
  const domains = [...domainSet].filter(passExclude)

  // 手动关键词（去空、去重，始终纳入）
  const customs = [...new Set(customKeywords.map(s => s.trim()).filter(Boolean))]

  // 组装正则片段
  const loose = opt.looseMatch
  const parts: string[] = []
  parts.push(...keywords.map(k => toPattern(k, loose)))
  if (opt.includeUsernames) parts.push(...usernames.map(escapeRegex))
  if (opt.includeDomains) parts.push(...domains.map(escapeRegex))
  parts.push(...customs.map(k => toPattern(k, loose)))

  const uniq = [...new Set(parts)].filter(Boolean)
  const body = uniq.join("|")
  let regex = ""
  if (uniq.length > 0) {
    regex = opt.wrapGroup ? `(?:${body})` : body
    if (opt.caseInsensitive) regex = "(?i)" + regex
  }

  return { regex, keywords, usernames, domains, customKeywords: customs }
}

// 测试一条消息是否被正则命中；返回命中的片段。用 JS RegExp 近似（(?i) 转为 i 标志）
export function testRegex(
  regexStr: string,
  message: string
): { ok: boolean; matched: boolean; hit: string; error?: string } {
  if (!regexStr) return { ok: true, matched: false, hit: "" }
  let src = regexStr
  let flags = ""
  if (src.startsWith("(?i)")) {
    src = src.slice(4)
    flags = "i"
  }
  try {
    const re = new RegExp(src, flags)
    const m = re.exec(message)
    return { ok: true, matched: m !== null, hit: m ? m[0] : "" }
  } catch (e) {
    return { ok: false, matched: false, hit: "", error: String(e) }
  }
}
