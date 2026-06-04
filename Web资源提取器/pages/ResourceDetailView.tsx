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
  VideoPlayer,
  useEffect,
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
import { parseM3u8Playlist, parseM3u8WithVariant, downloadM3u8SegmentsToFile, type M3u8Variant } from "../functions/m3u8Downloader"

const LIVE_ACTIVITY_MIN_UPDATE_INTERVAL_MS = 1000
const LIVE_ACTIVITY_MIN_PROGRESS_STEP = 1
const ENCRYPTED_M3U8_LIVE_ACTIVITY_UPDATE_INTERVAL_MS = 700
const ENCRYPTED_M3U8_LIVE_ACTIVITY_PROGRESS_STEP = 1
const ENCRYPTED_M3U8_DECRYPT_UI_UPDATE_INTERVAL_MS = 250

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
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

  async function flush(canContinue: () => boolean = () => true) {
    if (liveUpdateInFlight) return
    liveUpdateInFlight = true

    try {
      await liveActivityReady?.catch(() => {})
      while (pendingLiveState && liveAct && liveActivityStarted && !closed && canContinue()) {
        const state = pendingLiveState
        pendingLiveState = null
        lastLiveProgress = state.progress
        lastLiveUpdateAt = Date.now()
        await liveAct.update(state, makeActivityOptions()).catch(() => {})
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
      if (!liveAct || !liveActivityStarted) return
      await liveAct.end(finalState, { ...makeActivityOptions(), dismissTimeInterval: 5 }).catch(() => {})
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
  const [m3u8Variants, setM3u8Variants] = useState<M3u8Variant[]>([])
  const [selectedVariant, setSelectedVariant] = useState<M3u8Variant | null>(null)

  // 图片和视频都先尝试保存到相册
  const canSaveToPhotos = ["image", "video"].includes(resource.type)

  // m3u8 合并下载
  async function downloadM3u8Stream(variant?: M3u8Variant) {
    setIsDownloading(true)
    setDownloadProgress(0)
    setDownloadLabel("正在解析 m3u8 播放列表...")
  
    let cancelled = false
    let lastProgress = 0
    const liveActivity = createDownloadLiveActivityController(resource, {
      minUpdateIntervalMs: ENCRYPTED_M3U8_LIVE_ACTIVITY_UPDATE_INTERVAL_MS,
      minProgressStep: ENCRYPTED_M3U8_LIVE_ACTIVITY_PROGRESS_STEP,
    })
    _downloadCancelFn = () => {
      if (cancelled) return
      cancelled = true
      liveActivity.end("cancelled", lastProgress)
    }
  
    try {
      let playlist
      if (variant) {
        playlist = await parseM3u8WithVariant(resource.url, variant)
      } else {
        playlist = await parseM3u8Playlist(resource.url)
      }
      
      const segments = playlist.segments
      if (segments.length === 0) throw new Error("未解析到任何视频切片数据")

      // 保存可用画质列表
      if (playlist.variants.length > 0) {
        setM3u8Variants(playlist.variants)
        if (!selectedVariant) {
          setSelectedVariant(playlist.selectedVariant || playlist.variants[0])
        }
      }

      const currentVariant = variant || playlist.selectedVariant
      if (currentVariant) {
        setDownloadLabel(`已选择画质 ${currentVariant.label}，准备下载...`)
      }
  
      liveActivity.start(() => !cancelled)

      const safeName = resource.name.replace(/\.m3u8$/i, "") || "video"
  
      const outPath = FileManager.temporaryDirectory + "/" + safeName + "_merged.ts"

      setDownloadLabel(`开始下载分片 (共 ${segments.length} 个)`)
      const segmentProgress = new Array(segments.length).fill(0)
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
        liveActivity.update(lastProgress, false, "downloading", () => !cancelled)
      }
  
      await downloadM3u8SegmentsToFile(segments, {
        outputPath: outPath,
        isCancelled: () => cancelled,
        onStatus: message => setDownloadLabel(message),
        onSegmentProgress: (index, fraction, phase) => {
          updateM3u8Progress(index, fraction, phase, fraction >= 1)
        },
      })
  
      if (cancelled) {
        throw new Error("用户已取消下载")
      }
  
      setDownloadLabel("正在准备 TS 文件...")
      const exportName = safeName + ".ts"
      const savedAs = "ts"

      setDownloadLabel("请在弹出的文件选择器中确认保存位置")
      liveActivity.update(100, true, "waitingForSave", () => !cancelled)
      setIsDownloading(false)
      
      const fileData = await FileManager.readAsData(outPath)
      const result = await DocumentPicker.exportFiles({
        files: [{ data: fileData, name: exportName }]
      })
  
      if (result.length > 0) {
        showToast(`已成功保存合并后的视频 (.${savedAs})`)
      }

      liveActivity.end("completed", 100)
  
      try { await FileManager.remove(outPath) } catch {}
  
    } catch (err: any) {
      liveActivity.end(cancelled ? "cancelled" : "error", lastProgress)
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

  function startDownload(onDone: (tempPath: string, mimeType: string, markWaitingForSave: () => void) => Promise<void>) {
    setIsDownloading(true)
    setDownloadProgress(0)
    setDownloadLabel("正在下载...")

    const tempPath = FileManager.temporaryDirectory + "/" + Date.now() + "_" + resource.name

    const task = BackgroundURLSession.startDownload({
      url: resource.url,
      destination: tempPath,
    })

    let lastProgress = 0
    let cancelled = false
    let cleanedUp = false
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
      cleanup()
      showToast("下载已取消")
    }
    
    task.onProgress = (details) => {
      if (cancelled) return
      lastProgress = clampProgress(details.progress * 100)
      setDownloadProgress(lastProgress)
      liveActivity.update(lastProgress, false, "downloading", () => !cancelled && !cleanedUp)
    }

    task.onFinishDownload = async (error, details) => {
      if (cancelled) return

      if (error) {
        showToast(`下载失败: ${error.message}`)
        liveActivity.end("error", lastProgress)
        cleanup()
        return
      }

      const downloadedPath = details.destination || details.temporary
      let mimeType = ""
      try { mimeType = FileManager.mimeType(downloadedPath) } catch {}

      const markWaitingForSave = () => {
        setDownloadLabel("请在弹出的文件选择器中确认保存位置")
        liveActivity.update(100, true, "waitingForSave", () => !cancelled && !cleanedUp)
      }

      try {
        setDownloadLabel("正在保存...")
        await onDone(downloadedPath, mimeType, markWaitingForSave)
      } catch (e: any) {
        showToast(`保存失败: ${e.message || "未知错误"}`)
      }

      try { await FileManager.remove(downloadedPath) } catch {}

      liveActivity.end("completed", 100)
      cleanup()
    }

    task.onComplete = (error, resumeData) => {
      if (cancelled || cleanedUp) return
      if (error) {
        showToast(`下载失败: ${error.message}`)
        liveActivity.end("error", lastProgress)
        cleanup()
      }
    }

    task.resume()
  }

  async function fallbackSaveToFile(tempPath: string, mimeType: string, markWaitingForSave?: () => void) {
    setDownloadLabel("正在准备保存到文件...")
    const finalPath = await ensureFileExt(tempPath, mimeType)
    const data = await FileManager.readAsData(finalPath)
    const fileName = getProperFileName(mimeType)
    markWaitingForSave?.()
    const result = await DocumentPicker.exportFiles({
      files: [{ data, name: fileName }]
    })
    if (result.length > 0) {
      showToast("已保存到选择的位置")
    }
    if (finalPath !== tempPath) {
      try { await FileManager.remove(finalPath) } catch {}
    }
  }

  function saveToPhotos() {
    startDownload(async (tempPath, mimeType, markWaitingForSave) => {
      setDownloadLabel("正在保存到相册...")

      let success = false
      if (resource.type === "image") {
        const data = await FileManager.readAsData(tempPath)
        success = await Photos.savePhoto(data, { fileName: resource.name })
      } else {
        const videoPath = await ensureFileExt(tempPath, mimeType)
        success = await Photos.saveVideo(videoPath, { fileName: resource.name })
        if (videoPath !== tempPath) {
          try { await FileManager.remove(videoPath) } catch {}
        }
      }

      if (success) {
        showToast("已保存到相册")
      } else {
        await fallbackSaveToFile(tempPath, mimeType, markWaitingForSave)
      }
    })
  }

  function saveToFile() {
    startDownload(async (tempPath, mimeType, markWaitingForSave) => {
      await fallbackSaveToFile(tempPath, mimeType, markWaitingForSave)
    })
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="资源详情"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: (
            <Button action={dismiss}>
            <Image
            systemName="chevron.left"
            foregroundStyle="accentColor"
            fontWeight="semibold" />
            </Button>
          )
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
                clipShape={{ type: 'rect', cornerRadius: 4 }}
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
              background={{ style: "ultraThinMaterial", shape: { type: 'rect', cornerRadius: 12 } }}
              border={{ style: { light: "rgba(209,209,214,0.55)", dark: "rgba(235,235,245,0.22)" }, width: 0.5 }}
              shadow={{ color: "rgba(0,0,0,0.035)", radius: 18, x: 0, y: 2 }}
              clipShape={{ type: 'rect', cornerRadius: 12 }}
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

        {/* 下载进度条模块 */}
        {isDownloading ? (
          <Section title="下载进度">
            <VStack alignment="leading" spacing={8}>
              <HStack>
                <Text font="caption">{downloadLabel}</Text>
                <Text font="caption" foregroundStyle="secondaryLabel">{"  " + downloadProgress + "%"}</Text>
              </HStack>
              <ProgressView value={downloadProgress / 100} progressViewStyle="linear" />
              <Button action={() => _downloadCancelFn?.()}>
                <HStack spacing={6}>
                  <Image systemName="xmark.circle" foregroundStyle="#FF3B30" />
                  <Text foregroundStyle="#FF3B30">取消下载</Text>
                </HStack>
              </Button>
            </VStack>
          </Section>
        ) : null}

        {/* 动态按钮区域 */}
        {isM3u8 ? (
          <Section title="流媒体下载 (试验性)">
            <VStack alignment="leading" spacing={6} padding={{ vertical: 8, horizontal: 4 }}>
              <Text font="caption" foregroundStyle="secondaryLabel">
                该资源为 m3u8 视频流。点击下载按钮选择画质，合并分片并导出为 TS 文件。
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
                  if (index === null) return // 用户取消
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
