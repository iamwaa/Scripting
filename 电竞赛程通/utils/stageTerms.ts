// 赛事阶段术语中文映射
// PandaScore 的 tournament.name / serie.name 常含固定英文阶段术语(如 Regular Season),
// 这里做术语级中文替换,覆盖面广且便于扩展;新增术语只需在表里加一行。
// 匹配策略:大小写不敏感 + 单词边界,避免 "Group A" 误伤 "Group Alpha"。

// 阶段术语映射表:英文 -> 中文
// 顺序不敏感:函数内会按长度降序处理,确保长短语先于其内部的短词替换
export const STAGE_TERMS: { en: string; zh: string }[] = [
  // 常规赛 / 季后赛 / 淘汰赛 / 入围赛
  { en: "Regular Season", zh: "常规赛" },
  { en: "Playoffs", zh: "季后赛" },
  { en: "Playoff", zh: "季后赛" },
  { en: "Knockout Stage", zh: "淘汰赛阶段" },
  { en: "Knockout", zh: "淘汰赛" },
  { en: "Last Chance Qualifier", zh: "最后机会资格赛" },
  { en: "Play-In Stage", zh: "入围赛阶段" },
  { en: "Play-In", zh: "入围赛" },
  { en: "Play In Stage", zh: "入围赛阶段" },
  { en: "Play In", zh: "入围赛" },
  { en: "Seeding Decider", zh: "种子排位赛" },
  { en: "Seed Deciders", zh: "种子排位赛" },
  { en: "Seed Decider", zh: "种子排位赛" },
  { en: "Qualifier", zh: "资格赛" },           // 修正: Qualifier 更准确为资格赛
  // 小组赛 / 分组(Group Stage 与 Groups 单列;带具体组名如 "Group Alpha"/"Group 2" 由通用规则处理)
  { en: "Group Stage", zh: "小组赛" },
  { en: "Groups", zh: "小组赛" },
  { en: "Legend Group", zh: "传奇组" },
  { en: "Rise Group", zh: "崛起组" },
  { en: "Group Ascend", zh: "登峰组" },
  { en: "Group Nirvana", zh: "涅槃组" },
  { en: "Lucky Losers Group", zh: "幸运落败者组" },
  // 循环赛
  { en: "Round Robin Stage", zh: "单循环赛" },
  // 瑞士轮
  { en: "Swiss Stage", zh: "瑞士轮" },
  { en: "Swiss", zh: "瑞士轮" },
  // 混战赛
  { en: "Rumble Stage", zh: "混战阶段" },
  { en: "Rumble", zh: "混战" },
  // 决赛 / 半决赛 / 四分之一决赛(长后缀排前)
  { en: "Reset Grand Final", zh: "总决赛重置战" },
  { en: "Grand Finals", zh: "总决赛" },
  { en: "Grand Final", zh: "总决赛" },
  { en: "Finals", zh: "决赛" },
  { en: "Final", zh: "决赛" },
  { en: "Semifinals", zh: "半决赛" },
  { en: "Semifinal", zh: "半决赛" },
  { en: "Quarterfinals", zh: "四分之一决赛" },
  { en: "Quarterfinal", zh: "四分之一决赛" },
  // 败者组 / 胜者组(长短语先于 "Bracket" 通用词)
  { en: "Lower Bracket Final", zh: "败者组决赛" },
  { en: "Lower Bracket Semifinal", zh: "败者组半决赛" },
  { en: "Lower Bracket", zh: "败者组" },
  { en: "Upper Bracket Final", zh: "胜者组决赛" },
  { en: "Upper Bracket Semifinal", zh: "胜者组半决赛" },
  { en: "Upper Bracket", zh: "胜者组" },
  { en: "Winners Bracket", zh: "胜者组" },
  { en: "Losers Bracket", zh: "败者组" },
  { en: "Decider Brackets", zh: "决胜淘汰赛" },
  { en: "Bracket", zh: "淘汰赛" },
  // 出局赛 / 胜者组比赛 / 季军赛 / 决胜赛(均为 "X match" 形式,长后缀排前)
  { en: "Elimination Match", zh: "淘汰赛" },
  { en: "Winners Match", zh: "胜者组比赛" },
  { en: "3rd Place Match", zh: "季军赛" },
  { en: "5th Place Match", zh: "第五名争夺战" },
  { en: "Decider Match", zh: "决胜赛" },
  { en: "Decieder Match", zh: "决胜赛" },
  { en: "Match", zh: "场" },
  // 分阶段 / 赛季分站(长 Split 先于通用 Split)
  { en: "Spring Split", zh: "春季赛" },
  { en: "Summer Split", zh: "夏季赛" },
  { en: "Winter Split", zh: "冬季赛" },
  { en: "Autumn Split", zh: "秋季赛" },
  { en: "Split", zh: "联赛阶段" },             // 修正: 分站赛 → 联赛阶段,更贴合电竞语境
  { en: "Season", zh: "赛季" },
  // 轮次 / 阶段
  { en: "Stage", zh: "阶段" },
  { en: "Round", zh: "轮" },
]

// 转义正则特殊字符,使术语可安全用于 RegExp
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// 为术语构造大小写不敏感、带单词边界的正则;对含非字母数字记号(如 "-")的词放宽前边界
function termRegExp(en: string): RegExp {
  const pat = escapeRegExp(en)
  // 单词边界对连字符类标点不够友好,这里仅在两端为英文字母/数字时加 \b
  const leftB = /^[A-Za-z0-9]/.test(en) ? "\\b" : ""
  const rightB = /[A-Za-z0-9]$/.test(en) ? "\\b" : ""
  return new RegExp(`${leftB}${pat}${rightB}`, "gi")
}

// 按长度降序排列,确保长短语先于其内部的短词替换(如 "Grand Finals" 先于 "Final")
const SORTED_TERMS = [...STAGE_TERMS].sort((a, b) => b.en.length - a.en.length)
// 预编译正则,避免每次调用重建
const SORTED_RULES = SORTED_TERMS.map((t) => ({ ...t, re: termRegExp(t.en) }))

// 通用分组规则:"Group <名>" -> "<名>组"(Alpha/Omega/2/S 等一律覆盖,避免硬编码与误伤)
// 名字取其后一个非空白词;大小写不敏感;起止用单词边界,避免误伤 "Group Stage"(此时 Stage 已先替换)
// 容错拼写 Gr?oup:兼容数据源错字 "Goup <名>"(少一个 r)
const GROUP_RULE = /\bGr?oup\s+([A-Za-z0-9]+)\b/gi

// 轮次号规则:"Round 1" / "Round 3-4" / "Rounds 1-2" -> "第1轮" / "第3-4轮" / "第1-2轮"(含连字符范围,兼容单复数)
const ROUND_NUMBER_RULE = /\bRounds?\s*(\d+(?:\s*[-–]\s*\d+)?)\b/gi

// N强赛规则:"Round of 16" / "Round of 32" -> "16强赛" / "32强赛"
// 必须在 SORTED_RULES 前处理,否则普通 "Round -> 轮" 会先破坏 "Round of"
const ROUND_OF_RULE = /\bRound\s+of\s+(\d+)\b/gi

// 场次号规则:"Match 1" / "Match 2" -> "第1场" / "第2场"
// 必须在 SORTED_RULES 前处理,否则普通 "Match -> 场" 会把编号与词拆开
const MATCH_NUMBER_RULE = /\bMatch\s+(\d+)\b/gi

// 将赛事/阶段名里的英文术语替换为中文;非术语部分(如 "LEC"、"2023")原样保留
// 匹配策略:大小写不敏感 + 单词边界,避免 "Group A" 误伤 "Group Alpha"
export function getStageDisplayName(name: string | null | undefined): string {
  if (!name) return ""
  let result = name
  // 先把 "Round 1" / "Round 3-4" 转为 "第1轮" / "第3-4轮",避免后续普通 "Round -> 轮" 破坏编号显示
  result = result.replace(ROUND_NUMBER_RULE, (_m, num: string) => {
    const normalized = String(num).replace(/\s*[-–]\s*/g, "-")
    return `第${normalized}轮`
  })
  // 先把 "Round of 16" 转为 "16强赛",避免普通 "Round -> 轮" 破坏 N强赛结构
  result = result.replace(ROUND_OF_RULE, (_m, num: string) => `${num}强赛`)
  // 先把 "Match 2" 转为 "第2场",避免普通 "Match -> 场" 拆开编号
  result = result.replace(MATCH_NUMBER_RULE, (_m, num: string) => `第${num}场`)
  // 再做固定术语替换(长短语优先):正则带全局+不敏感标志,直接 replace 所有匹配
  for (const { zh, re } of SORTED_RULES) {
    re.lastIndex = 0
    result = result.replace(re, zh)
  }
  // 再做通用分组规则:Group <名> -> <名>组(含 Goup 容错)
  result = result.replace(GROUP_RULE, (_m, g1: string) => `${g1}组`)
  // 阶段号 + 组名 重组:把 "阶段 1 A组" 压缩并加分隔为 "阶段1 - A组"
  // 阶段号可能是数字或字母(如 "阶段 A C组"),且阶段与数字间可能无空格(如 "阶段1 A组"),
  // 因此阶段后空白用 \s*, 仅当阶段号后紧跟组名时才加分隔,避免误伤纯阶段号
  result = result.replace(/阶段\s*([A-Za-z0-9]+)\s+(.+?组)/g, "阶段$1 - $2")
  // 清理多余空格(连续空格合并、文本两端的空格)
  return result.replace(/\s+/g, " ").trim()
}