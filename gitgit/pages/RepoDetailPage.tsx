/**
 * pages/RepoDetailPage.tsx - 仓库详情页
 *
 * 只负责声明式 UI 与各编排 hook 的接线：
 * - 数据加载与 Tab 懒加载：hooks/useRepoDetailData
 * - 全屏操作遮罩：hooks/useOpBusy
 * - 子页导航：hooks/useRepoDetailNavigation
 * - 工作区（暂存 / Stash / 提交）：hooks/useRepoWorktreeActions
 * - 需确认的操作（丢弃 / 删分支 / 撤销 / 回退 / 重编 / 回滚）：hooks/useRepoPendingActions
 * - 分支与同步动作：hooks/useRepoBranchActions、hooks/useRepoSyncActions
 */

import { List, Text, Button, Menu, useState } from "scripting"
import { BusyOverlay } from "../components/BusyOverlay"
import { toastContent } from "../components/Toast"
import { useToast } from "../hooks/useToast"
import { RepoBranchSection } from "../components/RepoBranchSection"
import { RepoRemoteSections } from "../components/RepoRemoteSections"
import {
  MergeConflictSection,
  RepoDetailTabContent,
} from "../components/RepoDetailContent"
import { RepoDetailDestination } from "../components/RepoDetailDestination"
import { CommitMessageSheet } from "../components/CommitMessageSheet"
import { useOpBusy } from "../hooks/useOpBusy"
import { useRepoDetailData } from "../hooks/useRepoDetailData"
import { useRepoDetailNavigation } from "../hooks/useRepoDetailNavigation"
import { useRepoWorktreeActions } from "../hooks/useRepoWorktreeActions"
import { useRepoPendingActions } from "../hooks/useRepoPendingActions"
import { useRepoBranchActions } from "../hooks/useRepoBranchActions"
import { useRepoSyncActions } from "../hooks/useRepoSyncActions"
import { updateBranchLastPulledAt } from "../services/repoStore"
import { shortOid, suggestCommitTitle } from "../utils/format"
import { getRepoPendingAlert } from "../utils/repoDetailAlerts"

type AlertState = {
  title: string
  message: string
} | null

export function RepoDetailPage({
  bookmarkName,
  name,
}: {
  bookmarkName: string
  name: string
}) {
  const [alertState, setAlertState] = useState<AlertState>(null)
  const { toastState, showToast, handleToastChanged, toastPresented } = useToast()

  function showAlert(title: string, message: string) {
    setAlertState({ title, message })
  }

  const data = useRepoDetailData({ bookmarkName, name, showToast })
  const { opBusy, beginOpBusy, updateOpBusy, endOpBusy, makeSyncCancel } =
    useOpBusy()
  const nav = useRepoDetailNavigation()

  const worktree = useRepoWorktreeActions({
    bookmarkName,
    displayName: data.displayName,
    changes: data.changes,
    beginOpBusy,
    endOpBusy,
    clearChanges: () => data.setChanges([]),
    reloadRepo: data.loadAll,
    refreshChangesAndSnapshot: data.refreshChangesAndSnapshot,
    loadChanges: data.loadChanges,
    loadStashes: data.loadStashes,
    setPending: (action) => pendingActions.setPending(action),
    showToast,
  })

  const pendingActions = useRepoPendingActions({
    bookmarkName,
    hasRemote: data.hasRemote,
    currentBranch: data.branchInfo.current,
    remoteOnlyBranches: data.remoteOnlyBranches,
    beginOpBusy,
    updateOpBusy,
    endOpBusy,
    makeSyncCancel,
    reloadRepo: data.loadAll,
    loadStashes: data.loadStashes,
    setStashBusy: worktree.setStashBusy,
    openAmendSheet: () => worktree.setCommitSheetMode("amend"),
    closeCommitSheet: worktree.closeCommitSheet,
    closeRollbackPage: () => nav.closePage("rollback"),
    showAlert,
    showToast,
  })

  // 仓库级互斥：任一写操作进行中时禁用分支切换、暂存、提交、同步、合并、撤销等
  const mutating =
    worktree.committing ||
    worktree.stagingBusy ||
    worktree.stashBusy ||
    opBusy != null

  const {
    handleMergeIntoCurrent,
    handleSwitchBranch,
    handleRenameBranch,
    handleCreateBranch,
  } = useRepoBranchActions({
    bookmarkName,
    currentBranch: data.branchInfo.current,
    hasCommits: data.hasCommits,
    hasRemote: data.hasRemote,
    mutating,
    mergeInProgress: data.mergeInProgress,
    beginOpBusy,
    endOpBusy,
    reloadRepo: data.loadAll,
    showAlert,
    showToast,
    openConflictsPage: nav.openConflictsPage,
  })

  const { handlePush, handlePull } = useRepoSyncActions({
    bookmarkName,
    displayName: data.displayName,
    currentBranch: data.branchInfo.current,
    hasRemote: data.hasRemote,
    beginOpBusy,
    updateOpBusy,
    endOpBusy,
    makeSyncCancel,
    setPulledAt: (branch, timestamp) => {
      updateBranchLastPulledAt(bookmarkName, branch, timestamp)
      data.setLastPulledAt(timestamp)
    },
    refreshSyncState: data.refreshSyncState,
    reloadRepo: data.loadAll,
    showAlert,
    showToast,
    openConflictsPage: nav.openConflictsPage,
  })

  async function handleRefresh() {
    // 操作进行中点刷新只重读当前 Tab 的核心数据，避免与 loadAll 竞态
    if (mutating) {
      if (data.tab === 0) await data.loadChanges()
      else if (data.tab === 1) await data.loadStashes()
      else if (data.tab === 2) await data.loadTrackedFiles()
      else await data.loadLog()
      return
    }
    await data.loadAll()
  }

  const confirmAlert = pendingActions.pending
    ? getRepoPendingAlert(pendingActions.pending)
    : null

  const activeAlert =
    confirmAlert != null
      ? { ...confirmAlert, isConfirm: true as const }
      : alertState
        ? {
            title: alertState.title,
            message: alertState.message,
            isConfirm: false as const,
            confirmButton: "好",
          }
        : null

  const canUpload = !data.hasRemote && data.repoSource !== "clone"

  return (
    <List
      navigationTitle={data.displayName}
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      overlay={
        opBusy
          ? {
            alignment: "center",
            content: (
              <BusyOverlay
                title={opBusy.title}
                message={opBusy.message}
                onCancel={opBusy.onCancel}
                cancelling={opBusy.cancelling}
              />
            ),
          }
          : undefined
      }
      toast={
        toastState
          ? {
              isPresented: toastPresented,
              onChanged: handleToastChanged,
              content: toastContent(toastState.message, toastState.type),
              duration: toastState.duration,
              position: "top",
            }
          : undefined
      }
      onAppear={() => {
        if (nav.consumeSkipNextAppearLoad()) return
        data.loadAll()
      }}
      refreshable={handleRefresh}
      toolbar={{
        topBarTrailing: data.githubFullName ? (
          <Menu title="GitHub" systemImage="rectangle.stack">
            <Button
              title="Issues"
              systemImage="smallcircle.filled.circle"
              action={() => nav.openGitHubWorkPage(0)}
            />
            <Button
              title="Pull Requests"
              systemImage="arrow.triangle.merge"
              action={() => nav.openGitHubWorkPage(1)}
            />
            <Button
              title="Actions"
              systemImage="hammer.fill"
              action={() => nav.openGitHubWorkPage(2)}
            />
          </Menu>
        ) : undefined,
      }}
      navigationDestination={{
        isPresented: nav.isPresented,
        onChanged: (presented: boolean) => {
          if (!presented) {
            nav.closeAll()
            // 从冲突页返回时刷新合并状态
            data.loadMergeState()
          }
        },
        content: (
          <RepoDetailDestination
            bookmarkName={bookmarkName}
            displayName={data.displayName}
            showUpload={nav.page === "upload"}
            showRemotes={nav.page === "remotes"}
            showConflicts={nav.page === "conflicts"}
            showCompare={nav.page === "compare"}
            showRollback={nav.page === "rollback"}
            currentBranch={data.branchInfo.current}
            githubFullName={
              nav.page === "githubWork" ? data.githubFullName : null
            }
            githubWorkKind={nav.githubWorkKind}
            commitGithubFullName={data.githubFullName}
            selectedCommitOid={nav.selectedCommitOid}
            onRollbackSelect={pendingActions.handleRollbackSelect}
            onUploaded={(repo) => {
              data.setDisplayName(repo.name)
              data.setRepoSource(repo.source || "clone")
              data.setHasRemote(true)
              nav.closePage("upload")
              data.loadAll().then(() => {
                showToast("上传成功：已上传到 " + repo.name, "success")
              })
            }}
            onRemotesChanged={() => {
              data.refreshRemoteConfig()
            }}
            onConflictsChanged={(reason) => {
              if (reason === "completed") {
                // 完成合并后避免返回详情页时再做一次全树扫描（P2.42）
                nav.skipNextAppearLoad()
              }
              data.loadMergeState()
              data.loadChanges()
              data.refreshHistoryIfLoaded()
            }}
          />
        ),
      }}
      sheet={{
        isPresented: worktree.commitSheetMode != null,
        onChanged: (presented: boolean) => {
          if (!presented) worktree.closeCommitSheet()
        },
        content: worktree.commitSheetMode === "amend" ? (
          <CommitMessageSheet
            key={`amend-${pendingActions.amendDraft.title}`}
            navigationTitle="重编提交"
            confirmTitle="提交"
            footer="确认后将改写最近一次提交。只能用于尚未推送的 HEAD，已推送会被拒绝。"
            initialTitle={pendingActions.amendDraft.title}
            initialDescription={pendingActions.amendDraft.description}
            onCancel={worktree.closeCommitSheet}
            onConfirm={pendingActions.handleAmendFormConfirm}
          />
        ) : (
          <CommitMessageSheet
            navigationTitle="提交改动"
            confirmTitle="提交"
            initialTitle={suggestCommitTitle(data.changes)}
            initialDescription=""
            busy={worktree.committing}
            onCancel={worktree.closeCommitSheet}
            onConfirm={worktree.handleCommit}
          />
        ),
      }}
      alert={{
        title: activeAlert?.title ?? "",
        message: <Text>{activeAlert?.message ?? ""}</Text>,
        isPresented: activeAlert != null,
        onChanged: (presented: boolean) => {
          if (!presented) {
            pendingActions.clearPending()
            setAlertState(null)
          }
        },
        actions: activeAlert?.isConfirm ? (
          <>
            <Button
              title="取消"
              role="cancel"
              action={pendingActions.clearPending}
            />
            <Button
              title={activeAlert.confirmButton}
              role="destructive"
              action={pendingActions.runPending}
            />
          </>
        ) : (
          <Button title="好" role="cancel" action={() => setAlertState(null)} />
        ),
      }}
    >
      <RepoBranchSection
        branchInfo={data.branchInfo}
        remoteOnlyBranches={data.remoteOnlyBranches}
        remoteBranchNames={data.remoteBranchNames}
        mergeSources={data.mergeSources}
        deletableBranches={data.deletableBranches}
        hasCommits={data.hasCommits}
        hasRemote={data.hasRemote}
        mergeInProgress={data.mergeInProgress}
        mutating={mutating}
        onDelete={pendingActions.requestDeleteBranch}
        onMerge={handleMergeIntoCurrent}
        onRename={handleRenameBranch}
        onCreate={handleCreateBranch}
        onSwitch={handleSwitchBranch}
      />

      {data.mergeInProgress ? (
        <MergeConflictSection
          conflictCount={data.conflictCount}
          mutating={mutating}
          onOpen={nav.openConflictsPage}
        />
      ) : null}

      <RepoRemoteSections
        branchInfo={data.branchInfo}
        upstream={data.upstream}
        pulledLabel={data.pulledLabel}
        hasRemote={data.hasRemote}
        canUpload={canUpload}
        mergeInProgress={data.mergeInProgress}
        mutating={mutating}
        hasCommits={data.hasCommits}
        onCompare={() => nav.openPage("compare", { skipReload: true })}
        onRollback={() => nav.openPage("rollback")}
        onManageRemotes={() => nav.openPage("remotes")}
        onUpload={() => nav.openPage("upload")}
        onPush={handlePush}
        onPull={handlePull}
      />

      <RepoDetailTabContent
        tab={data.tab}
        onTabChange={data.handleTabChange}
        bookmarkName={bookmarkName}
        changes={data.changes}
        stashes={data.stashes}
        log={data.log}
        trackedFiles={data.trackedFiles}
        loading={data.loading}
        onOpenCommitForm={worktree.openCommitForm}
        committing={worktree.committing}
        stagingBusy={worktree.stagingBusy}
        stashBusy={worktree.stashBusy}
        onStage={worktree.handleStage}
        onUnstage={worktree.handleUnstage}
        onStageAll={worktree.handleStageAll}
        onUnstageAll={worktree.handleUnstageAll}
        onRestore={worktree.handleRestore}
        onCreateStash={worktree.handleCreateStash}
        onApplyStash={worktree.handleApplyStash}
        onDropStash={worktree.handleDropStash}
        onCopyCommit={async (entry) => {
          try {
            // 只复制完整 oid，不要其它信息
            await Pasteboard.setString(entry.oid)
            showToast("已复制：" + shortOid(entry.oid), "success")
          } catch (e: any) {
            showToast("复制失败：" + String(e?.message || e), "error")
          }
        }}
        onSelectCommit={(entry) => nav.openCommitDetail(entry.oid)}
        onRevert={pendingActions.handleRevertRequest}
        onSoftReset={pendingActions.handleSoftResetRequest}
        onAmend={pendingActions.handleAmendRequest}
        onSearch={data.handleHistorySearch}
        onLoadMore={data.handleHistoryLoadMore}
        historyHasMore={data.historyHasMore}
        historySearchBusy={data.historySearchBusy}
        historyTotalMatches={data.historyTotalMatches}
        historyLoading={data.historyLoading}
        historyLimited={data.historyLimited}
        githubFullName={data.githubFullName}
      />
    </List>
  )
}
