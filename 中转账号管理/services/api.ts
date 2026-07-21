declare const fetch: any
import type { Account, SelfInfo, CheckinStatus, CheckinRecord, ApiJson, ApiResult } from "../types"
import { UA } from "../constants"
import { normalizeBaseUrl, quotaFromUsd, localDateString, localMonthString } from "../utils/format"
import { translateErrorMessage } from "../utils/error"
import { mergeCookies } from "../utils/cookie"
import { getSecret, removeSecret } from "./storage"
import { isWebChallengeResponse, refreshWebChallengeCookies } from "./antiBot"

// 服务端消息中出现这些关键词才认为是登录失效；
// 单纯的 "forbidden"/"access denied"/"permission denied" 不算，因为 403 常被用作额度/IP/权限等业务错误
const AUTH_EXPIRED_MESSAGE_RE = /unauthorized|not\s+logged\s+in|no\s+access\s+token|authentication\s+(is\s+)?required|token\s+(has\s+)?expired|session\s+(has\s+)?expired|cookie\s+(has\s+)?expired|login\s+expired|invalid\s+token|malformed\s+token|missing\s+token|access.?token|session\s*(not\s+found|expired|invalid)|no\s+session|无权进行此操作|未登录|登录状态已过期|登录已过期|令牌无效|令牌已过期/i

// 构造带 HTTP 状态和 authExpired 元数据的错误，供上层判断是否需要重登
function makeApiError(message: string, opts?: { status?: number, authExpired?: boolean }) {
  const err: any = new Error(translateErrorMessage(message))
  if (opts?.status) err.status = opts.status
  if (opts?.authExpired) err.authExpired = true
  return err
}

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

export async function sub2ApiRequest<T = any>(account: Account, method: string, path: string, body?: any, challengeRetried = false): Promise<T> {
  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  const token = getSecret(account.cookieKey)
  if (!token) throw new Error("缺少 Sub2API 登录令牌")

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
    if (isWebChallengeResponse(response, raw)) {
      if (!challengeRetried) {
        await refreshWebChallengeCookies(account)
        return await sub2ApiRequest<T>(account, method, path, body, true)
      }
      throw makeApiError("站点防护验证未通过，请先用网页登录刷新 Cookie 后再试", { authExpired: false })
    }
    // 非 JSON 响应通常是触发了验证或登录失效，而非真正的 API 路径错误
    throw makeApiError(`响应不是 JSON：${raw.slice(0, 60)}`, { authExpired: !response.ok })
  }
  if (!response.ok) {
    // 保留服务端原始消息让翻译规则正确分类（额度不足/被封禁/限流等），auth-expired 只作为元数据附带
    // 401 无条件视为登录失效；403/404 只在消息含认证关键词时才算（避免额度/IP/封禁被误判）
    const status = Number(response.status) || 0
    const rawMessage = json?.message || json?.detail || (status ? `HTTP ${status}` : "未知错误")
    const authExpired = status === 401 || AUTH_EXPIRED_MESSAGE_RE.test(rawMessage)
    throw makeApiError(rawMessage, { status, authExpired })
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

export async function apiRequestWithMeta<T = any>(account: Account, method: string, path: string, body?: any, extraHeaders?: Record<string, string>, challengeRetried = false): Promise<ApiResult<T>> {
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
  // 附加调用方传入的额外请求头（如 PoW 签到签名头）
  if (extraHeaders) Object.assign(headers, extraHeaders)
  if (accessToken) {
    // 使用访问令牌认证
    headers["Authorization"] = accessToken.startsWith("Bearer ") ? accessToken : `Bearer ${accessToken}`
  } else if (cookie) {
    headers.Cookie = cookie
  }
  if (account.lastSelf?.id) headers["New-Api-User"] = String(account.lastSelf.id)
  else if (path !== "/api/user/login" && !accessToken) throw new Error("缺少用户 ID，请先登录")
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
    if (isWebChallengeResponse(response, raw)) {
      if (!challengeRetried) {
        await refreshWebChallengeCookies(account)
        return await apiRequestWithMeta<T>(account, method, path, body, extraHeaders, true)
      }
      throw makeApiError("站点防护验证未通过，请先用网页登录刷新 Cookie 后再试", { authExpired: false })
    }
    // 非 JSON 响应通常是触发了验证或登录失效，而非真正的 API 路径错误
    throw makeApiError(`响应不是 JSON：${raw.slice(0, 60)}`, { authExpired: true })
  }

  const setCookie = getHeader(response, "set-cookie")
  const responseCookies = Array.isArray(response?.cookies) ? response.cookies : []

  if (json.success !== true) {
    // 保留服务端原始消息让翻译规则正确分类（额度不足/被封禁/限流等），auth-expired 只作为元数据附带
    // NewAPI 常返回 HTTP 200 + success:false，主要靠消息文本识别；403 单独不足以判定登录失效
    const status = Number(response?.status) || 0
    const rawMessage = json.message || (status ? `HTTP ${status}` : "未知错误")
    const authExpired = status === 401 || AUTH_EXPIRED_MESSAGE_RE.test(rawMessage)
    throw makeApiError(rawMessage, { status, authExpired })
  }
  return { data: json.data as T, cookie: mergeCookies("", setCookie, responseCookies) }
}

export async function apiRequest<T = any>(account: Account, method: string, path: string, body?: any, extraHeaders?: Record<string, string>): Promise<T> {
  return (await apiRequestWithMeta<T>(account, method, path, body, extraHeaders)).data
}
