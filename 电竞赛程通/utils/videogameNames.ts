// 游戏名称中文映射:把 PandaScore 的 videogame / videogame_title slug 或英文名映射为中文显示名

export interface VideogameMeta {
  slug: string
  label: string
  name: string
}

export interface VideogameTitleMeta {
  slug: string
  label: string
  name: string
}

// 游戏元信息映射表(videogame 层,统称),按 slug 索引
export const VIDEOGAMES: VideogameMeta[] = [
  { slug: "league-of-legends", label: "英雄联盟", name: "League of Legends" },
  { slug: "lol-wild-rift", label: "英雄联盟手游", name: "LoL Wild Rift" },
  { slug: "cs-go", label: "反恐精英", name: "Counter-Strike" },
  { slug: "dota-2", label: "Dota 2", name: "Dota 2" },
  { slug: "valorant", label: "无畏契约", name: "Valorant" },
  { slug: "ow", label: "守望先锋", name: "Overwatch" },
  { slug: "rl", label: "火箭联盟", name: "Rocket League" },
  { slug: "r6-siege", label: "彩虹六号", name: "Rainbow Six Siege" },
  { slug: "pubg", label: "绝地求生", name: "PUBG" },
  { slug: "kog", label: "王者荣耀", name: "King of Glory" },
  { slug: "mlbb", label: "决胜巅峰", name: "Mobile Legends: Bang Bang" },
  { slug: "cod-mw", label: "使命召唤", name: "Call of Duty" },
  { slug: "starcraft-2", label: "星际争霸2", name: "StarCraft 2" },
  { slug: "starcraft-brood-war", label: "星际争霸:母巢之战", name: "StarCraft Brood War" },
  { slug: "fifa", label: "FC 足球", name: "EA Sports FC" },
  { slug: "e-soccer", label: "电子足球", name: "eSoccer" },
  { slug: "e-basketball", label: "电子篮球", name: "eBasketball" },
  { slug: "e-cricket", label: "电子板球", name: "eCricket" },
]

// 游戏标题映射表(videogame_title 层,具体版本/子标题),按 slug 索引
// 统称无法代表多个游戏时,优先用 title 显示;当前已知 Counter-Strike 下两个 title
export const VIDEOGAME_TITLES: VideogameTitleMeta[] = [
  { slug: "cs-go", label: "反恐精英:全球攻势", name: "Counter-Strike: Global Offensive" },
  { slug: "cs-2", label: "反恐精英2", name: "Counter-Strike 2" },
]

// slug -> 元信息 的快速查找索引
const VIDEOGAME_BY_SLUG: Record<string, VideogameMeta> = Object.fromEntries(
  VIDEOGAMES.map((g) => [g.slug, g]),
)

// 名 -> 元信息 的快速查找索引(用于按英文 name 反查)
const VIDEOGAME_BY_NAME: Record<string, VideogameMeta> = Object.fromEntries(
  VIDEOGAMES.map((g) => [g.name.toLowerCase(), g]),
)

// videogame_title slug -> 元信息 的快速查找索引
const VIDEOGAME_TITLE_BY_SLUG: Record<string, VideogameTitleMeta> = Object.fromEntries(
  VIDEOGAME_TITLES.map((t) => [t.slug, t]),
)

// videogame_title 英文名 -> 元信息 的快速查找索引(大小写不敏感)
const VIDEOGAME_TITLE_BY_NAME: Record<string, VideogameTitleMeta> = Object.fromEntries(
  VIDEOGAME_TITLES.map((t) => [t.name.toLowerCase(), t]),
)

export function getVideogameLabel(slug: string | null | undefined, fallback?: string): string {
  if (!slug) return fallback ?? ""
  return VIDEOGAME_BY_SLUG[slug]?.label ?? fallback ?? slug
}

export function getVideogameMeta(slug: string | null | undefined): VideogameMeta | null {
  if (!slug) return null
  return VIDEOGAME_BY_SLUG[slug] ?? null
}

export function getVideogameMetaByName(name: string | null | undefined): VideogameMeta | null {
  if (!name) return null
  return VIDEOGAME_BY_NAME[name.toLowerCase()] ?? null
}

export function getVideogameTitleLabel(slug: string | null | undefined, fallback?: string): string {
  if (!slug) return fallback ?? ""
  return VIDEOGAME_TITLE_BY_SLUG[slug]?.label ?? fallback ?? slug
}

export function getVideogameTitleMeta(slug: string | null | undefined): VideogameTitleMeta | null {
  if (!slug) return null
  return VIDEOGAME_TITLE_BY_SLUG[slug] ?? null
}

export function getVideogameTitleMetaByName(name: string | null | undefined): VideogameTitleMeta | null {
  if (!name) return null
  return VIDEOGAME_TITLE_BY_NAME[name.toLowerCase()] ?? null
}

// 统一的赛事游戏显示名:title 优先,缺失回退 videogame 中文名,再回退到原始英文名
export function getGameDisplayName(params: {
  videogameSlug?: string | null
  videogameName?: string | null
  titleSlug?: string | null
  titleName?: string | null
}): string {
  const { videogameSlug, videogameName, titleSlug, titleName } = params
  // 优先 title 中文名(slug 命中)
  if (titleSlug) {
    const bySlug = VIDEOGAME_TITLE_BY_SLUG[titleSlug]
    if (bySlug) return bySlug.label
  }
  // 次选 title 中文名(按英文名命中)
  if (titleName) {
    const byName = VIDEOGAME_TITLE_BY_NAME[titleName.toLowerCase()]
    if (byName) return byName.label
  }
  // 再次回退到 videogame 中文名(slug 命中)
  if (videogameSlug) {
    const bySlug = VIDEOGAME_BY_SLUG[videogameSlug]
    if (bySlug) return bySlug.label
  }
  // 再按 videogame 英文名命中
  if (videogameName) {
    const byName = VIDEOGAME_BY_NAME[videogameName.toLowerCase()]
    if (byName) return byName.label
  }
  // 最后保留 API 原始英文 title 名,其次 videogame 英文名,兜底空串
  return titleName || videogameName || ""
}

export function getVideogameOptions(): { value: string; label: string }[] {
  return VIDEOGAMES.map((g) => ({ value: g.slug, label: g.label }))
}
