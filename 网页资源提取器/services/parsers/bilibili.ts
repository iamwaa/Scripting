import { fetch } from "scripting"
import type { ResourceItem } from "../../types/resource"
import { sanitizeFileName } from "../../utils/fileName"
import type { SiteParser, SiteParseContext, SiteParseResult } from "./types"

const BILIBILI_HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  Referer: "https://www.bilibili.com/",
}

const QUALITY_LABELS: Record<number, string> = {
  16: "360p",
  32: "480p",
  64: "720p",
  74: "720p60",
  80: "1080p",
  112: "1080p+",
  116: "1080p60",
  120: "4K",
  125: "HDR",
  126: "杜比视界",
  127: "8K",
}

type BilibiliStream = {
  id?: number
  baseUrl?: string
  base_url?: string
  backupUrl?: string[]
  backup_url?: string[]
  width?: number
  height?: number
  mimeType?: string
  mime_type?: string
  codecs?: string
  bandwidth?: number
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function matchFirst(source: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const value = source.match(pattern)?.[1]
    if (value) return decodeHtml(value.trim())
  }
  return ""
}

function extractPageInfo(context: SiteParseContext) {
  const bvid = matchFirst(`${context.url}\n${context.html}`, [
    /\b(BV[0-9A-Za-z]{10})\b/i,
    /["']bvid["']\s*:\s*["'](BV[0-9A-Za-z]{10})["']/i,
  ])
  const cid = Number.parseInt(matchFirst(context.html, [
    /["']cid["']\s*:\s*(\d+)/i,
    /\bcid=(\d+)/i,
  ]), 10)
  const title = matchFirst(context.html, [
    /<title[^>]*>([^<]+)<\/title>/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
  ]).replace(/_哔哩哔哩_bilibili$/i, "")
  const cover = matchFirst(context.html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  ])

  return { bvid, cid, title, cover }
}

function streamUrl(stream: BilibiliStream): string {
  return stream.baseUrl || stream.base_url || stream.backupUrl?.[0] || stream.backup_url?.[0] || ""
}

function qualityLabel(id: number | undefined, height?: number): string {
  if (id && QUALITY_LABELS[id]) return QUALITY_LABELS[id]
  return height ? `${height}p` : "未知画质"
}

function makeName(title: string, quality: string, extension: string): string {
  const base = sanitizeFileName(title || "bilibili_video", "bilibili_video")
  return `${base}_${quality}.${extension}`
}

async function resolvePageInfo(bvid: string, pageNumber: number): Promise<{ cid: number; part?: string } | null> {
  const response = await fetch(`https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`, {
    headers: BILIBILI_HEADERS,
  })
  if (!response.ok) return null
  const payload = await response.json()
  if (payload?.code !== 0 || !Array.isArray(payload.data)) return null

  const selected = payload.data.find((item: any) => item?.page === pageNumber) || payload.data[0]
  const cid = Number(selected?.cid)
  return Number.isFinite(cid) && cid > 0
    ? { cid, part: typeof selected?.part === "string" ? selected.part : undefined }
    : null
}

async function requestPlayUrl(bvid: string, cid: number, fnval: number): Promise<any | null> {
  const params = `bvid=${encodeURIComponent(bvid)}&cid=${cid}&qn=80&fnval=${fnval}&fourk=1`
  const response = await fetch(`https://api.bilibili.com/x/player/playurl?${params}`, {
    headers: BILIBILI_HEADERS,
  })
  if (!response.ok) return null
  const payload = await response.json()
  return payload?.code === 0 ? payload.data : null
}

function parseProgressive(data: any, title: string): ResourceItem[] {
  const quality = qualityLabel(data?.quality)
  return Array.isArray(data?.durl)
    ? data.durl.flatMap((item: any) => {
      const url = typeof item?.url === "string" ? item.url : ""
      if (!url) return []
      return [{
        type: "video" as const,
        url,
        name: makeName(title, quality, data?.format?.includes("flv") ? "flv" : "mp4"),
        source: "bilibili",
        quality,
        format: data?.format || "mp4",
        headers: BILIBILI_HEADERS,
      }]
    })
    : []
}

function parseDash(data: any, title: string): ResourceItem[] {
  const videos: BilibiliStream[] = Array.isArray(data?.dash?.video) ? data.dash.video : []
  const audios: BilibiliStream[] = Array.isArray(data?.dash?.audio) ? data.dash.audio : []
  const bestAudio = [...audios].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0]
  const audioUrl = bestAudio ? streamUrl(bestAudio) : ""
  const seen = new Set<string>()

  return videos.flatMap(video => {
    const url = streamUrl(video)
    const quality = qualityLabel(video.id, video.height)
    const key = `${quality}:${video.codecs || ""}`
    if (!url || seen.has(key)) return []
    seen.add(key)
    return [{
      type: "video" as const,
      url,
      audioUrl: audioUrl || undefined,
      name: makeName(title, quality, "mp4"),
      source: "bilibili",
      quality,
      format: video.codecs || video.mimeType || video.mime_type || "dash",
      width: video.width,
      height: video.height,
      headers: BILIBILI_HEADERS,
    }]
  })
}

async function parseBilibili(context: SiteParseContext): Promise<SiteParseResult> {
  const page = extractPageInfo(context)
  if (!page.bvid) return { resources: [] }

  const requestedPageMatch = context.url.match(/[?&]p=(\d+)/i)
  const requestedPage = Math.max(1, Number.parseInt(requestedPageMatch?.[1] || "1", 10) || 1)
  const resolvedPage = requestedPageMatch || !page.cid
    ? await resolvePageInfo(page.bvid, requestedPage)
    : null
  const cid = resolvedPage?.cid || page.cid || 0
  if (!cid) return { resources: [] }

  const shouldAppendPart = resolvedPage?.part
    && requestedPage > 1
    && !page.title.toLowerCase().includes(resolvedPage.part.toLowerCase())
  const title = shouldAppendPart
    ? `${page.title}_${resolvedPage!.part}`
    : page.title
  const progressive = await requestPlayUrl(page.bvid, cid, 1)
  const dash = await requestPlayUrl(page.bvid, cid, 4048)
  const resources = [
    ...parseDash(dash, title),
    ...parseProgressive(progressive, title),
  ].filter((item, index, items) => items.findIndex(candidate => candidate.url === item.url) === index)

  if (page.cover) {
    const cover = page.cover.startsWith("//") ? `https:${page.cover}` : page.cover
    resources.push({
      type: "image",
      url: cover,
      name: `${sanitizeFileName(title || page.bvid, page.bvid)}_cover.jpg`,
      source: "bilibili",
      headers: BILIBILI_HEADERS,
    })
  }

  return { resources, title: title || undefined }
}

export const bilibiliParser: SiteParser = {
  id: "bilibili",
  matches(url) {
    return /(?:^|\.)bilibili\.com$|(?:^|\.)b23\.tv$/i.test(url.match(/^https?:\/\/([^/:?#]+)/i)?.[1] || "")
  },
  parse: parseBilibili,
}
