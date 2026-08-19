/**
 * hooks/useOpBusy.ts - 仓库级操作忙态（中央全屏遮罩）
 *
 * 撤销/回退/重编/分支操作/合并/推送/拉取等写操作共用同一遮罩状态。
 * onCancel 存在时遮罩带取消按钮；cancelling 后副标题冻结为「取消中…」。
 */

import { useState } from "scripting"
import { yieldForUi } from "../utils/remoteProgress"
import type { RemoteCancelToken } from "../services/gitService"

export type OpBusyState = {
  title: string
  message?: string
  onCancel?: () => void
  cancelling?: boolean
} | null

export function useOpBusy() {
  const [opBusy, setOpBusy] = useState<OpBusyState>(null)

  // 设置操作忙态遮罩，并让出一帧以便遮罩先渲染；传 onCancel 则遮罩带取消按钮
  async function beginOpBusy(
    title: string,
    message?: string,
    onCancel?: () => void
  ) {
    setOpBusy({ title, message, onCancel })
    await yieldForUi()
  }

  // 更新遮罩标题/副标题；保留取消按钮，已请求取消后冻结副标题为「取消中…」
  async function updateOpBusy(title: string, message?: string) {
    setOpBusy((cur) => ({
      title,
      message: cur?.cancelling ? cur.message : message,
      onCancel: cur?.onCancel,
      cancelling: cur?.cancelling,
    }))
    await yieldForUi()
  }

  function endOpBusy() {
    setOpBusy(null)
  }

  // 推送/拉取的遮罩取消回调：请求协作式取消并冻结副标题
  function makeSyncCancel(token: RemoteCancelToken) {
    return () => {
      token.cancel()
      setOpBusy((cur) =>
        cur ? { ...cur, message: "取消中…", cancelling: true } : cur
      )
    }
  }

  return {
    opBusy,
    beginOpBusy,
    updateOpBusy,
    endOpBusy,
    makeSyncCancel,
  }
}
