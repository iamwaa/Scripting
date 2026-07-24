/**
 * pages/StashTab.tsx - Stash 独立 Tab
 *
 * 展示 Stash 列表，支持保存当前改动（含未暂存）、点进查看改动文件、应用和删除。
 */

import { Section, Text, HStack, Button, NavigationLink } from "scripting"
import type { StashEntry, FileChange } from "../types/git"
import { COLOR_SECONDARY_LABEL } from "../constants/colors"
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

  return (
    <Section
      footer={
        <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
          保存会包含已暂存与未暂存改动（含未跟踪文件）。点进条目可查看改动文件。
        </Text>
      }
    >
      <Button
        title={stashBusy ? "处理中…" : "保存当前改动"}
        systemImage="archivebox"
        action={onCreateStash}
        disabled={loading || worktreeBusy || committing || changes.length === 0}
      />
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
