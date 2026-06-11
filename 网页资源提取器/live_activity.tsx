import {
  LiveActivity,
  LiveActivityUI,
  LiveActivityUIExpandedCenter,
  LiveActivityUIBuilder,
  HStack,
  VStack,
  Text,
  Image,
} from "scripting"

export type ResourceType = "image" | "css" | "js" | "video" | "audio" | "font" | "document" | "archive" | "other"

export type DownloadActivityState = {
  fileName: string
  progress: number
  status: "downloading" | "waitingForSave" | "completed" | "cancelled" | "error"
  resourceType: ResourceType
  revision: number
}

function truncateName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name
  return name.substring(0, maxLen) + "…"
}

function TypeIcon({ type, width, height }: { type: ResourceType; width: number; height: number }) {
  const symbolSize = width > 30 ? 36 : width;
  const imageProps = { frame: { width, height }, font: symbolSize };

  switch (type) {
    case "image": return <Image systemName="photo" foregroundStyle="#007AFF" {...imageProps} />
    case "video": return <Image systemName="film" foregroundStyle="#AF52DE" {...imageProps} />
    case "audio": return <Image systemName="waveform" foregroundStyle="#FF9500" {...imageProps} />
    case "document": return <Image systemName="doc.text" foregroundStyle="#34C759" {...imageProps} />
    case "archive": return <Image systemName="doc.zipper" foregroundStyle="#A2845E" {...imageProps} />
    case "css": return <Image systemName="paintbrush" foregroundStyle="#FF2D55" {...imageProps} />
    case "js": return <Image systemName="chevron.left.forwardslash.chevron.right" foregroundStyle="#FFD60A" {...imageProps} />
    case "font": return <Image systemName="textformat" foregroundStyle="#5AC8FA" {...imageProps} />
    default: return <Image systemName="paperclip" foregroundStyle="#8E8E93" {...imageProps} />
  }
}

function StatusSubtitle(state: DownloadActivityState) {
  switch (state.status) {
    case "downloading":
      return <Text font="caption" foregroundStyle="secondaryLabel">正在下载…</Text>
    case "waitingForSave":
      return <Text font="caption" foregroundStyle="#007AFF">请返回选择保存位置</Text>
    case "completed":
      return <Text font="caption" foregroundStyle="#34C759">下载完成</Text>
    case "cancelled":
      return <Text font="caption" foregroundStyle="#FF9500">已取消</Text>
    case "error":
      return <Text font="caption" foregroundStyle="#FF3B30">下载失败</Text>
  }
}

function ProgressPercent(state: DownloadActivityState) {
  const areaWidth = 56;
  const areaHeight = 36;
  const statusFont = 24;

  if (state.status === "downloading") {
    return (
      <Text
        font="title2"
        fontWeight="bold"
        foregroundStyle="#007AFF"
        frame={{ width: areaWidth, height: areaHeight, alignment: "trailing" }}
      >
        {state.progress}%
      </Text>
    )
  }
  
  const iconProps = {
    frame: { width: areaWidth, height: areaHeight, alignment: "trailing" as const },
    font: statusFont
  };

  if (state.status === "waitingForSave") {
    return <Image systemName="folder.badge.plus" foregroundStyle="#007AFF" {...iconProps} />
  }
  if (state.status === "completed") {
    return <Image systemName="checkmark.circle.fill" foregroundStyle="#34C759" {...iconProps} />
  }
  if (state.status === "cancelled") {
    return <Image systemName="xmark.circle.fill" foregroundStyle="#FF9500" {...iconProps} />
  }
  if (state.status === "error") {
    return <Image systemName="exclamationmark.circle.fill" foregroundStyle="#FF3B30" {...iconProps} />
  }
  return null
}

function ContentRow(state: DownloadActivityState) {
  return (
    <HStack 
      spacing={16} 
      alignment="center" 
      frame={{ maxWidth: "infinity" }} 
      padding={{ leading: 30, trailing: 30 }}
    >
      <TypeIcon type={state.resourceType} width={36} height={36} />
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
        <Text font="headline" fontWeight="bold" lineLimit={1}>
          {truncateName(state.fileName, 18)}
        </Text>
        <StatusSubtitle {...state} />
      </VStack>
      <ProgressPercent {...state} />
    </HStack>
  )
}

function CompactStatusText(state: DownloadActivityState) {
  switch (state.status) {
    case "downloading":
      return <Text font="caption" fontWeight="bold">{state.progress}%</Text>
    case "waitingForSave":
      return <Text font="caption" foregroundStyle="#007AFF">保存</Text>
    case "completed":
      return <Text font="caption" foregroundStyle="#34C759">✓</Text>
    case "cancelled":
      return <Text font="caption" foregroundStyle="#FF9500">✕</Text>
    case "error":
      return <Text font="caption" foregroundStyle="#FF3B30">!</Text>
  }
}

function CompactStatusIcon(state: DownloadActivityState) {
  const size = 16;
  const imageProps = { font: size, frame: { width: 30, height: 18, alignment: "leading" as const } };

  switch (state.status) {
    case "downloading":
      return <Image systemName="arrow.down.circle.fill" foregroundStyle="#007AFF" {...imageProps} />
    case "waitingForSave":
      return <Image systemName="folder.badge.plus" foregroundStyle="#007AFF" {...imageProps} />
    case "completed":
      return <Image systemName="checkmark.circle.fill" foregroundStyle="#34C759" {...imageProps} />
    case "cancelled":
      return <Image systemName="xmark.circle.fill" foregroundStyle="#FF9500" {...imageProps} />
    case "error":
      return <Image systemName="exclamationmark.circle.fill" foregroundStyle="#FF3B30" {...imageProps} />
    default:
      return null;
  }
}

function MinimalStatus(state: DownloadActivityState) {
  const size = 18;

  switch (state.status) {
    case "downloading":
      return <Text font="caption2" fontWeight="bold" foregroundStyle="#007AFF">{state.progress}%</Text>
    case "waitingForSave":
      return <Image systemName="folder.badge.plus" foregroundStyle="#007AFF" font={size} />
    case "completed":
      return <Image systemName="checkmark.circle.fill" foregroundStyle="#34C759" font={size} />
    case "cancelled":
      return <Image systemName="xmark.circle.fill" foregroundStyle="#FF9500" font={size} />
    case "error":
      return <Image systemName="exclamationmark.circle.fill" foregroundStyle="#FF3B30" font={size} />
    default:
      return null;
  }
}

const builder: LiveActivityUIBuilder<DownloadActivityState> = (state) => {
  return (
    <LiveActivityUI
      content={<ContentRow {...state} />}
      compactLeading={<CompactStatusIcon {...state} />}
      compactTrailing={<CompactStatusText {...state} />}
      minimal={<MinimalStatus {...state} />}
    >
      <LiveActivityUIExpandedCenter>
        <ContentRow {...state} />
      </LiveActivityUIExpandedCenter>
    </LiveActivityUI>
  )
}

export const DownloadLiveActivity = LiveActivity.register<DownloadActivityState>(
  "DownloadLiveActivity",
  builder
)
