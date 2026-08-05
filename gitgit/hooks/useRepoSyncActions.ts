import {
  hasRemoteBranch,
  isRemoteOperationCancelled,
  pull,
  push,
  RemoteCancelToken,
} from "../services/gitService"
import { notifySync } from "../services/notifyService"
import { formatPullSuccessAlert } from "../utils/branchMerge"
import type { RemoteProgressInfo } from "../utils/remoteProgress"

type UseRepoSyncActionsProps = {
  bookmarkName: string
  displayName: string
  currentBranch: string | null
  hasRemote: boolean
  beginOpBusy: (
    title: string,
    message?: string,
    onCancel?: () => void
  ) => Promise<void>
  updateOpBusy: (title: string, message?: string) => Promise<void>
  endOpBusy: () => void
  makeSyncCancel: (token: RemoteCancelToken) => () => void
  setPulledAt: (branch: string, timestamp: number) => void
  refreshSyncState: () => Promise<void>
  reloadRepo: () => Promise<void>
  showAlert: (title: string, message: string) => void
  openConflictsPage: () => void
}

export function useRepoSyncActions({
  bookmarkName,
  displayName,
  currentBranch,
  hasRemote,
  beginOpBusy,
  updateOpBusy,
  endOpBusy,
  makeSyncCancel,
  setPulledAt,
  refreshSyncState,
  reloadRepo,
  showAlert,
  openConflictsPage,
}: UseRepoSyncActionsProps) {
  async function handlePush() {
    const token = new RemoteCancelToken()
    const remoteOptions = {
      cancelToken: token,
      onProgress: async (info: RemoteProgressInfo) => {
        await updateOpBusy("正在推送", info.label)
      },
    }
    try {
      await beginOpBusy("正在推送", undefined, makeSyncCancel(token))
      const branch = currentBranch
      if (!branch) throw new Error("当前没有可推送的分支")
      if (hasRemote && (await hasRemoteBranch(bookmarkName, branch, "origin"))) {
        try {
          await updateOpBusy("正在推送", "先拉取最新…")
          await pull(bookmarkName, "origin", branch, undefined, remoteOptions)
          setPulledAt(branch, Date.now())
          await updateOpBusy("正在推送")
        } catch (error: any) {
          if (isRemoteOperationCancelled(error)) throw error
          const code = String(error?.code || "")
          const message = String(error?.message || error)
          if (code === "MergeConflictError" || message.includes("合并冲突")) {
            const conflictError = new Error("先拉取最新出现合并冲突：" + message)
            ;(conflictError as any).code = "MergeConflictError"
            throw conflictError
          }
          throw new Error("先拉取最新失败：" + message)
        }
      }
      await push(bookmarkName, "origin", branch, false, remoteOptions)
      await notifySync("push", displayName, branch)
      showAlert("推送成功", `已发布到 GitHub：origin/${branch}`)
    } catch (error: any) {
      if (isRemoteOperationCancelled(error)) {
        showAlert("已取消", "推送已取消")
      } else {
        const code = String(error?.code || "")
        const message = String(error?.message || error)
        if (code === "MergeConflictError" || message.includes("合并冲突")) {
          openConflictsPage()
          showAlert("合并冲突", message)
        } else {
          showAlert("推送失败", message)
        }
      }
    } finally {
      try {
        await refreshSyncState()
      } catch (_e) {
        // 刷新失败不覆盖推送结果
      }
      endOpBusy()
    }
  }

  async function handlePull() {
    const token = new RemoteCancelToken()
    try {
      await beginOpBusy("正在拉取", undefined, makeSyncCancel(token))
      const result = await pull(bookmarkName, "origin", undefined, undefined, {
        cancelToken: token,
        onProgress: async (info: RemoteProgressInfo) => {
          await updateOpBusy("正在拉取", info.label)
        },
      })
      setPulledAt(result.branch, Date.now())
      await notifySync("pull", displayName, result.branch || currentBranch || "")
      const alert = formatPullSuccessAlert(result)
      showAlert(alert.title, alert.message)
    } catch (error: any) {
      if (isRemoteOperationCancelled(error)) {
        showAlert("已取消", "拉取已取消")
        return
      }
      const code = String(error?.code || "")
      const message = String(error?.message || error)
      if (code === "MergeConflictError" || message.includes("合并冲突")) {
        try {
          await reloadRepo()
        } catch (_e) {
          // 冲突页仍应允许打开
        }
        openConflictsPage()
        showAlert("合并冲突", message)
      } else {
        showAlert("拉取失败", message)
      }
    } finally {
      try {
        await reloadRepo()
      } catch (_e) {
        // 刷新失败不覆盖拉取结果
      }
      endOpBusy()
    }
  }

  return { handlePush, handlePull }
}
