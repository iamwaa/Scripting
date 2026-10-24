import { HStack, Image, Text, VStack } from "scripting"
import { HupuAvatar } from "./HupuAvatar"

interface HupuCommentBubbleProps {
  content: string
  // 有评论用户时显示其头像与昵称,否则用火苗图标标识「热评」
  user?: string
  avatar?: string
  lineLimit?: number
}

const AVATAR_SIZE = 16

// 热评气泡:左上角收窄成「尾巴」,底色用系统填充色适配深浅色
export function HupuCommentBubble({ content, user, avatar, lineLimit = 2 }: HupuCommentBubbleProps) {
  const showUser = !!user

  return (
    <HStack
      alignment="top"
      spacing={6}
      padding={{ horizontal: 10, vertical: 7 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={{
        style: "tertiarySystemFill",
        shape: {
          type: "rect",
          cornerRadii: { topLeading: 3, topTrailing: 12, bottomLeading: 12, bottomTrailing: 12 },
          style: "continuous",
        },
      }}
    >
      {showUser ? (
        <HupuAvatar url={avatar ?? ""} size={AVATAR_SIZE} />
      ) : (
        <Image systemName="flame.fill" font={13} imageScale="small" foregroundStyle="orange" padding={{ top: 2 }} />
      )}
      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {showUser ? (
          <Text font={11} foregroundStyle="tertiaryLabel" lineLimit={1} frame={{ minHeight: AVATAR_SIZE, alignment: "leading" }}>
            {user}
          </Text>
        ) : null}
        <Text
          font={13}
          foregroundStyle="secondaryLabel"
          lineLimit={lineLimit}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          fixedSize={{ horizontal: false, vertical: true }}
        >
          {content}
        </Text>
      </VStack>
    </HStack>
  )
}
