import { htmlRule } from "../constants"

// 组装 HTML 请求：内置规则在前，用户提示语作为具体需求
export function buildHtmlPrompt(prompt: string) {
  return `${htmlRule}\n\n页面需求：\n${prompt.trim()}\n\n现在只输出完整 HTML 源码。`
}

// 从一段候选文本里找完整 HTML 文档
function matchDocument(text: string): string | null {
  const match = text.match(/<!doctype html[\s\S]*<\/html\s*>/i) ?? text.match(/<html\b[\s\S]*<\/html\s*>/i)
  return match ? match[0].trim() : null
}

// 模型可能在 HTML 前后夹杂说明文字，也可能先输出 ```css / ```js 等其它语言围栏；
// 因此把每个围栏内容和整段原文都当候选，逐个找完整文档，不能只看第一个围栏
export function extractHtml(content: string): string | null {
  const normalized = content.replace(/^\uFEFF/, "").trim()
  const candidates: string[] = []
  const fencePattern = /```[^\n`]*\n([\s\S]*?)(?:```|$)/g
  for (const fence of normalized.matchAll(fencePattern)) candidates.push(fence[1])
  candidates.push(normalized)
  for (const candidate of candidates) {
    const html = matchDocument(candidate)
    if (html) return html
  }
  return null
}

// 只校验文档结构是否完整，具体页面内容由用户提示语决定，不做关键词匹配
export function isValidHtml(content: string): boolean {
  const html = extractHtml(content)
  if (!html) return false
  return /<html\b[\s\S]*<\/html\s*>/i.test(html)
    && /<head\b[\s\S]*<\/head\s*>/i.test(html)
    && /<body\b[\s\S]*<\/body\s*>/i.test(html)
}
