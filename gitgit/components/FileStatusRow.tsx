/**
 * components/FileStatusRow.tsx - 文件状态行
 *
 * 显示文件路径 + 状态徽标（M/A/D/!），适配暗黑模式
 */

import { HStack, Text, Spacer } from "scripting"
import type { FileChangeStatus } from "../types/git"
import { truncatePath } from "../utils/format"
import {
  COLOR_LABEL,
  COLOR_SECONDARY_LABEL,
  COLOR_ORANGE,
} from "../constants/colors"

/** 状态 → 单字母徽标 */
function statusBadge(status: FileChangeStatus): string {
  if (status.startsWith("*")) return "!"
  switch (status) {
    case "added":
      return "A"
    case "modified":
      return "M"
    case "deleted":
      return "D"
    default:
      return "·"
  }
}

/** 状态 → 简短中文描述 */
function statusLabel(status: FileChangeStatus): string {
  switch (status) {
    case "added":
      return "已暂存·新增"
    case "*added":
      return "未暂存·新增"
    case "modified":
      return "已暂存·修改"
    case "*modified":
      return "未暂存·修改"
    case "deleted":
      return "已暂存·删除"
    case "*deleted":
      return "未暂存·删除"
    default:
      return "无变化"
  }
}

export function FileStatusRow({ change }: { change: { filepath: string; status: FileChangeStatus } }) {
  const badge = statusBadge(change.status)
  const label = statusLabel(change.status)
  return (
    <HStack alignment="center">
      {/* 徽标：用语义色，自动适配暗黑 */}
      <Text
        font="body"
        foregroundStyle={
          change.status.startsWith("*") ? COLOR_SECONDARY_LABEL : COLOR_ORANGE
        }
      >
        {badge}
      </Text>
      <Text font="body" foregroundStyle={COLOR_LABEL} lineLimit={1}>
        {truncatePath(change.filepath)}
      </Text>
      <Spacer />
      <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
        {label}
      </Text>
    </HStack>
  )
}
