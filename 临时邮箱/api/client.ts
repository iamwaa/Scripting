import { fetch } from "scripting"
import { API_BASE_URL } from "../constants"
import { MessageDetail, MessageSummary } from "../types"
import {
  getApiKey,
  getToken,
  loadCachedMessages,
  saveCachedMessages,
  saveToken,
} from "../utils/storage"

// v2 每次读取会清空服务端收件箱，本地缓存已读邮件
const messageCache = new Map<string, MessageSummary[]>()

function getCachedMessages(token: string): MessageSummary[] {
  const memoryCache = messageCache.get(token)
  if (memoryCache) {
    return memoryCache
  }

  const storedCache = loadCachedMessages(token)
  messageCache.set(token, storedCache)
  return storedCache
}

function setCachedMessages(token: string, messages: MessageSummary[]): void {
  messageCache.set(token, messages)
  saveCachedMessages(token, messages)
}

// 统一请求 JSON 接口
async function requestJson<T>(
  method: string,
  path: string,
  body?: any,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  }

  // 可选 API Key（免费层可不填）
  const apiKey = getApiKey()
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  let requestBody: string | undefined
  if (body !== undefined) {
    headers["Content-Type"] = "application/json"
    requestBody = JSON.stringify(body)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: requestBody,
  })
  const rawText = await response.text()

  let data: any = null
  if (rawText) {
    try {
      data = JSON.parse(rawText)
    } catch {
      throw new Error("服务器返回了无法解析的数据")
    }
  }

  if (response.status < 200 || response.status >= 300) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      data?.detail ||
      `请求失败（状态 ${response.status}）`
    throw new Error(String(message))
  }

  return data as T
}

// 为 tempmail 邮件生成稳定 id（v2 邮件本身无 id 字段）
function buildMessageId(email: any, index: number): string {
  const date = email?.date ?? 0
  const from = email?.from || ""
  const subject = email?.subject || ""
  return `${date}_${from}_${subject}_${index}`
}

// 将 tempmail.lol 邮件映射为本项目 MessageSummary
function mapEmail(email: any, index: number): MessageSummary {
  return {
    id: buildMessageId(email, index),
    subject: email?.subject || "",
    from: email?.from || "",
    to: email?.to,
    intro: typeof email?.body === "string" ? email.body.slice(0, 120) : "",
    text: email?.body || "",
    body: email?.body || "",
    html: email?.html || undefined,
    date: email?.date,
    createdAt: email?.date,
  }
}

// 合并新邮件到本地缓存（按 id 去重，新邮件在前）
function mergeMessages(token: string, incoming: MessageSummary[]): MessageSummary[] {
  const existing = getCachedMessages(token)
  const known = new Set(existing.map((item) => String(item.id)))
  const fresh = incoming.filter((item) => !known.has(String(item.id)))
  const merged = [...fresh, ...existing]
  setCachedMessages(token, merged)
  return merged
}

// 拉取服务端邮件并写入本地缓存
async function pullInbox(token: string): Promise<{
  messages: MessageSummary[]
  expired: boolean
}> {
  const payload = await requestJson<{ emails?: any[]; expired?: boolean }>(
    "GET",
    `/inbox?token=${encodeURIComponent(token)}`,
  )

  if (payload?.expired) {
    return { messages: getCachedMessages(token), expired: true }
  }

  const emails = Array.isArray(payload?.emails) ? payload.emails : []
  const mapped = emails.map(mapEmail)
  return {
    messages: mergeMessages(token, mapped),
    expired: false,
  }
}

// 创建临时邮箱（可指定前缀/域名，均可选）
export async function createSession(options?: {
  prefix?: string
  domain?: string
}): Promise<{
  success: boolean
  data: { email: string }
  auth: { token: string; email: string }
}> {
  const body: Record<string, string> = {}
  if (options?.prefix) {
    body.prefix = options.prefix
  }
  if (options?.domain) {
    body.domain = options.domain
  }

  const result = await requestJson<{ address?: string; token?: string }>(
    "POST",
    "/inbox/create",
    Object.keys(body).length > 0 ? body : {},
  )

  const email = result?.address
  const token = result?.token
  if (!email || !token) {
    throw new Error("创建邮箱失败：未返回地址或令牌")
  }

  saveToken(email, token)
  setCachedMessages(token, [])

  return {
    success: true,
    data: { email },
    auth: { token, email },
  }
}

// 使用本地保存的 token 恢复历史邮箱
export async function restoreSession(email: string): Promise<{
  success: boolean
  data: { email: string }
  auth: { token: string; email: string }
}> {
  const token = getToken(email)
  if (!token) {
    throw new Error("该邮箱无法恢复（缺少访问令牌），请重新生成")
  }

  const { expired } = await pullInbox(token)
  if (expired) {
    throw new Error("该邮箱已过期，请重新生成")
  }

  return {
    success: true,
    data: { email },
    auth: { token, email },
  }
}

// 获取邮件列表（含本地缓存）
export async function fetchMessages(email: string, token: string): Promise<{
  success: boolean
  data: MessageSummary[]
  expired?: boolean
}> {
  void email
  const { messages, expired } = await pullInbox(token)
  if (expired) {
    throw new Error("该邮箱已过期，请重新生成")
  }
  return {
    success: true,
    data: messages,
    expired,
  }
}

// 获取邮件详情：优先读缓存，必要时再拉一次收件箱
export async function fetchMessageContent(
  messageId: string | number,
  token: string,
): Promise<{
  success: boolean
  data: MessageDetail
}> {
  const cached = getCachedMessages(token).find(
    (item) => String(item.id) === String(messageId),
  )
  if (cached) {
    return { success: true, data: cached }
  }

  const { messages, expired } = await pullInbox(token)
  if (expired) {
    throw new Error("该邮箱已过期，请重新生成")
  }

  const found = messages.find((item) => String(item.id) === String(messageId))
  if (!found) {
    throw new Error("未找到该邮件，可能已被清理")
  }

  return {
    success: true,
    data: found,
  }
}
