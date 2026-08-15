/**
 * hooks/useToast.ts - 顶部提示状态管理
 *
 * 适配 Scripting 内置 toast prop，提供 showToast / dismissToast。
 * 支持 success / error / warning / info 四种类型，各自有图标和颜色。
 * 自动消失由内置 toast 的 duration 控制（秒）。
 */

import { useState, useRef, useEffect } from "scripting"

export type ToastType = "success" | "error" | "warning" | "info"

export type ToastState = {
  /** 提示文案 */
  message: string
  /** 提示类型 */
  type: ToastType
  /** 自动消失时长（秒），默认 2.5 */
  duration: number
} | null

export function useToast(defaultDuration = 2.5) {
  const [toastState, setToastState] = useState<ToastState>(null)
  const timerRef = useRef<number | null>(null)

  function clearTimer() {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function dismissToast() {
    clearTimer()
    setToastState(null)
  }

  /**
   * 显示一条 toast 提示
   * @param message 提示文案
   * @param type 提示类型（默认 info）
   * @param duration 自动消失时长（秒），默认 2.5
   */
  function showToast(
    message: string,
    type: ToastType = "info",
    duration = defaultDuration
  ) {
    clearTimer()
    setToastState({ message, type, duration })
  }

  // toast 关闭后清空状态（onChanged(false) 时触发）
  function handleToastChanged(presented: boolean) {
    if (!presented) {
      clearTimer()
      setToastState(null)
    }
  }

  // 组件卸载时清除计时器
  useEffect(() => {
    return () => clearTimer()
  }, [])

  return {
    toastState,
    showToast,
    dismissToast,
    handleToastChanged,
    /** 是否正在显示 toast */
    toastPresented: toastState != null,
  }
}
