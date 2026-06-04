import { fetch } from "scripting"
import type { M3u8Segment } from "../types/resource"
import { WebURL } from "../utils/WebURL"
import { keyExpansion, aes128CBCDecryptAsync, parseM3u8IV } from "../utils/aes"

export type M3u8Variant = {
  url: string
  bandwidth: number
  resolution: string
  label: string
}

export type M3u8PlaylistInfo = {
  segments: M3u8Segment[]
  playlistUrl: string
  totalDurationSeconds?: number
  variants: M3u8Variant[]
  selectedVariant?: M3u8Variant
}

export type DownloadM3u8Options = {
  isCancelled?: () => boolean
  onStatus?: (message: string) => void
  onSegmentProgress?: (index: number, fraction: number, phase: "download" | "decrypt") => void
}

export type DownloadM3u8ToFileOptions = DownloadM3u8Options & {
  outputPath: string
  onOrderedSegment?: (data: Uint8Array, index: number) => Promise<void> | void
}

function parseAttributeList(text: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const regex = /([A-Z0-9-]+)=((?:"[^"]*")|[^,]*)/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    attrs[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "")
  }
  return attrs
}

function formatVariantLabel(bandwidth: number, resolution: string): string {
  const height = resolution ? Number.parseInt(resolution.split("x")[1] || "0", 10) : 0
  if (height > 0) {
    if (height >= 2160) return "4K"
    if (height >= 1080) return "1080p"
    if (height >= 720) return "720p"
    if (height >= 480) return "480p"
    if (height >= 360) return "360p"
    return `${height}p`
  }
  if (bandwidth > 0) {
    return `${Math.round(bandwidth / 1000)}kbps`
  }
  return "未知"
}

function parseAllVariants(lines: string[], playlistUrl: string): M3u8Variant[] {
  const variants: M3u8Variant[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue

    const attrs = parseAttributeList(line.slice("#EXT-X-STREAM-INF:".length))
    const uri = lines.slice(i + 1).find(item => item && !item.startsWith("#"))
    if (!uri) continue

    const bandwidth = Number.parseInt(attrs.BANDWIDTH || attrs["AVERAGE-BANDWIDTH"] || "0", 10) || 0
    const resolution = attrs.RESOLUTION || ""

    variants.push({
      url: new WebURL(uri, playlistUrl).href,
      bandwidth,
      resolution,
      label: formatVariantLabel(bandwidth, resolution),
    })
  }

  variants.sort((a, b) => {
    if (b.bandwidth !== a.bandwidth) return b.bandwidth - a.bandwidth
    const aHeight = Number.parseInt(a.resolution.split("x")[1] || "0", 10) || 0
    const bHeight = Number.parseInt(b.resolution.split("x")[1] || "0", 10) || 0
    return bHeight - aHeight
  })
  return variants
}

export async function parseM3u8Playlist(playlistUrl: string): Promise<M3u8PlaylistInfo> {
  const res = await fetch(playlistUrl)
  if (!res.ok) throw new Error(`获取 m3u8 失败: HTTP ${res.status}`)

  const text = await res.text()
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean)

  if (text.includes("#EXT-X-STREAM-INF")) {
    const variants = parseAllVariants(lines, playlistUrl)
    if (variants.length === 0) throw new Error("主播放列表解析失败：未找到子列表链接")
    // 默认选择最高画质
    const bestVariant = variants[0]
    const nested = await parseM3u8Playlist(bestVariant.url)
    return { ...nested, variants, selectedVariant: bestVariant }
  }

  const segments: M3u8Segment[] = []
  let currentSeq = 0
  let totalDurationSeconds = 0
  let pendingDuration: number | null = null
  let currentKeyUrl: string | null = null
  let currentKeyMethod: string | null = null
  let currentIV: string | null = null

  for (const line of lines) {
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      currentSeq = Number.parseInt(line.split(":")[1], 10) || 0
      continue
    }

    if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = parseAttributeList(line.slice("#EXT-X-KEY:".length))
      if (attrs.METHOD === "NONE") {
        currentKeyUrl = null
        currentKeyMethod = null
        currentIV = null
      } else {
        currentKeyMethod = attrs.METHOD || null
        currentKeyUrl = attrs.URI ? new WebURL(attrs.URI, playlistUrl).href : null
        currentIV = attrs.IV || null
      }
      continue
    }

    if (line.startsWith("#EXTINF:")) {
      const durationText = line.slice("#EXTINF:".length).split(",")[0]
      const duration = Number.parseFloat(durationText)
      pendingDuration = Number.isFinite(duration) ? duration : null
      continue
    }

    if (line.startsWith("#")) continue

    if (pendingDuration !== null) {
      totalDurationSeconds += pendingDuration
    }

    segments.push({
      url: new WebURL(line, playlistUrl).href,
      keyUrl: currentKeyUrl,
      keyMethod: currentKeyMethod,
      ivHex: currentIV,
      seq: currentSeq,
    })
    currentSeq++
    pendingDuration = null
  }

  return { segments, playlistUrl, totalDurationSeconds, variants: [] }
}

export async function parseM3u8WithVariant(
  playlistUrl: string,
  variant: M3u8Variant
): Promise<M3u8PlaylistInfo> {
  const res = await fetch(variant.url)
  if (!res.ok) throw new Error(`获取 m3u8 失败: HTTP ${res.status}`)

  const text = await res.text()
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean)

  const segments: M3u8Segment[] = []
  let currentSeq = 0
  let totalDurationSeconds = 0
  let pendingDuration: number | null = null
  let currentKeyUrl: string | null = null
  let currentKeyMethod: string | null = null
  let currentIV: string | null = null

  for (const line of lines) {
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      currentSeq = Number.parseInt(line.split(":")[1], 10) || 0
      continue
    }

    if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = parseAttributeList(line.slice("#EXT-X-KEY:".length))
      if (attrs.METHOD === "NONE") {
        currentKeyUrl = null
        currentKeyMethod = null
        currentIV = null
      } else {
        currentKeyMethod = attrs.METHOD || null
        currentKeyUrl = attrs.URI ? new WebURL(attrs.URI, variant.url).href : null
        currentIV = attrs.IV || null
      }
      continue
    }

    if (line.startsWith("#EXTINF:")) {
      const durationText = line.slice("#EXTINF:".length).split(",")[0]
      const duration = Number.parseFloat(durationText)
      pendingDuration = Number.isFinite(duration) ? duration : null
      continue
    }

    if (line.startsWith("#")) continue

    if (pendingDuration !== null) {
      totalDurationSeconds += pendingDuration
    }

    segments.push({
      url: new WebURL(line, variant.url).href,
      keyUrl: currentKeyUrl,
      keyMethod: currentKeyMethod,
      ivHex: currentIV,
      seq: currentSeq,
    })
    currentSeq++
    pendingDuration = null
  }

  // 重新获取主播放列表以保留所有 variants
  const mainRes = await fetch(playlistUrl)
  let variants: M3u8Variant[] = []
  if (mainRes.ok) {
    const mainText = await mainRes.text()
    const mainLines = mainText.split("\n").map(l => l.trim()).filter(Boolean)
    variants = parseAllVariants(mainLines, playlistUrl)
  }

  return { segments, playlistUrl: variant.url, totalDurationSeconds, variants, selectedVariant: variant }
}

const PLAIN_SEGMENT_CONCURRENCY = 12
const ENCRYPTED_SEGMENT_CONCURRENCY = 6

async function fetchExpandedKey(keyUrl: string, cache: Map<string, Promise<Uint8Array>>): Promise<Uint8Array> {
  const cached = cache.get(keyUrl)
  if (cached) return cached

  const pending = (async () => {
    const keyRes = await fetch(keyUrl)
    if (!keyRes.ok) throw new Error(`获取解密密钥失败: HTTP ${keyRes.status}`)
    const keyBytes = await keyRes.bytes()
    const encryptionKey = new Uint8Array(keyBytes as any)
    if (encryptionKey.length !== 16) {
      throw new Error(`解密密钥长度异常: 期望 16 字节, 实际 ${encryptionKey.length} 字节`)
    }

    return keyExpansion(encryptionKey)
  })()

  cache.set(keyUrl, pending)
  try {
    return await pending
  } catch (err) {
    cache.delete(keyUrl)
    throw err
  }
}

async function downloadM3u8Segment(
  seg: M3u8Segment,
  segmentIndex: number,
  keyCache: Map<string, Promise<Uint8Array>>,
  options: DownloadM3u8Options
): Promise<Uint8Array> {
  let retry = 3

  while (retry > 0) {
    if (options.isCancelled?.()) throw new Error("用户已取消下载")

    try {
      const tsRes = await fetch(seg.url)
      if (!tsRes.ok) throw new Error(`HTTP ${tsRes.status}`)
      const rawBytes = await tsRes.bytes()
      let data = new Uint8Array(rawBytes as any)

      if (seg.keyUrl) {
        if (seg.keyMethod && seg.keyMethod !== "AES-128") {
          throw new Error(`暂不支持的 m3u8 加密方式: ${seg.keyMethod}`)
        }
        options.onStatus?.("检测到 AES-128 加密，正在解密分片...")
        const expandedKey = await fetchExpandedKey(seg.keyUrl, keyCache)
        const iv = parseM3u8IV(seg.ivHex, seg.seq)
        // 使用异步解密，分块处理并让出主线程，避免 UI 卡死
        data = await aes128CBCDecryptAsync(data, expandedKey, iv)
      }

      options.onSegmentProgress?.(segmentIndex, 1, "download")
      return data
    } catch (err) {
      retry--
      if (retry === 0) throw err
    }
  }

  throw new Error("分片下载失败")
}

function getSegmentConcurrency(segments: M3u8Segment[]): number {
  const hasEncryptedSegments = segments.some(seg => Boolean(seg.keyUrl))
  return hasEncryptedSegments ? ENCRYPTED_SEGMENT_CONCURRENCY : PLAIN_SEGMENT_CONCURRENCY
}

export async function downloadM3u8SegmentsToFile(
  segments: M3u8Segment[],
  options: DownloadM3u8ToFileOptions
): Promise<void> {
  const keyCache = new Map<string, Promise<Uint8Array>>()
  const concurrency = getSegmentConcurrency(segments)
  const chunks = new Array<Uint8Array | null>(segments.length).fill(null)
  let nextIndex = 0
  let nextWriteIndex = 0
  let appendChain = Promise.resolve()
  let writeError: Error | null = null

  try { await FileManager.remove(options.outputPath) } catch {}

  function queueWriteReadySegments() {
    appendChain = appendChain.then(async () => {
      while (nextWriteIndex < chunks.length && chunks[nextWriteIndex]) {
        if (writeError) return
        const data = chunks[nextWriteIndex]
        if (!data) break
        const fileData = Data.fromUint8Array(data)
        if (!fileData) { writeError = new Error("分片数据转换失败"); return }
        await FileManager.appendData(options.outputPath, fileData)
        await options.onOrderedSegment?.(data, nextWriteIndex)
        chunks[nextWriteIndex] = null
        nextWriteIndex++
      }
    })
  }

  async function worker() {
    while (nextIndex < segments.length) {
      if (options.isCancelled?.()) throw new Error("用户已取消下载")
      if (writeError) throw writeError
      const segmentIndex = nextIndex
      nextIndex++
      chunks[segmentIndex] = await downloadM3u8Segment(segments[segmentIndex], segmentIndex, keyCache, options)
      // 写入不阻塞下载：只触发写入队列，不等待完成
      queueWriteReadySegments()
    }
  }

  const workerCount = Math.min(concurrency, segments.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  // 等待所有写入完成
  await appendChain
  if (writeError) throw writeError
}


