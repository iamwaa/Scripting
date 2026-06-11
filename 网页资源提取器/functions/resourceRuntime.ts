import type { ResourceItem } from "../types/resource"
import { WebURL } from "../utils/WebURL"
import {
  detectDirectResourceType,
  getResourceFileName,
  normalizeResourceURL,
} from "./resourceParsing"

const SNAPSHOT_STORAGE_KEY = "runtimeSnapshot"
const SNAPSHOT_STORAGE_FILE_NAMES = [
  `${encodeURIComponent("网页资源提取器")}.json`,
  `${encodeURIComponent("Web Resource Extractor Runtime Sniffer")}.json`,
]
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

function getSnapshotPaths(): string[] {
  return SNAPSHOT_STORAGE_FILE_NAMES.map(fileName => `${FileManager.safariBrowserStorageDirectory}/${fileName}`)
}

function parseStoredSnapshot(raw: string): RuntimeResourceSnapshot | null {
  const storage = JSON.parse(raw)
  const snapshot = storage?.[SNAPSHOT_STORAGE_KEY] ?? storage
  if (!snapshot || !Array.isArray(snapshot.resources)) return null
  return snapshot as RuntimeResourceSnapshot
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
  for (const path of getSnapshotPaths()) {
    const exists = await FileManager.exists(path).catch(() => false)
    if (!exists) continue

    try {
      const raw = await FileManager.readAsString(path)
      const snapshot = parseStoredSnapshot(raw)
      if (!snapshot) continue
      if (!isSamePageSnapshot(snapshot.pageUrl, targetURL)) continue
      if (Date.now() - snapshot.capturedAt > SNAPSHOT_MAX_AGE_MS) continue
      return snapshot
    } catch {
      continue
    }
  }

  return null
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
