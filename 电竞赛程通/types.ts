export interface Opponent {
  id: number | null
  name: string
  acronym: string
  slug: string
  imageUrl: string
}

export interface MatchResult {
  score: number
  teamId: number
}

export interface Match {
  id: number
  name: string
  status: "not_started" | "running" | "finished"
  scheduled_at: string
  league: string
  leagueId: number | null
  leagueSlug: string
  serie: string
  serieId: number | null
  serieSlug: string
  tournament: string
  tournamentId: number | null
  tournamentSlug: string
  opponents: Opponent[]
  results: MatchResult[]
  videogame: string
  videogameId: number | null
  videogameSlug: string
  videogameTitle: string
  videogameTitleSlug: string
}

export interface Videogame {
  id: number
  name: string
  slug: string
}

export type FilterKey = "videogame" | "league" | "tournament" | "team"

export interface MatchFilters {
  videogame: string
  league: string
  tournament: string
  team: string
}

export interface FilterOption {
  value: string
  label: string
}

export interface Subscription {
  matchId: number
  notifyMinutesBefore: number
  match?: Match
}

export interface Settings {
  apiToken: string | null
  defaultNotifyMinutesBefore: number
  notifyAtStart: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  apiToken: null,
  defaultNotifyMinutesBefore: 30,
  notifyAtStart: true,
}
