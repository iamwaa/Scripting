import { Notification } from "scripting"
import { fetchMessages } from "../api/client"

// Scripting 环境没有内置 timer 类型声明，手动补齐
declare function setInterval(callback: () => void, ms?: number): number

let intervalId: number | null = null
let isPolling = false
let hasInitialSnapshot = false
let activeEmail = ""
let activeToken = ""
const knownIds = new Set<string>()

// 设置当前需要保活的邮箱会话
export function setActiveSession(email: string, token: string) {
  activeEmail = email
  activeToken = token
  knownIds.clear()
  hasInitialSnapshot = false
}

// 开始后台轮询（默认 60 秒一次）
export function startPolling(intervalMs = 60000) {
  if (intervalId !== null) {
    return
  }
  if (!activeEmail || !activeToken) {
    return
  }

  pollOnce()
  intervalId = setInterval(() => {
    pollOnce()
  }, intervalMs)
}

// 单次轮询：检查新邮件
async function pollOnce() {
  if (!activeEmail || !activeToken || isPolling) {
    return
  }
  isPolling = true

  try {
    const result = await fetchMessages(activeEmail, activeToken)
    const messages = result.data || []
    const unseen = messages.filter((msg: any) => {
      const id = String(msg.id || "")
      return id && !knownIds.has(id)
    })

    // 将本轮所有邮件 id 记录下来
    messages.forEach((msg: any) => {
      const id = String(msg.id || "")
      if (id) {
        knownIds.add(id)
      }
    })

    if (hasInitialSnapshot && unseen.length > 0) {
      const subject = unseen[0]?.subject || "（无主题）"
      const body =
        unseen.length === 1
          ? `收到新邮件：${subject}`
          : `收到 ${unseen.length} 封新邮件，最新：${subject}`

      await Notification.schedule({
        title: "临时邮箱",
        subtitle: activeEmail,
        body,
        silent: false,
        userInfo: { email: activeEmail },
      })
    }
    hasInitialSnapshot = true
  } catch (err) {
    console.error("后台轮询失败:", err)
  } finally {
    isPolling = false
  }
}
