import { sanitizeFileName } from "../utils/fileName"

export interface ResourceItem {
  type: "image" | "css" | "js" | "video" | "audio" | "font" | "document" | "archive" | "other"
  url: string
  name: string
  likelyThumbnail?: boolean
  source?: string
  quality?: string
  format?: string
  width?: number
  height?: number
  audioUrl?: string
  headers?: Record<string, string>
  sourceUrl?: string
  videoFormatId?: string
  audioFormatId?: string
}

export { sanitizeFileName }

export const CATEGORY_ORDER: ResourceItem["type"][] = [
  "image", "video", "audio", "document", "archive", "css", "js", "font", "other"
]

export type M3u8Segment = {
  url: string
  keyUrl: string | null
  keyMethod: string | null  // "AES-128" | null
  ivHex: string | null
  seq: number
}
