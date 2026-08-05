/**
 * pages/StashTab.tsx - Stash 独立 Tab
 *
 * 展示 Stash 列表，支持保存当前改动（含未暂存）、点进查看改动文件、应用和删除。
 */

import { Section, Text, HStack, Spacer, Button, Image, NavigationLink } from "scripting"
import type { StashEntry, FileChange } from "../types/git"
import {
  COLOR_SECONDARY_LABEL,
  COLOR_ACCENT,
} from "../constants/colors"
import { CommitDetailPage } from "./CommitDetailPage"

export function StashTab({
  bookmarkName,
  changes,
  stashes,
  loading,
  committing,
  stagingBusy,
  stashBusy,
  onCreateStash,
  onApplyStash,
  onDropStash,
}: {
  bookmarkName: string
  changes: FileChange[]
  stashes: StashEntry[]
  loading: boolean
  committing: boolean
  stagingBusy: boolean
  stashBusy: boolean
  onCreateStash: () => void
  onApplyStash: (entry: StashEntry) => void
  onDropStash: (entry: StashEntry) => void
}) {
  const worktreeBusy = stagingBusy || stashBusy
  // 无改动时禁用，但仍显示，与改动 Tab 的「全部暂存」一致
  const saveDisabled =
    loading || worktreeBusy || committing || changes.length === 0
  const saveTint = saveDisabled ? COLOR_SECONDARY_LABEL : COLOR_ACCENT

  return (
    <Section
      header={
        <HStack alignment="center">
          <Text>Stash{stashes.length > 0 ? `（${stashes.length}）` : ""}</Text>
          <Spacer />
          <Button action={onCreateStash} disabled={saveDisabled} tint={saveTint}>
            <HStack alignment="center" spacing={4}>
              <Image
                systemName="archivebox"
                font="caption"
                foregroundStyle={saveTint}
              />
              <Text font="caption" foregroundStyle={saveTint}>
                {stashBusy ? "处理中…" : "保存"}
              </Text>
            </HStack>
          </Button>
        </HStack>
      }
      footer={
        <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
          保存会包含已暂存与未暂存改动（含未跟踪文件）。点进条目可查看改动文件。
        </Text>
      }
    >
      {stashes.length === 0 ? (
        <Text foregroundStyle={COLOR_SECONDARY_LABEL}>没有 Stash</Text>
      ) : (
        stashes.map((entry) => {
          const row = (
            <Text>{entry.message}</Text>
          )
          return (
            <HStack
              key={entry.index}
              alignment="center"
              trailingSwipeActions={{
                allowsFullSwipe: false,
                actions: [
                  <Button
                    title="应用"
                    systemImage="arrow.down.to.line"
                    tint="systemBlue"
                    action={() => onApplyStash(entry)}
                    disabled={worktreeBusy}
                  />,
                  <Button
                    title="删除"
                    systemImage="trash"
                    tint="systemRed"
                    action={() => onDropStash(entry)}
                    disabled={worktreeBusy}
                  />,
                ],
              }}
            >
              {entry.oid ? (
                <NavigationLink
                  destination={
                    <CommitDetailPage
                      bookmarkName={bookmarkName}
                      oid={entry.oid}
                      title="Stash 详情"
                    />
                  }
                >
                  {row}
                </NavigationLink>
              ) : (
                row
              )}
            </HStack>
          )
        })
      )}
    </Section>
  )
}
