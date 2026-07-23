/**
 * pages/StashTab.tsx - Stash 独立 Tab
 *
 * 展示 Stash 列表，支持保存当前改动、应用和删除 Stash。
 */

import { Section, Text, HStack, Button } from "scripting"
import type { StashEntry, FileChange } from "../types/git"
import { COLOR_SECONDARY_LABEL } from "../constants/colors"

export function StashTab({
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
    <Section>
      <Button
        title={stashBusy ? "处理中…" : "保存当前改动"}
        systemImage="archivebox"
        action={onCreateStash}
        disabled={loading || worktreeBusy || committing || changes.length === 0}
      />
      {stashes.length === 0 ? (
        <Text foregroundStyle={COLOR_SECONDARY_LABEL}>没有 Stash</Text>
      ) : (
        stashes.map((entry) => (
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
            <Text>{entry.message}</Text>
          </HStack>
        ))
      )}
    </Section>
  )
}
