// 数据模型定义

// 单条广告推文
export interface AdItem {
  id: string
  text: string
}

// 正则生成选项
export interface GenOptions {
  // 中文关键短语的最小长度（字符数）
  minLen: number
  // 关键词至少出现在多少条广告中才保留（交集强度）；广告只有一条时按 1 处理
  minDocFreq: number
  // 生成正则里关键词的最大数量，避免正则过长
  maxKeywords: number
  // 是否把 @频道用户名 作为关键词
  includeUsernames: boolean
  // 是否把域名/链接作为关键词
  includeDomains: boolean
  // 是否用 (?:...) 包裹整体
  wrapGroup: boolean
  // 忽略大小写（在正则前加 (?i)，默认开启）
  caseInsensitive: boolean
  // 宽松匹配：容忍关键词字符间插入的空格/emoji/分隔符（默认关闭）
  looseMatch: boolean
}

// 广告库（一组相似广告 + 生成结果）
export interface AdGroup {
  id: string
  name: string
  ads: AdItem[]
  options: GenOptions
  // 手动补充、始终纳入正则的关键词（解决漏匹配）
  customKeywords: string[]
  // 排除词：从自动结果中剔除，永不纳入（解决误伤）
  excludeKeywords: string[]
  // 最近一次生成的正则
  regex: string
  updatedAt: number
}

// 生成结果明细
export interface GenResult {
  regex: string
  keywords: string[]
  usernames: string[]
  domains: string[]
  customKeywords: string[]
}

// 默认生成选项
export function defaultOptions(): GenOptions {
  return {
    minLen: 3,
    minDocFreq: 2,
    maxKeywords: 40,
    includeUsernames: true,
    includeDomains: true,
    wrapGroup: true,
    caseInsensitive: true,
    looseMatch: false,
  }
}

// 兼容旧数据：补齐新增字段，保证读取旧存档不出错
export function normalizeGroup(g: any): AdGroup {
  const opt = g?.options ?? {}
  return {
    id: String(g?.id ?? ""),
    name: String(g?.name ?? "未命名"),
    ads: Array.isArray(g?.ads) ? g.ads : [],
    options: {
      minLen: typeof opt.minLen === "number" ? opt.minLen : 3,
      minDocFreq: typeof opt.minDocFreq === "number" ? opt.minDocFreq : 2,
      maxKeywords: typeof opt.maxKeywords === "number" ? opt.maxKeywords : 40,
      includeUsernames: opt.includeUsernames ?? true,
      includeDomains: opt.includeDomains ?? true,
      wrapGroup: opt.wrapGroup ?? true,
      // 旧数据无此字段：忽略大小写默认开启，宽松匹配默认关闭
      caseInsensitive: opt.caseInsensitive ?? true,
      looseMatch: opt.looseMatch ?? false,
    },
    customKeywords: Array.isArray(g?.customKeywords) ? g.customKeywords : [],
    excludeKeywords: Array.isArray(g?.excludeKeywords) ? g.excludeKeywords : [],
    regex: typeof g?.regex === "string" ? g.regex : "",
    updatedAt: typeof g?.updatedAt === "number" ? g.updatedAt : Date.now(),
  }
}
