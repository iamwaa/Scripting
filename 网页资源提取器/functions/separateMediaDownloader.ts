export type SeparateMediaDownloadResult = {
  outputPath: string
  mimeType: "video/mp4"
  fileSize: number
}

export type SeparateMediaDownloadOptions = {
  headers?: Record<string, string>
  onProgress?: (progress: number, totalBytesWritten: number) => void
  onStatus?: (label: string) => void
}

export type SeparateMediaDownloadHandle = {
  result: Promise<SeparateMediaDownloadResult>
  cancel: () => void
  pause?: () => void
  resume?: () => void
}

type DownloadProgress = {
  fraction: number
  bytes: number
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function removePath(path: string) {
  try {
    await FileManager.remove(path)
  } catch {}
}

function startDownload(
  url: string,
  destination: string,
  headers: Record<string, string> | undefined,
  onProgress: (progress: DownloadProgress) => void
) {
  let settled = false
  let rejectPromise: (error: Error) => void = () => {}

  const task = BackgroundURLSession.startDownload({ url, destination, headers })
  const result = new Promise<string>((resolve, reject) => {
    rejectPromise = reject
    task.onProgress = details => {
      onProgress({
        fraction: Math.max(0, Math.min(1, details.progress)),
        bytes: Math.max(0, details.totalBytesWritten),
      })
    }
    task.onFinishDownload = (error, details) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(details.destination || details.temporary || destination)
    }
  })
  task.resume()

  return {
    result,
    pause() {
      if (settled) return
      task.suspend()
    },
    resume() {
      if (settled) return
      task.resume()
    },
    cancel() {
      if (settled) return
      settled = true
      task.cancel()
      rejectPromise(new Error("用户已取消下载"))
    },
  }
}

async function mergeMedia(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  const base = `ffmpeg -hide_banner -y -i ${quoteShellArg(videoPath)} -i ${quoteShellArg(audioPath)} -map 0:v:0 -map 1:a:0`
  const attempts = [
    `${base} -c copy -movflags +faststart ${quoteShellArg(outputPath)}`,
    `${base} -c:v copy -c:a aac -b:a 160k -movflags +faststart ${quoteShellArg(outputPath)}`,
  ]

  let lastOutput = ""
  for (const command of attempts) {
    await removePath(outputPath)
    const result = await Shell.run(command, { timeout: 1800 })
    lastOutput = result.output || ""
    if (!result.timedOut && result.exitCode === 0) return
  }

  const detail = lastOutput.trim().split("\n").slice(-4).join("\n")
  throw new Error(detail ? `音视频合并失败：${detail}` : "音视频合并失败")
}

export function startSeparateMediaDownload(
  videoUrl: string,
  audioUrl: string,
  workPrefix: string,
  options: SeparateMediaDownloadOptions = {}
): SeparateMediaDownloadHandle {
  const videoPath = `${workPrefix}.video.part`
  const audioPath = `${workPrefix}.audio.part`
  const outputPath = `${workPrefix}.merged.mp4`
  let cancelled = false
  let merging = false
  let videoProgress: DownloadProgress = { fraction: 0, bytes: 0 }
  let audioProgress: DownloadProgress = { fraction: 0, bytes: 0 }

  const emitProgress = () => {
    const fraction = (videoProgress.fraction + audioProgress.fraction) / 2
    options.onProgress?.(Math.round(fraction * 90), videoProgress.bytes + audioProgress.bytes)
  }

  let videoDownload: ReturnType<typeof startDownload> | null = null
  let audioDownload: ReturnType<typeof startDownload> | null = null

  const result = (async (): Promise<SeparateMediaDownloadResult> => {
    await Promise.all([removePath(videoPath), removePath(audioPath), removePath(outputPath)])
    if (cancelled) throw new Error("用户已取消下载")

    options.onStatus?.("正在下载视频和音轨...")
    videoDownload = startDownload(videoUrl, videoPath, options.headers, progress => {
      videoProgress = progress
      emitProgress()
    })
    audioDownload = startDownload(audioUrl, audioPath, options.headers, progress => {
      audioProgress = progress
      emitProgress()
    })

    try {
      const [downloadedVideoPath, downloadedAudioPath] = await Promise.all([
        videoDownload.result,
        audioDownload.result,
      ])
      if (cancelled) throw new Error("用户已取消下载")

      merging = true
      options.onStatus?.("正在合并音视频...")
      options.onProgress?.(90, videoProgress.bytes + audioProgress.bytes)
      await mergeMedia(downloadedVideoPath, downloadedAudioPath, outputPath)
      if (cancelled) throw new Error("用户已取消下载")

      const fileSize = (await FileManager.stat(outputPath)).size
      await Promise.all([removePath(downloadedVideoPath), removePath(downloadedAudioPath)])
      options.onProgress?.(100, videoProgress.bytes + audioProgress.bytes)
      return { outputPath, mimeType: "video/mp4", fileSize }
    } catch (error) {
      videoDownload?.cancel()
      audioDownload?.cancel()
      await Promise.all([removePath(videoPath), removePath(audioPath), removePath(outputPath)])
      throw error
    }
  })()

  return {
    result,
    pause() {
      if (merging) return
      videoDownload?.pause()
      audioDownload?.pause()
      options.onStatus?.("下载已暂停")
    },
    resume() {
      if (merging) return
      videoDownload?.resume()
      audioDownload?.resume()
      options.onStatus?.("正在继续下载...")
    },
    cancel() {
      if (cancelled) return
      cancelled = true
      if (merging) options.onStatus?.("正在取消合并...")
      videoDownload?.cancel()
      audioDownload?.cancel()
    },
  }
}
