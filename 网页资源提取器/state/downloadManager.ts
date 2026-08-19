import type { ResourceItem } from "../types/resource"
import type { M3u8Variant } from "../functions/m3u8Downloader"
import { startSeparateMediaDownload } from "../functions/separateMediaDownloader"
import { startYouTubeMediaDownload } from "../functions/youtubeMediaDownloader"
import { sanitizeFileName } from "../utils/fileName"

export type DownloadTaskStatus = "downloading" | "paused" | "completed" | "failed" | "cancelled" | "saving"

export type DownloadTaskItem = {
  id: string
  resource: ResourceItem
  status: DownloadTaskStatus
  progress: number
  label: string
  speed: string
  tempPath?: string
  mimeType?: string
  error?: string
  fileSize?: number
  savedTo?: "photos" | "file" | "none"
  createdAt: number
  cancel?: () => void
  pause?: () => void
  resume?: () => void
  retry?: () => void
  m3u8Variant?: M3u8Variant
}

export type EnqueueDownloadOptions = {
  onUpdate?: (task: DownloadTaskItem) => void
}

const downloadTaskListeners = new Map<string, (task: DownloadTaskItem) => void>()

const DOWNLOAD_STORE_DIR = `${FileManager.appGroupDocumentsDirectory}/WebResourceExtractor`
const DOWNLOAD_FILES_DIR = `${DOWNLOAD_STORE_DIR}/downloads`
const DOWNLOAD_TASKS_STORAGE_KEY = "webResourceExtractor.downloadTasks"

export const downloadTasks = new (Observable as any)(loadStoredTasks()) as Observable<DownloadTaskItem[]>

let lastPersistedJson = ""

type PersistedDownloadTaskItem = Omit<DownloadTaskItem, "cancel" | "pause" | "resume" | "retry">

function normalizeRestoredTask(item: PersistedDownloadTaskItem): DownloadTaskItem {
  const restored: DownloadTaskItem = {
    ...item,
    speed: "",
    cancel: undefined,
    pause: undefined,
    resume: undefined,
    retry: undefined,
  }

  if (restored.status === "downloading") {
    restored.status = "cancelled"
    restored.label = "上次退出时下载已中断"
    restored.speed = ""
  } else if (restored.status === "paused") {
    restored.status = "cancelled"
    restored.label = "上次退出时下载已中断"
    restored.speed = ""
  } else if (restored.status === "saving") {
    restored.status = "completed"
    restored.label = "已下载，可在下载管理器导出"
    restored.speed = ""
  }

  return restored
}

function loadStoredTasks(): DownloadTaskItem[] {
  try {
    const stored = Storage.get<PersistedDownloadTaskItem[]>(DOWNLOAD_TASKS_STORAGE_KEY)
    if (!Array.isArray(stored)) return []
    return stored.map(item => normalizeRestoredTask(item)).filter(item => item?.id && item?.resource)
  } catch {
    return []
  }
}

function persistTasks(items: DownloadTaskItem[]) {
  try {
    const persisted: PersistedDownloadTaskItem[] = items.map(item => {
      const { cancel, pause, resume, retry, ...plainItem } = item
      const nextItem: PersistedDownloadTaskItem = { ...plainItem, speed: "" }

      if (nextItem.status === "downloading") {
        nextItem.status = "cancelled"
        nextItem.label = "上次退出时下载已中断"
        nextItem.savedTo = "none"
      } else if (nextItem.status === "saving") {
        nextItem.status = "completed"
        nextItem.label = "已下载，可在下载管理器导出"
      }
      return nextItem
    })

    const json = JSON.stringify(persisted)
    if (json === lastPersistedJson) return
    lastPersistedJson = json
    Storage.set(DOWNLOAD_TASKS_STORAGE_KEY, persisted)
  } catch {}
}

function getTasks(): DownloadTaskItem[] {
  return downloadTasks.value as DownloadTaskItem[]
}

function updateTasks(updater: (items: DownloadTaskItem[]) => DownloadTaskItem[]) {
  const nextItems = updater(getTasks())
  downloadTasks.setValue(nextItems)
  persistTasks(nextItems)
}

function updateTask(id: string, patch: Partial<DownloadTaskItem>) {
  updateTasks(items => items.map(item => item.id === id ? { ...item, ...patch } : item))
  const task = getTasks().find(item => item.id === id)
  if (!task) return
  downloadTaskListeners.get(id)?.(task)
  if (task.status !== "downloading" && task.status !== "paused" && task.status !== "saving") {
    downloadTaskListeners.delete(id)
  }
}

function formatDownloadSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return ""

  const units = ["B/s", "KB/s", "MB/s", "GB/s"]
  let value = bytesPerSecond
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  const text = value >= 10 || unitIndex === 0 ? Math.round(value).toString() : value.toFixed(1)
  return `${text} ${units[unitIndex]}`
}

function createSpeedTracker(onSpeed: (speed: string) => void) {
  let lastBytes = 0
  let lastAt = Date.now()

  return {
    update(totalBytes: number) {
      const now = Date.now()
      const elapsedSeconds = (now - lastAt) / 1000
      if (elapsedSeconds < 0.5 || totalBytes < lastBytes) return

      const speed = (totalBytes - lastBytes) / elapsedSeconds
      lastBytes = totalBytes
      lastAt = now
      onSpeed(formatDownloadSpeed(speed))
    },
  }
}

function getExtFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
    "image/webp": "webp", "image/svg+xml": "svg", "image/heic": "heic",
    "image/heif": "heif", "image/bmp": "bmp", "image/tiff": "tiff",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/x-m4v": "m4v",
    "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a",
  }
  return map[mimeType] || ""
}

function getFileName(resource: ResourceItem, mimeType: string): string {
  const name = sanitizeFileName(resource.name)
  const ext = name.split(".").pop()?.toLowerCase() || ""
  const mimeExt = getExtFromMime(mimeType)
  const hasValidExt = ext.length > 0 && ext.length <= 5 && !ext.includes("!") && !ext.includes("?")

  if (mimeExt && ext === "m3u8") {
    return `${name.replace(/\.m3u8$/i, "") || "video"}.${mimeExt}`
  }

  if (hasValidExt) return name

  return mimeExt ? `${name}.${mimeExt}` : name
}

async function completeDownloadedTask(
  id: string,
  downloadedPath: string,
  mimeType: string,
  fileSize: number,
  label: string
) {
  const task = getDownloadTask(id)
  if (!task || task.status !== "downloading") {
    FileManager.remove(downloadedPath).catch(() => {})
    return
  }

  await FileManager.createDirectory(DOWNLOAD_FILES_DIR, true)
  const stableFileName = `${id}_${getFileName(task.resource, mimeType)}`
  const stablePath = `${DOWNLOAD_FILES_DIR}/${stableFileName}`
  if (downloadedPath !== stablePath) {
    try { await FileManager.remove(stablePath) } catch {}
    await FileManager.copyFile(downloadedPath, stablePath)
    try { await FileManager.remove(downloadedPath) } catch {}
  }

  const stableSize = fileSize || (await FileManager.stat(stablePath)).size
  updateTask(id, {
    status: "completed",
    progress: 100,
    label,
    speed: "",
    tempPath: stablePath,
    mimeType,
    fileSize: stableSize,
    savedTo: "none",
    cancel: undefined,
    pause: undefined,
    resume: undefined,
  })
}

export function createDownloadTask(resource: ResourceItem, label = "等待下载..."): string {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const taskItem: DownloadTaskItem = {
    id,
    resource,
    status: "downloading",
    progress: 0,
    label,
    speed: "",
    createdAt: Date.now(),
  }
  updateTasks(items => [taskItem, ...items])
  return id
}

export function updateDownloadTask(id: string, patch: Partial<DownloadTaskItem>) {
  updateTask(id, patch)
}

export function getDownloadTask(id: string): DownloadTaskItem | undefined {
  return getTasks().find(item => item.id === id)
}

export function getActiveDownloadCount(): number {
  return getTasks().filter(item => item.status === "downloading" || item.status === "saving").length
}

function isUnfinishedTask(item: DownloadTaskItem): boolean {
  return item.status === "downloading" || item.status === "paused" || item.status === "saving"
}

export function hasDownloadManagerContent(): boolean {
  return getTasks().length > 0
}

export function removeDownloadTask(id: string) {
  const task = getTasks().find(item => item.id === id)
  task?.cancel?.()
  if (task?.tempPath) {
    FileManager.remove(task.tempPath).catch(() => {})
  }
  // 兜底：同时清理稳定目录中可能残留的文件
  if (task) {
    const stableFileName = `${task.id}_${getFileName(task.resource, task.mimeType || "")}`
    const stablePath = `${DOWNLOAD_FILES_DIR}/${stableFileName}`
    if (stablePath !== task?.tempPath) {
      FileManager.remove(stablePath).catch(() => {})
    }
  }
  updateTasks(items => items.filter(item => item.id !== id))
}

export function pauseDownloadTask(id: string) {
  const task = getDownloadTask(id)
  if (task?.status !== "downloading") return
  task.pause?.()
}

export function resumeDownloadTask(id: string) {
  const task = getDownloadTask(id)
  if (task?.status !== "paused") return
  task.resume?.()
}

export function cancelDownloadTask(id: string) {
  const task = getTasks().find(item => item.id === id)
  if (task?.status !== "downloading" && task?.status !== "paused" && task?.status !== "saving") return
  task?.cancel?.()
}

export function clearFinishedDownloadTasks() {
  const removable = getTasks().filter(item => !isUnfinishedTask(item))
  for (const task of removable) {
    if (task.tempPath) FileManager.remove(task.tempPath).catch(() => {})
    // 兜底：同时尝试清理稳定目录中可能残留的文件
    const stableFileName = `${task.id}_${getFileName(task.resource, task.mimeType || "")}`
    const stablePath = `${DOWNLOAD_FILES_DIR}/${stableFileName}`
    if (stablePath !== task.tempPath) {
      FileManager.remove(stablePath).catch(() => {})
    }
  }
  updateTasks(items => items.filter(item => isUnfinishedTask(item)))
}

export function retryDownloadTask(id: string): string | undefined {
  const task = getDownloadTask(id)
  if (!task || isUnfinishedTask(task)) return undefined
  // m3u8 任务使用专用重试回调，避免走普通下载只下载播放列表
  if (task.retry) {
    task.retry()
    return undefined
  }
  removeDownloadTask(id)
  return enqueueResourceDownload(task.resource)
}

export async function exportDownloadTask(id: string) {
  const task = getTasks().find(item => item.id === id)
  if (!task?.tempPath || task.status !== "completed") return

  updateTask(id, { status: "saving", label: "正在准备导出..." })
  try {
    const data = await FileManager.readAsData(task.tempPath)
    const result = await DocumentPicker.exportFiles({
      files: [{ data, name: getFileName(task.resource, task.mimeType || "") }]
    })
    updateTask(id, {
      status: "completed",
      label: result.length > 0 ? "已导出，可清除任务" : "已下载，等待导出",
      savedTo: result.length > 0 ? "file" : task.savedTo,
    })
  } catch (e: any) {
    updateTask(id, {
      status: "completed",
      label: "导出失败，可重试",
      error: e.message || "未知错误",
    })
  }
}

function enqueueSeparateMediaDownload(resource: ResourceItem, options: EnqueueDownloadOptions = {}): string {
  const id = createDownloadTask(resource, "正在准备音视频下载...")
  if (options.onUpdate) downloadTaskListeners.set(id, options.onUpdate)
  const workPrefix = `${FileManager.temporaryDirectory}/${id}`
  const speedTracker = createSpeedTracker(speed => updateTask(id, { speed }))
  let cancelled = false

  BackgroundKeeper.keepAlive().catch(() => false)
  const isYouTube = resource.source === "youtube"
    && !!resource.sourceUrl
    && !!resource.videoFormatId
  const handle = isYouTube
    ? startYouTubeMediaDownload(
      resource.sourceUrl!,
      resource.videoFormatId!,
      resource.audioFormatId,
      workPrefix,
      label => updateTask(id, { label, speed: "" }),
    )
    : startSeparateMediaDownload(resource.url, resource.audioUrl!, workPrefix, {
      headers: resource.headers,
      onStatus: label => updateTask(id, { label, speed: label.includes("合并") ? "" : getDownloadTask(id)?.speed || "" }),
      onProgress: (progress, totalBytes) => {
        speedTracker.update(totalBytes)
        updateTask(id, { progress })
      },
    })

  updateTask(id, {
    cancel: () => {
      if (cancelled) return
      cancelled = true
      handle.cancel()
      updateTask(id, {
        label: "正在取消下载...",
        speed: "",
      })
    },
    pause: handle.pause ? () => {
      if (cancelled) return
      handle.pause?.()
      updateTask(id, { status: "paused", label: "下载已暂停", speed: "" })
    } : undefined,
    resume: handle.resume ? () => {
      if (cancelled) return
      handle.resume?.()
      updateTask(id, { status: "downloading", label: "正在下载..." })
    } : undefined,
  })

  handle.result.then(async result => {
    if (cancelled) {
      FileManager.remove(result.outputPath).catch(() => {})
      updateTask(id, {
        status: "cancelled",
        label: "下载已取消",
        speed: "",
        cancel: undefined,
      })
      return
    }

    await completeDownloadedTask(
      id,
      result.outputPath,
      result.mimeType,
      result.fileSize,
      "音视频已合并，等待导出"
    )
  }).catch((error: any) => {
    updateTask(id, {
      status: cancelled ? "cancelled" : "failed",
      label: cancelled ? "下载已取消" : "音视频下载或合并失败",
      error: cancelled ? undefined : error.message || "未知错误",
      speed: "",
      cancel: undefined,
    })
  }).finally(() => {
    BackgroundKeeper.stopKeepAlive().catch(() => {})
  })

  return id
}

export function enqueueResourceDownload(resource: ResourceItem, options: EnqueueDownloadOptions = {}): string {
  if (resource.audioUrl || (resource.source === "youtube" && resource.videoFormatId)) {
    return enqueueSeparateMediaDownload(resource, options)
  }

  const id = createDownloadTask(resource)
  if (options.onUpdate) downloadTaskListeners.set(id, options.onUpdate)
  const tempPath = `${FileManager.temporaryDirectory}/${id}_${sanitizeFileName(resource.name)}`

  BackgroundKeeper.keepAlive().catch(() => false)

  const download = BackgroundURLSession.startDownload({
    url: resource.url,
    destination: tempPath,
    headers: resource.headers,
  })
  const speedTracker = createSpeedTracker(speed => updateTask(id, { speed }))

  let settled = false
  let paused = false
  updateTask(id, {
    label: "正在下载...",
    cancel: () => {
      if (settled) return
      settled = true
      download.cancel()
      updateTask(id, {
        status: "cancelled",
        label: "下载已取消",
        speed: "",
        cancel: undefined,
      })
      BackgroundKeeper.stopKeepAlive().catch(() => {})
    },
    pause: () => {
      if (settled || paused) return
      paused = true
      download.suspend()
      updateTask(id, { status: "paused", label: "下载已暂停", speed: "" })
    },
    resume: () => {
      if (settled || !paused) return
      paused = false
      download.resume()
      updateTask(id, { status: "downloading", label: "正在下载..." })
    },
  })

  download.onProgress = details => {
    const progress = Math.max(0, Math.min(100, Math.round(details.progress * 100)))
    speedTracker.update(details.totalBytesWritten)
    updateTask(id, { progress, label: "正在下载..." })
  }

  download.onFinishDownload = async (error, details) => {
    if (settled) {
      const path = details.destination || details.temporary || tempPath
      FileManager.remove(path).catch(() => {})
      return
    }
    settled = true
    if (error) {
      updateTask(id, {
        status: "failed",
        label: "下载失败",
        error: error.message,
        speed: "",
        cancel: undefined,
      })
      BackgroundKeeper.stopKeepAlive().catch(() => {})
      return
    }

    const downloadedPath = details.destination || details.temporary || tempPath
    let mimeType = ""
    let fileSize = 0
    try { mimeType = FileManager.mimeType(downloadedPath) } catch {}
    try { fileSize = (await FileManager.stat(downloadedPath)).size } catch {}

    try {
      await completeDownloadedTask(id, downloadedPath, mimeType, fileSize, "已下载，等待导出")
    } catch (error: any) {
      updateTask(id, {
        status: "failed",
        label: "下载文件保存失败",
        error: error.message || "未知错误",
        speed: "",
        cancel: undefined,
      })
    }
    BackgroundKeeper.stopKeepAlive().catch(() => {})
  }

  download.onComplete = (error) => {
    if (!error || settled) return
    settled = true
    const current = getTasks().find(item => item.id === id)
    if (!current || current.status !== "downloading") return
    updateTask(id, {
      status: "failed",
      label: "下载失败",
      error: error.message,
      speed: "",
      cancel: undefined,
    })
    BackgroundKeeper.stopKeepAlive().catch(() => {})
  }

  download.resume()
  return id
}
