import type { CommitEntry } from "../types/git"

export interface HistoryPage {
  entries: CommitEntry[]
  hasMore: boolean
  totalMatches: number | null
  limited?: boolean
}

export function normalizeHistoryQuery(query: string): string {
  return query.trim().toLocaleLowerCase()
}

export function matchesHistoryQuery(
  entry: CommitEntry,
  query: string
): boolean {
  const normalizedQuery = normalizeHistoryQuery(query)
  if (!normalizedQuery) return true
  const searchable = [
    entry.oid,
    entry.message,
    entry.author.name,
    entry.author.email,
  ]
    .join("\n")
    .toLocaleLowerCase()
  return searchable.includes(normalizedQuery)
}

export function paginateHistory(
  entries: CommitEntry[],
  offset: number,
  limit: number,
  query = ""
): HistoryPage {
  const safeOffset = Math.max(0, Math.trunc(offset))
  const safeLimit = Math.max(1, Math.trunc(limit))
  const normalizedQuery = normalizeHistoryQuery(query)
  const matches = normalizedQuery
    ? entries.filter((entry) => matchesHistoryQuery(entry, normalizedQuery))
    : entries
  const page = matches.slice(safeOffset, safeOffset + safeLimit)

  return {
    entries: page,
    hasMore: safeOffset + page.length < matches.length,
    totalMatches: normalizedQuery ? matches.length : null,
  }
}
