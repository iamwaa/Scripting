// AppIntents —— 供小组件与实时活动按钮使用的播放控制意图
import { AppIntentManager, AppIntentProtocol, Script, Widget } from "scripting"
import { getCachedLyrics, getCachedArtworkPath } from "./utils/cache"
import { fetchLyrics } from "./api/lyrics"
// 偏移量调整复用统一存取层
import { adjustOffset, resetOffset, OFFSET_STEP } from "./utils/offset"

const SCRIPT_NAME = "实时歌词"
const SNAPSHOT_KEY = "lyric_nowplaying"

/** 写入供小组件读取的快照 */
function writeSnapshot(snap: Record<string, unknown>) {
  Storage.set(SNAPSHOT_KEY, snap)
}

/** 写入当前播放快照，便于主脚本被唤起后快速启动 */
async function prepareSnapshot() {
  const item = SystemMusicPlayer.getNowPlayingItem()
  if (!item) return
  const title = item.title
  const artist = item.artist ?? "未知歌手"
  const currentTime = SystemMusicPlayer.getCurrentPlaybackTime()
  const playbackDuration = item.playbackDuration
  const isPlaying = SystemMusicPlayer.getPlaybackState() === "playing"
  const progress = playbackDuration > 0 ? Math.min(currentTime / playbackDuration, 1) : 0

  let lyric = await getCachedLyrics(title, artist)
  if (!lyric) {
    lyric = await fetchLyrics({
      title,
      artist,
      albumTitle: item.albumTitle,
      duration: playbackDuration,
    })
  }

  writeSnapshot({
    title,
    artist,
    persistentID: item.persistentID,
    artworkPath: getCachedArtworkPath(title, artist) ?? undefined,
    currentText: lyric?.lines[0]?.text ?? "",
    nextText: lyric?.lines[1]?.text ?? "",
    progress,
    isPlaying,
    hasLyric: !!(lyric && lyric.lines.length > 0),
    updatedAt: Date.now() / 1000,
  })
}

/** 唤起主脚本并请求自动启动实时歌词 */
async function resumeMainApp() {
  const runURL = Script.createRunURLScheme(SCRIPT_NAME, { autoStart: "true" })
  try {
    const opened = await Safari.openURL(runURL)
    if (opened) return
  } catch {
    // 继续尝试 Script.run
  }
  try {
    await Script.run({
      name: SCRIPT_NAME,
      queryParameters: { autoStart: true },
      singleMode: true,
    })
  } catch {
    // 忽略唤起失败
  }
}

/** 切换播放/暂停；开始播放时顺便开启实时歌词 */
export const TogglePlayIntent = AppIntentManager.register<void>({
  name: "TogglePlay",
  protocol: AppIntentProtocol.AudioPlaybackIntent,
  perform: async () => {
    const state = SystemMusicPlayer.getPlaybackState()
    if (state === "playing") {
      await SystemMusicPlayer.pause()
    } else {
      await SystemMusicPlayer.play()
      await prepareSnapshot()
      await resumeMainApp()
    }
    Widget.reloadAll()
  },
})

/** 上一首 */
export const PreviousTrackIntent = AppIntentManager.register<void>({
  name: "PreviousTrack",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    await SystemMusicPlayer.skipToPreviousItem()
    Widget.reloadAll()
  },
})

/** 下一首 */
export const NextTrackIntent = AppIntentManager.register<void>({
  name: "NextTrack",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    await SystemMusicPlayer.skipToNextItem()
    Widget.reloadAll()
  },
})

/**
 * 调整歌词时间偏移量。
 * delta 取值：-0.5 表示提早 0.5s（歌词来晚了），+0.5 表示延迟 0.5s（歌词来早了）。
 * @param params.delta 调整增量（秒），由调用方按步长传入
 */
export const AdjustOffsetIntent = AppIntentManager.register<{ delta: number }>({
  name: "AdjustOffset",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (params) => {
    const delta = typeof params?.delta === "number" ? params.delta : OFFSET_STEP
    adjustOffset(delta)
    // 若主脚本在运行，唤起其重读偏移并刷新；否则仅刷新小组件
    try {
      await resumeMainApp()
    } catch {
      // 忽略唤起失败
    }
    Widget.reloadAll()
  },
})

/** 重置歌词时间偏移量为 0 */
export const ResetOffsetIntent = AppIntentManager.register<void>({
  name: "ResetOffset",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    resetOffset()
    try {
      await resumeMainApp()
    } catch {
      // 忽略唤起失败
    }
    Widget.reloadAll()
  },
})
