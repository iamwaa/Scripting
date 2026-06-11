export interface ResourceItem {
  type: "image" | "css" | "js" | "video" | "audio" | "font" | "document" | "archive" | "other"
  url: string
  name: string
  /** 启发式判断：疑似图标/缩略图 */
  likelyThumbnail?: boolean
}

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
