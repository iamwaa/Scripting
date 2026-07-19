// 封面图获取 —— 优先本地缓存，再网易云，最后 api.lrc.cx
import { cacheArtworkImage, getCachedArtworkPath } from "../utils/cache"

// 声明全局 fetch（运行时由 Scripting 提供，TS 类型库未内置 DOM）
declare const fetch: (input: string, init?: any) => Promise<any>

const NETEASE_BASE = "https://music.163.com/api"
const NETEASE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"
const NETEASE_HEADERS = {
  "User-Agent": NETEASE_UA,
  Referer: "https://music.163.com/",
}
// 与 cache 缩略尺寸一致
const COVER_PX = 240

/** 将网易云封面 URL 统一为指定尺寸 */
function withCoverSize(url: string, px: number = COVER_PX): string {
  if (/param=\d+y\d+/i.test(url)) {
    return url.replace(/param=\d+y\d+/i, `param=${px}y${px}`)
  }
  return `${url}${url.includes("?") ? "&" : "?"}param=${px}y${px}`
}

/** 网易云：搜索 songId → 详情取 album.picUrl → 下载封面 */
async function fetchCoverFromNetEase(
  title: string,
  artist: string,
): Promise<UIImage | null> {
  try {
    const searchUrl =
      `${NETEASE_BASE}/search/get/web?s=${encodeURIComponent(`${title} ${artist}`.trim())}` +
      "&type=1&limit=5"
    const searchResp: any = await fetch(searchUrl, { headers: NETEASE_HEADERS })
    if (!searchResp.ok) return null
    const searchData = await searchResp.json()
    const songs = searchData?.result?.songs
    if (!Array.isArray(songs) || songs.length === 0) return null
    const songId = songs[0]?.id
    if (!songId) return null

    const detailUrl = `${NETEASE_BASE}/song/detail?ids=[${songId}]`
    const detailResp: any = await fetch(detailUrl, { headers: NETEASE_HEADERS })
    if (!detailResp.ok) return null
    const detailData = await detailResp.json()
    const song = detailData?.songs?.[0]
    const picUrl: string | undefined = song?.album?.picUrl || song?.album?.blurPicUrl
    if (!picUrl) return null

    return await UIImage.fromURL(withCoverSize(picUrl))
  } catch {
    return null
  }
}

/** 备用：api.lrc.cx 封面接口 */
async function fetchCoverFromLrcCx(
  title: string,
  artist: string,
): Promise<UIImage | null> {
  try {
    const url =
      `https://api.lrc.cx/cover?title=${encodeURIComponent(title)}` +
      (artist ? `&artist=${encodeURIComponent(artist)}` : "")
    return await UIImage.fromURL(url)
  } catch {
    return null
  }
}

/**
 * 获取封面 JPEG 路径。
 * 优先级：本地缓存 → 网易云 → api.lrc.cx
 */
export async function fetchArtworkPath(
  title: string,
  artist: string,
): Promise<string | null> {
  if (!title) return null

  const cached = getCachedArtworkPath(title, artist)
  if (cached) return cached

  // 首选：网易云专辑封面
  const netease = await fetchCoverFromNetEase(title, artist)
  if (netease) {
    const path = await cacheArtworkImage(title, artist, netease)
    if (path) return path
  }

  // 备用：api.lrc.cx
  const lrc = await fetchCoverFromLrcCx(title, artist)
  if (lrc) {
    const path = await cacheArtworkImage(title, artist, lrc)
    if (path) return path
  }

  return null
}
