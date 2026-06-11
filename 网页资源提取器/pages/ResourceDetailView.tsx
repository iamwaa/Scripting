import {
  Navigation,
  NavigationStack,
  List,
  Section,
  Text,
  Button,
  HStack,
  VStack,
  Image,
  ProgressView,
  Spacer,
  VideoPlayer,
  useEffect,
  useRef,
  useState,
  ZStack,
} from "scripting"
import type { ResourceItem } from "../types/resource"
import { WebURL } from "../utils/WebURL"
import { getTypeInfo } from "../functions/resourceInfo"
import { toastMessage, toastVisible, showToast } from "../state/appState"
import { TextPreview } from "../components/TextPreview"
import { FontPreview } from "../components/FontPreview"
import { DownloadLiveActivity, type DownloadActivityState } from "../live_activity"
import {
  createDownloadTask,
  updateDownloadTask,
} from "../state/downloadManager"
import {
  parseM3u8Playlist,
  parseM3u8WithVariant,
  downloadM3u8SegmentsToFile,
  downloadM3u8DirectlyToMp4,
  convertTsToMp4,
  type M3u8Variant,
} from "../functions/m3u8Downloader"

const LIVE_ACTIVITY_MIN_UPDATE_INTERVAL_MS = 10000
const LIVE_ACTIVITY_MIN_PROGRESS_STEP = 5
const LIVE_ACTIVITY_UPDATE_TIMEOUT_MS = 3000
const ENCRYPTED_M3U8_LIVE_ACTIVITY_UPDATE_INTERVAL_MS = 10000
const ENCRYPTED_M3U8_LIVE_ACTIVITY_PROGRESS_STEP = 5
const ENCRYPTED_M3U8_DECRYPT_UI_UPDATE_INTERVAL_MS = 250

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
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

function createDownloadSpeedTracker(onSpeed: (speed: string) => void) {
  let lastBytes = 0
  let lastAt = Date.now()

  return {
    reset() {
      lastBytes = 0
      lastAt = Date.now()
      onSpeed("")
    },
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("操作超时")), timeoutMs)
    }),
  ])
}

type LiveActivityControllerOptions = {
  minUpdateIntervalMs?: number
  minProgressStep?: number
}

type DownloadActivityStatus = DownloadActivityState["status"]

function createDownloadLiveActivityController(resource: ResourceItem, options: LiveActivityControllerOptions = {}) {
  let liveAct: any = null
  let liveActivityReady: Promise<void> | null = null
  let liveActivityStarted = false
  let lastLiveProgress = 0
  let lastLiveUpdateAt = 0
  let pendingLiveState: DownloadActivityState | null = null
  let liveUpdateInFlight = false
  let liveUpdateTimer: any = null
  let revision = 0
  let closed = false

  const minUpdateIntervalMs = options.minUpdateIntervalMs ?? LIVE_ACTIVITY_MIN_UPDATE_INTERVAL_MS
  const minProgressStep = options.minProgressStep ?? LIVE_ACTIVITY_MIN_PROGRESS_STEP

  function makeActivityState(progress: number, status: DownloadActivityStatus): DownloadActivityState {
    revision += 1
    return {
      fileName: resource.name,
      resourceType: resource.type,
      progress: clampProgress(progress),
      status,
      revision,
    }
  }

  function makeActivityOptions() {
    return {
      staleDate: Date.now() + 15000,
      relevanceScore: 100,
    }
  }

  function clearUpdateTimer() {
    if (liveUpdateTimer) {
      clearTimeout(liveUpdateTimer)
      liveUpdateTimer = null
    }
  }

  function start(canContinue: () => boolean = () => true) {
    liveActivityReady = (async () => {
      const enabled = await LiveActivity.areActivitiesEnabled().catch(() => false)
      if (!enabled || closed || !canContinue()) return

      const activity = DownloadLiveActivity()
      liveAct = activity
      await BackgroundKeeper.keepAlive().catch(() => false)

      const started = await activity.start(
        makeActivityState(lastLiveProgress, "downloading"),
        makeActivityOptions()
      ).catch(() => false)

      if (!started || closed || !canContinue()) {
        liveAct = null
        return
      }

      liveActivityStarted = true
      lastLiveUpdateAt = Date.now()
    })()
  }

  function update(
    progress: number,
    force = false,
    status: "downloading" | "waitingForSave" = "downloading",
    canContinue: () => boolean = () => true
  ) {
    if (closed) return

    const nextProgress = clampProgress(progress)
    if (nextProgress < lastLiveProgress && !force) return
    if (nextProgress === lastLiveProgress && status === "downloading" && !force) return

    const nextState = makeActivityState(nextProgress, status)
    const now = Date.now()
    const shouldSendNow = force
      || status !== "downloading"
      || nextProgress >= 100
      || nextProgress - lastLiveProgress >= minProgressStep
      || now - lastLiveUpdateAt >= minUpdateIntervalMs

    pendingLiveState = nextState

    if (!shouldSendNow) {
      if (!liveUpdateTimer) {
        const delay = Math.max(120, minUpdateIntervalMs - (now - lastLiveUpdateAt))
        liveUpdateTimer = setTimeout(() => {
          liveUpdateTimer = null
          flush(canContinue)
        }, delay)
      }
      return
    }

    flush(canContinue)
  }

  async function sendLiveUpdate(state: DownloadActivityState) {
    lastLiveProgress = state.progress
    lastLiveUpdateAt = Date.now()
    await withTimeout(
      liveAct.update(state, makeActivityOptions()),
      LIVE_ACTIVITY_UPDATE_TIMEOUT_MS
    ).catch(() => {})
  }

  async function flush(canContinue: () => boolean = () => true) {
    if (liveUpdateInFlight) return
    liveUpdateInFlight = true

    try {
      await liveActivityReady?.catch(() => {})
      while (pendingLiveState && liveAct && liveActivityStarted && !closed && canContinue()) {
        const state = pendingLiveState
        pendingLiveState = null
        await sendLiveUpdate(state)
      }
    } finally {
      liveUpdateInFlight = false
      if (pendingLiveState && !closed && canContinue()) {
        flush(canContinue)
      }
    }
  }

  function end(status: "completed" | "cancelled" | "error", progress: number) {
    const finalState = makeActivityState(progress, status)
    closed = true
    clearUpdateTimer()
    pendingLiveState = null
    ;(async () => {
      await liveActivityReady?.catch(() => {})
      if (!liveAct || !liveActivityStarted) {
        setTimeout(() => BackgroundKeeper.stopKeepAlive(), 5000)
        return
      }

      await withTimeout(
        liveAct.end(finalState, { ...makeActivityOptions(), dismissTimeInterval: 5 }),
        LIVE_ACTIVITY_UPDATE_TIMEOUT_MS
      ).catch(() => {})
      liveAct = null
      setTimeout(() => BackgroundKeeper.stopKeepAlive(), 5000)
    })()
  }

  function dispose() {
    closed = true
    clearUpdateTimer()
    pendingLiveState = null
    setTimeout(() => BackgroundKeeper.stopKeepAlive(), 5000)
  }

  return { start, update, end, dispose }
}

// 模块级下载取消函数
let _downloadCancelFn: (() => void) | null = null

export function ResourceDetailView({ resource }: { resource: ResourceItem }) {
  const dismiss = Navigation.useDismiss()
  const info = getTypeInfo(resource.type)
  let host = ""
  try {
    host = new WebURL(resource.url).host
  } catch (e) {
    host = ""
  }

  const isTextType = ["css", "js", "document"].includes(resource.type)
    || (resource.type === "other" && /\.(json|xml)$/i.test(resource.name))
  const isMedia = ["video", "audio"].includes(resource.type)

  const isM3u8 = resource.type === "video" && (
    resource.url.toLowerCase().includes(".m3u8") ||
    resource.name.toLowerCase().endsWith(".m3u8")
  )

  const [player, setPlayer] = useState<any>(null)
  const isDetailActiveRef = useRef(true)

  useEffect(() => {
    isDetailActiveRef.current = true
    return () => {
      isDetailActiveRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!isMedia) return
    const avPlayer = new AVPlayer()
    avPlayer.setSource(resource.url)
    setPlayer(avPlayer)
    return () => {
      avPlayer.dispose()
    }
  }, [resource.url])

  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadLabel, setDownloadLabel] = useState("")
  const [downloadSpeed, setDownloadSpeed] = useState("")
  const [m3u8Variants, setM3u8Variants] = useState<M3u8Variant[]>([])
  const [selectedVariant, setSelectedVariant] = useState<M3u8Variant | null>(null)

  // 只有图片保留相册保存，视频统一走文件保存。
  const canSaveToPhotos = resource.type === "image"

  // m3u8 合并下载
  async function downloadM3u8Stream(variant?: M3u8Variant) {
    setIsDownloading(true)
    setDownloadProgress(0)
    setDownloadSpeed("")
    setDownloadLabel("正在解析 m3u8 播放列表...")

    let cancelled = false
    let lastProgress = 0
    const managerTaskId = createDownloadTask(resource, "正在解析 m3u8 播放列表...")
    const speedTracker = createDownloadSpeedTracker(speed => {
      setDownloadSpeed(speed)
      updateDownloadTask(managerTaskId, { speed })
    })
    const liveActivity = createDownloadLiveActivityController(resource, {
      minUpdateIntervalMs: ENCRYPTED_M3U8_LIVE_ACTIVITY_UPDATE_INTERVAL_MS,
      minProgressStep: ENCRYPTED_M3U8_LIVE_ACTIVITY_PROGRESS_STEP,
    })

    _downloadCancelFn = () => {
      if (cancelled) return
      cancelled = true
      _downloadCancelFn = null
      setDownloadSpeed("")
      setIsDownloading(false)
      liveActivity.end("cancelled", lastProgress)
      updateDownloadTask(managerTaskId, {
        status: "cancelled",
        progress: lastProgress,
        label: "下载已取消",
        speed: "",
        cancel: undefined,
      })
      showToast("下载已取消")
    }
    updateDownloadTask(managerTaskId, { cancel: _downloadCancelFn })

    try {
      let playlist
      if (variant) {
        playlist = await parseM3u8WithVariant(resource.url, variant)
      } else {
        playlist = await parseM3u8Playlist(resource.url)
      }

      const segments = playlist.segments
      if (segments.length === 0) throw new Error("未解析到任何视频切片数据")

      if (playlist.variants.length > 0) {
        setM3u8Variants(playlist.variants)
        if (!selectedVariant) {
          setSelectedVariant(playlist.selectedVariant || playlist.variants[0])
        }
      }

      const currentVariant = variant || playlist.selectedVariant
      if (currentVariant) {
        const label = `已选择画质 ${currentVariant.label}，准备下载...`
        setDownloadLabel(label)
        updateDownloadTask(managerTaskId, { label })
      }

      liveActivity.start(() => !cancelled)

      const safeName = resource.name.replace(/\.m3u8$/i, "") || "video"
      const mp4Path = FileManager.temporaryDirectory + "/" + safeName + "_merged.mp4"

      try {
        await downloadM3u8DirectlyToMp4(playlist.playlistUrl, mp4Path, {
          isCancelled: () => cancelled,
          estimatedDurationSeconds: playlist.totalDurationSeconds,
          onStatus: message => {
            setDownloadLabel(message)
            updateDownloadTask(managerTaskId, { label: message })
          },
          onProgress: progress => {
            if (cancelled) return
            lastProgress = Math.max(lastProgress, progress)
            setDownloadProgress(lastProgress)
            updateDownloadTask(managerTaskId, { progress: lastProgress, label: "正在下载..." })
            FileManager.stat(mp4Path).then(stat => {
              if (!cancelled && stat.size > 0) speedTracker.update(stat.size)
            }).catch(() => {})
            liveActivity.update(lastProgress, false, "downloading", () => !cancelled)
          },
        })

        if (cancelled) throw new Error("用户已取消下载")

        const exportName = safeName + ".mp4"
        const fileSize = (await FileManager.stat(mp4Path).catch(() => ({ size: 0 }))).size
        setDownloadProgress(100)

        if (!isDetailActiveRef.current) {
          liveActivity.end("completed", 100)
          updateDownloadTask(managerTaskId, {
            status: "completed",
            progress: 100,
            label: "已下载，可在下载管理器导出",
            tempPath: mp4Path,
            mimeType: "video/mp4",
            fileSize,
            savedTo: "none",
            speed: "",
            cancel: undefined,
          })
          setIsDownloading(false)
          return
        }

        setDownloadLabel("请在弹出的文件选择器中确认保存位置")
        updateDownloadTask(managerTaskId, {
          status: "saving",
          progress: 100,
          label: "请在弹出的文件选择器中确认保存位置",
          tempPath: mp4Path,
          mimeType: "video/mp4",
          fileSize,
        })
        liveActivity.update(100, true, "waitingForSave", () => !cancelled)
        setIsDownloading(false)

        const fileData = await FileManager.readAsData(mp4Path)
        if (!isDetailActiveRef.current) {
          liveActivity.end("completed", 100)
          updateDownloadTask(managerTaskId, {
            status: "completed",
            progress: 100,
            label: "已下载，可在下载管理器导出",
            tempPath: mp4Path,
            mimeType: "video/mp4",
            fileSize,
            savedTo: "none",
            speed: "",
            cancel: undefined,
          })
          return
        }

        const result = await DocumentPicker.exportFiles({
          files: [{ data: fileData, name: exportName }]
        })

        if (result.length > 0) {
          showToast("已成功保存合并后的视频 (.mp4)")
        }

        liveActivity.end("completed", 100)
        updateDownloadTask(managerTaskId, {
          status: "completed",
          progress: 100,
          label: "已保存，可在下载管理器再次导出",
          tempPath: mp4Path,
          mimeType: "video/mp4",
          fileSize,
          savedTo: result.length > 0 ? "file" : "none",
          speed: "",
          cancel: undefined,
        })
        return
      } catch (err) {
        if (cancelled) throw err
        try { await FileManager.remove(mp4Path) } catch {}
        lastProgress = 0
        speedTracker.reset()
        setDownloadProgress(0)
        updateDownloadTask(managerTaskId, {
          progress: 0,
          label: "ffmpeg 直接处理失败，改用分片下载...",
          speed: "",
        })
        liveActivity.update(0, true, "downloading", () => !cancelled)
        setDownloadLabel("ffmpeg 直接处理失败，改用分片下载...")
      }

      const outPath = FileManager.temporaryDirectory + "/" + safeName + "_merged.ts"
      const startLabel = `开始下载分片 (共 ${segments.length} 个)`
      setDownloadLabel(startLabel)
      updateDownloadTask(managerTaskId, { label: startLabel })
      const segmentProgress = new Array(segments.length).fill(0)
      let downloadedBytes = 0
      let lastM3u8UiUpdateAt = 0

      function getCompletedSegmentsCount(): number {
        return Math.min(segmentProgress.filter(item => item >= 1).length, segments.length)
      }

      function updateM3u8Progress(index: number, fraction: number, phase: "download" | "decrypt", force = false) {
        if (cancelled) return
        segmentProgress[index] = Math.max(segmentProgress[index], Math.max(0, Math.min(1, fraction)))

        const now = Date.now()
        const partialCount = segmentProgress.reduce((sum, item) => sum + item, 0)
        const nextProgress = clampProgress((partialCount / segments.length) * 100)
        const shouldUpdateUi = force
          || nextProgress > lastProgress
          || now - lastM3u8UiUpdateAt >= ENCRYPTED_M3U8_DECRYPT_UI_UPDATE_INTERVAL_MS

        if (!shouldUpdateUi) return

        lastM3u8UiUpdateAt = now
        lastProgress = Math.max(lastProgress, nextProgress)
        setDownloadProgress(lastProgress)
        const label = phase === "decrypt"
          ? `正在解密... (${Math.min(Math.floor(partialCount), segments.length)}/${segments.length})`
          : `正在下载... (${getCompletedSegmentsCount()}/${segments.length})`
        setDownloadLabel(label)
        updateDownloadTask(managerTaskId, { progress: lastProgress, label })
        liveActivity.update(lastProgress, false, "downloading", () => !cancelled)
      }

      await downloadM3u8SegmentsToFile(segments, {
        outputPath: outPath,
        isCancelled: () => cancelled,
        onStatus: message => {
          setDownloadLabel(message)
          updateDownloadTask(managerTaskId, { label: message })
        },
        onSegmentProgress: (index, fraction, phase) => {
          updateM3u8Progress(index, fraction, phase, fraction >= 1)
        },
        onOrderedSegment: data => {
          downloadedBytes += data.length
          speedTracker.update(downloadedBytes)
        },
      })

      if (cancelled) throw new Error("用户已取消下载")

      setDownloadLabel("正在转换为 MP4...")
      updateDownloadTask(managerTaskId, { label: "正在转换为 MP4..." })
      await convertTsToMp4(outPath, mp4Path, {
        isCancelled: () => cancelled,
        onStatus: message => {
          setDownloadLabel(message)
          updateDownloadTask(managerTaskId, { label: message })
        },
      })

      if (cancelled) throw new Error("用户已取消下载")

      const exportName = safeName + ".mp4"
      const savedAs = "mp4"
      const fileSize = (await FileManager.stat(mp4Path).catch(() => ({ size: 0 }))).size

      if (!isDetailActiveRef.current) {
        liveActivity.end("completed", 100)
        updateDownloadTask(managerTaskId, {
          status: "completed",
          progress: 100,
          label: "已下载，可在下载管理器导出",
          tempPath: mp4Path,
          mimeType: "video/mp4",
          fileSize,
          savedTo: "none",
          speed: "",
          cancel: undefined,
        })
        setIsDownloading(false)
        try { await FileManager.remove(outPath) } catch {}
        return
      }

      setDownloadLabel("请在弹出的文件选择器中确认保存位置")
      updateDownloadTask(managerTaskId, {
        status: "saving",
        progress: 100,
        label: "请在弹出的文件选择器中确认保存位置",
        tempPath: mp4Path,
        mimeType: "video/mp4",
        fileSize,
      })
      liveActivity.update(100, true, "waitingForSave", () => !cancelled)
      setIsDownloading(false)

      const fileData = await FileManager.readAsData(mp4Path)
      if (!isDetailActiveRef.current) {
        liveActivity.end("completed", 100)
        updateDownloadTask(managerTaskId, {
          status: "completed",
          progress: 100,
          label: "已下载，可在下载管理器导出",
          tempPath: mp4Path,
          mimeType: "video/mp4",
          fileSize,
          savedTo: "none",
          speed: "",
          cancel: undefined,
        })
        try { await FileManager.remove(outPath) } catch {}
        return
      }

      const result = await DocumentPicker.exportFiles({
        files: [{ data: fileData, name: exportName }]
      })

      if (result.length > 0) {
        showToast(`已成功保存合并后的视频 (.${savedAs})`)
      }

      liveActivity.end("completed", 100)
      updateDownloadTask(managerTaskId, {
        status: "completed",
        progress: 100,
        label: "已保存，可在下载管理器再次导出",
        tempPath: mp4Path,
        mimeType: "video/mp4",
        fileSize,
        savedTo: result.length > 0 ? "file" : "none",
        speed: "",
        cancel: undefined,
      })
      try { await FileManager.remove(outPath) } catch {}

    } catch (err: any) {
      // 清理可能残留的 m3u8 临时文件
      try {
        const tmpName = resource.name.replace(/\.m3u8$/i, "") || "video"
        FileManager.remove(FileManager.temporaryDirectory + "/" + tmpName + "_merged.ts").catch(() => {})
        FileManager.remove(FileManager.temporaryDirectory + "/" + tmpName + "_merged.mp4").catch(() => {})
      } catch {}
      liveActivity.end(cancelled ? "cancelled" : "error", lastProgress)
      updateDownloadTask(managerTaskId, {
        status: cancelled ? "cancelled" : "failed",
        label: cancelled ? "下载已取消" : "下载失败",
        error: cancelled ? undefined : err.message,
        progress: lastProgress,
        speed: "",
        cancel: undefined,
      })
      if (!cancelled) {
        showToast(`${err.message}`)
      }
      setIsDownloading(false)
    } finally {
      _downloadCancelFn = null
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

  function getProperFileName(mimeType: string): string {
    const ext = resource.name.split(".").pop()?.toLowerCase() || ""
    const hasValidExt = ext.length > 0 && ext.length <= 5 && !ext.includes("!") && !ext.includes("?")
    if (hasValidExt) return resource.name
    const mimeExt = getExtFromMime(mimeType)
    return mimeExt ? resource.name + "." + mimeExt : resource.name
  }

  // 确保文件有正确扩展名，返回最终路径（可能是新副本）
  async function ensureFileExt(filePath: string, mimeType: string): Promise<string> {
    const ext = resource.name.split(".").pop()?.toLowerCase() || ""
    const hasValidExt = ext.length > 0 && ext.length <= 5 && !ext.includes("!") && !ext.includes("?")
    if (hasValidExt) return filePath
    const mimeExt = getExtFromMime(mimeType)
    if (mimeExt) {
      const newPath = filePath + "." + mimeExt
      await FileManager.copyFile(filePath, newPath)
      return newPath
    }
    return filePath
  }

  function startDownload(onDone: (tempPath: string, mimeType: string, markWaitingForSave: () => void) => Promise<"photos" | "file" | "none" | void>) {
    setIsDownloading(true)
    setDownloadProgress(0)
    setDownloadSpeed("")
    setDownloadLabel("正在下载...")

    const tempPath = FileManager.temporaryDirectory + "/" + Date.now() + "_" + resource.name
    const managerTaskId = createDownloadTask(resource, "正在下载...")

    const task = BackgroundURLSession.startDownload({
      url: resource.url,
      destination: tempPath,
    })

    let lastProgress = 0
    let cancelled = false
    let cleanedUp = false
    const speedTracker = createDownloadSpeedTracker(speed => {
      setDownloadSpeed(speed)
      updateDownloadTask(managerTaskId, { speed })
    })
    const liveActivity = createDownloadLiveActivityController(resource)

    function cleanup() {
      if (cleanedUp) return
      cleanedUp = true
      _downloadCancelFn = null
      setIsDownloading(false)
    }

    liveActivity.start(() => !cancelled && !cleanedUp)

    _downloadCancelFn = () => {
      if (cancelled || cleanedUp) return
      cancelled = true
      task.cancel()
      liveActivity.end("cancelled", lastProgress)
      updateDownloadTask(managerTaskId, {
        status: "cancelled",
        progress: lastProgress,
        label: "下载已取消",
        speed: "",
        cancel: undefined,
      })
      cleanup()
      showToast("下载已取消")
    }
    updateDownloadTask(managerTaskId, { cancel: _downloadCancelFn })

    task.onProgress = (details) => {
      if (cancelled) return
      lastProgress = clampProgress(details.progress * 100)
      setDownloadProgress(lastProgress)
      updateDownloadTask(managerTaskId, { progress: lastProgress, label: "正在下载..." })
      speedTracker.update(details.totalBytesWritten)
      liveActivity.update(lastProgress, false, "downloading", () => !cancelled && !cleanedUp)
    }

    task.onFinishDownload = async (error, details) => {
      if (cancelled) return

      if (error) {
        showToast(`下载失败: ${error.message}`)
        updateDownloadTask(managerTaskId, {
          status: "failed",
          label: "下载失败",
          error: error.message,
          progress: lastProgress,
          speed: "",
        })
        liveActivity.end("error", lastProgress)
        cleanup()
        return
      }

      const downloadedPath = details.destination || details.temporary
      let mimeType = ""
      let fileSize = 0
      try { mimeType = FileManager.mimeType(downloadedPath) } catch {}
      try { fileSize = (await FileManager.stat(downloadedPath)).size } catch {}

      if (!isDetailActiveRef.current) {
        updateDownloadTask(managerTaskId, {
          status: "completed",
          progress: 100,
          label: "已下载，可在下载管理器导出",
          tempPath: downloadedPath,
          mimeType,
          fileSize,
          savedTo: "none",
          speed: "",
          cancel: undefined,
        })
        liveActivity.end("completed", 100)
        cleanup()
        return
      }

      const markWaitingForSave = () => {
        setDownloadLabel("请在弹出的文件选择器中确认保存位置")
        updateDownloadTask(managerTaskId, {
          status: "saving",
          progress: 100,
          label: "请在弹出的文件选择器中确认保存位置",
          tempPath: downloadedPath,
          mimeType,
          fileSize,
        })
        liveActivity.update(100, true, "waitingForSave", () => !cancelled && !cleanedUp)
      }

      try {
        setDownloadLabel("正在保存...")
        const savedTo = await onDone(downloadedPath, mimeType, markWaitingForSave)
        updateDownloadTask(managerTaskId, {
          status: "completed",
          progress: 100,
          label: isDetailActiveRef.current ? "已保存，可在下载管理器再次导出" : "已下载，可在下载管理器导出",
          tempPath: downloadedPath,
          mimeType,
          fileSize,
          savedTo: savedTo || "none",
          speed: "",
          cancel: undefined,
        })
      } catch (e: any) {
        showToast(`保存失败: ${e.message || "未知错误"}`)
        updateDownloadTask(managerTaskId, {
          status: "completed",
          progress: 100,
          label: "保存失败，可在下载管理器导出",
          error: e.message || "未知错误",
          tempPath: downloadedPath,
          mimeType,
          fileSize,
          savedTo: "none",
          speed: "",
          cancel: undefined,
        })
      }

      liveActivity.end("completed", 100)
      cleanup()
    }

    task.onComplete = (error, resumeData) => {
      if (cancelled || cleanedUp) return
      if (error) {
        showToast(`下载失败: ${error.message}`)
        updateDownloadTask(managerTaskId, {
          status: "failed",
          label: "下载失败",
          error: error.message,
          progress: lastProgress,
          speed: "",
        })
        liveActivity.end("error", lastProgress)
        cleanup()
      }
    }

    task.resume()
  }

  async function fallbackSaveToFile(tempPath: string, mimeType: string, markWaitingForSave?: () => void): Promise<"file" | "none" | void> {
    setDownloadLabel("正在准备保存到文件...")
    const finalPath = await ensureFileExt(tempPath, mimeType)
    if (!isDetailActiveRef.current) return

    const data = await FileManager.readAsData(finalPath)
    const fileName = getProperFileName(mimeType)
    if (!isDetailActiveRef.current) return

    markWaitingForSave?.()
    if (!isDetailActiveRef.current) return

    const result = await DocumentPicker.exportFiles({
      files: [{ data, name: fileName }]
    })
    if (result.length > 0) {
      showToast("已保存到选择的位置")
      return "file"
    }
    if (finalPath !== tempPath) {
      try { await FileManager.remove(finalPath) } catch {}
    }
    return "none"
  }

  function saveToPhotos() {
    startDownload(async (tempPath, mimeType, markWaitingForSave) => {
      setDownloadLabel("正在保存到相册...")
      if (!isDetailActiveRef.current) return

      const data = await FileManager.readAsData(tempPath)
      if (!isDetailActiveRef.current) return

      const success = await Photos.savePhoto(data, { fileName: resource.name })
      if (!isDetailActiveRef.current) return

      if (success) {
        showToast("已保存到相册")
        return "photos"
      } else {
        return await fallbackSaveToFile(tempPath, mimeType, markWaitingForSave)
      }
    })
  }

  function saveToFile() {
    startDownload(async (tempPath, mimeType, markWaitingForSave) => {
      return await fallbackSaveToFile(tempPath, mimeType, markWaitingForSave)
    })
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="资源详情"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: (
            <Button action={() => {
              isDetailActiveRef.current = false
              dismiss()
            }}>
              <Image
                systemName="chevron.left"
                foregroundStyle="accentColor"
                fontWeight="semibold"
              />
            </Button>
          ),
        }}
        toast={{
          message: toastMessage.value,
          position: "top",
          isPresented: toastVisible,
          duration: 2
        }}
      >
        <Section title="资源信息">
          <VStack alignment="leading" spacing={8}>
            <HStack spacing={6}>
              <Text
                font="caption2"
                fontWeight="medium"
                foregroundStyle="white"
                padding={{ horizontal: 6, vertical: 2 }}
                background={info.color}
                clipShape={{ type: "rect", cornerRadius: 4 }}
              >
                {info.label}
              </Text>
              <Text fontWeight="bold" lineLimit={2}>
                {resource.name}
              </Text>
            </HStack>
            <VStack alignment="leading" spacing={2}>
              <Text font="caption" foregroundStyle="secondaryLabel">
                资源链接
              </Text>
              <Text font="caption" textSelection lineLimit={10}>
                {resource.url}
              </Text>
            </VStack>
          </VStack>
        </Section>

        {resource.type === "image" ? (
          <Section title="预览内容">
            <ZStack
              background={{ style: "ultraThinMaterial", shape: { type: "rect", cornerRadius: 12 } }}
              border={{ style: { light: "rgba(209,209,214,0.55)", dark: "rgba(235,235,245,0.22)" }, width: 0.5 }}
              shadow={{ color: "rgba(0,0,0,0.035)", radius: 18, x: 0, y: 2 }}
              clipShape={{ type: "rect", cornerRadius: 12 }}
              padding={8}
              frame={{ maxWidth: "infinity", minHeight: 160 }}
            >
              <Image
                imageUrl={resource.url}
                resizable
                aspectRatio={{ value: null, contentMode: "fit" }}
                frame={{ maxWidth: "infinity", maxHeight: 400 }}
              />
            </ZStack>
          </Section>
        ) : null}

        {isMedia && player ? (
          <Section title="预览内容">
            <VideoPlayer
              player={player}
              frame={{ maxWidth: "infinity", minHeight: 220 }}
            />
          </Section>
        ) : null}

        {isTextType ? (
          <Section title="预览内容">
            <Button
              buttonStyle="plain"
              action={async () => { await Safari.present(resource.url) }}
            >
              <TextPreview resource={resource} />
            </Button>
          </Section>
        ) : null}

        {resource.type === "font" ? (
          <Section title="字体预览">
            <FontPreview resource={resource} />
          </Section>
        ) : null}

        {isDownloading ? (
          <Section title="下载进度">
            <VStack alignment="leading" spacing={8}>
              <HStack>
                <Text font="caption">{downloadLabel}</Text>
                <Spacer />
                <Text font="caption" foregroundStyle="secondaryLabel">{"  " + downloadProgress + "%"}</Text>
              </HStack>
              <ProgressView value={downloadProgress / 100} progressViewStyle="linear" />
              <HStack>
                <Text font="caption" foregroundStyle="secondaryLabel">{downloadSpeed || " "}</Text>
                <Spacer />
                <Button action={() => _downloadCancelFn?.()}>
                  <HStack spacing={6}>
                    <Image systemName="xmark.circle" foregroundStyle="#FF3B30" />
                    <Text foregroundStyle="#FF3B30">取消下载</Text>
                  </HStack>
                </Button>
              </HStack>
            </VStack>
          </Section>
        ) : null}

        {isM3u8 ? (
          <Section title="流媒体下载 (试验性)">
            <VStack alignment="leading" spacing={6} padding={{ vertical: 8, horizontal: 4 }}>
              <Text font="caption" foregroundStyle="secondaryLabel">
                该资源为 m3u8 视频流。点击下载按钮选择画质，合并分片并通过 ffmpeg 导出为 MP4 文件。
              </Text>
            </VStack>

            <Button
              action={async () => {
                // 先解析获取可用画质
                let variants = m3u8Variants
                if (variants.length === 0) {
                  try {
                    setDownloadLabel("正在解析播放列表...")
                    const playlist = await parseM3u8Playlist(resource.url)
                    variants = playlist.variants
                    setM3u8Variants(variants)
                  } catch (err: any) {
                    showToast(`解析失败: ${err.message}`)
                    return
                  }
                }

                // 如果有多个画质，弹出选择框
                let selectedVariant: M3u8Variant | undefined
                if (variants.length > 1) {
                  const actions = variants.map(v => ({
                    label: v.resolution ? `${v.label} (${v.resolution})` : v.label,
                  }))
                  const index = await Dialog.actionSheet({
                    title: "选择画质",
                    message: "请选择要下载的视频画质",
                    actions,
                  })
                  if (index === null) return
                  selectedVariant = variants[index]
                  setSelectedVariant(selectedVariant)
                } else if (variants.length === 1) {
                  selectedVariant = variants[0]
                  setSelectedVariant(selectedVariant)
                }

                // 开始下载
                downloadM3u8Stream(selectedVariant)
              }}
              disabled={isDownloading}
            >
              <HStack spacing={6}>
                <Image systemName="arrow.down.circle" />
                <Text fontWeight="bold">内置合并下载</Text>
              </HStack>
            </Button>

            <Button
              action={async () => {
                await Pasteboard.setString(resource.url)
                showToast(`流媒体链接已复制`)
              }}
              disabled={isDownloading}
            >
              <HStack spacing={6}>
                <Image systemName="doc.on.clipboard" />
                <Text>复制 m3u8 链接</Text>
              </HStack>
            </Button>

            <Button
              action={async () => { await Safari.present(resource.url) }}
              disabled={isDownloading}
            >
              <HStack spacing={6}>
                <Image systemName="safari" />
                <Text>用浏览器打开</Text>
              </HStack>
            </Button>
          </Section>
        ) : (
          <Section>
            {canSaveToPhotos ? (
              <Button action={saveToPhotos} disabled={isDownloading}>
                <HStack spacing={6}>
                  <Image systemName="photo.on.rectangle" />
                  <Text>保存到相册</Text>
                </HStack>
              </Button>
            ) : (
              <Button action={saveToFile} disabled={isDownloading}>
                <HStack spacing={6}>
                  <Image systemName="arrow.down.doc" />
                  <Text>保存到文件</Text>
                </HStack>
              </Button>
            )}
            <Button
              action={async () => {
                await Pasteboard.setString(resource.url)
                showToast(`资源链接已复制`)
              }}
              disabled={isDownloading}
            >
              <HStack spacing={6}>
                <Image systemName="doc.on.doc" />
                <Text>复制链接</Text>
              </HStack>
            </Button>
            <Button
              action={async () => { await Safari.present(resource.url) }}
              disabled={isDownloading}
            >
              <HStack spacing={6}>
                <Image systemName="safari" />
                <Text>用浏览器打开</Text>
              </HStack>
            </Button>
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}
