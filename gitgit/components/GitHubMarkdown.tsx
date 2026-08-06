import { Image, Markdown, RoundedRectangle, VStack, ZStack } from "scripting"
import { githubMarkdownForDisplay } from "../utils/github"
import { COLOR_SECONDARY_LABEL } from "../constants/colors"

const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
const QUOTE_PATTERN = /(^|\n)(?:> ?.*(?:\n|$))+/g

type Segment = { type: "text" | "image"; value: string }

// 去除行首 `>` 标记，避免原生 Markdown 引用缩进过大
function stripQuoteMarkers(value: string): string {
  return value
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join("\n")
    .trim()
}

// 将文本按图片语法拆开，图片交给原生 Image 控制尺寸
function splitSegments(value: string): Segment[] {
  const segments: Segment[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  IMAGE_PATTERN.lastIndex = 0
  while ((match = IMAGE_PATTERN.exec(value)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: "text", value: value.slice(cursor, match.index) })
    }
    segments.push({ type: "image", value: match[2] })
    cursor = match.index + match[0].length
  }
  if (cursor < value.length) {
    segments.push({ type: "text", value: value.slice(cursor) })
  }
  return segments
}

function MarkdownText({ content }: { content: string }) {
  return (
    <Markdown
      content={content}
      theme="basic"
      useDefaultHighlighterTheme
      scrollable={false}
    />
  )
}

function MarkdownImage({
  url,
  onTap,
}: {
  url: string
  onTap?: (url: string) => void
}) {
  return (
    <Image
      imageUrl={url}
      resizable={true}
      scaleToFit={true}
      aspectRatio={{ value: null, contentMode: "fit" }}
      frame={{ maxWidth: "infinity", maxHeight: 360, alignment: "leading" }}
      placeholder={<></>}
      onTapGesture={onTap ? () => onTap(url) : undefined}
    />
  )
}

function SegmentList({
  segments,
  onImageTap,
}: {
  segments: Segment[]
  onImageTap?: (url: string) => void
}) {
  return (
    <VStack
      alignment="leading"
      spacing={8}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      {segments.map((segment, index) => segment.type === "image" ? (
        <MarkdownImage key={`image-${index}`} url={segment.value} onTap={onImageTap} />
      ) : segment.value.trim() ? (
        <MarkdownText key={`text-${index}`} content={segment.value} />
      ) : null)}
    </VStack>
  )
}

export function GitHubMarkdown({
  content,
  fullName,
  onImageTap,
}: {
  content: string
  fullName: string
  onImageTap?: (url: string) => void
}) {
  const markdown = githubMarkdownForDisplay(content, fullName)
  const blocks: Array<{ type: "text" | "quote"; value: string }> = []
  let cursor = 0
  let quoteMatch: RegExpExecArray | null

  QUOTE_PATTERN.lastIndex = 0
  while ((quoteMatch = QUOTE_PATTERN.exec(markdown)) !== null) {
    if (quoteMatch.index > cursor) {
      blocks.push({ type: "text", value: markdown.slice(cursor, quoteMatch.index) })
    }
    blocks.push({ type: "quote", value: quoteMatch[0] })
    cursor = quoteMatch.index + quoteMatch[0].length
  }
  if (cursor < markdown.length) {
    blocks.push({ type: "text", value: markdown.slice(cursor) })
  }

  const source = blocks.length > 0
    ? blocks
    : [{ type: "text" as const, value: markdown }]

  return (
    <VStack alignment="leading" spacing={8}>
      {source.map((block, index) => {
        const segments = splitSegments(
          block.type === "quote" ? stripQuoteMarkers(block.value) : block.value
        )
        if (block.type === "quote") {
          // 被引用内容：左侧色条 + 浅色背景，与新回复区分
          return (
            <VStack
              key={`quote-${index}`}
              alignment="leading"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
              padding={{ vertical: 6, leading: 23, trailing: 10 }}
              background={
                <ZStack alignment="leading">
                  <RoundedRectangle cornerRadius={8} fill="quaternarySystemFill" />
                  <RoundedRectangle
                    cornerRadius={2}
                    fill={COLOR_SECONDARY_LABEL}
                    frame={{ width: 3, maxHeight: "infinity" }}
                    padding={{ vertical: 6, leading: 10 }}
                  />
                </ZStack>
              }
            >
              <SegmentList segments={segments} onImageTap={onImageTap} />
            </VStack>
          )
        }
        return (
          <SegmentList
            key={`text-${index}`}
            segments={segments}
            onImageTap={onImageTap}
          />
        )
      })}
    </VStack>
  )
}
