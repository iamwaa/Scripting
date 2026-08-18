import { fetch } from "scripting"
import type { ResourceItem } from "../../types/resource"
import { sanitizeFileName } from "../../utils/fileName"
import type { SiteParser, SiteParseContext, SiteParseResult } from "./types"

const MOBILE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
const VIDEO_ADDRESS_KEYS = ["play_addr_h264", "play_addr", "download_addr", "playAddr", "downloadAddr"]
const IMAGE_ADDRESS_KEYS = ["url_list", "urlList", "download_url_list", "downloadUrlList", "watermark_free_download_url_list"]

type DouyinCollected = {
  title: string
  videoUrls: string[]
  imageUrls: string[]
  coverUrls: string[]
}

function createCollected(): DouyinCollected {
  return { title: "", videoUrls: [], imageUrls: [], coverUrls: [] }
}

function addUnique(target: string[], value: unknown) {
  if (typeof value !== "string") return
  const url = value.replace(/\\u002F/gi, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&").trim()
  if (!/^https?:\/\//i.test(url) || target.includes(url)) return
  // 排除 CSS/JS/字体等非媒体资源
  if (/\.(css|js|woff2?|ttf|svg|ico|m3u8)(?:\?|#|$)/i.test(url)) return
  if (/\/static\/(?:css|js)\//i.test(url)) return
  target.push(url)
}

function collectAddress(value: unknown, target: string[]) {
  if (typeof value === "string") {
    addUnique(target, value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectAddress(item, target))
    return
  }
  if (!value || typeof value !== "object") return

  const record = value as Record<string, unknown>
  for (const key of [...IMAGE_ADDRESS_KEYS, "uri", "url"]) {
    if (record[key] !== undefined) collectAddress(record[key], target)
  }
}

function collectImageEntries(value: unknown, target: string[]) {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    for (const key of ["display_image", "displayImage", "origin_image", "originImage", "download_url", "downloadUrl", ...IMAGE_ADDRESS_KEYS]) {
      if (record[key] !== undefined) collectAddress(record[key], target)
    }
  }
}

function collectData(root: unknown, result: DouyinCollected) {
  const visited = new Set<object>()

  function walk(value: unknown, depth: number) {
    if (depth > 18 || !value || typeof value !== "object") return
    const objectValue = value as object
    if (visited.has(objectValue)) return
    visited.add(objectValue)

    if (Array.isArray(value)) {
      value.forEach(item => walk(item, depth + 1))
      return
    }

    const record = value as Record<string, unknown>
    if (!result.title) {
      for (const key of ["desc", "description", "title", "share_title", "shareTitle"]) {
        if (typeof record[key] === "string" && record[key]!.trim()) {
          result.title = String(record[key]).trim()
          break
        }
      }
    }

    for (const key of VIDEO_ADDRESS_KEYS) {
      if (record[key] !== undefined) collectAddress(record[key], result.videoUrls)
    }
    if (Array.isArray(record.bit_rate)) {
      for (const bitrate of record.bit_rate) {
        if (!bitrate || typeof bitrate !== "object") continue
        const item = bitrate as Record<string, unknown>
        collectAddress(item.play_addr || item.playAddr, result.videoUrls)
      }
    }

    collectImageEntries(record.images, result.imageUrls)
    const imagePost = record.image_post_info || record.imagePostInfo
    if (imagePost && typeof imagePost === "object") {
      collectImageEntries((imagePost as Record<string, unknown>).images, result.imageUrls)
    }

    for (const key of ["cover", "origin_cover", "dynamic_cover", "poster_url", "video_cover"]) {
      if (record[key] !== undefined) collectAddress(record[key], result.coverUrls)
    }

    Object.values(record).forEach(item => walk(item, depth + 1))
  }

  walk(root, 0)
}

function decodeEntities(value: string): string {
  return value.replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
}

function extractCanonicalUrl(html: string): string | undefined {
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1]
  if (!canonical) return undefined

  const decoded = decodeEntities(canonical).trim()
  return /^https?:\/\/(?:www\.)?douyin\.com\/(?:video|note)\/\d+/i.test(decoded)
    ? decoded
    : undefined
}

function parseJsonText(text: string): unknown | null {
  const candidates = [text.trim(), decodeEntities(text.trim())]
  try {
    candidates.push(decodeURIComponent(text.trim()))
  } catch {}

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {}
  }
  return null
}

function collectStaticData(html: string, result: DouyinCollected) {
  const scriptRegex = /<script[^>]*(?:id=["'](?:RENDER_DATA|__UNIVERSAL_DATA_FOR_REHYDRATION__)["']|type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = scriptRegex.exec(html)) !== null) {
    const parsed = parseJsonText(match[1])
    if (parsed) collectData(parsed, result)
  }

  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
  if (!result.title && title) result.title = decodeEntities(title).trim()
}

async function waitForWebViewLoad(webView: WebViewController): Promise<void> {
  // 等待首屏加载，最多 8 秒
  try {
    await Promise.race([
      webView.waitForLoad?.()?.then(() => true)?.catch(() => false) ?? Promise.resolve(false),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 8000)),
    ])
  } catch {}
}

// 在 WebView 内调用抖音 Web API 获取作品详情，利用 WebView 的 cookies 和 referer 上下文
async function fetchAwemeDetailInWebView(webView: WebViewController, awemeId: string): Promise<string | null> {
  const escapedId = JSON.stringify(awemeId)
  return webView.evaluateJavaScript<string | null>(`
    (async () => {
      const awemeId = ${escapedId}
      const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms))
      const fetchDetail = async () => {
        const params = new URLSearchParams({
          device_platform: 'webapp', channel: 'channel_pc_web',
          update_version_code: '170400', pc_client_type: '1',
          version_code: '290100', version_name: '29.1.0',
          cookie_enabled: 'true',
          screen_width: String(window.screen?.width || 390),
          screen_height: String(window.screen?.height || 844),
          browser_language: navigator.language || 'zh-CN',
          browser_platform: navigator.platform || 'iPhone',
          browser_name: 'Safari', browser_version: '18.0',
          browser_online: String(navigator.onLine),
          engine_name: 'WebKit', engine_version: '605.1.15',
          os_name: 'iOS', os_version: '18',
          cpu_core_num: String(navigator.hardwareConcurrency || 8),
          device_memory: '8', platform: 'PC',
          downlink: '10', effective_type: '4g', round_trip_time: '200',
          support_h265: '1', support_dash: '1', uifid: '',
          aweme_id: awemeId, aid: '6383',
        })
        for (const endpoint of ['/aweme/v1/web/aweme/detail/', 'https://www.douyin.com/aweme/v1/web/aweme/detail/']) {
          try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 1800)
            const response = await fetch(endpoint + '?' + params.toString(), {
              credentials: 'include', signal: controller.signal,
              headers: { accept: 'application/json, text/plain, */*' },
            })
            clearTimeout(timer)
            if (!response.ok) continue
            const json = await response.json()
            if (json?.aweme_detail) return JSON.stringify(json)
          } catch (e) {}
        }
        return null
      }
      return await Promise.race([fetchDetail(), timeout(4500)])
    })()
  `)
}

function extractAwemeId(url: string): string | null {
  return url.match(/\/(?:share\/)?(?:video|note|gallery|slides)\/(\d{15,20})/)?.[1]
    || url.match(/[?&](?:modal_id|aweme_id|item_id)=(\d{15,20})/)?.[1]
    || null
}

async function collectWebViewData(url: string, result: DouyinCollected) {
  const webView = new WebViewController({ ephemeral: true })
  try {
    webView.setCustomUserAgent(MOBILE_USER_AGENT)
    const loaded = await webView.loadURL(url)
    if (!loaded) return

    // 等待首屏加载稳定
    await waitForWebViewLoad(webView)
    await new Promise<void>(resolve => setTimeout(resolve, 2500))

    // 激活视频节点触发数据加载
    await webView.evaluateJavaScript(`
      (async () => {
        const video = document.querySelector('video')
        if (video) {
          try { video.muted = true; await video.play() } catch (e) {}
        }
      })()
    `)
    await new Promise<void>(resolve => setTimeout(resolve, 4000))

    // 读取页面内嵌数据和全局变量
    const snapshot = await webView.evaluateJavaScript<any>(`
      const mediaEntries = performance.getEntriesByType('resource')
        .map((item) => item.name)
        .filter((name) => ['video','playwm','/play/','mp4','douyinvod','tos-cn','douyinpic'].some((t) => name.includes(t)))
      const scripts = Array.from(document.scripts)
        .map((s) => s.textContent || '')
        .filter((text) => ['aweme_detail','play_addr','bit_rate','playwm','video_id','_ROUTER_DATA','videoInfoRes','image_post_info','images'].some((t) => text.includes(t)))
        .slice(0, 8).map((text) => text.slice(0, 12000))
      let routerDataJSON = null, videoInfoResJSON = null
      try {
        if (typeof window._ROUTER_DATA !== 'undefined') {
          routerDataJSON = JSON.stringify(window._ROUTER_DATA)
          const loaderValues = Object.values(window._ROUTER_DATA?.loaderData || {})
          const matched = loaderValues.find((item) => item?.videoInfoRes)?.videoInfoRes
          if (matched) videoInfoResJSON = JSON.stringify(matched)
        }
      } catch (e) {}
      try {
        if (!videoInfoResJSON && typeof window.videoInfoRes !== 'undefined') {
          videoInfoResJSON = JSON.stringify(window.videoInfoRes)
        }
      } catch (e) {}
      const videos = Array.from(document.querySelectorAll('video')).map(item => ({
        src: item.currentSrc || item.src || '',
        poster: item.poster || ''
      }))
      const images = Array.from(document.images).map(img => img.currentSrc || img.src).filter(Boolean).slice(0, 80)
      const canonical = document.querySelector('link[rel="canonical"]')?.href || null
      return {
        title: document.title || '',
        videos, images, canonical,
        routerDataJSON, videoInfoResJSON,
        resourceHints: scripts,
        performanceMedia: mediaEntries,
      }
    `)

    if (!snapshot || typeof snapshot !== "object") return
    if (!result.title && typeof snapshot.title === "string") result.title = snapshot.title.trim()

    // 视频标签 src
    if (Array.isArray(snapshot.videos)) {
      for (const item of snapshot.videos) {
        addUnique(result.videoUrls, item?.src)
        addUnique(result.coverUrls, item?.poster)
      }
    }

    // performance 资源请求中的媒体 URL（排除 CSS/JS）
    if (Array.isArray(snapshot.performanceMedia)) {
      for (const url of snapshot.performanceMedia) {
        if (typeof url !== "string") continue
        // 只保留真正的视频流 URL，排除 CSS/JS/字体等
        if (/\/(?:playwm|play)\//i.test(url) || /douyinvod|aweme\.snssdk\.com\/aweme\/v1\/play/i.test(url)) {
          addUnique(result.videoUrls, url)
        }
      }
    }

    // DOM 图片
    if (Array.isArray(snapshot.images)) {
      for (const url of snapshot.images) {
        if (typeof url === "string" && /douyinpic|tos-cn|p3-sign/i.test(url)) {
          addUnique(result.imageUrls, url)
        }
      }
    }

    // 解析 _ROUTER_DATA 和 videoInfoRes 中的结构化数据
    for (const jsonStr of [snapshot.routerDataJSON, snapshot.videoInfoResJSON]) {
      if (typeof jsonStr === "string" && jsonStr) {
        try {
          collectData(JSON.parse(jsonStr), result)
        } catch {}
      }
    }

    // script 标签中的内嵌数据
    if (Array.isArray(snapshot.resourceHints)) {
      for (const hint of snapshot.resourceHints) {
        if (typeof hint !== "string") continue
        try {
          collectData(JSON.parse(hint), result)
        } catch {}
      }
    }

    // 仍无资源时，尝试在 WebView 内调用抖音 Web API
    if (result.videoUrls.length === 0 && result.imageUrls.length === 0) {
      const awemeId = extractAwemeId(snapshot.canonical || url)
      if (awemeId) {
        const apiJSON = await fetchAwemeDetailInWebView(webView, awemeId)
        if (apiJSON) {
          try { collectData(JSON.parse(apiJSON), result) } catch {}
        }
      }
    }
  } finally {
    webView.dispose()
  }
}

function preferPlayableVideo(urls: string[]): string[] {
  return [...urls].sort((a, b) => {
    const score = (value: string) => {
      // 真正的播放 API URL 最高优先
      if (/aweme\/v1\/play/i.test(value)) return 5
      if (/\/play\//i.test(value)) return 4
      if (/\/playwm\//i.test(value)) return 3
      // CDN 视频流
      if (/douyinvod/i.test(value)) return 2
      // 其他
      return 0
    }
    return score(b) - score(a)
  })
}

function makeResources(context: SiteParseContext, collected: DouyinCollected): ResourceItem[] {
  const headers = { "User-Agent": MOBILE_USER_AGENT, Referer: context.url }
  const title = sanitizeFileName(collected.title.replace(/[-_]?抖音.*$/i, "").trim() || "douyin", "douyin")
  const resources: ResourceItem[] = []

  preferPlayableVideo(collected.videoUrls).forEach((url, index) => {
    resources.push({
      type: "video",
      url,
      name: `${title}${index > 0 ? `_${index + 1}` : ""}.mp4`,
      source: "douyin",
      quality: index === 0 ? "推荐" : undefined,
      headers,
    })
  })

  collected.imageUrls.forEach((url, index) => {
    resources.push({
      type: "image",
      url,
      name: `${title}_${index + 1}.jpg`,
      source: "douyin",
      headers,
    })
  })

  collected.coverUrls.forEach((url, index) => {
    if (collected.imageUrls.includes(url)) return
    resources.push({
      type: "image",
      url,
      name: `${title}_cover${index > 0 ? `_${index + 1}` : ""}.jpg`,
      source: "douyin",
      likelyThumbnail: true,
      headers,
    })
  })

  return resources
}

async function fetchCanonicalPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": MOBILE_USER_AGENT } })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

async function parseDouyin(context: SiteParseContext): Promise<SiteParseResult> {
  const collected = createCollected()
  const pageUrl = extractCanonicalUrl(context.html)
  const shouldFollowPage = pageUrl && pageUrl.split("#")[0] !== context.url.split("#")[0]
  collectStaticData(context.html, collected)

  // 分享页提取到 canonical 但当前 HTML 无资源时，跟随 canonical 重新解析
  if (shouldFollowPage && pageUrl) {
    const canonicalHtml = await fetchCanonicalPage(pageUrl)
    if (canonicalHtml) collectStaticData(canonicalHtml, collected)
  }

  // canonical 跟随后仍无资源，且当前已不在 canonical 页面时，用 WebView 兜底
  if (collected.videoUrls.length === 0 && collected.imageUrls.length === 0) {
    await collectWebViewData(shouldFollowPage && pageUrl ? pageUrl : context.url, collected)
  }

  return {
    resources: makeResources(context, collected),
    title: collected.title || undefined,
    pageUrl,
  }
}

export const douyinParser: SiteParser = {
  id: "douyin",
  matches(url) {
    const host = url.match(/^https?:\/\/([^/:?#]+)/i)?.[1] || ""
    return /(?:^|\.)(?:douyin|iesdouyin)\.com$/i.test(host)
  },
  parse: parseDouyin,
}
