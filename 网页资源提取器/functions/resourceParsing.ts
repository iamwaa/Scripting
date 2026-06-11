import type { ResourceItem } from "../types/resource"
import { WebURL } from "../utils/WebURL"

export const DIRECT_RESOURCE_EXTS: Record<string, ResourceItem["type"]> = {
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
  ".heic": "image",
  ".heif": "image",
  ".bmp": "image",
  ".ico": "image",
  ".tiff": "image",
  ".avif": "image",
  ".mp4": "video",
  ".webm": "video",
  ".m3u8": "video",
  ".mov": "video",
  ".avi": "video",
  ".mkv": "video",
  ".flv": "video",
  ".mp3": "audio",
  ".wav": "audio",
  ".ogg": "audio",
  ".m4a": "audio",
  ".aac": "audio",
  ".flac": "audio",
  ".woff": "font",
  ".woff2": "font",
  ".ttf": "font",
  ".otf": "font",
  ".eot": "font",
  ".pdf": "document",
  ".doc": "document",
  ".docx": "document",
  ".xls": "document",
  ".xlsx": "document",
  ".ppt": "document",
  ".pptx": "document",
  ".zip": "archive",
  ".rar": "archive",
  ".7z": "archive",
  ".tar": "archive",
  ".gz": "archive",
}

export const TYPE_LABELS: Record<ResourceItem["type"], string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  font: "字体",
  document: "文档",
  archive: "压缩包",
  css: "样式",
  js: "脚本",
  other: "其他",
}

export function detectDirectResourceType(targetURL: string): ResourceItem["type"] | null {
  const urlPathLower = targetURL.split("?")[0].split("#")[0].toLowerCase()
  for (const [ext, type] of Object.entries(DIRECT_RESOURCE_EXTS)) {
    if (urlPathLower.endsWith(ext)) return type
  }
  return null
}

export function getResourceFileName(rawURL: string, baseURL?: string): string {
  try {
    const parsed = new WebURL(baseURL ? normalizeResourceURL(rawURL, baseURL) : rawURL)
    const segments = parsed.pathname.split("/").filter(Boolean)
    const last = segments[segments.length - 1]
    return last && last.length < 50
      ? decodeURIComponent(last)
      : `resource_${parsed.hostname}_${Math.floor(Math.random() * 1000)}`
  } catch {
    const clean = rawURL.split("?")[0].split("#")[0]
    const segments = clean.split("/")
    const last = segments[segments.length - 1]
    return last && last.length < 50
      ? decodeURIComponent(last)
      : `unknown_resource_${Math.floor(Math.random() * 1000)}`
  }
}

export function unescapeUrl(raw: string): string {
  if (!raw) return ""
  return raw
    .replace(/\\u002F/gi, "/")
    .replace(/\\x2F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\x26/gi, "&")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
}

export function cleanExtractedUrl(text: string): string {
  const trimmed = text.trim()
  if (/^(https?:\/\/|data:|\/\/|\/|javascript:|mailto:|tel:)/i.test(trimmed)) return trimmed
  const urlMatch = trimmed.match(/https?:\/\/[^"'\s\\<>{}\[\]]+/i)
  if (urlMatch) return urlMatch[0]
  return trimmed
}

export function normalizeResourceURL(rawURL: string, targetURL: string): string {
  if (!rawURL) return ""
  const raw = cleanExtractedUrl(unescapeUrl(rawURL))
  if (!raw || raw === "#" || raw.startsWith("#") || /^(javascript:|mailto:|tel:|about:)/i.test(raw)) return ""
  if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return raw
  if (raw.startsWith("//")) return `https:${raw}`

  try {
    return new WebURL(raw, targetURL).href
  } catch {
    const originMatch = targetURL.match(/^(https?:\/\/[^\/]+)/i)
    const origin = originMatch ? originMatch[1] : ""
    if (raw.startsWith("/")) return origin + raw
    const basePath = targetURL.split("?")[0].split("#")[0].replace(/\/[^\/]*$/, "")
    return basePath + "/" + raw
  }
}

function extractUrlsFromCss(cssText: string): string[] {
  const urls: string[] = []
  const urlRegex = /url\(["']?([^"')]+)["']?\)/gi
  let match: RegExpExecArray | null
  while ((match = urlRegex.exec(cssText)) !== null) {
    urls.push(match[1])
  }
  // 匹配 image-set() 中不带 url() 包裹的图片路径（新版语法）
  const imageSetRegex = /(?:-webkit-)?image-set\(\s*["']([^"']+\.(?:jpg|jpeg|png|gif|webp|avif|svg))["']/gi
  while ((match = imageSetRegex.exec(cssText)) !== null) {
    urls.push(match[1])
  }
  return urls
}

function getCssUrlType(rawUrl: string): ResourceItem["type"] {
  const cleanUrl = rawUrl.toLowerCase().split("?")[0].split("#")[0]
  if (/\.(woff2?|ttf|otf|eot)$/.test(cleanUrl)) return "font"
  return "image"
}

function extractSrcsetUrls(srcsetText: string): string[] {
  return srcsetText
    .split(",")
    .map(item => item.trim().split(/\s+/)[0])
    .filter(Boolean)
}

/**
 * 尝试将图片缩略图 URL 升级为更高清版本
 * 去除常见的尺寸/质量/缩略图后缀和路径段
 */
function upgradeImageURL(url: string): string {
  let u = url
  // 去掉缩略图路径段
  u = u.replace(/\/(thumb(nail)?|small|preview|缩略)\//gi, "/")
  // 去掉尺寸后缀：_300x300, -300x300, !300x300
  u = u.replace(/[!_\-]\d{2,4}[xX×]\d{2,4}/g, "")
  // 去掉 CDN resize 参数
  u = u.replace(/([?&])(w|h|width|height|size|resize|thumb)size?=[^&]*/gi, "$1")
  u = u.replace(/\/resize,[^/]+/gi, "")
  // 去掉质量参数：?quality=75, !q75
  u = u.replace(/[!?&]q(?:uality)?=\d+/gi, "")
  // 去掉 _thumb 后缀：photo_thumb.jpg → photo.jpg
  u = u.replace(/[_-]thumb(nail)?\.(jpg|jpeg|png|webp)/gi, ".$2")
  // 去掉 Blogger/Google 的 /s150/, /w150/ 路径段
  u = u.replace(/\/[sw]\d{2,4}\//gi, "/")
  return u
}

/**
 * 启发式判断图片 URL 是否疑似图标/缩略图
 */
function isLikelyThumbnail(url: string): boolean {
  const lower = url.toLowerCase()
  // 文件名/路径中包含图标关键词
  if (/\b(icon|logo|favicon|sprite|avatar|emoji|badge|button|arrow|bullet|loading|placeholder)\b/i.test(lower)) return true
  // 路径中包含尺寸暗示（<=100px）
  if (/\/(s|w|h|size)[-_]?(1[0-9]|[1-9][0-9])\b/.test(lower)) return true
  if (/[!_\-](1[0-9]|[1-9][0-9])[xX×](1[0-9]|[1-9][0-9])/.test(lower)) return true
  // 常见缩略图路径关键词
  if (/\/(thumb|thumbnail|preview|small|mini|micro|tiny)\//i.test(lower)) return true
  return false
}

export function parseHtmlResources(html: string, targetURL: string, onStatus?: (message: string) => void): ResourceItem[] {
  const results: ResourceItem[] = []
  const seen: Record<string, boolean> = {}

  function addResource(type: ResourceItem["type"], rawURL: string) {
    const normalized = normalizeResourceURL(rawURL, targetURL)
    if (!normalized || normalized.startsWith("data:") || seen[normalized]) return
    // 避免把页面自身、锚点、占位符等误判为图片资源，导致列表里出现空预览。
    if (type === "image") {
      const clean = normalized.split("?")[0].split("#")[0]
      const targetClean = targetURL.split("?")[0].split("#")[0]
      if (clean === targetClean) return
    }

    // 对图片 URL 尝试升级为更高清版本
    let finalUrl = normalized
    if (type === "image") {
      const upgraded = upgradeImageURL(normalized)
      if (upgraded !== normalized) {
        if (seen[upgraded]) return // 已有高清版本，跳过低清重复
        finalUrl = upgraded
      }
    }

    seen[finalUrl] = true
    const likelyThumbnail = type === "image" ? isLikelyThumbnail(finalUrl) : false
    results.push({ type, url: finalUrl, name: getResourceFileName(finalUrl, targetURL), likelyThumbnail })
  }

  function scanMatches(regex: RegExp, type: ResourceItem["type"], source: string) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(source)) !== null) {
      addResource(type, match[1])
    }
  }

  const imgSrcRegex = /<img[^>]+(?:src|data-(?:src|original|lazy-src|lazy|echo|bg|background|actualsrc|original-src|zi-src|ks-lazyload|hi-res-src))\s*=\s*["']([^"']+)["']/gi
  const srcsetRegex = /<source[^>]+srcset\s*=\s*["']([^"']+)["']/gi
  const imgSrcsetRegex = /<img[^>]+srcset\s*=\s*["']([^"']+)["']/gi
  const styleAttrRegex = /style\s*=\s*["']([^"']+)["']/gi
  const styleBlockRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi
  const iconRegex = /<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]+href\s*=\s*["']([^"']+)["']/gi
  const preloadImageRegex = /<link[^>]+rel\s*=\s*["'][^"']*preload[^"']*["'][^>]+as\s*=\s*["']image["'][^>]+href\s*=\s*["']([^"']+)["']/gi
  const ogRegex = /<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']+)["']/gi
  const twitterImageRegex = /<meta[^>]+(?:name|property)\s*=\s*["']twitter:image(?::src)?["'][^>]+content\s*=\s*["']([^"']+)["']/gi
  const appleTouchIconRegex = /<link[^>]+rel\s*=\s*["']apple-touch-icon(?:-precomposed)?["'][^>]+href\s*=\s*["']([^"']+)["']/gi
  const wechatDataSrcRegex = /\bdata-src\s*=\s*["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|gif|webp|svg)(?:\?[^"']*)?)["']/gi
  const cssRegex = /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]+href\s*=\s*["']([^"']+)["']/gi
  const cssExtRegex = /(?:href|src|data[^=]*)\s*=\s*["']([^"']+\.css(?:\?[^"']*)?)["']/gi
  const jsRegex = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi
  const jsExtRegex = /(?:href|src|data[^=]*)\s*=\s*["']([^"']+\.js(?:\?[^"']*)?)["']/gi
  const videoSrcRegex = /<video[^>]+(?:src|poster)\s*=\s*["']([^"']+)["']/gi
  const videoBlockRegex = /<video[^>]*>([\s\S]*?)<\/video>/gi
  const videoExtRegex = /(?:href|src|data[^=]*)\s*=\s*["']([^"']+\.(?:mp4|webm|m3u8|mov|avi|mkv|flv)(?:\?[^"']*)?)["']/gi
  const audioSrcRegex = /<audio[^>]+src\s*=\s*["']([^"']+)["']/gi
  const audioBlockRegex = /<audio[^>]*>([\s\S]*?)<\/audio>/gi
  const audioExtRegex = /(?:href|src|data[^=]*)\s*=\s*["']([^"']+\.(?:mp3|wav|ogg|m4a|aac|flac)(?:\?[^"']*)?)["']/gi
  const fontRegex = /url\(["']?([^"')]+\.(woff2?|ttf|otf|eot))["']?\)/gi
  const docExtRegex = /(?:href|src|data[^=]*)\s*=\s*["']([^"']+\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|csv)(?:\?[^"']*)?)["']/gi
  const archiveExtRegex = /(?:href|src|data[^=]*)\s*=\s*["']([^"']+\.(?:zip|rar|7z|tar|gz|bz2)(?:\?[^"']*)?)["']/gi
  const otherExtRegex = /(?:href|src|data[^=]*)\s*=\s*["']([^"']+\.(?:apk|ipa|exe|dmg|pkg|iso|json|xml)(?:\?[^"']*)?)["']/gi

  onStatus?.("正在提取图片与内联样式资源...")
  let match: RegExpExecArray | null
  scanMatches(imgSrcRegex, "image", html)
  while ((match = srcsetRegex.exec(html)) !== null) {
    extractSrcsetUrls(match[1]).forEach((url) => addResource("image", url))
  }
  while ((match = imgSrcsetRegex.exec(html)) !== null) {
    extractSrcsetUrls(match[1]).forEach((url) => addResource("image", url))
  }

  while ((match = styleAttrRegex.exec(html)) !== null) {
    extractUrlsFromCss(match[1]).forEach((url) => addResource(getCssUrlType(url), url))
  }
  while ((match = styleBlockRegex.exec(html)) !== null) {
    extractUrlsFromCss(match[1]).forEach((url) => addResource(getCssUrlType(url), url))
  }

  scanMatches(iconRegex, "image", html)
  scanMatches(appleTouchIconRegex, "image", html)
  scanMatches(preloadImageRegex, "image", html)
  scanMatches(ogRegex, "image", html)
  scanMatches(twitterImageRegex, "image", html)
  scanMatches(wechatDataSrcRegex, "image", html)

  onStatus?.("正在提取样式资源...")
  scanMatches(cssRegex, "css", html)
  scanMatches(cssExtRegex, "css", html)

  onStatus?.("正在提取脚本资源...")
  scanMatches(jsRegex, "js", html)
  scanMatches(jsExtRegex, "js", html)

  onStatus?.("正在提取视频资源...")
  scanMatches(videoSrcRegex, "video", html)
  let videoBlock: RegExpExecArray | null
  while ((videoBlock = videoBlockRegex.exec(html)) !== null) {
    const sourceRegex = /<source[^>]+src\s*=\s*["']([^"']+)["']/gi
    let srcMatch: RegExpExecArray | null
    while ((srcMatch = sourceRegex.exec(videoBlock[1])) !== null) addResource("video", srcMatch[1])
  }
  scanMatches(videoExtRegex, "video", html)

  onStatus?.("正在提取音频资源...")
  scanMatches(audioSrcRegex, "audio", html)
  let audioBlock: RegExpExecArray | null
  while ((audioBlock = audioBlockRegex.exec(html)) !== null) {
    const sourceRegex = /<source[^>]+src\s*=\s*["']([^"']+)["']/gi
    let srcMatch: RegExpExecArray | null
    while ((srcMatch = sourceRegex.exec(audioBlock[1])) !== null) addResource("audio", srcMatch[1])
  }
  scanMatches(audioExtRegex, "audio", html)

  onStatus?.("正在提取字体资源...")
  scanMatches(fontRegex, "font", html)
  onStatus?.("正在提取文档资源...")
  scanMatches(docExtRegex, "document", html)
  onStatus?.("正在提取压缩包资源...")
  scanMatches(archiveExtRegex, "archive", html)
  onStatus?.("正在提取其他类型附件...")
  scanMatches(otherExtRegex, "other", html)

  onStatus?.("正在执行深度全局扫描...")
  const decodedHtml = unescapeUrl(html)
  const globalUrlRegex = /(?:https?:)?\/\/[^"'\s\\<>{}\[\]]+/gi
  const relativePathRegex = /["'](\/[^"'\s\\<>{}\[\]]+\.(?:mp4|webm|m3u8|mov|avi|mkv|flv|mp3|wav|ogg|m4a|aac|flac|jpg|jpeg|png|gif|webp|svg|heic|heif|bmp|ico|avif|tiff|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|csv|zip|rar|7z|tar|gz|bz2|woff2?|ttf|otf|eot|css|js))["']/gi

  function processFoundUrl(raw: string, forceType?: ResourceItem["type"]) {
    const foundUrl = cleanExtractedUrl(unescapeUrl(raw.replace(/[,;。]+$/, "")))
    const cleanPath = foundUrl.split("?")[0].split("#")[0].toLowerCase()

    if (forceType) {
      addResource(forceType, foundUrl)
      return
    }

    if (/\.(mp4|webm|m3u8|mov|avi|mkv|flv)$/.test(cleanPath)) addResource("video", foundUrl)
    else if (/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(cleanPath)) addResource("audio", foundUrl)
    else if (/\.(jpg|jpeg|png|gif|webp|svg|heic|heif|bmp|ico|avif|tiff)$/.test(cleanPath)) addResource("image", foundUrl)
    else if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|csv)$/.test(cleanPath)) addResource("document", foundUrl)
    else if (/\.(zip|rar|7z|tar|gz|bz2)$/.test(cleanPath)) addResource("archive", foundUrl)
    else if (/\.(woff2?|ttf|otf|eot)$/.test(cleanPath)) addResource("font", foundUrl)
    else if (/\/video\/|\/stream\/|getvideo/i.test(cleanPath)) addResource("video", foundUrl)
    else if (/\/audio\/|\/music\//i.test(cleanPath)) addResource("audio", foundUrl)
  }

  let globalMatch: RegExpExecArray | null
  while ((globalMatch = globalUrlRegex.exec(decodedHtml)) !== null) processFoundUrl(globalMatch[0])

  let relMatch: RegExpExecArray | null
  while ((relMatch = relativePathRegex.exec(decodedHtml)) !== null) processFoundUrl(relMatch[1])

  return results
}
