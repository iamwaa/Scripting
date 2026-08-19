import { Button, Picker, Section, Text } from "scripting"
import type { CommitEntry, FileChange, StashEntry } from "../types/git"
import { COLOR_SECONDARY_LABEL } from "../constants/colors"
import { ChangesTab } from "../pages/ChangesTab"
import { FilesTab } from "../pages/FilesTab"
import { HistoryTab } from "../pages/HistoryTab"
import { StashTab } from "../pages/StashTab"

export type RepoDetailTab = 0 | 1 | 2 | 3

export function MergeConflictSection({
  conflictCount,
  mutating,
  onOpen,
}: {
  conflictCount: number
  mutating: boolean
  onOpen: () => void
}) {
  return (
    <Section
      header={<Text>合并冲突</Text>}
      footer={
        <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
          {conflictCount > 0
            ? `仍有 ${conflictCount} 个文件待解决`
            : "冲突已解决，请完成合并提交或中止合并"}
        </Text>
      }
    >
      <Button
        title={
          conflictCount > 0
            ? `处理冲突（${conflictCount}）`
            : "完成或中止合并"
        }
        systemImage="exclamationmark.triangle"
        action={onOpen}
        disabled={mutating}
      />
    </Section>
  )
}

export function RepoDetailTabContent({
  tab,
  onTabChange,
  bookmarkName,
  changes,
  stashes,
  log,
  trackedFiles,
  loading,
  onOpenCommitForm,
  committing,
  stagingBusy,
  stashBusy,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
  onRestore,
  onCreateStash,
  onApplyStash,
  onDropStash,
  onCopyCommit,
  onSelectCommit,
  onRevert,
  onSoftReset,
  onAmend,
  onSearch,
  onLoadMore,
  historyHasMore,
  historySearchBusy,
  historyTotalMatches,
  historyLoading,
  historyLimited,
  githubFullName,
}: {
  tab: RepoDetailTab
  onTabChange: (tab: RepoDetailTab) => void | Promise<void>
  bookmarkName: string
  changes: FileChange[]
  stashes: StashEntry[]
  log: CommitEntry[]
  trackedFiles: string[]
  loading: boolean
  onOpenCommitForm: () => void
  committing: boolean
  stagingBusy: boolean
  stashBusy: boolean
  onStage: (filepath: string) => void | Promise<void>
  onUnstage: (filepath: string) => void | Promise<void>
  onStageAll: () => void | Promise<void>
  onUnstageAll: () => void | Promise<void>
  onRestore: (filepath: string) => void
  onCreateStash: () => void | Promise<void>
  onApplyStash: (entry: StashEntry) => void | Promise<void>
  onDropStash: (entry: StashEntry) => void
  onCopyCommit: (entry: CommitEntry) => void | Promise<void>
  onSelectCommit: (entry: CommitEntry) => void
  onRevert: (entry: CommitEntry) => void
  onSoftReset: (entry: CommitEntry) => void
  onAmend: (entry: CommitEntry) => void | Promise<void>
  onSearch: (query: string) => void | Promise<void>
  onLoadMore: () => void | Promise<void>
  historyHasMore: boolean
  historySearchBusy: boolean
  historyTotalMatches: number | null
  historyLoading: boolean
  historyLimited: boolean
  githubFullName: string | null
}) {
  return (
    <>
      <Section>
        <Picker
          title="视图"
          value={tab}
          onChanged={(value: number) => onTabChange(value as RepoDetailTab)}
          pickerStyle="segmented"
        >
          <Text tag={0}>改动</Text>
          <Text tag={1}>Stash</Text>
          <Text tag={2}>文件</Text>
          <Text tag={3}>历史</Text>
        </Picker>
      </Section>
      {tab === 0 ? (
        <ChangesTab
          bookmarkName={bookmarkName}
          changes={changes}
          loading={loading}
          onOpenCommitForm={onOpenCommitForm}
          committing={committing}
          stagingBusy={stagingBusy}
          onStage={onStage}
          onUnstage={onUnstage}
          onStageAll={onStageAll}
          onUnstageAll={onUnstageAll}
          onRestore={onRestore}
        />
      ) : tab === 1 ? (
        <StashTab
          bookmarkName={bookmarkName}
          changes={changes}
          stashes={stashes}
          loading={loading}
          committing={committing}
          stagingBusy={stagingBusy}
          stashBusy={stashBusy}
          onCreateStash={onCreateStash}
          onApplyStash={onApplyStash}
          onDropStash={onDropStash}
        />
      ) : tab === 2 ? (
        <FilesTab files={trackedFiles} loading={loading} />
      ) : (
        <HistoryTab
          log={log}
          loading={historyLoading}
          onCopy={onCopyCommit}
          onSelect={onSelectCommit}
          onRevert={onRevert}
          onSoftReset={onSoftReset}
          onAmend={onAmend}
          onSearch={onSearch}
          onLoadMore={onLoadMore}
          hasMore={historyHasMore}
          searchBusy={historySearchBusy}
          totalMatches={historyTotalMatches}
          limited={historyLimited}
          githubFullName={githubFullName}
        />
      )}
    </>
  )
}
