import { LiveActivity, Script } from "scripting"
import { ytDlpInstallPath, ensureSabrComponents } from "../services/ytDlpManager"
import type { SeparateMediaDownloadHandle } from "./separateMediaDownloader"

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function extractYouTubeDownloadError(output: string): string {
  const lines = output.split("\n").map(line => line.trim()).filter(Boolean)
  const errors = lines.filter(line => line.startsWith("ERR:"))
  return (errors.length > 0 ? errors : lines).slice(-4).join("\n")
}

async function removePath(path: string) {
  try {
    await FileManager.remove(path)
  } catch {}
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

export function startYouTubeMediaDownload(
  sourceUrl: string,
  videoFormatId: string,
  audioFormatId: string | undefined,
  workPrefix: string,
  onStatus?: (label: string) => void,
  // 预解析的格式 URL（由 youtube parser 提供，当前未使用——Python 脚本自行获取 URL）
  _preResolvedVideoUrl?: string,
  _preResolvedAudioUrl?: string,
  _preResolvedHeaders?: Record<string, string>,
): SeparateMediaDownloadHandle {
  const videoPath = `${workPrefix}.video.mp4`
  const audioPath = `${workPrefix}.audio.m4a`
  const outputPath = `${workPrefix}.merged.mp4`
  let cancelled = false

  const result = (async () => {
    await LiveActivity.endAllActivities({ dismissTimeInterval: 0 }).catch(() => false)
    await Promise.all([removePath(videoPath), removePath(audioPath), removePath(outputPath)])
    // 确保 SABR 下载组件已安装（包含 SSL 适配器）
    const sabrReady = await ensureSabrComponents(true)
    if (!sabrReady) throw new Error("SABR 组件未安装，无法下载 YouTube 视频")

    onStatus?.("正在下载 YouTube 视频和音轨...")

    // Python 脚本负责获取 Innertube URL，并下载视频与音频轨道。
    const command = [
      "python",
      quoteShellArg(`${Script.directory}/scripts/youtube_download.py`),
      quoteShellArg(ytDlpInstallPath),
      quoteShellArg(sourceUrl),
      quoteShellArg(videoFormatId),
      quoteShellArg(audioFormatId || "-"),
      quoteShellArg(videoPath),
      quoteShellArg(audioPath),
    ].join(" ")

    let usedFallback = false
    let download = await Shell.run(command, { cwd: Script.directory, timeout: 1800 })
    if (cancelled) throw new Error("用户已取消下载")
    if (download.timedOut) throw new Error("YouTube 下载超时")

    // 高画质 DASH 轨道可能被 YouTube 的 PO Token/SABR 拦截，降级到可直下的 360p 合一格式。
    if (download.exitCode !== 0 && /HTTP 403/.test(download.output || "") && videoFormatId !== "18") {
      usedFallback = true
      onStatus?.("高画质受 YouTube 限制，改用兼容的 360p 下载...")
      const fallbackCommand = [
        "python",
        quoteShellArg(`${Script.directory}/scripts/youtube_download.py`),
        quoteShellArg(ytDlpInstallPath),
        quoteShellArg(sourceUrl),
        quoteShellArg("18"),
        quoteShellArg("-"),
        quoteShellArg(videoPath),
        quoteShellArg(audioPath),
      ].join(" ")
      download = await Shell.run(fallbackCommand, { cwd: Script.directory, timeout: 1800 })
    }

    if (cancelled) throw new Error("用户已取消下载")
    if (download.timedOut) throw new Error("YouTube 下载超时")
    if (download.exitCode !== 0) {
      const detail = extractYouTubeDownloadError(download.output)
      throw new Error(detail ? `YouTube 下载失败：${detail}` : "YouTube 下载失败")
    }

    // 降级为 itag 18 后已经是音视频合一文件，无需再合并音轨。
    if (!audioFormatId || usedFallback) {
      const fileSize = (await FileManager.stat(videoPath)).size
      return { outputPath: videoPath, mimeType: "video/mp4" as const, fileSize }
    }

    // 合并音视频
    onStatus?.("正在合并音视频...")
    await mergeMedia(videoPath, audioPath, outputPath)
    if (cancelled) throw new Error("用户已取消下载")
    const fileSize = (await FileManager.stat(outputPath)).size
    await Promise.all([removePath(videoPath), removePath(audioPath)])
    return { outputPath, mimeType: "video/mp4" as const, fileSize }
  })().catch(async error => {
    await Promise.all([removePath(videoPath), removePath(audioPath), removePath(outputPath)])
    throw error
  })

  return {
    result,
    cancel() {
      cancelled = true
    },
  }
}
