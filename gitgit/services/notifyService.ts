/**
 * services/notifyService.ts - 本地通知封装
 *
 * 在 push/pull/commit/clone 等关键操作完成后发送即时通知。
 * 使用 Scripting 内置 Notification.schedule（省略 trigger 即立即发送）。
 */

import { Notification } from "scripting"
import { readNotifyEnabled } from "./storage"

/** 同步操作类型 → 对应的完成提示文案 */
type SyncKind = "commit" | "push" | "pull" | "fetch" | "clone"

const KIND_TITLE: Record<SyncKind, string> = {
  commit: "提交完成",
  push: "推送完成",
  pull: "拉取完成",
  fetch: "获取完成",
  clone: "克隆完成",
}

function redactSensitive(value?: string): string | undefined {
  if (!value) return value
  return value
    .replace(/([?&](?:token|access_token|auth|password)=)[^&#\s]+/gi, "$1***")
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1***@")
    .replace(/\b(?:gh[opusr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, "***")
}

/**
 * 发送一条操作完成通知
 * @param kind 操作类型
 * @param repoName 仓库名称
 * @param detail 详情（如 commit oid、提交数）
 */
export async function notifySync(
  kind: SyncKind,
  repoName: string,
  detail?: string
): Promise<void> {
  if (!readNotifyEnabled()) return
  try {
    await Notification.schedule({
      title: KIND_TITLE[kind],
      subtitle: redactSensitive(repoName),
      body: redactSensitive(detail),
      silent: false,
      threadIdentifier: "gitgit-sync",
      interruptionLevel: "active",
      // 点击通知重新打开 gitgit
      tapAction: { type: "runScript", scriptName: "gitgit" },
    })
  } catch (e) {
    // 通知失败不应阻断主流程（可能是未授权通知权限）
    console.warn("⚠️ 发送通知失败: " + e)
  }
}

/** 发送错误通知 */
export async function notifyError(
  repoName: string,
  message: string
): Promise<void> {
  if (!readNotifyEnabled()) return
  try {
    await Notification.schedule({
      title: "操作失败",
      subtitle: redactSensitive(repoName),
      body: redactSensitive(message),
      silent: false,
      threadIdentifier: "gitgit-error",
    })
  } catch (e) {
    console.warn("⚠️ 发送通知失败: " + e)
  }
}
