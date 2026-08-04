// Live Activity（锁屏）与灵动岛 UI —— 仅渲染上/当前/下三行
import {
  LiveActivity,
  LiveActivityUI,
  LiveActivityUIBuilder,
  VStack,
  Text,
  Image,
  LiveActivityUIExpandedBottom,
} from "scripting"
import type { LyricActivityState } from "./types"

// 灵动岛展开区可用宽度
const LYRIC_MAX_WIDTH = 400
// 超长文本再缩小的下限（系统在 lineLimit 内自动等比缩字）
const LYRIC_MIN_SCALE = 0.75

/**
 * 估算文本视觉宽度：CJK 及全角标点按 1 个字宽计，其余按 0.55 计。
 * 用于在系统自动缩字之前先选一个合适的基础字号，避免直接缩到最小。
 */
function visualLength(text: string) {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd)
    width += isWide ? 1 : 0.55
  }
  return width
}

/** 当前行（最多两行）基础字号：按文本长度分档 */
function currentFontSize(text: string) {
  const width = visualLength(text)
  // 两行可容纳的字数约为单行两倍，故短句一律保持大字号
  if (width <= 32) return 28
  if (width <= 42) return 24
  if (width <= 54) return 21
  return 18
}

/** 上/下行（各最多一行）基础字号：按文本长度分档 */
function sideFontSize(text: string) {
  const width = visualLength(text)
  if (width <= 26) return 18
  if (width <= 34) return 16
  return 15
}

/** 稳定三行歌词：当前行居中高亮（最多两行），上下行各一行弱化 */
function CenteredLyric(state: LyricActivityState) {
  if (!state.hasLyric) {
    return <Text font={24} foregroundStyle="gray">无可用歌词</Text>
  }
  const prevText = state.prevText || " "
  const currentText = state.currentText || "♪"
  const nextText = state.nextText || " "
  return (
    <VStack
      alignment="center"
      spacing={4}
      frame={{ maxWidth: LYRIC_MAX_WIDTH, alignment: "center" }}
    >
      <Text
        font={sideFontSize(prevText)}
        lineLimit={1}
        minScaleFactor={LYRIC_MIN_SCALE}
        foregroundStyle={{ color: "white", opacity: 0.38 }}
        multilineTextAlignment="center"
        frame={{ maxWidth: LYRIC_MAX_WIDTH, alignment: "center" }}
      >
        {prevText}
      </Text>
      <Text
        font={currentFontSize(currentText)}
        fontWeight="bold"
        // 最多两行；配合 fixedSize 允许纵向长高，避免被压成单行尾部省略
        lineLimit={2}
        // 分档字号仍放不下时，系统在两行内继续等比缩小
        minScaleFactor={LYRIC_MIN_SCALE}
        foregroundStyle="white"
        multilineTextAlignment="center"
        frame={{ maxWidth: LYRIC_MAX_WIDTH, alignment: "center" }}
        fixedSize={{ horizontal: false, vertical: true }}
        // 用 seq 拼进可访问标签，确保系统识别内容变化
        accessibilityLabel={`lyric-${state.seq}-${state.currentIndex}`}
      >
        {currentText}
      </Text>
      <Text
        font={sideFontSize(nextText)}
        lineLimit={1}
        minScaleFactor={LYRIC_MIN_SCALE}
        foregroundStyle={{ color: "white", opacity: 0.38 }}
        multilineTextAlignment="center"
        frame={{ maxWidth: LYRIC_MAX_WIDTH, alignment: "center" }}
      >
        {nextText}
      </Text>
    </VStack>
  )
}

/** 锁屏内容区：居中歌词 */
function ContentView(state: LyricActivityState) {
  return (
    <VStack
      alignment="center"
      spacing={8}
      frame={{ maxWidth: Infinity, minHeight: 120, maxHeight: Infinity, alignment: "center" }}
      activityBackgroundTint={{ light: "clear", dark: "clear" }}
    >
      <CenteredLyric {...state} />
    </VStack>
  )
}

const builder: LiveActivityUIBuilder<LyricActivityState> = (state) => {
  // 紧凑态右侧只放播放/暂停，歌词在展开/锁屏显示
  const trailingIcon = state.isPlaying ? "pause.fill" : "play.fill"
  return (
    <LiveActivityUI
      content={<ContentView {...state} />}
      compactLeading={<Image systemName="music.note" foregroundStyle="white" />}
      compactTrailing={<Image systemName={trailingIcon} foregroundStyle="white" />}
      minimal={<Image systemName="music.note" foregroundStyle="white" />}
    >
      {/* Bottom 区纵向空间更充裕，便于当前行折成两行 */}
      <LiveActivityUIExpandedBottom>
        <CenteredLyric {...state} />
      </LiveActivityUIExpandedBottom>
    </LiveActivityUI>
  )
}

// 注册名为 LyricsLiveActivity 的实时活动
export const LyricsLiveActivity = LiveActivity.register("LyricsLiveActivity", builder)
