/**
 * widget.tsx - 桌面小组件
 *
 * 显示所有仓库的未提交改动总数概览。
 * 数据来源：repoStore.writeSnapshot() 写入的同步快照（持久化于 Storage private 域）。
 * 适配明暗模式（全部使用语义色）。
 */

import { VStack, HStack, Text, Image, Widget } from "scripting"
import { readSnapshots } from "./services/repoStore"
import type { RepoSnapshot } from "./types/git"
import {
  COLOR_LABEL,
  COLOR_SECONDARY_LABEL,
  COLOR_ACCENT,
  COLOR_ORANGE,
  COLOR_GREEN,
} from "./constants/colors"

/** 渲染小组件 */
function WidgetView({ snapshots }: { snapshots: RepoSnapshot[] }) {
  // 有未提交改动的仓库
  const dirty = snapshots.filter((s) => s.uncommitted > 0)
  const totalDirty = dirty.reduce((sum, s) => sum + s.uncommitted, 0)

  return (
    <VStack alignment="leading" spacing={6} frame={{ maxWidth: Infinity }}>
      <HStack alignment="center" spacing={6}>
        <Image systemName="square.stack.3d.up.fill" foregroundStyle={COLOR_ACCENT} />
        <Text font="headline" foregroundStyle={COLOR_LABEL}>
          gitgit
        </Text>
      </HStack>

      {snapshots.length === 0 ? (
        <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
          还没有仓库
        </Text>
      ) : totalDirty === 0 ? (
        <HStack alignment="center" spacing={4}>
          <Image systemName="checkmark.circle.fill" foregroundStyle={COLOR_GREEN} />
          <Text font="subheadline" foregroundStyle={COLOR_SECONDARY_LABEL}>
            所有仓库都很干净
          </Text>
        </HStack>
      ) : (
        <HStack alignment="firstTextBaseline" spacing={4}>
          <Text font="title" foregroundStyle={COLOR_ORANGE}>
            {String(totalDirty)}
          </Text>
          <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
            个未提交改动 · {dirty.length} 个仓库
          </Text>
        </HStack>
      )}

      {/* 列出最多 3 个有改动的仓库 */}
      {dirty.slice(0, 3).map((s) => (
        <HStack key={s.name} alignment="center" spacing={6}>
          <Image systemName="arrow.triangle.branch" foregroundStyle={COLOR_SECONDARY_LABEL} />
          <Text font="caption" foregroundStyle={COLOR_LABEL} lineLimit={1}>
            {s.name}
          </Text>
          <Text font="caption" foregroundStyle={COLOR_ORANGE}>
            {String(s.uncommitted)}
          </Text>
        </HStack>
      ))}
    </VStack>
  )
}

// 异步读取快照后渲染
readSnapshots()
  .then((map) => {
    const snapshots = Object.values(map)
    Widget.present(<WidgetView snapshots={snapshots} />)
  })
  .catch(() => {
    // 读取失败时渲染空状态
    Widget.present(<WidgetView snapshots={[]} />)
  })
