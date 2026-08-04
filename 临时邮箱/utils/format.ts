import type { MessageDetail } from "../types"

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

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  }

  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, code: string) => {
      if (code[0] !== "#") {
        return namedEntities[code.toLowerCase()] ?? entity
      }

      const isHex = code[1]?.toLowerCase() === "x"
      const value = Number.parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isFinite(value) ? String.fromCodePoint(value) : entity
    },
  )
}

function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<\s*(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<[^>]+>/g, ""),
  )
}

function decodeBase64Text(value: string): string | null {
  const normalized = value.replace(/\s/g, "")
  if (
    normalized.length < 8 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  ) {
    return null
  }

  const data = Data.fromBase64String(normalized)
  if (!data) {
    return null
  }

  const canonical = data.toBase64String().replace(/=+$/, "")
  if (canonical !== normalized.replace(/=+$/, "")) {
    return null
  }

  const decoded = data.toDecodedString("utf8")
  const invalidCharacters = [...decoded].filter(
    (character) =>
      character === "\uFFFD" ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(character),
  ).length
  if (invalidCharacters > Math.max(3, decoded.length * 0.25)) {
    return null
  }

  const replacementIndex = decoded.indexOf("\uFFFD")
  const withoutBrokenPrefix =
    replacementIndex >= 0 ? decoded.slice(replacementIndex + 1) : decoded
  const cleaned = withoutBrokenPrefix
    .replace(/\uFFFD/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()

  return cleaned || null
}

function normalizeBody(value: string): string {
  const decoded = decodeBase64Text(value.trim()) ?? value
  const plainText = /<[^>]+>/.test(decoded) ? htmlToPlainText(decoded) : decoded
  return plainText.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

// 提取并解码可读正文
export function getMessageBody(detail: MessageDetail | null): string {
  if (!detail) {
    return "（无正文内容）"
  }

  const candidates = [
    detail.text,
    detail.body,
    Array.isArray(detail.html) ? detail.html.join("\n") : detail.html,
    detail.intro,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return normalizeBody(candidate) || "（无正文内容）"
    }
  }

  return "（无正文内容）"
}
