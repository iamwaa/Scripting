/**
 * PageIndicatorBar — 悬浮小圆点分页指示器
 * 无背景、无箭头，仅圆点直跳；挂在天气页 List 的 safeAreaInset.bottom，
 * List 内容自动避开。圆点带极轻阴影，保证在任何动态天气背景上可辨。
 * 单页（count <= 1）时不渲染。
 */
import { Circle, HStack, Text } from "scripting"
import { textColor } from "./tokens"

// 圆点数量上限：超出后降级为 "3 / 8" 文本，避免一排圆点溢出屏幕
const MAX_DOTS = 12

// 悬浮圆点投影：极轻，只为在浅色背景上托起圆点轮廓
const dotShadow = { color: "rgba(0,0,0,0.3)", radius: 2, y: 1 } as const

export function PageIndicatorBar({
  count,
  index,
  onSelect,
}: {
  count: number
  index: number
  onSelect: (index: number) => void
}) {
  if (count <= 1) return null

  if (count > MAX_DOTS) {
    return (
      <Text font={13} foregroundStyle={textColor.secondary} monospacedDigit shadow={dotShadow}>
        {index + 1} / {count}
      </Text>
    )
  }

  return (
    <HStack alignment="center" spacing={7} padding={{ vertical: 6, horizontal: 10 }}>
      {Array.from({ length: count }, (_, i) => (
        <Circle
          key={i}
          frame={{ width: 7, height: 7 }}
          fill={i === index ? textColor.primary : textColor.tertiary}
          shadow={dotShadow}
          onTapGesture={() => onSelect(i)}
        />
      ))}
    </HStack>
  )
}
