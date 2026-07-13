import { fetch } from "scripting"
import type { Match, Videogame, MatchFilters } from "./types"

const BASE_URL = "https://api.pandascore.co"

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export interface ApiUsage {
  remaining: number | null
  updatedAt: number
}

type UsageListener = (usage: ApiUsage) => void
let usageListener: UsageListener | null = null

export function setUsageListener(listener: UsageListener | null): void {
  usageListener = listener
}

function reportUsage(response: { headers: { get: (name: string) => string | null } }): void {
  if (!usageListener) return
  // HTTP 头部大小写不敏感
  const raw = response.headers.get("X-Rate-Limit-Remaining")
  const remaining = raw != null && raw !== "" ? Number(raw) : null
  if (remaining != null && !Number.isNaN(remaining)) {
    usageListener({ remaining, updatedAt: Date.now() })
  }
}


export async function fetchUpcomingMatches(
  token: string | null,
  perPage = 50,
  filters?: MatchFilters,
  page = 1,
): Promise<Match[]> {
  const url = new URL(`${BASE_URL}/matches/upcoming`)
  url.searchParams.set("per_page", String(perPage))
  url.searchParams.set("page", String(page))
  url.searchParams.set("sort", "scheduled_at")
  appendMatchFilters(url, filters)

  const response = await fetch(url.toString(), {
    headers: authHeaders(token),
  })

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }
  reportUsage(response)

  const rawList: unknown[] = await response.json()
  return rawList.map(parseMatch).filter(Boolean) as Match[]
}

export async function fetchRunningMatches(
  token: string | null,
  perPage = 50,
  filters?: MatchFilters,
  page = 1,
): Promise<Match[]> {
  const url = new URL(`${BASE_URL}/matches/running`)
  url.searchParams.set("per_page", String(perPage))
  url.searchParams.set("page", String(page))
  appendMatchFilters(url, filters)

  const response = await fetch(url.toString(), {
    headers: authHeaders(token),
  })

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }
  reportUsage(response)

  const rawList: unknown[] = await response.json()
  return rawList.map(parseMatch).filter(Boolean) as Match[]
}

export async function fetchFinishedMatches(
  token: string | null,
  perPage = 50,
  filters?: MatchFilters,
  page = 1,
): Promise<Match[]> {
  const url = new URL(`${BASE_URL}/matches/past`)
  url.searchParams.set("per_page", String(perPage))
  url.searchParams.set("page", String(page))
  url.searchParams.set("sort", "-scheduled_at")
  appendMatchFilters(url, filters)

  const response = await fetch(url.toString(), {
    headers: authHeaders(token),
  })

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }
  reportUsage(response)

  const rawList: unknown[] = await response.json()
  return rawList.map(parseMatch).filter(Boolean) as Match[]
}

export async function fetchVideogames(token: string | null): Promise<Videogame[]> {
  const response = await fetch(`${BASE_URL}/videogames`, {
    headers: authHeaders(token),
  })

  if (!response.ok) {
    throw new Error(`获取游戏列表失败: ${response.status}`)
  }

  const rawList: any[] = await response.json()
  return rawList.map((item) => ({
    id: item.id,
    name: item.name,
    slug: item.slug,
  })) as Videogame[]
}

function appendMatchFilters(url: URL, filters?: MatchFilters): void {
  if (!filters) return

  if (filters.videogame !== "all") {
    url.searchParams.set("filter[videogame]", filters.videogame)
  }
  if (filters.league !== "all") {
    url.searchParams.set("filter[league_id]", filters.league)
  }
  if (filters.tournament !== "all") {
    url.searchParams.set("filter[tournament_id]", filters.tournament)
  }
  if (filters.team !== "all") {
    url.searchParams.set("filter[opponent_id]", filters.team)
  }
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

function parseMatch(item: any): Match | null {
  if (!item || !item.id) return null

  return {
    id: item.id as number,
    name: (item.name as string) ?? "未命名赛事",
    status: (item.status as Match["status"]) ?? "not_started",
    scheduled_at: (item.scheduled_at as string) ?? (item.begin_at as string) ?? new Date().toISOString(),
    league: (item.league?.name as string) ?? "未知联赛",
    leagueId: nullableNumber(item.league?.id),
    leagueSlug: (item.league?.slug as string) ?? "",
    serie: (item.serie?.name as string) ?? "",
    serieId: nullableNumber(item.serie?.id),
    serieSlug: (item.serie?.slug as string) ?? "",
    tournament: (item.tournament?.name as string) ?? "",
    tournamentId: nullableNumber(item.tournament?.id),
    tournamentSlug: (item.tournament?.slug as string) ?? "",
    opponents: ((item.opponents as any[]) ?? []).map((opp: any) => ({
      id: nullableNumber(opp.opponent?.id),
      name: (opp.opponent?.name as string) ?? "未知队伍",
      acronym: (opp.opponent?.acronym as string) ?? "",
      slug: (opp.opponent?.slug as string) ?? "",
      imageUrl: (opp.opponent?.image_url as string) ?? "",
    })),
    results: ((item.results as any[]) ?? []).map((r: any) => ({
      score: (r.score as number) ?? 0,
      teamId: nullableNumber(r.team_id) ?? 0,
    })),
    videogame: (item.videogame?.name as string) ?? "未知游戏",
    videogameId: nullableNumber(item.videogame?.id),
    videogameSlug: (item.videogame?.slug as string) ?? "",
    videogameTitle: (item.videogame_title?.name as string) ?? "",
    videogameTitleSlug: (item.videogame_title?.slug as string) ?? "",
  }
}


