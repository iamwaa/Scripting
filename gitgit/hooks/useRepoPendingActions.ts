/**
 * hooks/useRepoPendingActions.ts - 需二次确认的仓库操作编排
 *
 * 丢弃改动、删除 Stash、删除本地/远端分支、撤销提交、soft 回退、重编、回滚强推
 * 统一进入 PendingAction，由详情页的声明式确认 alert 触发 runPending 执行。
 * 所有分支都走全屏遮罩，失败后仍刷新仓库状态，避免页面与实际不一致。
 */

import { useState } from "scripting"
import type { CommitEntry } from "../types/git"
import {
  amendHeadCommit,
  deleteBranch,
  deleteRemoteBranch,
  dropStash,
  fetchRemote,
  isRemoteOperationCancelled,
  pull,
  RemoteCancelToken,
  resetToCommitAndForcePush,
  restoreFile,
  revertCommit,
  softResetHead,
} from "../services/gitService"
import {
  buildCommitMessage,
  commitBody,
  commitTitle,
  shortOid,
} from "../utils/format"
import type { RepoPendingAction } from "../utils/repoDetailAlerts"
import type { ToastType } from "./useToast"

type UseRepoPendingActionsProps = {
  bookmarkName: string
  hasRemote: boolean
  currentBranch: string | null
  remoteOnlyBranches: string[]
  beginOpBusy: (
    title: string,
    message?: string,
    onCancel?: () => void
  ) => Promise<void>
  updateOpBusy: (title: string, message?: string) => Promise<void>
  endOpBusy: () => void
  makeSyncCancel: (token: RemoteCancelToken) => () => void
  reloadRepo: () => Promise<void>
  loadStashes: () => Promise<void>
  setStashBusy: (busy: boolean) => void
  openAmendSheet: () => void
  closeCommitSheet: () => void
  closeRollbackPage: () => void
  showAlert: (title: string, message: string) => void
  showToast: (message: string, type?: ToastType, duration?: number) => void
}

// 各操作失败时的提示标题
const FAILURE_TITLES: Record<string, string> = {
  restore: "撤销失败",
  dropStash: "删除 Stash 失败",
  revert: "撤销提交失败",
  amend: "重编失败",
  deleteLocalBranch: "删除分支失败",
  deleteRemoteBranch: "删除远端分支失败",
  rollback: "回滚失败",
  softReset: "回退失败",
}

// 失败后需要刷新遮罩文案的操作及其标题
const REFRESH_BUSY_TITLES: Record<string, string> = {
  revert: "正在撤销",
  softReset: "正在回退",
  amend: "正在重编",
  rollback: "正在回滚",
}

export function useRepoPendingActions({
  bookmarkName,
  hasRemote,
  currentBranch,
  remoteOnlyBranches,
  beginOpBusy,
  updateOpBusy,
  endOpBusy,
  makeSyncCancel,
  reloadRepo,
  loadStashes,
  setStashBusy,
  openAmendSheet,
  closeCommitSheet,
  closeRollbackPage,
  showAlert,
  showToast,
}: UseRepoPendingActionsProps) {
  const [pending, setPending] = useState<RepoPendingAction>(null)
  const [amendMessage, setAmendMessage] = useState("")
  // 打开重编表单时的初始草稿，由 sheet 内部 Observable 接管后续编辑
  const [amendDraft, setAmendDraft] = useState({ title: "", description: "" })

  // 请求删除分支：本地分支与仅远端分支分别确认
  function requestDeleteBranch(branch: string) {
    if (remoteOnlyBranches.includes(branch)) {
      setPending({ type: "deleteRemoteBranch", branch })
    } else {
      setPending({ type: "deleteLocalBranch", branch })
    }
  }

  function handleRevertRequest(entry: CommitEntry) {
    setPending({ type: "revert", entry })
  }

  function handleSoftResetRequest(entry: CommitEntry) {
    setPending({ type: "softReset", entry })
  }

  function handleAmendRequest(entry: CommitEntry) {
    setAmendDraft({
      title: commitTitle(entry.message),
      description: commitBody(entry.message),
    })
    openAmendSheet()
  }

  function handleAmendFormConfirm(titleText: string, descriptionText: string) {
    const title = titleText.trim()
    if (!title) {
      showToast("提交信息不能为空", "warning")
      return
    }
    setAmendMessage(buildCommitMessage(title, descriptionText))
    closeCommitSheet()
    // 等 sheet 收起后再弹确认，避免模态叠加导致 alert 不显示
    setTimeout(() => setPending({ type: "amend" }), 350)
  }

  function handleRollbackSelect(entry: CommitEntry) {
    const branch = currentBranch
    if (!branch) {
      showToast("当前没有命名分支，无法回滚", "error")
      return
    }
    // 关闭选择页，再弹确认
    closeRollbackPage()
    setTimeout(() => setPending({ type: "rollback", entry, branch }), 350)
  }

  async function submitAmend() {
    const msg = amendMessage.trim()
    if (!msg) {
      showToast("提交信息不能为空", "warning")
      return
    }
    try {
      await beginOpBusy("正在重编", "准备改写最近一次提交…")
      // 先 fetch 刷新远端跟踪引用，让 amend 内的「未推送」安全判定基于最新远端 tip
      if (hasRemote) {
        try {
          await updateOpBusy("正在重编", "刷新远端引用…")
          await fetchRemote(bookmarkName, "origin", currentBranch || undefined)
        } catch (_e) {
          /* fetch 失败则沿用旧引用，交由 amend 内 guard 判定 */
        }
      }
      await updateOpBusy("正在重编", "改写提交…")
      const oid = await amendHeadCommit(bookmarkName, msg)
      setAmendMessage("")
      await updateOpBusy("正在重编", "刷新仓库状态…")
      await reloadRepo()
      showToast("已重编：" + shortOid(oid), "success")
    } catch (e: any) {
      showToast("重编失败：" + String(e?.message || e), "error")
    } finally {
      endOpBusy()
    }
  }

  async function runPending() {
    const action = pending
    setPending(null)
    if (!action) return
    try {
      if (action.type === "restore") {
        await beginOpBusy("正在丢弃改动", action.filepath)
        await restoreFile(bookmarkName, action.filepath)
        await reloadRepo()
        return
      }
      if (action.type === "dropStash") {
        setStashBusy(true)
        try {
          await dropStash(bookmarkName, action.entry.index)
          await loadStashes()
          showToast("Stash 已删除：" + action.entry.message, "success")
        } finally {
          setStashBusy(false)
        }
        return
      }
      if (action.type === "deleteLocalBranch") {
        await beginOpBusy("正在删除分支", action.branch)
        await deleteBranch(bookmarkName, action.branch)
        await reloadRepo()
        showToast("已删除：本地分支 " + action.branch, "success")
        return
      }
      if (action.type === "deleteRemoteBranch") {
        await beginOpBusy("正在删除远端分支", `origin/${action.branch}`)
        await deleteRemoteBranch(bookmarkName, "origin", action.branch)
        await reloadRepo()
        showToast("已删除：远端分支 origin/" + action.branch, "success")
        return
      }
      if (action.type === "revert") {
        await beginOpBusy("正在撤销", "准备创建反向提交…")
        // 先拉最新，避免在落后 HEAD 上生成反向提交（pull 失败则中止）
        if (hasRemote) {
          await updateOpBusy("正在撤销", "先拉取最新…")
          await pull(bookmarkName, "origin", currentBranch || undefined)
        }
        await updateOpBusy("正在撤销", "生成反向提交…")
        const oid = await revertCommit(bookmarkName, action.entry.oid)
        await updateOpBusy("正在撤销", "刷新仓库状态…")
        await reloadRepo()
        showToast("已撤销：新建反向提交 " + shortOid(oid), "success")
        return
      }
      if (action.type === "softReset") {
        await beginOpBusy("正在回退", "准备 soft 回退 HEAD…")
        // 先 fetch 刷新远端跟踪引用，让 reset 内判定基于最新远端 tip
        if (hasRemote) {
          try {
            await updateOpBusy("正在回退", "刷新远端引用…")
            await fetchRemote(bookmarkName, "origin", currentBranch || undefined)
          } catch (_e) {
            /* fetch 失败则沿用旧引用，交由 reset 内 guard 判定 */
          }
        }
        await updateOpBusy("正在回退", "移动 HEAD…")
        await softResetHead(bookmarkName)
        await updateOpBusy("正在回退", "刷新仓库状态…")
        await reloadRepo()
        showToast("已回退：已 soft 回退 HEAD，改动保留在工作区", "success")
        return
      }
      if (action.type === "amend") {
        await submitAmend()
        return
      }
      if (action.type === "rollback") {
        const token = new RemoteCancelToken()
        await beginOpBusy("正在回滚", "准备重置到目标提交…", makeSyncCancel(token))
        const result = await resetToCommitAndForcePush(
          bookmarkName,
          action.entry.oid,
          {
            cancelToken: token,
            onProgress: async (info) => {
              await updateOpBusy("正在回滚", info.label)
            },
          }
        )
        await updateOpBusy("正在回滚", "刷新仓库状态…")
        await reloadRepo()
        showToast(
          "已回滚：" +
            result.branch +
            " 已重置到 " +
            shortOid(action.entry.oid) +
            " 并强制推送到 origin/" +
            result.branch,
          "success"
        )
        return
      }
    } catch (e: any) {
      if (action.type === "rollback" && isRemoteOperationCancelled(e)) {
        try {
          await reloadRepo()
        } catch (_refreshError) {
          /* 忽略刷新失败 */
        }
        // 本地已重置但强推被取消：必须明确告知远端仍是旧历史
        showAlert(
          "回滚未完成",
          "强制推送已取消。本地分支可能已重置到目标提交，远端仍是原历史，可重新执行回滚。"
        )
        return
      }
      // revert/reset 失败前可能已改工作区或 HEAD，刷新以避免页面状态与实际不一致
      try {
        const busyTitle = REFRESH_BUSY_TITLES[action.type]
        if (busyTitle) await updateOpBusy(busyTitle, "刷新仓库状态…")
        await reloadRepo()
      } catch (_e) {
        /* 忽略刷新失败 */
      }
      showToast(
        (FAILURE_TITLES[action.type] || "操作失败") +
          ": " +
          String(e?.message || e),
        "error"
      )
    } finally {
      // 操作遮罩统一收尾；submitAmend 内也会清，重复赋值无害
      endOpBusy()
    }
  }

  return {
    pending,
    amendDraft,
    setPending,
    clearPending: () => setPending(null),
    requestDeleteBranch,
    handleRevertRequest,
    handleSoftResetRequest,
    handleAmendRequest,
    handleAmendFormConfirm,
    handleRollbackSelect,
    runPending,
  }
}
