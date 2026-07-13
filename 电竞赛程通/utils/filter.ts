import type { Match, FilterKey, MatchFilters, FilterOption } from "../types"
import { getGameDisplayName } from "./videogameNames"
import { getStageDisplayName } from "./stageTerms"

export const FILTER_LABELS: Record<FilterKey, string> = {
  videogame: "游戏",
  league: "赛事/联赛",
  tournament: "赛程",
  team: "战队",
}

export const FILTER_ORDER: FilterKey[] = ["videogame", "league", "tournament", "team"]

export const DEFAULT_FILTERS: MatchFilters = {
  videogame: "all",
  league: "all",
  tournament: "all",
  team: "all",
}

function matchOptions(match: Match, key: FilterKey): FilterOption[] {
  if (key === "videogame") {
    const value = match.videogameSlug || String(match.videogameId ?? "")
    // label 用中文名(title 优先回退 videogame),与主页面显示保持一致;value 仍用 slug 保证筛选稳定
    const label = getGameDisplayName({
      videogameSlug: match.videogameSlug,
      videogameName: match.videogame,
      titleSlug: match.videogameTitleSlug,
      titleName: match.videogameTitle,
    })
    return value ? [{ value, label: label || match.videogame }] : []
  }
  if (key === "league") {
    return match.leagueId ? [{ value: String(match.leagueId), label: match.league }] : []
  }
  if (key === "tournament") {
    // label 用阶段名中译(英文术语->中文);value 仍用 tournamentId 保证筛选稳定
    return match.tournamentId
      ? [{ value: String(match.tournamentId), label: getStageDisplayName(match.tournament) }]
      : []
  }

  return match.opponents
    .map((opponent) => {
      const value = opponent.slug || String(opponent.id ?? "")
      return value ? { value, label: opponent.name } : null
    })
    .filter((item): item is FilterOption => item !== null)
}

// 筛选值匹配: value 可能是逗号分隔的多 ID(同名合并),比赛只要命中其中一个即可
function matchPasses(match: Match, key: FilterKey, value: string): boolean {
  if (value === "all") return true
  const values = value.split(",")
  return matchOptions(match, key).some((option) => values.includes(option.value))
}

// 只应用指定维度之前的筛选，用于生成级联选项
export function matchesBeforeKey(matches: Match[], filters: MatchFilters, key: FilterKey): Match[] {
  const keyIndex = FILTER_ORDER.indexOf(key)
  const upstreamKeys = FILTER_ORDER.slice(0, keyIndex)

  return matches.filter((match) =>
    upstreamKeys.every((filterKey) => matchPasses(match, filterKey, filters[filterKey])),
  )
}

export function extractCascadingOptions(
  matches: Match[],
  filters: MatchFilters,
  key: FilterKey,
): FilterOption[] {
  const scopedMatches = matchesBeforeKey(matches, filters, key)
  // 按 label 合并同名选项, value 用逗号连接多个 ID
  const byLabel = new Map<string, { values: string[]; label: string }>()

  for (const match of scopedMatches) {
    for (const option of matchOptions(match, key)) {
      const existing = byLabel.get(option.label)
      if (existing) {
        if (!existing.values.includes(option.value)) {
          existing.values.push(option.value)
        }
      } else {
        byLabel.set(option.label, { values: [option.value], label: option.label })
      }
    }
  }

  return Array.from(byLabel.values())
    .map(({ values, label }) => ({ value: values.join(","), label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function filterMatches(matches: Match[], filters: MatchFilters): Match[] {
  return matches.filter((match) => FILTER_ORDER.every((key) => matchPasses(match, key, filters[key])))
}

export function normalizeFilters(matches: Match[], filters: MatchFilters): MatchFilters {
  const normalized = { ...filters }

  for (const key of FILTER_ORDER) {
    if (normalized[key] === "all") continue
    const options = extractCascadingOptions(matches, normalized, key)
    if (!options.some((option) => option.value === normalized[key])) {
      normalized[key] = "all"
    }
  }

  return normalized
}

export function updateCascadingFilters(filters: MatchFilters, key: FilterKey, value: string): MatchFilters {
  const next = { ...filters, [key]: value }
  const changedIndex = FILTER_ORDER.indexOf(key)

  for (const downstreamKey of FILTER_ORDER.slice(changedIndex + 1)) {
    next[downstreamKey] = "all"
  }

  return next
}
