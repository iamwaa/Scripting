import { Text, VStack } from "scripting"
import type { Color } from "scripting"

// 虎扑评分是 10 分制,按档位给出 Light/Dark 双套色值
function scoreColor(score: number): { light: Color; dark: Color } {
  if (score >= 8.5) return { light: "#C31432", dark: "#FF5A6E" }
  if (score >= 7) return { light: "#C46A00", dark: "#FFAE42" }
  if (score >= 5) return { light: "#6B6B6B", dark: "#B0B0B0" }
  return { light: "#1E6FD9", dark: "#5AA2FF" }
}

interface HupuScoreBadgeProps {
  score: number | null
  count?: number
  size?: number
}

// 评分徽章:主分数 + 可选评分人数
export function HupuScoreBadge({ score, count, size = 18 }: HupuScoreBadgeProps) {
  const label = score == null || score <= 0 ? "—" : score.toFixed(1)
  const color = score == null || score <= 0 ? "secondaryLabel" : scoreColor(score)

  return (
    <VStack alignment="center" spacing={2}>
      <Text font={size} fontWeight="bold" foregroundStyle={color}>
        {label}
      </Text>
      {count != null ? (
        <Text font={11} foregroundStyle="tertiaryLabel" lineLimit={1}>
          {formatCount(count)}评分
        </Text>
      ) : null}
    </VStack>
  )
}

// 人数简写:10000 -> 1.0万
export function formatCount(value: number): string {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(1)}万`
  }
  return String(value)
}
