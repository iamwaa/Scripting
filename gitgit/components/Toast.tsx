/**
 * components/Toast.tsx - Toast 提示工具
 *
 * 使用 Scripting 内置 toast prop（非自定义 overlay）。
 * 提供按类型渲染的 content 节点和颜色映射。
 * 适配 Light/Dark 模式，使用语义色。
 */

import { HStack, Image, Text } from "scripting"
import type { Color } from "scripting"
import type { ToastType } from "../hooks/useToast"
import {
  COLOR_LABEL,
  COLOR_GREEN,
  COLOR_RED,
  COLOR_ORANGE,
  COLOR_ACCENT,
} from "../constants/colors"

/** 类型 → 图标 + 颜色 */
const TOAST_CONFIG: Record<
  ToastType,
  { icon: string; color: Color }
> = {
  success: { icon: "checkmark.circle.fill", color: COLOR_GREEN },
  error: { icon: "xmark.octagon.fill", color: COLOR_RED },
  warning: { icon: "exclamationmark.triangle.fill", color: COLOR_ORANGE },
  info: { icon: "info.circle.fill", color: COLOR_ACCENT },
}

/**
 * 构建 toast content 节点（图标 + 文案）
 * 供 List / 页面的 toast prop content 使用
 */
export function toastContent(message: string, type: ToastType = "info") {
  const config = TOAST_CONFIG[type] ?? TOAST_CONFIG.info
  return (
    <HStack alignment="center" spacing={8}>
      <Image
        systemName={config.icon}
        font={16}
        foregroundStyle={config.color}
      />
      <Text font={14} foregroundStyle={COLOR_LABEL}>
        {message}
      </Text>
    </HStack>
  )
}
