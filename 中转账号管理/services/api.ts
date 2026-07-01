declare const fetch: any
import type { Account, SelfInfo, CheckinStatus, CheckinRecord, ApiJson, ApiResult } from "../types"
import { UA } from "../constants"
import { normalizeBaseUrl, quotaFromUsd, localDateString, localMonthString } from "../utils/format"
import { translateErrorMessage } from "../utils/error"
import { mergeCookies } from "../utils/cookie"
import { getSecret, removeSecret } from "./storage"

export function getHeader(response: any, name: string) {
  try {
    if (typeof response?.headers?.get === "function") return response.headers.get(name) ?? response.headers.get(name.toLowerCase()) ?? ""
    if (response?.headers && typeof response.headers === "object") return response.headers[name] ?? response.headers[name.toLowerCase()] ?? ""
  } catch {}
  return ""
}

export function removeAccountSecrets(account: Account) {
  if (account.passwordKey) removeSecret(account.passwordKey)
  if (account.cookieKey) removeSecret(account.cookieKey)
  if (account.accessTokenKey) removeSecret(account.accessTokenKey)
}

export function unwrapSub2ApiJson<T>(json: any): T {
  if (json && typeof json === "object" && "code" in json) {
    if (json.code === 0) return json.data as T
    throw new Error(translateErrorMessage(json.message || json.detail || `API code ${json.code}`))
  }
  return json as T
}

export async function sub2ApiRequest<T = any>(account: Account, method: string, path: string, body?: any): Promise<T> {
  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  const token = getSecret(account.cookieKey)
  if (!token) throw new Error(`缺少 Sub2API 登录令牌，请使用“网页登录获取 Cookie”或粘贴 auth_token`)

  const hasQuery = path.includes("?")
  const timezone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")
  const url = `${baseUrl}/api/v1${path}${method.toUpperCase() === "GET" ? `${hasQuery ? "&" : "?"}timezone=${timezone}` : ""}`

  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Authorization": token.startsWith("Bearer ") ? token : `Bearer ${token}`,
    "Origin": baseUrl,
    "Referer": `${baseUrl}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  }
  if (body !== undefined) headers["Content-Type"] = "application/json"

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    allowInsecureRequest: baseUrl.startsWith("http://"),
    timeout: 25,
  } as any)

  const raw = await response.text()
  let json: any
  try {
    json = raw ? JSON.parse(raw) : {}
  } catch {
    // 非 JSON 响应通常是触发了验证或登录失效，而非真正的 API 路径错误
    throw new Error(`响应不是 JSON：${raw.slice(0, 60)}`)
  }
  if (!response.ok) {
    // HTTP 401/403/404 都可能表示登录失效，把状态码拼进消息，便于上层 isAuthExpiredError 识别并触发重登录
    const status = Number(response.status) || 0
    const rawMessage = json?.message || json?.detail || (status ? `HTTP ${status}` : "未知错误")
    const authExpired = status === 401 || status === 403 || (status === 404 && /session|token|login|登录|权限|auth/i.test(rawMessage))
    const message = authExpired ? `未登录或权限不足（HTTP ${status}）：${rawMessage}` : rawMessage
    throw new Error(translateErrorMessage(message))
  }
  return unwrapSub2ApiJson<T>(json)
}

export function firstFiniteNumber(...values: any[]) {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

export async function fetchSub2ApiSelf(account: Account) {
  const data = await sub2ApiRequest<any>(account, "GET", "/auth/me")
  let stats: any = {}
  try {
    stats = await sub2ApiRequest<any>(account, "GET", "/usage/dashboard/stats")
  } catch {}
  const usedCost = firstFiniteNumber(stats?.total_actual_cost, stats?.total_cost)
  const requestCount = firstFiniteNumber(stats?.total_requests, stats?.today_requests)
  return {
    id: data?.id,
    username: data?.username,
    display_name: data?.display_name || data?.nickname || data?.username,
    email: data?.email,
    group: data?.role || data?.run_mode || data?.status,
    quota: quotaFromUsd(data?.balance),
    used_quota: quotaFromUsd(usedCost),
    request_count: requestCount,
    balance: data?.balance,
    concurrency: data?.concurrency,
    status: data?.status,
  } as SelfInfo
}

export async function fetchSub2ApiCheckinStatus(account: Account, month = localMonthString()) {
  const [year, monthIndex] = month.split("-").map(Number)
  // 先尝试新版 API（/check-in/status），失败则回退旧版（/user/check-in）
  let status: any
  let isNewApi = false
  try {
    status = await sub2ApiRequest<any>(account, "GET", "/check-in/status")
    isNewApi = true
  } catch {
    try {
      status = await sub2ApiRequest<any>(account, "GET", "/user/check-in")
    } catch {
      // 两种 API 都失败，返回禁用状态
      return { enabled: false, min_quota: undefined, max_quota: undefined, stats: { total_quota: undefined, total_checkins: 0, checkin_count: 0, records: [] } } as CheckinStatus
    }
  }
  let records: CheckinRecord[] = []
  try {
    // 获取签到日历记录
    const calendar = isNewApi
      ? await sub2ApiRequest<any>(account, "GET", `/check-in/calendar?month=${year}-${String(monthIndex).padStart(2, "0")}`)
      : await sub2ApiRequest<any>(account, "GET", `/user/check-in/calendar?year=${year}&month=${monthIndex}`)
    // 新版 API 返回 signed_dates 数组，旧版返回 checked_in_dates 数组
    const dates = calendar?.signed_dates ?? calendar?.checked_in_dates ?? []
    const rewardAmount = isNewApi ? (status?.today_reward ?? status?.reward_amount) : status?.reward_amount
    records = dates.map((date: string) => ({
      checkin_date: date,
      quota_awarded: quotaFromUsd(rewardAmount),
    }))
  } catch {}
  const rewardAmount = isNewApi ? (status?.today_reward ?? status?.reward_amount) : status?.reward_amount
  const checkedToday = isNewApi ? status?.checked_in_today : status?.checked_in_today
  if (checkedToday && !records.some(record => record.checkin_date === localDateString())) {
    records.push({ checkin_date: localDateString(), quota_awarded: quotaFromUsd(rewardAmount) })
  }
  // 新版 API 使用 rewards 数组（连续签到奖励），旧版使用 min/max_quota
  const rewards = isNewApi ? (status?.rewards ?? []) : []
  const minQuota = isNewApi ? (rewards.length > 0 ? quotaFromUsd(rewards[0]) : undefined) : quotaFromUsd(status?.min_quota)
  const maxQuota = isNewApi ? (rewards.length > 0 ? quotaFromUsd(rewards[rewards.length - 1]) : undefined) : quotaFromUsd(status?.max_quota)
  const totalDays = isNewApi ? (status?.total_check_in_days ?? records.length) : (status?.check_in_days ?? records.length)
  const totalQuota = isNewApi ? quotaFromUsd(status?.total_reward) : (quotaFromUsd(rewardAmount) !== undefined ? records.length * (quotaFromUsd(rewardAmount) as number) : undefined)
  return {
    enabled: status?.enabled ?? true,
    min_quota: minQuota,
    max_quota: maxQuota,
    stats: {
      total_quota: totalQuota,
      total_checkins: totalDays,
      checkin_count: totalDays,
      records,
    },
  } as CheckinStatus
}

export async function doSub2ApiCheckin(account: Account) {
  // 先尝试新版 API（POST /check-in），失败则回退旧版（POST /user/check-in）
  try {
    return await sub2ApiRequest<any>(account, "POST", "/check-in", {})
  } catch (e) {
    return await sub2ApiRequest<any>(account, "POST", "/user/check-in", {})
  }
}

export async function apiRequestWithMeta<T = any>(account: Account, method: string, path: string, body?: any): Promise<ApiResult<T>> {
  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  const cookie = getSecret(account.cookieKey)
  const accessToken = getSecret(account.accessTokenKey)
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Origin": baseUrl,
    "Referer": `${baseUrl}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  }
  if (accessToken) {
    // 使用访问令牌认证
    headers["Authorization"] = accessToken.startsWith("Bearer ") ? accessToken : `Bearer ${accessToken}`
  } else if (cookie) {
    headers.Cookie = cookie
  }
  if (account.lastSelf?.id) headers["New-Api-User"] = String(account.lastSelf.id)
  else if (path !== "/api/user/login" && !accessToken) throw new Error("缺少用户 ID，请先执行一次登录")
  if (body !== undefined) headers["Content-Type"] = "application/json"

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    allowInsecureRequest: baseUrl.startsWith("http://"),
    timeout: 25,
  } as any)

  const raw = await response.text()
  let json: ApiJson<T>
  try {
    json = raw ? JSON.parse(raw) : {}
  } catch {
    // 非 JSON 响应通常是触发了验证或登录失效，而非真正的 API 路径错误
    throw new Error(`响应不是 JSON：${raw.slice(0, 60)}`)
  }

  const setCookie = getHeader(response, "set-cookie")
  const responseCookies = Array.isArray(response?.cookies) ? response.cookies : []

  if (json.success !== true) {
    // HTTP 401/403/404 都可能表示登录失效，把状态码拼进消息，便于上层 isAuthExpiredError 识别并触发重登录
    const status = Number(response?.status) || 0
    const rawMessage = json.message || (status ? `HTTP ${status}` : "未知错误")
    const authExpired = status === 401 || status === 403 || (status === 404 && /session|token|login|登录|权限|auth/i.test(rawMessage))
    const message = authExpired ? `无权进行此操作，未登录或权限不足（HTTP ${status}）：${rawMessage}` : rawMessage
    throw new Error(translateErrorMessage(message))
  }
  return { data: json.data as T, cookie: mergeCookies("", setCookie, responseCookies) }
}

export async function apiRequest<T = any>(account: Account, method: string, path: string, body?: any): Promise<T> {
  return (await apiRequestWithMeta<T>(account, method, path, body)).data
}
