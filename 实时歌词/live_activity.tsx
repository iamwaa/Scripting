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

/** 稳定三行歌词：当前行居中高亮，上下行弱化 */
function CenteredLyric(state: LyricActivityState) {
  if (!state.hasLyric) {
    return <Text font={24} foregroundStyle="gray">无可用歌词</Text>
  }
  return (
    <VStack
      alignment="center"
      spacing={4}
      frame={{ maxWidth: LYRIC_MAX_WIDTH, alignment: "center" }}
    >
      <Text
        font="callout"
        lineLimit={1}
        foregroundStyle={{ color: "white", opacity: 0.38 }}
        multilineTextAlignment="center"
        frame={{ maxWidth: LYRIC_MAX_WIDTH, alignment: "center" }}
      >
        {state.prevText || " "}
      </Text>
      <Text
        font={24}
        fontWeight="bold"
        // 最多两行；配合 fixedSize 允许纵向长高，避免被压成单行尾部省略
        lineLimit={2}
        foregroundStyle="white"
        multilineTextAlignment="center"
        frame={{ maxWidth: LYRIC_MAX_WIDTH, alignment: "center" }}
        fixedSize={{ horizontal: false, vertical: true }}
        // 用 seq 拼进可访问标签，确保系统识别内容变化
        accessibilityLabel={`lyric-${state.seq}-${state.currentIndex}`}
      >
        {state.currentText || "♪"}
      </Text>
      <Text
        font="callout"
        lineLimit={1}
        foregroundStyle={{ color: "white", opacity: 0.38 }}
        multilineTextAlignment="center"
        frame={{ maxWidth: LYRIC_MAX_WIDTH, alignment: "center" }}
      >
        {state.nextText || " "}
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
