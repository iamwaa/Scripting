/**
 * utils/format.ts - 纯工具格式化函数（无副作用）
 */

/** oid 截短为前 7 位（类 GitHub 风格） */
export function shortOid(oid: string): string {
  return oid ? oid.substring(0, 7) : ""
}

/** ISO 时间 → 相对时间描述（如 "3 分钟前"） */
export function relativeTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return "刚刚"
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return d.toLocaleDateString()
}

/** 提取 commit message 的首行（标题） */
export function commitTitle(message: string): string {
  return message.split("\n")[0].trim()
}

/** 截断过长路径，中间用 … 省略 */
export function truncatePath(path: string, max = 40): string {
  if (path.length <= max) return path
  return path.substring(0, max - 1) + "…"
}

/** 从 Git URL 提取仓库目录名（去掉 .git） */
export function repoNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, "").replace(/\.git$/i, "")
  const raw = cleaned.split("/").filter(Boolean).pop() || "repo"
  const name = raw.replace(/[^a-zA-Z0-9._-]/g, "_")
  return name || "repo"
}

/** 组装 GitHub 风格提交信息：标题 + 可选描述 */
export function buildCommitMessage(title: string, description?: string): string {
  const head = title.trim()
  const body = (description || "").trim()
  if (!body) return head
  return `${head}\n\n${body}`
}

/** 复制用：完整 commit 信息（oid / 作者 / 日期 / message） */
export function formatFullCommit(entry: {
  oid: string
  message: string
  author: { name: string; email: string }
  date: string
}): string {
  const lines = [
    `commit ${entry.oid}`,
    `Author: ${entry.author.name} <${entry.author.email}>`,
    `Date:   ${entry.date}`,
    "",
    entry.message,
  ]
  return lines.join("\n")
}
