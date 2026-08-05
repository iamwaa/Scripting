import {
  checkoutBranch,
  createBranch,
  mergeBranchIntoCurrent,
  renameBranch,
} from "../services/gitService"
import { validateBranchName } from "../utils/branch"
import { formatMergeSuccessAlert } from "../utils/branchMerge"

type UseRepoBranchActionsProps = {
  bookmarkName: string
  currentBranch: string | null
  hasCommits: boolean
  hasRemote: boolean
  mutating: boolean
  mergeInProgress: boolean
  beginOpBusy: (title: string, message?: string) => Promise<void>
  endOpBusy: () => void
  reloadRepo: () => Promise<void>
  showAlert: (title: string, message: string) => void
  openConflictsPage: () => void
}

export function useRepoBranchActions({
  bookmarkName,
  currentBranch,
  hasCommits,
  hasRemote,
  mutating,
  mergeInProgress,
  beginOpBusy,
  endOpBusy,
  reloadRepo,
  showAlert,
  openConflictsPage,
}: UseRepoBranchActionsProps) {
  async function handleMergeIntoCurrent(source: string) {
    if (mutating || mergeInProgress) return
    try {
      await beginOpBusy(
        "正在合并",
        `${source} → ${currentBranch || "当前分支"}`
      )
      const result = await mergeBranchIntoCurrent(bookmarkName, source)
      const alert = formatMergeSuccessAlert(result)
      showAlert(alert.title, alert.message)
    } catch (error: any) {
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
        showAlert("合并失败", message)
      }
    } finally {
      try {
        await reloadRepo()
      } catch (_e) {
        // 刷新失败不覆盖合并结果
      }
      endOpBusy()
    }
  }

  async function handleSwitchBranch(ref: string) {
    if (mutating) return
    try {
      await beginOpBusy("正在切换分支", ref)
      await checkoutBranch(bookmarkName, ref)
      await reloadRepo()
    } catch (error: any) {
      showAlert("切换失败", String(error?.message || error))
    } finally {
      endOpBusy()
    }
  }

  async function handleRenameBranch() {
    const from = currentBranch
    if (!from) {
      showAlert("gitgit", "当前没有可重命名的分支")
      return
    }
    try {
      const input = await Dialog.prompt({
        title: "重命名分支",
        message: `将「${from}」重命名为新名称`,
        defaultValue: from,
        cancelLabel: "取消",
        confirmLabel: "重命名",
      })
      if (input == null) return
      let to = ""
      try {
        to = validateBranchName(input)
      } catch (error: any) {
        showAlert("名称无效", String(error?.message || error))
        return
      }
      if (to === from) return
      await beginOpBusy("正在重命名分支", `${from} → ${to}`)
      const result = await renameBranch(bookmarkName, from, to)
      await reloadRepo()
      if (!result.oldRemote) {
        showAlert("已重命名", `${from} → ${to}`)
      } else if (result.remoteError) {
        showAlert(
          "本地已重命名，远端同步失败",
          `${from} → ${to}。${result.pushedNewBranch ? "新分支已推送，但删除远端旧分支失败" : "推送新分支失败"}：${result.remoteError}`
        )
      } else {
        showAlert(
          "已重命名并同步远端",
          `${from} → ${to}。已推送新分支并删除远端旧分支「${from}」。`
        )
      }
    } catch (error: any) {
      showAlert("重命名失败", String(error?.message || error))
    } finally {
      endOpBusy()
    }
  }

  async function handleCreateBranch() {
    try {
      const input = await Dialog.prompt({
        title: "新建分支",
        message: "输入新分支名称，将创建并切换到该分支",
        placeholder: "feature/xxx",
        cancelLabel: "取消",
        confirmLabel: "创建",
      })
      if (input == null) return
      const name = input.trim()
      if (!name) {
        showAlert("gitgit", "分支名称不能为空")
        return
      }
      const emptyBefore = !hasCommits
      await beginOpBusy("正在新建分支", name)
      await createBranch(bookmarkName, name)
      await reloadRepo()
      showAlert(
        emptyBefore ? "已设置" : "已创建本地分支",
        emptyBefore
          ? `空仓库目标分支已设为 ${name}，首次提交后生效`
          : hasRemote
            ? `已创建并切换到 ${name}。点击「推送 Push」发布到 GitHub。`
            : `已创建并切换到 ${name}`
      )
    } catch (error: any) {
      showAlert("创建失败", String(error?.message || error))
    } finally {
      endOpBusy()
    }
  }

  return {
    handleMergeIntoCurrent,
    handleSwitchBranch,
    handleRenameBranch,
    handleCreateBranch,
  }
}
