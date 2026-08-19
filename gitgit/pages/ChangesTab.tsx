/**
 * pages/ChangesTab.tsx - 改动 Tab 子组件
 *
 * 改动文件列表 + GitHub 风格提交（标题必填、描述选填）。
 * 提交信息区仅在有已暂存改动时显示；全部暂存/取消暂存；文件级左滑暂存/撤销。
 */

import {
  Section,
  Text,
  HStack,
  Spacer,
  Button,
  Image,
  NavigationLink,
} from "scripting"
import type { FileChange } from "../types/git"
import { FileStatusRow } from "../components/FileStatusRow"
import { DiffPage } from "./DiffPage"
import {
  COLOR_SECONDARY_LABEL,
  COLOR_GREEN,
  COLOR_ACCENT,
  COLOR_RED,
} from "../constants/colors"

export function ChangesTab({
  bookmarkName,
  changes,
  loading,
  onOpenCommitForm,
  committing,
  stagingBusy,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
  onRestore,
}: {
  bookmarkName: string
  changes: FileChange[]
  loading: boolean
  committing: boolean
  stagingBusy: boolean
  onOpenCommitForm: () => void
  onStage: (filepath: string) => void
  onUnstage: (filepath: string) => void
  onStageAll: () => void
  onUnstageAll: () => void
  onRestore: (filepath: string) => void
}) {
  const hasUnstaged = changes.some((change) => change.unstaged)
  const hasStaged = changes.some((change) => change.staged)
  const worktreeBusy = stagingBusy
  // 无改动时禁用，但仍显示「全部暂存」，避免提交清空后卡在「取消暂存」
  const bulkDisabled =
    loading || worktreeBusy || committing || (!hasUnstaged && !hasStaged)
  // 有未暂存 → 全部暂存；仅已暂存 → 取消暂存；无改动默认全部暂存
  const canUnstageAll = hasStaged && !hasUnstaged
  const bulkAction = canUnstageAll ? onUnstageAll : onStageAll
  const bulkTitle = stagingBusy
    ? "处理中…"
    : canUnstageAll
      ? "取消暂存"
      : "全部暂存"
  // List 的 systemImage 会落到行首导致离文字很远；header 用自定义紧凑 label
  const bulkSystemImage = stagingBusy
    ? null
    : canUnstageAll
      ? "minus.circle"
      : "plus.circle"
  // 禁用时用次级灰色，避免仍像可点的强调色
  const bulkTint = bulkDisabled
    ? COLOR_SECONDARY_LABEL
    : canUnstageAll
      ? COLOR_RED
      : COLOR_ACCENT

  return (
    <>
      <Section
        header={
          <HStack alignment="center">
            <Text>改动文件{changes.length > 0 ? `（${changes.length}）` : "" }</Text>
            <Spacer />
            <Button
              action={bulkAction}
              disabled={bulkDisabled}
              tint={bulkTint}
            >
              <HStack alignment="center" spacing={4}>
                {bulkSystemImage ? (
                  <Image
                    systemName={bulkSystemImage}
                    font="caption"
                    foregroundStyle={bulkTint}
                  />
                ) : null}
                <Text font="caption" foregroundStyle={bulkTint}>
                  {bulkTitle}
                </Text>
              </HStack>
            </Button>
          </HStack>
        }
      >
        {loading ? (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载中…</Text>
        ) : changes.length === 0 ? (
          <HStack alignment="center" spacing={6}>
            <Image
              systemName="checkmark.circle.fill"
              foregroundStyle={COLOR_GREEN}
            />
            <Text foregroundStyle={COLOR_SECONDARY_LABEL}>没有未提交的改动</Text>
          </HStack>
        ) : (
          <>
            {changes.map((c) => (
              <HStack
                key={c.filepath}
                alignment="center"
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button
                      title={c.unstaged ? "暂存" : "取消暂存"}
                      systemImage={c.unstaged ? "plus.circle" : "minus.circle"}
                      tint={c.unstaged ? "systemBlue" : "systemRed"}
                      action={() => c.unstaged ? onStage(c.filepath) : onUnstage(c.filepath)}
                      disabled={(!c.unstaged && !c.staged) || worktreeBusy}
                    />,
                    <Button
                      title="撤销"
                      systemImage="arrow.uturn.backward.circle"
                      tint="systemRed"
                      action={() => onRestore(c.filepath)}
                      disabled={worktreeBusy}
                    />,
                  ],
                }}
              >
                <NavigationLink
                  destination={
                    <DiffPage bookmarkName={bookmarkName} filepath={c.filepath} />
                  }
                >
                  <FileStatusRow change={c} />
                </NavigationLink>
              </HStack>
            ))}
          </>
        )}
      </Section>

      {/* 无可提交内容时隐藏，避免空操作占位 */}
      {hasStaged ? (
        <Section>
          <Button
            title={committing ? "提交中…" : "提交改动"}
            systemImage="checkmark.circle"
            action={onOpenCommitForm}
            disabled={committing || worktreeBusy}
          />
        </Section>
      ) : null}
    </>
  )
}
