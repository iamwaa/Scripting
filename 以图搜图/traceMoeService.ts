import { fetch } from "scripting"

export type TraceMoeResult = {
  anilist?: {
    id?: number
    title?: {
      native?: string
      romaji?: string
      english?: string
    }
  }
  filename?: string
  episode?: number | string | null
  from?: number
  to?: number
  similarity?: number
  image?: string
  video?: string
}

export async function searchTraceMoe(imageURL: string) {
  const apiURL = `https://api.trace.moe/search?anilistInfo&cutBorders=true&url=${encodeURIComponent(imageURL)}`
  const response = await fetch(apiURL, { timeout: 60 })
  const data = await response.json()
  if (!response.ok || data.error) {
    throw new Error(data.error || `TraceMoe 请求失败：${response.status}`)
  }
  return (data.result ?? []) as TraceMoeResult[]
}

export function traceTitle(result: TraceMoeResult) {
  return result.anilist?.title?.native || result.anilist?.title?.romaji || result.anilist?.title?.english || "未知动画"
}

export function formatTraceTime(seconds?: number) {
  if (seconds == null || Number.isNaN(seconds)) {
    return "未知时间"
  }
  const minutes = Math.floor(seconds / 60)
  const restSeconds = Math.floor(seconds % 60)
  return `${minutes}:${String(restSeconds).padStart(2, "0")}`
}

export function formatSimilarity(value?: number) {
  if (value == null || Number.isNaN(value)) {
    return "相似度未知"
  }
  return `${Math.round(value * 1000) / 10}%`
}
