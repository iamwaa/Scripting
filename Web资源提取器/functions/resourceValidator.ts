import { fetch } from "scripting"
import type { ResourceItem } from "../types/resource"

function isHtmlContentType(contentType: string): boolean {
  return contentType.includes("text/html") || contentType.includes("application/xhtml")
}

function isCompatibleContentType(item: ResourceItem, contentType: string): boolean {
  if (!contentType) return true
  if (isHtmlContentType(contentType)) return false

  switch (item.type) {
    case "image":
      return contentType.includes("image") || contentType.includes("octet-stream")
    case "css":
      return contentType.includes("text/css") || contentType.includes("octet-stream")
    case "js":
      return (
        contentType.includes("javascript") ||
        contentType.includes("ecmascript") ||
        contentType.includes("text/plain") ||
        contentType.includes("octet-stream")
      )
    case "font":
      return contentType.includes("font") || contentType.includes("octet-stream")
    default:
      return true
  }
}

function getHeader(res: any, name: string): string {
  if (res.headers && typeof res.headers.get === "function") {
    return res.headers.get(name)?.toLowerCase() || ""
  } else if (res.headers) {
    return (
      res.headers[name] ||
      res.headers[name.toLowerCase()] ||
      res.headers[name.replace(/(^|-)(\w)/g, (_, p, c) => p + c.toUpperCase())] ||
      ""
    ).toLowerCase()
  }
  return ""
}

function getContentType(res: any): string {
  return getHeader(res, "content-type")
}

function hasEmptyBody(res: any): boolean {
  const length = getHeader(res, "content-length")
  return length === "0"
}

function isOctetStream(contentType: string): boolean {
  return contentType.includes("octet-stream")
}

async function getResponseBytes(res: any): Promise<Uint8Array> {
  const raw = await res.bytes()
  return raw instanceof Uint8Array ? raw : new Uint8Array(raw as any)
}

function hasImageSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false

  // jpg
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true
  // png
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true
  // gif
  const ascii = Array.from(bytes.slice(0, Math.min(bytes.length, 16))).map(b => String.fromCharCode(b)).join("")
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return true
  // webp: RIFF....WEBP
  if (bytes.length >= 12 && ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return true
  // bmp
  if (ascii.startsWith("BM")) return true
  // ico
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return true
  // tiff
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)) return true
  // heic/heif/avif: ....ftypxxxx
  if (bytes.length >= 12 && ascii.slice(4, 8) === "ftyp" && /(heic|heix|hevc|hevx|mif1|msf1|avif|avis)/.test(ascii.slice(8, 16))) return true
  // svg 文本
  const trimmed = ascii.trimStart().toLowerCase()
  if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml")) return true

  return false
}

async function validateImageByContent(item: ResourceItem, referer: string): Promise<boolean> {
  const res = await fetchWithTimeout(item.url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Referer": referer,
      "Accept": "image/*,*/*",
      "Range": "bytes=0-63",
    }
  }, 5000)

  const ct = getContentType(res)
  if (res.status === 404 || res.status === 410 || hasEmptyBody(res) || isHtmlContentType(ct)) return false
  if (ct && !isOctetStream(ct) && !ct.includes("image")) return false
  if (!(res.ok || res.status === 206)) return false

  const bytes = await getResponseBytes(res)
  return hasImageSignature(bytes)
}

async function fetchWithTimeout(url: string, options: any, ms: number): Promise<any> {
  const p = fetch(url, options)
  const t = new Promise<any>((_, rej) => setTimeout(() => rej(new Error("Timeout")), ms))
  return Promise.race([p, t])
}

export async function validateResources(
  items: ResourceItem[],
  referer: string,
  onProgress?: (completed: number, total: number) => void
): Promise<ResourceItem[]> {
  const validResults: ResourceItem[] = []
  const CONCURRENCY_LIMIT = 15
  let completedCount = 0

  const fetchOptions = (method: string) => ({
    method,
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Referer": referer,
      "Accept": "*/*"
    }
  })

  for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
    const chunk = items.slice(i, i + CONCURRENCY_LIMIT)

    const chunkPromises = chunk.map(async (item) => {
      const isMedia = item.type === "video" || item.type === "audio"

      try {
        const res = await fetchWithTimeout(item.url, fetchOptions("HEAD"), 5000)
        const ct = getContentType(res)

        if (res.status === 404 || res.status === 410 || hasEmptyBody(res)) return null
        if (isHtmlContentType(ct)) return null

        if (res.ok) {
          if (item.type === "image" && (!ct || isOctetStream(ct))) {
            return await validateImageByContent(item, referer) ? item : null
          }
          return (!ct || isCompatibleContentType(item, ct)) ? item : null
        }

        const getOpts = fetchOptions("GET")
        // @ts-ignore
        getOpts.headers["Range"] = item.type === "image" ? "bytes=0-63" : "bytes=0-0"

        const getRes = await fetchWithTimeout(item.url, getOpts, 5000)
        const getCt = getContentType(getRes)

        if (getRes.status === 404 || getRes.status === 410 || hasEmptyBody(getRes) || isHtmlContentType(getCt)) return null
        if (getRes.ok || getRes.status === 206) {
          if (item.type === "image" && (!getCt || isOctetStream(getCt))) {
            const bytes = await getResponseBytes(getRes)
            return hasImageSignature(bytes) ? item : null
          }
          return (!getCt || isCompatibleContentType(item, getCt)) ? item : null
        }
        if (isMedia) return item
        return null
      } catch (e) {
        // 图片预览失败通常就是用户看到的“空预览”，过滤模式下不再保留这类图片。
        if (isMedia) return item
        return null
      }
    })

    const checkedChunk = await Promise.all(chunkPromises)
    for (const checkedItem of checkedChunk) {
      if (checkedItem !== null) validResults.push(checkedItem)
    }

    completedCount += chunk.length
    onProgress?.(Math.min(completedCount, items.length), items.length)
  }

  return validResults
}
