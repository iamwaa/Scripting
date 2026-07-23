/**
 * components/BusyOverlay.tsx - 中央忙态浮层
 *
 * 与仓库列表「正在更新状态」同款：全屏淡化 + 毛玻璃卡片 + ProgressView。
 * 供列表状态刷新、历史撤销/回退/重编等长操作复用。
 */

import {
  ZStack,
  VStack,
  Text,
  ProgressView,
  RoundedRectangle,
} from "scripting"
import type { Color } from "scripting"
import { COLOR_LABEL, COLOR_SECONDARY_LABEL } from "../constants/colors"

export function BusyOverlay({
  title,
  message,
}: {
  title: string
  message?: string
}) {
  // List overlay 默认按内容收缩；用屏幕尺寸强制全屏
  const screen = Device.screen
  const isDark = Device.colorScheme === "dark"
  // 暗黑用浅色柔光阴影才可见；浅色仍用常规深色阴影
  const cardShadow = isDark
    ? { color: "rgba(255, 255, 255, 0.15)" as Color, radius: 18, y: 0 }
    : { color: "rgba(0, 0, 0, 0.15)" as Color, radius: 18, y: 0 }
  const cardRadius = 22
  const detail = String(message || "").trim()

  return (
    <ZStack
      alignment="center"
      frame={{
        width: screen.width,
        height: screen.height,
      }}
      background={{
        light: "rgba(242, 242, 247, 0.62)",
        dark: "rgba(0, 0, 0, 0.48)",
      }}
    >
      <VStack
        alignment="center"
        spacing={12}
        padding={{ horizontal: 28, vertical: 22 }}
        frame={{ minWidth: 168 }}
        background={{
          style: "regularMaterial",
          shape: { type: "rect", cornerRadius: cardRadius, style: "continuous" },
        }}
        clipShape={{ type: "rect", cornerRadius: cardRadius, style: "continuous" }}
        // border 不跟随 continuous 圆角，改用 RoundedRectangle 描边
        overlay={
          <RoundedRectangle
            cornerRadius={cardRadius}
            stroke={{
              shapeStyle: {
                light: "rgba(255, 255, 255, 0.40)",
                dark: "rgba(0, 0, 0, 0.40)",
              },
              strokeStyle: { lineWidth: 0.5 },
            }}
          />
        }
        shadow={cardShadow}
      >
        <ProgressView />
        <VStack alignment="center" spacing={4}>
          <Text font="subheadline" fontWeight="semibold" foregroundStyle={COLOR_LABEL}>
            {title}
          </Text>
          {detail ? (
            <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
              {detail}
            </Text>
          ) : null}
        </VStack>
      </VStack>
    </ZStack>
  )
}
