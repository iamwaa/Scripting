// ==UserScript==
// @name Web Resource Extractor Runtime Sniffer
// @name:zh-CN 网页资源提取器
// @description Capture runtime images, media and network resources for Web Resource Extractor.
// @description:zh-CN 为网页资源提取器捕获运行后的图片、视频和网络资源。
// @match *://*/*
// @run-at document-start
// @grant GM.registerMenuCommand
// @grant GM.log
// @grant GM.setValue
// @grant GM.openInTab
// ==/UserScript==

declare const GM: {
  log: (...args: any[]) => void
  registerMenuCommand: (name: string, callback: () => void) => number
  setValue: (key: string, value: any) => Promise<void>
  openInTab: (url: string, options?: boolean | Record<string, any>) => Promise<any>
}
declare const document: any
declare const window: any
declare const location: any
declare const performance: any
declare const XMLHttpRequest: any
declare const MutationObserver: any
declare const alert: (message: string) => void

type AnyElement = any

type ResourceType = "image" | "video" | "audio" | "css" | "js" | "font" | "document" | "archive" | "other" | "unknown"

type RuntimeCandidate = {
  url: string
  type: ResourceType
  tag?: string
  width?: number
  height?: number
}

type RuntimeSnapshot = {
  pageUrl: string
  title: string
  capturedAt: number
  resources: RuntimeCandidate[]
}

const SNAPSHOT_STORAGE_KEY = "runtimeSnapshot"
const MAX_RESOURCES = 800
const STORE_DELAY_MS = 900

const candidates = new Map<string, RuntimeCandidate>()
let storeTimer: any = null

function absolutize(rawUrl: string | null | undefined): string {
  if (!rawUrl) return ""
  const trimmed = rawUrl.trim()
  if (!trimmed || trimmed === "#" || /^(javascript:|mailto:|tel:|about:)/i.test(trimmed)) return ""
  if (/^(https?:|blob:|data:)/i.test(trimmed)) return trimmed
  try {
    return new URL(trimmed, location.href).href
  } catch {
    return ""
  }
}

function classify(url: string, initiatorType?: string): ResourceType {
  const lower = url.toLowerCase().split("#")[0]
  if (/\.(jpg|jpeg|png|gif|webp|svg|heic|heif|bmp|ico|avif|tiff)(?:\?|$)/.test(lower)) return "image"
  if (/\.(mp4|webm|m3u8|mov|m4v|avi|mkv|flv|ts|m4s)(?:\?|$)/.test(lower)) return "video"
  if (/\.(mp3|wav|ogg|m4a|aac|flac)(?:\?|$)/.test(lower)) return "audio"
  if (/\.(css)(?:\?|$)/.test(lower)) return "css"
  if (/\.(js|mjs)(?:\?|$)/.test(lower)) return "js"
  if (/\.(woff2?|ttf|otf|eot)(?:\?|$)/.test(lower)) return "font"
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|md|csv)(?:\?|$)/.test(lower)) return "document"
  if (/\.(zip|rar|7z|tar|gz|bz2)(?:\?|$)/.test(lower)) return "archive"
  if (/m3u8|hls|playlist|\/video\/|\/stream\//i.test(lower)) return "video"

  switch (initiatorType) {
    case "img": return "image"
    case "video": return "video"
    case "audio": return "audio"
    case "css": return "css"
    case "script": return "js"
    case "link": return lower.includes("font") ? "font" : "unknown"
    default: return "unknown"
  }
}

function addCandidate(rawUrl: string | null | undefined, type?: ResourceType, details: Partial<RuntimeCandidate> = {}) {
  const url = absolutize(rawUrl)
  if (!url || url.startsWith("data:")) return
  if (candidates.size >= MAX_RESOURCES && !candidates.has(url)) return

  const previous = candidates.get(url)
  const nextType = type && type !== "unknown" ? type : classify(url)
  candidates.set(url, {
    ...previous,
    ...details,
    url,
    type: previous?.type && previous.type !== "unknown" ? previous.type : nextType,
  })
  scheduleStore()
}

function addSrcset(srcset: string | null | undefined, type: ResourceType, tag: string) {
  if (!srcset) return
  srcset.split(",").forEach(item => {
    const url = item.trim().split(/\s+/)[0]
    addCandidate(url, type, { tag })
  })
}

function collectDomResources() {
  document.querySelectorAll("img").forEach((img: AnyElement) => {
    const el = img
    addCandidate(el.currentSrc || el.src, "image", {
      tag: "img",
      width: el.naturalWidth || el.width || undefined,
      height: el.naturalHeight || el.height || undefined,
    })
    addSrcset(el.getAttribute("srcset"), "image", "img")
    ;["data-src", "data-original", "data-lazy-src", "data-actualsrc", "data-hi-res-src"].forEach(attr => {
      addCandidate(el.getAttribute(attr), "image", { tag: "img" })
    })
  })

  document.querySelectorAll("source").forEach((source: AnyElement) => {
    const el = source
    const parentTag = el.parentElement?.tagName.toLowerCase()
    const type: ResourceType = parentTag === "video" ? "video" : parentTag === "audio" ? "audio" : "image"
    addCandidate(el.src, type, { tag: "source" })
    addSrcset(el.getAttribute("srcset"), type, "source")
  })

  document.querySelectorAll("video").forEach((video: AnyElement) => {
    const el = video
    addCandidate(el.currentSrc || el.src, "video", { tag: "video" })
    addCandidate(el.poster, "image", { tag: "video-poster" })
  })

  document.querySelectorAll("audio").forEach((audio: AnyElement) => {
    const el = audio
    addCandidate(el.currentSrc || el.src, "audio", { tag: "audio" })
  })

  document.querySelectorAll("link[href]").forEach((link: AnyElement) => {
    const el = link
    const rel = (el.rel || "").toLowerCase()
    if (rel.includes("stylesheet")) addCandidate(el.href, "css", { tag: "link" })
    else if (rel.includes("icon") || rel.includes("preload") && (el as any).as === "image") addCandidate(el.href, "image", { tag: "link" })
  })

  document.querySelectorAll("script[src]").forEach((script: AnyElement) => {
    addCandidate(script.src, "js", { tag: "script" })
  })

  document.querySelectorAll("[style]").forEach((el: AnyElement) => {
    const style = el.getAttribute("style") || ""
    collectCssUrls(style)
  })
}

function collectCssUrls(text: string) {
  const regex = /url\(["']?([^"')]+)["']?\)/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    addCandidate(match[1], classify(match[1]), { tag: "css" })
  }
}

function collectPerformanceResources() {
  if (!performance?.getEntriesByType) return
  performance.getEntriesByType("resource").forEach((entry: any) => {
    const item = entry
    addCandidate(item.name, classify(item.name, item.initiatorType), { tag: `perf:${item.initiatorType || "resource"}` })
  })
}

function hookNetwork() {
  const originalFetch = window.fetch
  window.fetch = function(input: any, init?: any) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    addCandidate(url, classify(url), { tag: "fetch" })
    return originalFetch.apply(this, arguments as any).then((response: any) => {
      const contentType = response.headers?.get("content-type") || ""
      if (/application\/vnd\.apple\.mpegurl|mpegurl|x-mpegurl/i.test(contentType)) {
        addCandidate(response.url || url, "video", { tag: "fetch:m3u8" })
      }
      return response
    })
  }

  const originalOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function(method: string, url: any) {
    const href = typeof url === "string" ? url : url.href
    ;(this as any).__wreUrl = href
    addCandidate(href, classify(href), { tag: "xhr" })
    return originalOpen.apply(this, arguments as any)
  }

  const originalSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function() {
    this.addEventListener("load", () => {
      const url = (this as any).__wreUrl || this.responseURL
      const contentType = this.getResponseHeader("content-type") || ""
      if (/application\/vnd\.apple\.mpegurl|mpegurl|x-mpegurl/i.test(contentType)) {
        addCandidate(url, "video", { tag: "xhr:m3u8" })
      }
    })
    return originalSend.apply(this, arguments as any)
  }
}

function observeMutations() {
  const observer = new MutationObserver(() => collectDomResources())
  const start = () => {
    if (!document.documentElement) return
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "href", "style", "poster", "data-src", "data-original", "data-lazy-src"],
    })
  }
  if (document.documentElement) start()
  else document.addEventListener("DOMContentLoaded", start, { once: true })
}

function makeSnapshot(): RuntimeSnapshot {
  return {
    pageUrl: location.href,
    title: document.title || location.href,
    capturedAt: Date.now(),
    resources: Array.from(candidates.values()),
  }
}

async function storeSnapshot() {
  storeTimer = null
  collectDomResources()
  collectPerformanceResources()
  try {
    await GM.setValue(SNAPSHOT_STORAGE_KEY, makeSnapshot())
    GM.log(`Web Resource Extractor captured ${candidates.size} resources`)
  } catch (err) {
    GM.log("Web Resource Extractor failed to store snapshot", String(err))
  }
}

function scheduleStore() {
  if (storeTimer) return
  storeTimer = setTimeout(storeSnapshot, STORE_DELAY_MS)
}

hookNetwork()
observeMutations()

const collectNow = async () => {
  collectDomResources()
  collectPerformanceResources()
  await storeSnapshot()
}

document.addEventListener("DOMContentLoaded", () => {
  collectNow()
})
window.addEventListener("load", () => {
  collectNow()
  setTimeout(collectNow, 1500)
  setTimeout(collectNow, 3500)
})

try {
  GM.registerMenuCommand("提取当前页资源", async () => {
    GM.log("准备启动主应用...")
    await collectNow()
    const scriptName = "网页资源提取器"
    const currentUrl = location.href
    const urlScheme = `scripting://run/${encodeURIComponent(scriptName)}?url=${encodeURIComponent(currentUrl)}`
    GM.log("启动 URL:", urlScheme)
    await GM.openInTab(urlScheme, { active: true })
  })
  GM.log("Web Resource Extractor 菜单已注册")
} catch (err) {
  GM.log("菜单注册失败:", String(err))
}
