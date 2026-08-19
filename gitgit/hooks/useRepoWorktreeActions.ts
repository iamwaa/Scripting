/**
 * hooks/useRepoWorktreeActions.ts - 工作区操作编排（暂存 / Stash / 提交）
 *
 * 暂存与 Stash 共用忙态互斥；提交走全屏遮罩并在成功后全量刷新。
 * 需要确认的操作（丢弃改动、删除 Stash）只提交 PendingAction，由页面统一确认。
 */

import { useState } from "scripting"
import type { FileChange, StashEntry } from "../types/git"
import {
  addFiles,
  applyStash,
  commit,
  createStash,
  stageAll,
  unstageFiles,
  unstageAll,
} from "../services/gitService"
import { notifySync } from "../services/notifyService"
import { buildCommitMessage, shortOid } from "../utils/format"
import type { RepoPendingAction } from "../utils/repoDetailAlerts"
import type { ToastType } from "./useToast"

type UseRepoWorktreeActionsProps = {
  bookmarkName: string
  displayName: string
  changes: FileChange[]
  beginOpBusy: (title: string, message?: string) => Promise<void>
  endOpBusy: () => void
  clearChanges: () => void
  reloadRepo: () => Promise<void>
  refreshChangesAndSnapshot: () => Promise<FileChange[]>
  loadChanges: () => Promise<FileChange[]>
  loadStashes: () => Promise<void>
  setPending: (action: RepoPendingAction) => void
  showToast: (message: string, type?: ToastType, duration?: number) => void
}

export function useRepoWorktreeActions({
  bookmarkName,
  displayName,
  changes,
  beginOpBusy,
  endOpBusy,
  clearChanges,
  reloadRepo,
  refreshChangesAndSnapshot,
  loadChanges,
  loadStashes,
  setPending,
  showToast,
}: UseRepoWorktreeActionsProps) {
  const [committing, setCommitting] = useState(false)
  const [stagingBusy, setStagingBusy] = useState(false)
  const [stashBusy, setStashBusy] = useState(false)
  const [commitSheetMode, setCommitSheetMode] = useState<"commit" | "amend" | null>(
    null
  )

  // 暂存类操作统一走同一忙态与错误提示
  async function runStaging(label: string, task: () => Promise<void>) {
    if (stagingBusy || stashBusy) return
    setStagingBusy(true)
    try {
      await task()
      await refreshChangesAndSnapshot()
    } catch (e: any) {
      showToast(`${label}失败：${String(e?.message || e)}`, "error")
    } finally {
      setStagingBusy(false)
    }
  }

  function handleStage(filepath: string) {
    return runStaging("暂存", () => addFiles(bookmarkName, filepath).then(() => {}))
  }

  function handleUnstage(filepath: string) {
    return runStaging("取消暂存", () => unstageFiles(bookmarkName, filepath).then(() => {}))
  }

  function handleStageAll() {
    return runStaging("全部暂存", () => stageAll(bookmarkName).then(() => {}))
  }

  function handleUnstageAll() {
    return runStaging("全部取消暂存", () => unstageAll(bookmarkName).then(() => {}))
  }

  function handleRestore(filepath: string) {
    if (stagingBusy || stashBusy) return
    setPending({ type: "restore", filepath })
  }

  async function handleCreateStash() {
    if (stashBusy || stagingBusy || changes.length === 0) return
    try {
      const message = await Dialog.prompt({
        title: "保存到 Stash",
        message: "可填写备注，留空将使用默认说明",
        defaultValue: "",
        cancelLabel: "取消",
        confirmLabel: "保存",
      })
      if (message == null) return
      setStashBusy(true)
      await createStash(bookmarkName, message)
      await Promise.all([loadChanges(), loadStashes()])
      showToast("已保存到 Stash：" + (message.trim() || "当前改动已保存"), "success")
    } catch (e: any) {
      showToast("保存 Stash 失败：" + String(e?.message || e), "error")
    } finally {
      setStashBusy(false)
    }
  }

  async function handleApplyStash(entry: StashEntry) {
    if (stashBusy || stagingBusy) return
    setStashBusy(true)
    try {
      await applyStash(bookmarkName, entry.index)
      await Promise.all([loadChanges(), loadStashes()])
      showToast("Stash 已应用：" + entry.message + "已恢复", "success")
    } catch (e: any) {
      try {
        await Promise.all([loadChanges(), loadStashes()])
      } catch (_refreshError) {
        /* 保留原错误提示 */
      }
      showToast("应用 Stash 失败：" + String(e?.message || e), "error")
    } finally {
      setStashBusy(false)
    }
  }

  function handleDropStash(entry: StashEntry) {
    if (stashBusy || stagingBusy) return
    setPending({ type: "dropStash", entry })
  }

  async function handleCommit(titleText: string, descriptionText: string) {
    const title = titleText.trim()
    if (!title) {
      showToast("请填写提交信息（标题）", "warning")
      return
    }
    if (!changes.some((change) => change.staged)) {
      showToast("没有暂存内容，请先暂存要提交的文件", "warning")
      return
    }
    setCommitSheetMode(null)
    setCommitting(true)
    try {
      await beginOpBusy("正在提交")
      const msg = buildCommitMessage(title, descriptionText)
      const oid = await commit(bookmarkName, msg)
      // 先清空改动，避免 loadAll 完成前按钮仍显示「取消暂存」
      clearChanges()
      await reloadRepo()
      await notifySync("commit", displayName, shortOid(oid))
      showToast("提交成功：" + shortOid(oid), "success")
    } catch (e: any) {
      showToast("提交失败：" + String(e?.message || e), "error")
    } finally {
      setCommitting(false)
      endOpBusy()
    }
  }

  return {
    committing,
    stagingBusy,
    stashBusy,
    commitSheetMode,
    setStashBusy,
    setCommitSheetMode,
    openCommitForm: () => setCommitSheetMode("commit"),
    closeCommitSheet: () => setCommitSheetMode(null),
    handleStage,
    handleUnstage,
    handleStageAll,
    handleUnstageAll,
    handleRestore,
    handleCreateStash,
    handleApplyStash,
    handleDropStash,
    handleCommit,
  }
}
