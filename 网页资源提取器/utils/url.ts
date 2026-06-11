// 从混合文本中提取 URL（如从小红书分享文本中提取链接）
export function extractURLFromText(text: string): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const match = trimmed.match(/https?:\/\/[^\s"'<>\[\]{}，。！？、；：）】」》]+/i)
  return match ? match[0].replace(/[.,;:!?)}\]]+$/, "") : null
}
