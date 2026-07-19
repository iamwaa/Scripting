// 多源歌词 API 调用
// 优先级：网易云 → LrcApi（https://api.lrc.cx/lyrics）→ LRCLIB
import type { LyricData, LyricLine } from "../types"
import { parseLrc } from "../utils/lrc"
import { cacheLyrics, getCachedLyrics } from "../utils/cache"

// 声明全局 fetch（运行时由 Scripting 提供，TS 类型库未内置 DOM）
declare const fetch: (input: string, init?: any) => Promise<any>

// 首选：网易云音乐公开接口
const NETEASE_BASE = "https://music.163.com/api"
const NETEASE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"
// 备选 1：LrcApi 公开接口，返回纯 LRC 文本
const LRCAPI_BASE = "https://api.lrc.cx/lyrics"
// 备选 2：LRCLIB，免费、无需 API Key 的开源歌词数据库
const LRCLIB_BASE = "https://lrclib.net/api"

type LrcLibGetResponse = {
  syncedLyrics?: string | null
  plainLyrics?: string | null
}

type LrcLibSearchItem = {
  trackName: string
  artistName: string
  albumName?: string
  duration?: number
  syncedLyrics?: string | null
  plainLyrics?: string | null
}

/** 将歌词文本与同步标志构造成 LyricData */
function buildData(
  title: string,
  artist: string,
  albumTitle: string | undefined,
  synced: string | null | undefined,
  plain: string | null | undefined,
): LyricData {
  // 优先使用同步歌词；没有则退化为纯歌词（单行、time=0）
  if (synced) {
    const lines: LyricLine[] = parseLrc(synced)
    if (lines.length > 0) {
      return { title, artist, albumTitle, lines, synced: true }
    }
  }
  return {
    title,
    artist,
    albumTitle,
    lines: plain ? [{ time: 0, text: plain.trim() }] : [],
    synced: false,
  }
}

/** 首选：网易云，先搜索 songId 再取 LRC 歌词 */
async function fetchFromNetEase(
  title: string,
  artist: string,
  albumTitle: string | undefined,
): Promise<LyricData | null> {
  try {
    // 1) 搜索获取 songId
    const searchUrl =
      `${NETEASE_BASE}/search/get/web?s=${encodeURIComponent(`${title} ${artist}`.trim())}` +
      "&type=1&limit=5"
    const searchResp: any = await fetch(searchUrl, {
      headers: {
        "User-Agent": NETEASE_UA,
        Referer: "https://music.163.com/",
      },
    })
    if (!searchResp.ok) return null
    const searchData = await searchResp.json()
    const songs = searchData?.result?.songs
    if (!Array.isArray(songs) || songs.length === 0) return null
    const songId = songs[0]?.id
    if (!songId) return null

    // 2) 获取歌词
    const lyricUrl = `${NETEASE_BASE}/song/lyric?id=${songId}&lv=1&tv=-1`
    const lyricResp: any = await fetch(lyricUrl, {
      headers: {
        "User-Agent": NETEASE_UA,
        Referer: "https://music.163.com/",
      },
    })
    if (!lyricResp.ok) return null
    const lyricData = await lyricResp.json()
    const lrcText: string | undefined = lyricData?.lrc?.lyric
    const plainText: string | undefined = lyricData?.tlyric?.lyric

    if (lrcText) {
      const lines = parseLrc(lrcText)
      if (lines.length > 0) {
        return { title, artist, albumTitle, lines, synced: true }
      }
    }
    // 无同步歌词时，尝试用译文/纯文本兜底
    if (plainText?.trim()) {
      return buildData(title, artist, albumTitle, null, plainText)
    }
  } catch {
    // 网易云失败时继续尝试下一个来源
  }
  return null
}

/** 备选 1：LrcApi，返回纯 LRC 文本，成功则解析为同步歌词 */
async function fetchFromLrcApi(
  title: string,
  artist: string,
  albumTitle: string | undefined,
): Promise<LyricData | null> {
  try {
    const url =
      `${LRCAPI_BASE}?title=${encodeURIComponent(title)}` +
      (artist ? `&artist=${encodeURIComponent(artist)}` : "")
    const resp: any = await fetch(url)
    if (!resp.ok) return null
    const text: string = await resp.text()
    const lines = parseLrc(text)
    if (lines.length > 0) {
      return { title, artist, albumTitle, lines, synced: true }
    }
  } catch {
    // LrcApi 失败时继续尝试下一个来源
  }
  return null
}

/** 备选 2：LRCLIB，先 /get 精确匹配，失败再走 /search 模糊搜索取第一条 */
async function fetchFromLrcLib(
  title: string,
  artist: string,
  albumTitle: string | undefined,
  duration: number | undefined,
): Promise<LyricData | null> {
  // 精确获取（推荐带时长，命中率更高）
  try {
    const url =
      `${LRCLIB_BASE}/get?track_name=${encodeURIComponent(title)}` +
      `&artist_name=${encodeURIComponent(artist)}` +
      (albumTitle ? `&album_name=${encodeURIComponent(albumTitle)}` : "") +
      (duration ? `&duration=${Math.round(duration)}` : "")
    const resp: any = await fetch(url)
    if (resp.ok) {
      const data = (await resp.json()) as LrcLibGetResponse
      if (data.syncedLyrics || data.plainLyrics) {
        return buildData(title, artist, albumTitle, data.syncedLyrics, data.plainLyrics)
      }
    }
  } catch {
    // 精确获取失败则继续走搜索兜底
  }

  // 模糊搜索兜底，取第一条有歌词的结果
  try {
    const url =
      `${LRCLIB_BASE}/search?track_name=${encodeURIComponent(title)}` +
      (artist ? `&artist_name=${encodeURIComponent(artist)}` : "")
    const resp: any = await fetch(url)
    if (!resp.ok) return null
    const list = (await resp.json()) as LrcLibSearchItem[]
    for (const item of list) {
      if (item.syncedLyrics || item.plainLyrics) {
        return buildData(
          item.trackName || title,
          item.artistName || artist,
          item.albumName,
          item.syncedLyrics,
          item.plainLyrics,
        )
      }
    }
  } catch {
    // LRCLIB 失败时维持无歌词结果
  }
  return null
}

/** 根据歌曲信息获取歌词。先查本地缓存，未命中则按优先级：网易云 → LrcApi → LRCLIB 获取。 */
export async function fetchLyrics(params: {
  title: string
  artist: string
  albumTitle?: string
  duration?: number
}): Promise<LyricData | null> {
  const { title, artist, albumTitle, duration } = params
  if (!title) return null

  // 先读本地文件缓存，命中则复用，避免重复拉取
  const cached = await getCachedLyrics(title, artist)
  if (cached) return cached

  // 首选 网易云
  const primary = await fetchFromNetEase(title, artist, albumTitle)
  if (primary) {
    cacheLyrics(title, artist, primary)
    return primary
  }

  // 备选 1 LrcApi
  const secondary = await fetchFromLrcApi(title, artist, albumTitle)
  if (secondary) {
    cacheLyrics(title, artist, secondary)
    return secondary
  }

  // 备选 2 LRCLIB
  const tertiary = await fetchFromLrcLib(title, artist, albumTitle, duration)
  if (tertiary) cacheLyrics(title, artist, tertiary)
  return tertiary
}
