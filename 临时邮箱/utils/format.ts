// 日期时间格式化
export function formatDate(input?: string | number): string {
  if (!input) {
    return "未知时间"
  }
  const date = new Date(input)
  if (isNaN(date.getTime())) {
    return String(input)
  }
  return date.toLocaleString("zh-CN")
}

// 根据邮件记录解析发件人
export function getSender(msg: any): string {
  const from = msg?.from
  if (typeof from === "string" && from) {
    return from
  }
  if (from && typeof from === "object") {
    if (from.name && from.address) {
      return `${from.name} <${from.address}>`
    }
    if (from.address) {
      return String(from.address)
    }
    if (from.name) {
      return String(from.name)
    }
  }
  return msg?.sender || "未知发件人"
}

// 根据邮件记录解析主题
export function getSubject(msg: any): string {
  return msg?.subject || "（无主题）"
}
