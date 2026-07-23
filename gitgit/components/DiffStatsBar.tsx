/**
 * components/DiffStatsBar.tsx - diff 增删统计悬浮胶囊
 *
 * 导航栏下方居中悬浮，可着色显示 +N/-M。
 */

import { HStack, Text } from "scripting"
import {
  COLOR_GREEN,
  COLOR_RED,
  COLOR_SECONDARY_LABEL,
} from "../constants/colors"

/** Liquid Glass 仅 iOS 26+；低版本走 Material 胶囊 */
const supportsLiquidGlass = (() => {
  const major = Number.parseInt(String(Device.systemVersion).split(".")[0] ?? "0", 10)
  return Number.isFinite(major) && major >= 26
})()

/** 胶囊表面：iOS 26+ 玻璃，否则 ultraThinMaterial */
function capsuleSurfaceProps() {
  if (supportsLiquidGlass) {
    return {
      glassEffect: {
        glass: UIGlass.clear().interactive(true),
        shape: "capsule" as const,
      },
    }
  }
  return {
    background: {
      style: "ultraThinMaterial" as const,
      shape: "capsule" as const,
    },
    clipShape: "capsule" as const,
  }
}

export function DiffStatsBar({
  added,
  deleted,
  binary = false,
  isNewFile = false,
  isDeletedFile = false,
}: {
  added: number
  deleted: number
  binary?: boolean
  isNewFile?: boolean
  isDeletedFile?: boolean
}) {
  return (
    // 外层铺满宽度并居中，本身透明，只让胶囊悬浮
    <HStack
      alignment="center"
      padding={{ horizontal: 16, top: 4, bottom: 8 }}
      frame={{ maxWidth: Infinity, alignment: "center" }}
    >
      <HStack
        spacing={8}
        alignment="center"
        padding={{ horizontal: 14, vertical: 7 }}
        shadow={{
          color: "rgba(72,88,120,0.22)",
          radius: 10,
          y: 3,
        }}
        {...capsuleSurfaceProps()}
      >
        {binary ? (
          <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
            二进制文件
          </Text>
        ) : (
          <>
            <Text font="caption" fontWeight="semibold" foregroundStyle={COLOR_GREEN}>
              +{added}
            </Text>
            <Text font="caption" fontWeight="semibold" foregroundStyle={COLOR_RED}>
              -{deleted}
            </Text>
          </>
        )}
        {isNewFile ? (
          <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
            新增文件
          </Text>
        ) : null}
        {isDeletedFile ? (
          <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
            删除文件
          </Text>
        ) : null}
      </HStack>
    </HStack>
  )
}
