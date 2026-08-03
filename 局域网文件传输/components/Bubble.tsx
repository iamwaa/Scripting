import { Button, HStack, Image, Spacer, Text, VStack } from "scripting"
import type { ChatMessage } from "../types"

// 气泡配色：本端蓝、对端灰卡（明暗自适应，iOS 18 风格纯色）
const mineColor = { light: "#007aff", dark: "#0a84ff" } as const
const cardColor = { light: "#e9e9eb", dark: "#2c2c2e" } as const
const metaMineColor = "rgba(255,255,255,0.82)"
const bubbleShape = { type: "rect", cornerRadius: 16, style: "continuous" } as const

const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "heic"]

function isImage(message: ChatMessage): boolean {
  const mime = (message.mime ?? "").toLowerCase()
  if (mime.indexOf("image/") === 0) return true
  return imageExts.includes(message.fileName?.split(".").pop()?.toLowerCase() ?? "")
}

function fileIcon(name: string | undefined): string {
  const ext = name?.split(".").pop()?.toLowerCase()
  if (imageExts.includes(ext ?? "")) return "🌄"
  if (["mp4", "mov", "mkv", "avi"].includes(ext ?? "")) return "🎬"
  if (["mp3", "m4a", "wav", "flac"].includes(ext ?? "")) return "🎵"
  if (["pdf"].includes(ext ?? "")) return "📕"
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext ?? "")) return "🗜️"
  return "📄"
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1)
  return `${(bytes / 1024 ** (index + 1)).toFixed(bytes >= 1024 ** (index + 2) ? 1 : 0)} ${units[index]}`
}

// 图片气泡：按本地路径由原生侧直接解码渲染（UIImage 不进 state，避免非原始类型入桥崩溃），点击共享/保存
function ImageBubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const color = mine ? mineColor : cardColor
  return (
    <Button buttonStyle="plain" action={() => message.url && ShareSheet.present([message.url])}>
      <VStack alignment="leading" spacing={6} padding={6} background={{ style: color, shape: bubbleShape }} frame={{ maxWidth: 220 }}>
        <Image filePath={message.url ?? ""} resizable={true} scaleToFit={true} frame={{ maxWidth: 208, maxHeight: 280 }} />
        <Text font={12} foregroundStyle={mine ? metaMineColor : "secondaryLabel"}>
          {message.fileName ?? "图片"} · {formatSize(message.fileSize ?? 0)}
        </Text>
      </VStack>
    </Button>
  )
}

// 文件气泡：图标 + 名 + 大小，同 TextBubble 不设 maxWidth，宽度随内容自适应，点击共享
function FileBubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const color = mine ? mineColor : cardColor
  return (
    <Button buttonStyle="plain" action={() => message.url && ShareSheet.present([message.url ?? ""])}>
      <HStack spacing={10} padding={10} background={{ style: color, shape: bubbleShape }}>
        <Text font={22}>{fileIcon(message.fileName)}</Text>
        <VStack alignment="leading" spacing={2}>
          <Text font={15} multilineTextAlignment="leading" foregroundStyle={mine ? "white" : "label"}>
            {message.fileName ?? "文件"}
          </Text>
          <Text font={12} foregroundStyle={mine ? metaMineColor : "secondaryLabel"}>
            {formatSize(message.fileSize ?? 0)}
          </Text>
        </VStack>
      </HStack>
    </Button>
  )
}

// 文字气泡：不设 maxWidth frame——该运行时下带 maxWidth 的视图是柔性的，
// 会与 Spacer 瓜分剩余空间导致短文字不靠边；长文宽度上限改由行内 Spacer 的 minLength 约束。
// textSelection 会让 Text 默认变单行截断，须显式给 lineLimit 区间恢复多行换行
function TextBubble({ text, mine }: { text: string; mine: boolean }) {
  const color = mine ? mineColor : cardColor
  return (
    <VStack alignment="leading" padding={{ horizontal: 14, vertical: 10 }} background={{ style: color, shape: bubbleShape }}>
      <Text font={15} foregroundStyle={mine ? "white" : "label"} multilineTextAlignment="leading" textSelection={true} lineLimit={{ min: 1, max: 99 }}>
        {text}
      </Text>
    </VStack>
  )
}

// 单条消息行：按发送方决定左右
export function Bubble({ message }: { message: ChatMessage }) {
  const mine = message.role === "app"
  const image = message.kind !== "text" && isImage(message)
  // 用 Spacer 将气泡推向一侧：己方靠右、对方靠左。
  // 文字/文件气泡随内容自适应宽度，Spacer 带 minLength 作为对侧最小边距来约束长内容气泡的
  // 最大宽度（见 TextBubble 注释）；图片气泡有固定宽度设计，用普通 Spacer
  const spacer = image ? <Spacer /> : <Spacer minLength={120} />
  return (
    <HStack frame={{ maxWidth: Infinity }}>
      {mine ? spacer : null}
      {message.kind === "text" ? (
        <TextBubble text={message.text ?? ""} mine={mine} />
      ) : image ? (
        <ImageBubble message={message} mine={mine} />
      ) : (
        <FileBubble message={message} mine={mine} />
      )}
      {mine ? null : spacer}
    </HStack>
  )
}
