import { fetch } from 'scripting'
import { createStorageManager } from './storage'

// ONE 每日内容数据。保留原来的 BingImage 名称，避免牵动 UI 层导入。
export type BingImage = {
  startdate: string
  fullstartdate: string
  enddate: string
  url: string
  urlbase: string
  copyright: string
  copyrightlink: string
  title: string
  quiz: string
  wp: boolean
  hsh: string
  drk: number
  top: number
  bot: number
  hs: unknown[]
}

// ONE 页面解析后的响应。保留原来的响应名称，减少调用侧改动。
export type BingApiResponse = {
  images: BingImage[]
  tooltips: {
    loading: string
    previous: string
    next: string
    walle: string
    walls: string
  }
}

export type WallpaperData = {
  imageUrl: string
  title: string
  copyright: string
  copyrightLink: string
  date: string
  rawDate: string
}

export type BingApiConfig = {
  name: string
  url: string
  description: string
}

export type RefreshLogStatus = 'start' | 'success' | 'error'

export type RefreshLogEntry = {
  id: string
  timestamp: number
  status: RefreshLogStatus
  message: string
  forceRefresh: boolean
  nextRefreshAt?: number
  displayDate?: string
}

const MAX_REFRESH_LOGS = 20

export type WallpaperDisplayMode = 'latest' | 'manual'

export type BingSettings = {
  apiConfigIndex: number
  imageQuality: string
  selectedDate: string
  currentDisplayDate: string
  displayMode: WallpaperDisplayMode
  autoRefresh: boolean
  showTitle: boolean
  showCopyright: boolean
  cacheExpireTime: number
  refreshHour: number
  refreshMinute: number
}

export const bingApiConfigs: BingApiConfig[] = [
  {
    name: 'ONE · 一个',
    url: 'https://m.wufazhuce.com/index',
    description: '从 ONE · 一个移动站获取最近每日图片、标题、VOL 和日期',
  },
]

// ONE 图片地址由网站直接提供，保留设置项仅用于兼容旧配置。
export const imageQualityOptions: { label: string; value: string; resolution: string }[] = [
  { label: '原图', value: 'original', resolution: 'source' },
]

export const displayModeOptions: { label: string; value: WallpaperDisplayMode }[] = [
  { label: '最新内容', value: 'latest' },
  { label: '手动指定日期', value: 'manual' },
]

const ONE_HOME_URL = 'https://m.wufazhuce.com/'
const ONE_INDEX_URL = 'https://m.wufazhuce.com/index'

const STORAGE_NAME = 'OneDailyImage.Settings'

const STORAGE_KEYS = {
  SETTINGS: 'settings',
  LAST_UPDATE: 'lastUpdate',
  CACHED_DATA: 'cachedData',
  REFRESH_LOGS: 'refreshLogs',
} as const

const storageManager = createStorageManager(STORAGE_NAME)
const REFRESH_LEAD_TIME_MINUTES = 5
const REFRESH_LEAD_TIME_MS = REFRESH_LEAD_TIME_MINUTES * 60 * 1000
const RETRY_REFRESH_INTERVAL_MINUTES = 30
const RETRY_REFRESH_INTERVAL_MS = RETRY_REFRESH_INTERVAL_MINUTES * 60 * 1000

const DEFAULT_SETTINGS: BingSettings = {
  apiConfigIndex: 0,
  imageQuality: 'original',
  selectedDate: '',
  currentDisplayDate: '',
  displayMode: 'latest',
  autoRefresh: true,
  showTitle: true,
  showCopyright: true,
  cacheExpireTime: 24 * 60,
  refreshHour: 9,
  refreshMinute: 0,
}

const MONTH_MAP: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
}

const clampRefreshHour = (value: unknown): number => {
  const hour: number = Number(value)
  if (!Number.isFinite(hour)) return DEFAULT_SETTINGS.refreshHour
  return Math.min(23, Math.max(0, Math.floor(hour)))
}

const clampRefreshMinute = (value: unknown): number => {
  const minute: number = Number(value)
  if (!Number.isFinite(minute)) return DEFAULT_SETTINGS.refreshMinute
  return Math.min(59, Math.max(0, Math.floor(minute)))
}

export const getRefreshTimeParts = (
  settings: BingSettings = getCurrentSettings(),
): { hour: number; minute: number } => {
  return {
    hour: clampRefreshHour(settings.refreshHour),
    minute: clampRefreshMinute(settings.refreshMinute),
  }
}

export const formatRefreshTime = (settings: BingSettings = getCurrentSettings()): string => {
  const { hour, minute } = getRefreshTimeParts(settings)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export const setRefreshTime = (hour: number, minute: number): BingSettings => {
  return updateSettings((settings: BingSettings) => ({
    ...settings,
    refreshHour: clampRefreshHour(hour),
    refreshMinute: clampRefreshMinute(minute),
  }))
}

export const buildRefreshTimeDateValue = (
  settings: BingSettings = getCurrentSettings(),
): number => {
  const { hour, minute } = getRefreshTimeParts(settings)
  const date: Date = new Date()
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

export const getNextRefreshDate = (settings: BingSettings = getCurrentSettings()): Date => {
  const { hour, minute } = getRefreshTimeParts(settings)
  const now: Date = new Date()
  const nextRefreshDate: Date = new Date(now)

  nextRefreshDate.setHours(hour, minute, 0, 0)

  if (now.getTime() >= nextRefreshDate.getTime()) {
    nextRefreshDate.setDate(nextRefreshDate.getDate() + 1)
  }

  return nextRefreshDate
}

const decodeHtmlEntities = (value: string): string => {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

const stripHtml = (value: string): string => {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

const normalizeImageUrl = (url: string): string => {
  if (!url) return ''
  const decodedUrl: string = decodeHtmlEntities(url).trim()

  if (decodedUrl.startsWith('//')) {
    return `https:${decodedUrl}`
  }

  if (decodedUrl.startsWith('http://image.wufazhuce.com')) {
    return decodedUrl.replace('http://', 'https://')
  }

  return decodedUrl
}

const parseOneDate = (
  dateText: string,
): { rawDate: string; displayDate: string; monthText: string; vol: string } | null => {
  const normalizedDateText: string = stripHtml(dateText)
  const match: RegExpMatchArray | null = normalizedDateText.match(
    /^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})\s+(VOL\.\d+)$/,
  )

  if (!match) return null

  const month: string = MONTH_MAP[match[1]]
  if (!month) return null

  const day: string = match[2].padStart(2, '0')
  const year: string = match[3]
  const vol: string = match[4]

  return {
    rawDate: `${year}${month}${day}`,
    displayDate: `${year}年${month}月${day}日`,
    monthText: `${match[1]}. ${year}`,
    vol,
  }
}

const buildOneImage = ({
  rawDate,
  displayDate,
  monthText,
  vol,
  imageUrl,
  title,
  link,
}: {
  rawDate: string
  displayDate: string
  monthText: string
  vol: string
  imageUrl: string
  title: string
  link: string
}): BingImage => {
  const normalizedImageUrl: string = normalizeImageUrl(imageUrl)

  return {
    startdate: rawDate,
    fullstartdate: rawDate,
    enddate: rawDate,
    url: normalizedImageUrl,
    urlbase: normalizedImageUrl,
    copyright: `${vol} | ${displayDate}`,
    copyrightlink: link,
    title,
    quiz: '',
    wp: true,
    hsh: `${vol}-${rawDate}`,
    drk: 1,
    top: 1,
    bot: 1,
    hs: [{ vol, date: displayDate, month: monthText }],
  }
}

const parseIndexPage = (html: string): BingImage[] => {
  const itemMatches: RegExpMatchArray[] = Array.from(
    html.matchAll(/<div[^>]*class=["'][^"']*item-issue[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]*class=["'][^"']*item-issue[^"']*["']|------ 没有更多内容啦|<\/body>)/gi),
  )
  const images: BingImage[] = []

  for (const itemMatch of itemMatches) {
    const itemHtml: string = itemMatch[1]
    const dateMatch: RegExpMatchArray | null = itemHtml.match(
      /<p[^>]*class=["'][^"']*date[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
    )
    const imageMatch: RegExpMatchArray | null = itemHtml.match(
      /<img[^>]*class=["'][^"']*item-picture-img[^"']*["'][^>]*src=["']([^"']+)["']/i,
    )
    const titleMatch: RegExpMatchArray | null = itemHtml.match(
      /<p[^>]*class=["'][^"']*text-content-short[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
    )
    const linkMatch: RegExpMatchArray | null = itemHtml.match(
      /<a[^>]*class=["'][^"']*div-link[^"']*["'][^>]*href=["']([^"']+\/one\/[^"']+)["']/i,
    )

    if (!dateMatch || !imageMatch || !titleMatch) continue

    const parsedDate = parseOneDate(dateMatch[1])
    if (!parsedDate) continue

    const title: string = stripHtml(titleMatch[1])
    if (!title) continue

    images.push(
      buildOneImage({
        ...parsedDate,
        imageUrl: imageMatch[1],
        title,
        link: normalizeImageUrl(linkMatch?.[1] || ONE_HOME_URL),
      }),
    )
  }

  return images
}

const parseHomePage = (html: string): BingImage[] => {
  const title: string = stripHtml(
    html.match(/<p[^>]*id=["']quote["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '',
  )
  const day: string = stripHtml(
    html.match(/<p[^>]*class=["'][^"']*day[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '',
  )
  const monthText: string = stripHtml(
    html.match(/<p[^>]*class=["'][^"']*month[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '',
  )
  const imageUrl: string =
    html.match(/<div[^>]*class=["'][^"']*home-img[^"']*["'][^>]*style=["'][^"']*background-image:\s*url\(&quot;?([^"'&)]+)&quot;?\)/i)?.[1] ||
    html.match(/<div[^>]*class=["'][^"']*home-img[^"']*["'][^>]*style=["'][^"']*background-image:\s*url\(["']?([^"')]+)["']?\)/i)?.[1] ||
    html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    ''
  const monthMatch: RegExpMatchArray | null = monthText.match(/^(VOL\.\d+)\s*\|\s*([A-Z][a-z]{2})\.\s*(\d{4})$/)

  if (!title || !day || !imageUrl || !monthMatch) return []

  const month: string = MONTH_MAP[monthMatch[2]]
  if (!month) return []

  const rawDay: string = day.padStart(2, '0')
  const year: string = monthMatch[3]

  return [
    buildOneImage({
      rawDate: `${year}${month}${rawDay}`,
      displayDate: `${year}年${month}月${rawDay}日`,
      monthText: `${monthMatch[2]}. ${year}`,
      vol: monthMatch[1],
      imageUrl,
      title,
      link: ONE_HOME_URL,
    }),
  ]
}

export const getCurrentSettings = (): BingSettings => {
  try {
    const savedSettings = storageManager.storage.get<Partial<BingSettings>>(STORAGE_KEYS.SETTINGS)
    if (savedSettings) {
      return { ...DEFAULT_SETTINGS, ...savedSettings }
    }
  } catch {
  }

  return DEFAULT_SETTINGS
}

export const saveSettings = (settings: BingSettings): boolean => {
  try {
    storageManager.storage.set(STORAGE_KEYS.SETTINGS, settings)
    return true
  } catch {
    return false
  }
}

export const updateSettings = (
  updater: (settings: BingSettings) => BingSettings,
): BingSettings => {
  const currentSettings: BingSettings = getCurrentSettings()
  const nextSettings: BingSettings = updater(currentSettings)
  saveSettings(nextSettings)
  return nextSettings
}

export const getCurrentApiConfig = (): BingApiConfig => {
  const settings: BingSettings = getCurrentSettings()
  return bingApiConfigs[settings.apiConfigIndex] || bingApiConfigs[0]
}

// ONE 已提供最终图片地址，这里仅做协议规范化。
export const buildImageUrl = (urlbase: string): string => {
  return normalizeImageUrl(urlbase)
}

export const getTodayDateString = (): string => {
  const today: Date = new Date()
  return (
    today.getFullYear().toString() +
    (today.getMonth() + 1).toString().padStart(2, '0') +
    today.getDate().toString().padStart(2, '0')
  )
}

export const formatDate = (dateString: string): string => {
  if (dateString.length !== 8) return dateString

  const year: string = dateString.substring(0, 4)
  const month: string = dateString.substring(4, 6)
  const day: string = dateString.substring(6, 8)

  return `${year}年${month}月${day}日`
}

const mapImageToWallpaperData = (image: BingImage): WallpaperData => {
  return {
    imageUrl: buildImageUrl(image.urlbase || image.url),
    title: image.title,
    copyright: image.copyright,
    copyrightLink: image.copyrightlink,
    date: formatDate(image.enddate),
    rawDate: image.startdate,
  }
}

const getCachedData = (allowExpired: boolean = false): BingApiResponse | null => {
  try {
    const cached = storageManager.storage.get<{ data: BingApiResponse; timestamp: number }>(
      STORAGE_KEYS.CACHED_DATA,
    )
    if (!cached) return null

    if (!allowExpired) {
      const settings: BingSettings = getCurrentSettings()
      const now: number = Date.now()
      const cacheAge: number = (now - cached.timestamp) / 1000 / 60

      if (cacheAge > settings.cacheExpireTime) {
        return null
      }
    }

    return cached.data
  } catch {
    return null
  }
}

const saveCachedData = (data: BingApiResponse): void => {
  try {
    storageManager.storage.set(STORAGE_KEYS.CACHED_DATA, {
      data,
      timestamp: Date.now(),
    })
  } catch {
  }
}

const requestText = async (url: string): Promise<string> => {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  return response.text()
}

export const fetchBingWallpaper = async (
  forceRefresh: boolean = false,
): Promise<BingApiResponse> => {
  if (!forceRefresh) {
    const cachedData: BingApiResponse | null = getCachedData()
    if (cachedData) {
      return cachedData
    }
  }

  const apiConfig: BingApiConfig = getCurrentApiConfig()

  try {
    const indexHtml: string = await requestText(apiConfig.url || ONE_INDEX_URL)
    let images: BingImage[] = parseIndexPage(indexHtml)

    if (images.length === 0) {
      const homeHtml: string = await requestText(ONE_HOME_URL)
      images = parseHomePage(homeHtml)
    }

    if (images.length === 0) {
      throw new Error('ONE 页面解析结果为空')
    }

    const data: BingApiResponse = {
      images,
      tooltips: {
        loading: '加载中',
        previous: '上一期',
        next: '下一期',
        walle: 'ONE · 一个',
        walls: '每日内容',
      },
    }

    saveCachedData(data)
    storageManager.storage.set(STORAGE_KEYS.LAST_UPDATE, Date.now())

    return data
  } catch {
    const cachedData: BingApiResponse | null = getCachedData() || getCachedData(true)
    if (cachedData) {
      return cachedData
    }

    throw new Error('无法获取 ONE 每日内容，请检查网络连接')
  }
}

const resolveDisplayDate = (
  images: BingImage[],
  settings: BingSettings,
): { nextSettings: BingSettings; resolvedDate: string } => {
  const availableDates: string[] = images.map((item: BingImage) => item.startdate)
  const latestDate: string = availableDates[0] || ''
  let resolvedDate: string = latestDate
  let nextSettings: BingSettings = { ...settings }

  if (settings.displayMode === 'manual') {
    const manualDate: string = settings.selectedDate
    resolvedDate = availableDates.includes(manualDate) ? manualDate : latestDate
    nextSettings = {
      ...nextSettings,
      currentDisplayDate: resolvedDate,
      selectedDate: resolvedDate,
    }
    return { nextSettings, resolvedDate }
  }

  resolvedDate = latestDate
  nextSettings = {
    ...nextSettings,
    currentDisplayDate: resolvedDate,
  }

  return { nextSettings, resolvedDate }
}

export const getDisplayWallpaper = async (
  forceRefresh: boolean = false,
): Promise<WallpaperData> => {
  const data: BingApiResponse = await fetchBingWallpaper(forceRefresh)
  const settings: BingSettings = getCurrentSettings()
  const { nextSettings, resolvedDate } = resolveDisplayDate(data.images, settings)

  if (
    nextSettings.currentDisplayDate !== settings.currentDisplayDate ||
    nextSettings.selectedDate !== settings.selectedDate ||
    nextSettings.imageQuality !== settings.imageQuality
  ) {
    saveSettings(nextSettings)
  }

  const selectedImage: BingImage =
    data.images.find((image: BingImage) => image.startdate === resolvedDate) || data.images[0]

  return mapImageToWallpaperData(selectedImage)
}

export const getTodayWallpaper = async (
  forceRefresh: boolean = false,
): Promise<WallpaperData> => {
  const data: BingApiResponse = await fetchBingWallpaper(forceRefresh)
  const todayStr: string = getTodayDateString()

  const todayImage: BingImage =
    data.images.find((img: BingImage) => img.startdate === todayStr) || data.images[0]

  return mapImageToWallpaperData(todayImage)
}

export const getWallpaperByDate = async (
  dateString: string,
): Promise<WallpaperData | null> => {
  const data: BingApiResponse = await fetchBingWallpaper()

  const image: BingImage | undefined = data.images.find(
    (img: BingImage) => img.startdate === dateString,
  )

  if (!image) {
    return null
  }

  return mapImageToWallpaperData(image)
}

export const getAllWallpapers = async (): Promise<WallpaperData[]> => {
  const data: BingApiResponse = await fetchBingWallpaper()

  return data.images.map((image: BingImage) => mapImageToWallpaperData(image))
}

export const setDisplayMode = (displayMode: WallpaperDisplayMode): BingSettings => {
  return updateSettings((settings: BingSettings) => {
    if (displayMode === 'manual') {
      const selectedDate: string = settings.selectedDate || settings.currentDisplayDate
      return {
        ...settings,
        displayMode,
        selectedDate,
        currentDisplayDate: selectedDate,
      }
    }

    return {
      ...settings,
      displayMode,
    }
  })
}

export const setManualWallpaperDate = (rawDate: string): BingSettings => {
  return updateSettings((settings: BingSettings) => ({
    ...settings,
    selectedDate: rawDate,
    currentDisplayDate: rawDate,
    displayMode: 'manual',
  }))
}

export const clearCache = (): void => {
  try {
    storageManager.storage.remove(STORAGE_KEYS.CACHED_DATA)
  } catch {
  }
}

export const getLastUpdateTime = (): number | null => {
  return storageManager.storage.get<number>(STORAGE_KEYS.LAST_UPDATE) || null
}

export const clearLastUpdateTime = (): void => {
  try {
    storageManager.storage.remove(STORAGE_KEYS.LAST_UPDATE)
  } catch {
  }
}

export const getRefreshLogs = (): RefreshLogEntry[] => {
  try {
    return storageManager.storage.get<RefreshLogEntry[]>(STORAGE_KEYS.REFRESH_LOGS) || []
  } catch {
    return []
  }
}

export const addRefreshLog = (entry: Omit<RefreshLogEntry, 'id' | 'timestamp'>): void => {
  try {
    const logs: RefreshLogEntry[] = getRefreshLogs()
    const nextLogs: RefreshLogEntry[] = [
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
      },
      ...logs,
    ].slice(0, MAX_REFRESH_LOGS)

    storageManager.storage.set(STORAGE_KEYS.REFRESH_LOGS, nextLogs)
  } catch {
  }
}

export const clearRefreshLogs = (): void => {
  try {
    storageManager.storage.remove(STORAGE_KEYS.REFRESH_LOGS)
  } catch {
  }
}

const getRefreshWindowStartTimestamp = (): number => {
  const nowTimestamp: number = Date.now()
  const now: Date = new Date(nowTimestamp)
  const settings: BingSettings = getCurrentSettings()
  const { hour, minute } = getRefreshTimeParts(settings)
  const todayRefreshDate: Date = new Date(now)
  const tomorrowRefreshDate: Date = new Date(now)

  todayRefreshDate.setHours(hour, minute, 0, 0)
  tomorrowRefreshDate.setDate(tomorrowRefreshDate.getDate() + 1)
  tomorrowRefreshDate.setHours(hour, minute, 0, 0)

  const todayWindowStart: number = todayRefreshDate.getTime() - REFRESH_LEAD_TIME_MS
  const tomorrowWindowStart: number = tomorrowRefreshDate.getTime() - REFRESH_LEAD_TIME_MS

  return nowTimestamp >= tomorrowWindowStart ? tomorrowWindowStart : todayWindowStart
}

export const getRetryRefreshDate = (): Date => {
  return new Date(Date.now() + RETRY_REFRESH_INTERVAL_MS)
}

export const shouldRetryRefreshAfterFetch = (wallpaperData: WallpaperData): boolean => {
  const settings: BingSettings = getCurrentSettings()
  if (!settings.autoRefresh || settings.displayMode !== 'latest') return false

  const nowTimestamp: number = Date.now()
  const refreshWindowStart: number = getRefreshWindowStartTimestamp()

  if (nowTimestamp < refreshWindowStart) {
    return false
  }

  const todayDate: string = getTodayDateString()
  return !!wallpaperData.rawDate && wallpaperData.rawDate < todayDate
}

// 到达或临近每日刷新时间后，如果最新内容还不是今天，则持续触发强制刷新。
export const shouldRefresh = (): boolean => {
  const settings: BingSettings = getCurrentSettings()
  if (!settings.autoRefresh) return false

  const nowTimestamp: number = Date.now()
  const refreshWindowStart: number = getRefreshWindowStartTimestamp()

  if (nowTimestamp < refreshWindowStart) {
    return false
  }

  if (settings.displayMode === 'latest') {
    const todayDate: string = getTodayDateString()
    if (!settings.currentDisplayDate || settings.currentDisplayDate < todayDate) {
      return true
    }
  }

  const lastUpdate: number | null = getLastUpdateTime()
  if (!lastUpdate) return true

  return lastUpdate < refreshWindowStart
}

export const BingSettingsManager = {
  getImageQuality: (): string => {
    const settings: BingSettings = getCurrentSettings()
    return settings.imageQuality
  },

  setImageQuality: (quality: string): void => {
    const settings: BingSettings = getCurrentSettings()
    saveSettings({
      ...settings,
      imageQuality: quality,
    })
  },

  getSelectedDate: (): string => {
    const settings: BingSettings = getCurrentSettings()
    return settings.selectedDate
  },

  setSelectedDate: (date: string): void => {
    const settings: BingSettings = getCurrentSettings()
    saveSettings({
      ...settings,
      selectedDate: date,
    })
  },

  getCurrentDisplayDate: (): string => {
    const settings: BingSettings = getCurrentSettings()
    return settings.currentDisplayDate
  },

  setCurrentDisplayDate: (date: string): void => {
    const settings: BingSettings = getCurrentSettings()
    saveSettings({
      ...settings,
      currentDisplayDate: date,
    })
  },

  getDisplayMode: (): WallpaperDisplayMode => {
    const settings: BingSettings = getCurrentSettings()
    return settings.displayMode
  },

  setDisplayMode: (displayMode: WallpaperDisplayMode): void => {
    setDisplayMode(displayMode)
  },

  getShowTitle: (): boolean => {
    const settings: BingSettings = getCurrentSettings()
    return settings.showTitle
  },

  setShowTitle: (value: boolean): void => {
    const settings: BingSettings = getCurrentSettings()
    saveSettings({
      ...settings,
      showTitle: value,
    })
  },

  getShowCopyright: (): boolean => {
    const settings: BingSettings = getCurrentSettings()
    return settings.showCopyright
  },

  setShowCopyright: (value: boolean): void => {
    const settings: BingSettings = getCurrentSettings()
    saveSettings({
      ...settings,
      showCopyright: value,
    })
  },

  getRefreshTimeValue: (): number => {
    return buildRefreshTimeDateValue()
  },

  getRefreshTimeLabel: (): string => {
    return formatRefreshTime()
  },

  setRefreshTime: (timestamp: number): void => {
    const date: Date = new Date(timestamp)
    setRefreshTime(date.getHours(), date.getMinutes())
  },
}
