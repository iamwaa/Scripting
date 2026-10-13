import {
  hasRemoteBranch,
  isRemoteOperationCancelled,
  pull,
  push,
  RemoteCancelToken,
} from "../services/gitService"
import { notifySync, notifyError } from "../services/notifyService"
import { formatPullSuccessAlert } from "../utils/branchMerge"
import type { RemoteProgressInfo } from "../utils/remoteProgress"
import type { ToastType } from "../hooks/useToast"

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
  showToast: (message: string, type?: ToastType, duration?: number) => void
  /** 合并冲突提醒：先在本页提示，关闭后再由详情页打开冲突页，避免提示被推入的页面遮住 */
  showConflictNotice: (message: string) => void
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
  showToast,
  showConflictNotice,
}: UseRepoSyncActionsProps) {
  async function handlePush() {
    const token = new RemoteCancelToken()
    // 组装请求体阶段（Uploading）达到该字节数时提示一次，避免用户误判卡住
    const LARGE_UPLOAD_THRESHOLD = 20 * 1024 * 1024
    let largeUploadWarned = false
    const remoteOptions = {
      cancelToken: token,
      onProgress: async (info: RemoteProgressInfo) => {
        if (
          info.phase === "上传对象" &&
          !largeUploadWarned &&
          info.loaded >= LARGE_UPLOAD_THRESHOLD
        ) {
          largeUploadWarned = true
          showToast("本次上传量较大，预计耗时较长", "warning", 4)
        }
        await updateOpBusy("正在推送", info.label)
      },
    }
    try {
      await beginOpBusy("正在推送", "正在打包对象…", makeSyncCancel(token))
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
      showToast(`推送成功：origin/${branch}`, "success")
    } catch (error: any) {
      if (isRemoteOperationCancelled(error)) {
        showToast("推送已取消", "warning")
      } else {
        const code = String(error?.code || "")
        const message = String(error?.message || error)
        if (code === "MergeConflictError" || message.includes("合并冲突")) {
          showConflictNotice(message)
        } else {
          showToast(`推送失败：${message}`, "error")
          notifyError("push", displayName, message)
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
      showToast(`${alert.title}：${alert.message}`, "success")
    } catch (error: any) {
      if (isRemoteOperationCancelled(error)) {
        showToast("拉取已取消", "warning")
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
        showConflictNotice(message)
      } else {
        showToast(`拉取失败：${message}`, "error")
        notifyError("pull", displayName, message)
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
