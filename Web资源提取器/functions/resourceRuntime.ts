import type { ResourceItem } from "../types/resource"
import { WebURL } from "../utils/WebURL"
import {
  detectDirectResourceType,
  getResourceFileName,
  normalizeResourceURL,
} from "./resourceParsing"

const SNAPSHOT_FILE_NAME = "web-resource-extractor-runtime-snapshot.json"
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000

export type RuntimeResourceSnapshot = {
  pageUrl: string
  title?: string
  capturedAt: number
  resources: RuntimeResourceCandidate[]
}

type RuntimeResourceCandidate = {
  url: string
  type?: ResourceItem["type"] | "unknown"
  tag?: string
  width?: number
  height?: number
}

function getSnapshotPath(): string {
  return `${FileManager.safariBrowserStorageDirectory}/${SNAPSHOT_FILE_NAME}`
}

function normalizeForCompare(rawURL: string): string {
  return rawURL.split("#")[0]
}

function isSamePageSnapshot(snapshotUrl: string, targetURL: string): boolean {
  return normalizeForCompare(snapshotUrl) === normalizeForCompare(targetURL)
}

function isLikelySmallImage(candidate: RuntimeResourceCandidate): boolean {
  if (candidate.type !== "image") return false
  const width = candidate.width || 0
  const height = candidate.height || 0
  return width > 0 && height > 0 && width <= 120 && height <= 120
}

function classifyRuntimeResource(candidate: RuntimeResourceCandidate, normalizedUrl: string): ResourceItem["type"] | null {
  if (candidate.type && candidate.type !== "unknown") return candidate.type

  const directType = detectDirectResourceType(normalizedUrl)
  if (directType) return directType

  const lower = normalizedUrl.toLowerCase()
  if (/\.m3u8(?:[?#]|$)/.test(lower) || /(?:^|[/?&=])m3u8(?:[/?&=]|$)/.test(lower)) return "video"
  if (/\.(?:ts|m4s)(?:[?#]|$)/.test(lower) && /(?:video|hls|dash|segment|media|stream)/i.test(lower)) return "video"
  if (/\.(?:jpg|jpeg|png|gif|webp|svg|heic|heif|bmp|ico|avif|tiff)(?:[?#]|$)/.test(lower)) return "image"
  if (/\.(?:mp4|webm|mov|m4v|avi|mkv|flv)(?:[?#]|$)/.test(lower)) return "video"
  if (/\.(?:mp3|wav|ogg|m4a|aac|flac)(?:[?#]|$)/.test(lower)) return "audio"
  if (/\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/.test(lower)) return "font"
  if (/\.(?:css)(?:[?#]|$)/.test(lower)) return "css"
  if (/\.(?:js|mjs)(?:[?#]|$)/.test(lower)) return "js"
  if (/\.(?:pdf|docx?|xlsx?|pptx?|txt|md|csv)(?:[?#]|$)/.test(lower)) return "document"
  if (/\.(?:zip|rar|7z|tar|gz|bz2)(?:[?#]|$)/.test(lower)) return "archive"

  return null
}

export async function readRuntimeSnapshot(targetURL: string): Promise<RuntimeResourceSnapshot | null> {
  const path = getSnapshotPath()
  const exists = await FileManager.exists(path).catch(() => false)
  if (!exists) return null

  try {
    const raw = await FileManager.readAsString(path)
    const snapshot = JSON.parse(raw) as RuntimeResourceSnapshot
    if (!snapshot || !Array.isArray(snapshot.resources)) return null
    if (!isSamePageSnapshot(snapshot.pageUrl, targetURL)) return null
    if (Date.now() - snapshot.capturedAt > SNAPSHOT_MAX_AGE_MS) return null
    return snapshot
  } catch {
    return null
  }
}

export function parseRuntimeSnapshotResources(
  snapshot: RuntimeResourceSnapshot,
  targetURL: string
): ResourceItem[] {
  const results: ResourceItem[] = []
  const seen: Record<string, boolean> = {}

  for (const candidate of snapshot.resources) {
    if (!candidate || !candidate.url || candidate.url.startsWith("blob:")) continue
    const normalized = normalizeResourceURL(candidate.url, targetURL)
    if (!normalized || normalized.startsWith("data:") || seen[normalized]) continue

    const type = classifyRuntimeResource(candidate, normalized)
    if (!type) continue

    seen[normalized] = true
    results.push({
      type,
      url: normalized,
      name: getResourceFileName(normalized, targetURL),
      likelyThumbnail: isLikelySmallImage(candidate),
    })
  }

  return results
}

export function mergeResourceLists(...groups: ResourceItem[][]): ResourceItem[] {
  const merged: ResourceItem[] = []
  const seen: Record<string, boolean> = {}

  for (const group of groups) {
    for (const item of group) {
      const key = `${item.type}:${normalizeForCompare(item.url)}`
      if (seen[key]) continue
      seen[key] = true
      merged.push(item)
    }
  }

  return merged
}
