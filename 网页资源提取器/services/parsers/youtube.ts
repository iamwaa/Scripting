import { Script } from "scripting"
import { ensureYtDlpInstalled, ensureSabrComponents, ytDlpInstallPath } from "../ytDlpManager"
import type { ResourceItem } from "../../types/resource"
import { sanitizeFileName } from "../../utils/fileName"
import type { SiteParser, SiteParseContext, SiteParseResult } from "./types"

const YOUTUBE_HEADERS = {
  Referer: "https://www.youtube.com/",
}

type YouTubeFormat = {
  formatId?: string
  url?: string
  ext?: string
  protocol?: string
  width?: number
  height?: number
  fps?: number
  vcodec?: string
  acodec?: string
  tbr?: number
  abr?: number
  headers?: Record<string, string>
}

type YouTubeInfo = {
  id?: string
  title?: string
  thumbnail?: string
  formats?: YouTubeFormat[]
  error?: string
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function isAudioOnly(format: YouTubeFormat): boolean {
  return format.vcodec === "none" && !!format.acodec && format.acodec !== "none"
}

function isVideo(format: YouTubeFormat): boolean {
  return !!format.vcodec && format.vcodec !== "none" && !!format.height
}

function isMp4Video(format: YouTubeFormat): boolean {
  return isVideo(format) && format.ext === "mp4" && /^avc1/i.test(format.vcodec || "")
}

function headersFor(format: YouTubeFormat): Record<string, string> {
  return { ...format.headers, ...YOUTUBE_HEADERS }
}

function parseShellJson(output: string): YouTubeInfo {
  const lines = output.trim().split("\n").map(line => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index])
      if (value && typeof value === "object") return value
    } catch {}
  }
  return { error: output.trim() || "YouTube 解析没有返回结果" }
}

async function requestYouTubeInfo(url: string): Promise<YouTubeInfo> {
  const command = `python ${quoteShellArg(`${Script.directory}/scripts/youtube_info.py`)} ${quoteShellArg(ytDlpInstallPath)} ${quoteShellArg(url)}`
  const result = await Shell.run(command, { cwd: Script.directory, timeout: 120 })
  const info = parseShellJson(result.output)
  if (result.timedOut) throw new Error("YouTube 解析超时")
  if (result.exitCode !== 0 || info.error) throw new Error(info.error || "YouTube 解析失败")
  return info
}

function formatQuality(format: YouTubeFormat): string {
  const frameRate = (format.fps || 0) >= 50 ? `${Math.round(format.fps || 0)}fps` : ""
  return `${format.height || 0}p${frameRate}`
}

function makeVideoResources(info: YouTubeInfo): ResourceItem[] {
  const formats = info.formats || []
  const title = sanitizeFileName(info.title || info.id || "youtube_video", "youtube_video")
  const bestAudio = formats
    .filter(format => isAudioOnly(format) && format.ext === "m4a" && format.url)
    .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0]
  const candidates = formats
    .filter(format => isMp4Video(format) && format.url)
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0) || (b.tbr || 0) - (a.tbr || 0))
  const seen = new Set<string>()
  const resources: ResourceItem[] = []

  for (const format of candidates) {
    const quality = formatQuality(format)
    const hasAudio = !!format.acodec && format.acodec !== "none"
    if (seen.has(quality) || (!hasAudio && !bestAudio?.url)) continue
    seen.add(quality)
    resources.push({
      type: "video",
      url: format.url!,
      audioUrl: hasAudio ? undefined : bestAudio?.url,
      name: `${title}_${quality}.mp4`,
      source: "youtube",
      quality,
      format: format.vcodec || "mp4",
      width: format.width,
      height: format.height,
      headers: headersFor(format),
      sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(info.id || "")}`,
      videoFormatId: format.formatId,
      audioFormatId: hasAudio ? undefined : bestAudio?.formatId,
    })
  }

  if (info.thumbnail) {
    resources.push({
      type: "image",
      url: info.thumbnail,
      name: `${title}_cover.jpg`,
      source: "youtube",
      likelyThumbnail: true,
      headers: YOUTUBE_HEADERS,
    })
  }
  return resources
}

async function parseYouTube(context: SiteParseContext): Promise<SiteParseResult> {
  const installed = await ensureYtDlpInstalled(true)
  if (!installed) return { resources: [] }
  // 确保 SABR 组件已安装（提供 SSL 适配器用于 IOS innertube API）
  await ensureSabrComponents(true)
  const info = await requestYouTubeInfo(context.url)
  return {
    resources: makeVideoResources(info),
    title: info.title || undefined,
  }
}

export const youtubeParser: SiteParser = {
  id: "youtube",
  matches(url) {
    const host = url.match(/^https?:\/\/([^/:?#]+)/i)?.[1] || ""
    return /(?:^|\.)(?:youtube\.com|youtu\.be)$/i.test(host)
  },
  parse: parseYouTube,
}
