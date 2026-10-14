import { Path, fetch } from "scripting"

import { DATA_DIR, LOCAL_APP_SECRET, decryptPayload, encryptPayload, generateId } from "./utils"

// --- 图标库类型 ---
export type IconLibraryEntry = { name: string; url: string }
export type IconLibrary = {
  id: string
  name: string
  url: string
  icons: IconLibraryEntry[]
  updatedAt?: number
  lastError?: string
}

// --- 存储路径 ---
const LIBRARIES_FILE = Path.join(DATA_DIR, "icon_libraries.json")
// 图标缓存放在 App Group 目录：图片体积大，避免随 iCloud 同步
const ICON_CACHE_DIR = Path.join(FileManager.appGroupDocumentsDirectory, "icon_cache")
// 单个图标体积上限，防止把大图或错误页面写进缓存
const MAX_ICON_BYTES = 2 * 1024 * 1024
// 图标库超过该时长视为过期，打开选择器时自动刷新
export const LIBRARY_STALE_MS = 7 * 24 * 60 * 60 * 1000

const isRemoteUrl = (url?: string): boolean => /^https?:\/\//i.test((url || "").trim())

const hostOf = (url: string): string => url.replace(/^https?:\/\//i, "").split(/[/?#]/)[0] || url

// --- 图标缓存 ---
// FNV 双哈希：把图标 URL 映射为稳定的短文件名，避免路径特殊字符与长度问题
const hashUrl = (url: string): string => {
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
}

const cacheFilePath = (url: string): string => Path.join(ICON_CACHE_DIR, hashUrl(url))

// 本次运行已确认存在的缓存路径，避免同一图标重复读盘
const resolvedPaths = new Map<string, string>()

// 取图标本地缓存路径（同步，供渲染路径直接使用），未缓存返回 null
export const getCachedIconPath = (url?: string): string | null => {
  const key = (url || "").trim()
  if (!isRemoteUrl(key)) return null
  const memo = resolvedPaths.get(key)
  if (memo) return memo
  const path = cacheFilePath(key)
  if (!FileManager.existsSync(path)) return null
  resolvedPaths.set(key, path)
  return path
}

// 兜底判断：部分图床不返回 Content-Type，用文件头确认是否为图片
const looksLikeImage = (data: Data): boolean => {
  const head = data.toHexString().slice(0, 8).toLowerCase()
  return ["89504e47", "ffd8ff", "47494638", "52494646", "00000100", "424d", "3c737667", "3c3f786d"].some(prefix => head.startsWith(prefix))
}

const downloadIcon = async (url: string): Promise<string | null> => {
  // 加超时：卡住的请求会一直占着下载队列的并发名额
  const response = await fetch(url, { timeout: 20 })
  if (!response.ok) return null
  const mime = response.mimeType || ""
  const data = await response.data()
  if (!data) return null
  const bytes = data.size ?? 0
  if (bytes <= 0 || bytes > MAX_ICON_BYTES) return null
  if (!mime.startsWith("image/") && !looksLikeImage(data)) return null
  const path = cacheFilePath(url)
  if (!FileManager.existsSync(ICON_CACHE_DIR)) FileManager.createDirectorySync(ICON_CACHE_DIR, true)
  FileManager.writeAsDataSync(path, data)
  resolvedPaths.set(url, path)
  return path
}

// --- 下载调度 ---
// 图标库动辄数百上千个图标，而列表并不保证只渲染可见行（onAppear 才可靠地只在可见时触发），
// 不限流就可能同时发起大量请求，搜索结果里的图标只能排在队尾慢慢加载。
// 这里统一走带并发上限的优先队列：搜索命中的图标走 high，其余（列表触发的下载）走 normal。
const MAX_CONCURRENT_DOWNLOADS = 6

export type DownloadPriority = "high" | "normal"

type DownloadTask = {
  url: string
  priority: DownloadPriority
  running: boolean
  canceled: boolean
  promise: Promise<string | null>
  resolve: (path: string | null) => void
}

const highQueue: DownloadTask[] = []
const normalQueue: DownloadTask[] = []
// url -> 排队中或下载中的任务：同一图标只下载一次，多处请求共享同一个 Promise
const pendingTasks = new Map<string, DownloadTask>()
let runningDownloads = 0

const queueOf = (priority: DownloadPriority): DownloadTask[] => (priority === "high" ? highQueue : normalQueue)

// 每次有空闲并发就从高优先级队列取，普通队列垫底
const pumpDownloads = () => {
  while (runningDownloads < MAX_CONCURRENT_DOWNLOADS) {
    const task = highQueue.shift() || normalQueue.shift()
    if (!task) return
    if (task.canceled) continue
    task.running = true
    runningDownloads++
    downloadIcon(task.url)
      .catch(() => null) // 失败不写缓存，下次挂载仍会重试
      .then(path => {
        pendingTasks.delete(task.url)
        runningDownloads--
        task.resolve(path)
        pumpDownloads()
      })
  }
}

const enqueueDownload = (url: string, priority: DownloadPriority): DownloadTask => {
  let resolve!: (path: string | null) => void
  const promise = new Promise<string | null>(r => { resolve = r })
  const task: DownloadTask = { url, priority, running: false, canceled: false, promise, resolve }
  pendingTasks.set(url, task)
  queueOf(priority).push(task)
  pumpDownloads()
  return task
}

// 已排队但还没开始的任务直接换队列，让后来变得重要的图标（滚到可见、被搜索命中）先下载
const promoteDownload = (task: DownloadTask, priority: DownloadPriority) => {
  if (task.priority === priority) return
  if (!task.running) {
    const queue = queueOf(task.priority)
    const index = queue.indexOf(task)
    if (index >= 0) queue.splice(index, 1)
    queueOf(priority).push(task)
  }
  task.priority = priority
}

// 取消尚未开始的排队任务；已经开始的下载不打断，调用方会拿到 null 回退远程加载
const cancelDownload = (task: DownloadTask) => {
  if (task.running || pendingTasks.get(task.url) !== task) return
  task.canceled = true
  const queue = queueOf(task.priority)
  const index = queue.indexOf(task)
  if (index >= 0) queue.splice(index, 1)
  pendingTasks.delete(task.url)
  task.resolve(null)
}

// 解析图标本地路径：命中缓存直接返回，否则排队下载并缓存；失败返回 null，由调用方回退远程加载
export const resolveIconPath = async (url?: string): Promise<string | null> => {
  const cached = getCachedIconPath(url)
  if (cached) return cached
  const key = (url || "").trim()
  if (!isRemoteUrl(key)) return null
  const pending = pendingTasks.get(key)
  if (pending) return pending.promise
  return enqueueDownload(key, "normal").promise
}

export type IconPrefetch = { cancel: () => void }

// 预取一批图标（默认高优先级，可插到整个图标库前面），用于「搜索命中」与「滚动到可见」的图标。
// 返回的句柄用 cancel() 丢弃还没开始的排队任务，避免关键词变化后旧的一批还占着队列。
export const prefetchIcons = (urls: string[], priority: DownloadPriority = "high"): IconPrefetch => {
  const created: DownloadTask[] = []
  for (const raw of urls) {
    const key = (raw || "").trim()
    if (!isRemoteUrl(key) || getCachedIconPath(key)) continue
    const pending = pendingTasks.get(key)
    if (pending) { promoteDownload(pending, priority); continue }
    created.push(enqueueDownload(key, priority))
  }
  return { cancel: () => { for (const task of created) cancelDownload(task) } }
}

export const getIconCacheInfo = async (): Promise<{ count: number; bytes: number }> => {
  try {
    if (!(await FileManager.exists(ICON_CACHE_DIR))) return { count: 0, bytes: 0 }
    // readDirectory 返回的是文件名，需要拼回目录
    const files = (await FileManager.readDirectory(ICON_CACHE_DIR)).map(name => Path.join(ICON_CACHE_DIR, name))
    let bytes = 0
    for (const file of files) {
      try { bytes += (await FileManager.stat(file)).size || 0 } catch {}
    }
    return { count: files.length, bytes }
  } catch { return { count: 0, bytes: 0 } }
}

export const clearIconCache = async (): Promise<void> => {
  try {
    if (await FileManager.exists(ICON_CACHE_DIR)) await FileManager.remove(ICON_CACHE_DIR)
  } catch {}
  resolvedPaths.clear()
}

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// --- 图标库订阅 ---
// 订阅地址支持两种 JSON 结构：{ name, icons: [{ name, url }] } 或直接是图标数组
const normalizeEntries = (raw: unknown): IconLibraryEntry[] => {
  if (!Array.isArray(raw)) return []
  const entries: IconLibraryEntry[] = []
  for (const item of raw) {
    if (typeof item === "string") {
      if (isRemoteUrl(item)) entries.push({ name: hostOf(item), url: item.trim() })
      continue
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>
      const url = typeof record.url === "string" ? record.url.trim() : ""
      if (!isRemoteUrl(url)) continue
      const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : hostOf(url)
      entries.push({ name, url })
    }
  }
  return entries
}

// selfh.st/icons 风格：每项形如 { Name, Reference, PNG: "Yes" }，图标位于同级 png/<Reference>.png
const buildReferenceEntries = (list: unknown[], indexUrl: string): IconLibraryEntry[] => {
  const base = indexUrl.trim().replace(/[?#].*$/, "").replace(/\/[^/]*$/, "")
  if (!/^https?:\/\//i.test(base)) return []
  const entries: IconLibraryEntry[] = []
  for (const item of list) {
    const record = item as Record<string, unknown>
    const reference = typeof record?.Reference === "string" ? record.Reference.trim() : ""
    if (!reference) continue
    // 无 PNG 版本的条目跳过，避免存入无法显示的 SVG 地址
    if (typeof record.PNG === "string" && record.PNG.trim().toLowerCase() !== "yes") continue
    const name = typeof record.Name === "string" && record.Name.trim() ? record.Name.trim() : reference
    entries.push({ name, url: `${base}/png/${encodeURIComponent(reference)}.png` })
  }
  return entries
}

export const fetchIconLibrary = async (url: string): Promise<{ name: string | null; icons: IconLibraryEntry[] }> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const json = await response.json()
  const list: unknown = Array.isArray(json) ? json : json?.icons
  let icons = normalizeEntries(list)
  // 兼容 selfh.st/icons 索引：条目只有 Reference，按订阅地址同级的 png/ 目录拼出图标地址
  if (icons.length === 0 && Array.isArray(list)) icons = buildReferenceEntries(list, url)
  if (icons.length === 0) throw new Error("未解析到图标")
  const name = !Array.isArray(json) && typeof json?.name === "string" && json.name.trim() ? json.name.trim() : null
  return { name, icons }
}

// 校验外部（备份）带来的图标库数据，丢弃结构不正确的部分
export const normalizeIconLibraries = (raw: unknown): IconLibrary[] => {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((lib): lib is IconLibrary => !!lib && typeof lib === "object" && typeof (lib as IconLibrary).url === "string" && !!((lib as IconLibrary).url || "").trim())
    .map(lib => ({
      id: typeof lib.id === "string" && lib.id ? lib.id : generateId(),
      name: typeof lib.name === "string" && lib.name.trim() ? lib.name.trim() : hostOf(lib.url.trim()),
      url: lib.url.trim(),
      icons: normalizeEntries(lib.icons),
      updatedAt: typeof lib.updatedAt === "number" ? lib.updatedAt : undefined,
    }))
}

export const loadIconLibraries = async (): Promise<IconLibrary[]> => {
  try {
    if (!(await FileManager.exists(LIBRARIES_FILE))) return []
    const raw = await FileManager.readAsString(LIBRARIES_FILE)
    if (!raw || typeof raw !== "string") return []
    return normalizeIconLibraries(decryptPayload<unknown>(raw, LOCAL_APP_SECRET))
  } catch { return [] }
}

export const saveIconLibraries = async (libraries: IconLibrary[]): Promise<void> => {
  if (!(await FileManager.exists(DATA_DIR))) await FileManager.createDirectory(DATA_DIR, true)
  await FileManager.writeAsString(LIBRARIES_FILE, encryptPayload(libraries, LOCAL_APP_SECRET))
}

// 订阅：拉取一次以校验地址并确定名称
export const subscribeIconLibrary = async (url: string): Promise<IconLibrary> => {
  const target = url.trim()
  const remote = await fetchIconLibrary(target)
  return {
    id: generateId(),
    name: remote.name || hostOf(target),
    url: target,
    icons: remote.icons,
    updatedAt: Date.now(),
  }
}

// 刷新：失败时保留已有图标，只记录错误
export const refreshIconLibrary = async (library: IconLibrary): Promise<IconLibrary> => {
  try {
    const remote = await fetchIconLibrary(library.url)
    return { ...library, icons: remote.icons, updatedAt: Date.now(), lastError: undefined }
  } catch (error) {
    return { ...library, lastError: `${error}` }
  }
}
