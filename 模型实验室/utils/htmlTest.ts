import { htmlRule } from "../constants"

// 组装 HTML 请求：内置规则在前，用户提示语作为具体需求
export function buildHtmlPrompt(prompt: string) {
  return `${htmlRule}\n\n页面需求：\n${prompt.trim()}\n\n现在只输出完整 HTML 源码。`
}

export function extractHtml(content: string): string | null {
  const normalized = content.replace(/^\uFEFF/, "").trim()
  const fenced = normalized.match(/```(?:html)?\s*([\s\S]*?)```/i)?.[1] ?? normalized
  const match = fenced.match(/<!doctype html[\s\S]*<\/html\s*>/i) ?? fenced.match(/<html\b[\s\S]*<\/html\s*>/i)
  return match ? match[0].trim() : null
}

// 只校验文档结构是否完整，具体页面内容由用户提示语决定，不做关键词匹配
export function isValidHtml(content: string): boolean {
  const html = extractHtml(content)
  if (!html) return false
  return /<html\b[\s\S]*<\/html\s*>/i.test(html)
    && /<head\b[\s\S]*<\/head\s*>/i.test(html)
    && /<body\b[\s\S]*<\/body\s*>/i.test(html)
}
