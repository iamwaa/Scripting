declare const fetch: any
import type { Account, SelfInfo, CheckinStatus, CheckinRecord, ApiJson, ApiResult } from "../types"
import { normalizeBaseUrl, quotaFromUsd, localDateString, localMonthString } from "../utils/format"
import { translateErrorMessage } from "../utils/error"
import { mergeCookies } from "../utils/cookie"
import { getSecret, setSecret, removeSecret, getRefreshTokenKey } from "./storage"
import { isWebChallengeResponse, refreshWebChallengeCookies } from "./antiBot"

// 服务端消息中出现这些关键词才认为是登录失效；
// 单纯的 "forbidden"/"access denied"/"permission denied" 不算，因为 403 常被用作额度/IP/权限等业务错误
const AUTH_EXPIRED_MESSAGE_RE = /unauthorized|not\s+logged\s+in|not\s+authenticated|user\s+not\s+authenticated|authorization\s+(header\s+)?is\s+required|authorization\s+required|no\s+access\s+token|authentication\s+(is\s+)?required|token\s+(has\s+)?expired|token\s+has\s+been\s+revoked|session\s+(has\s+)?expired|cookie\s+(has\s+)?expired|login\s+expired|invalid\s+token|malformed\s+token|missing\s+token|access.?token\s+(无效|invalid|expired|已过期)|session\s*(not\s+found|expired|invalid)|no\s+session|无权进行此操作，(未登录且未提供\s*access\s*token|access\s*token\s*无效|用户信息无效|未提供\s*New-Api-User)|未登录|登录状态已过期|登录已过期|令牌无效|令牌已过期/i

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
  removeSecret(getRefreshTokenKey(account))
}

export function unwrapSub2ApiJson<T>(json: any): T {
  if (json && typeof json === "object" && "code" in json) {
    if (json.code === 0) return json.data as T
    throw new Error(translateErrorMessage(json.message || json.detail || `API code ${json.code}`))
  }
  return json as T
}

// 用 refresh_token 调 /auth/refresh 换取新的 access_token（不经过登录 Turnstile）
export async function refreshSub2ApiToken(account: Account): Promise<boolean> {
  const refreshTokenKey = getRefreshTokenKey(account)
  const refreshToken = getSecret(refreshTokenKey)
  if (!refreshToken) return false
  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) return false
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": baseUrl,
        "Referer": `${baseUrl}/`,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      allowInsecureRequest: baseUrl.startsWith("http://"),
      timeout: 25,
    } as any)
    const raw = await response.text()
    if (!response.ok) return false
    let json: any
    try { json = raw ? JSON.parse(raw) : {} } catch { return false }
    const data = unwrapSub2ApiJson<any>(json)
    const newToken = data?.access_token
    if (!newToken) return false
    if (account.cookieKey) setSecret(account.cookieKey, newToken)
    // 部分实现会轮换 refresh_token，一并更新
    if (data?.refresh_token) setSecret(refreshTokenKey, data.refresh_token)
    return true
  } catch {
    return false
  }
}

export async function sub2ApiRequest<T = any>(account: Account, method: string, path: string, body?: any, challengeRetried = false, refreshRetried = false): Promise<T> {
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
    // 非 JSON 响应：附上 HTTP 状态，便于上层 isRouteUnavailable 识别 404/405 触发路由回退
    // authExpired 仅在非 2xx 时附带（2xx 非 JSON 多为网关/防护异常页）
    const status = Number(response.status) || 0
    throw makeApiError(`响应不是 JSON：${raw.slice(0, 60)}`, { status, authExpired: !response.ok })
  }
  if (!response.ok) {
    // 保留服务端原始消息让翻译规则正确分类（额度不足/被封禁/限流等），auth-expired 只作为元数据附带
    // 401 无条件视为登录失效；403/404 只在消息含认证关键词时才算（避免额度/IP/封禁被误判）
    const status = Number(response.status) || 0
    const rawMessage = json?.message || json?.detail || (status ? `HTTP ${status}` : "未知错误")
    const authExpired = status === 401 || AUTH_EXPIRED_MESSAGE_RE.test(rawMessage)
    // 登录态失效时先用 refresh_token 换新 access_token 再重试一次，避开登录 Turnstile
    if (authExpired && !refreshRetried && await refreshSub2ApiToken(account)) {
      return await sub2ApiRequest<T>(account, method, path, body, challengeRetried, true)
    }
    throw makeApiError(rawMessage, { status, authExpired })
  }
  return unwrapSub2ApiJson<T>(json)
}

function isRouteUnavailable(error: any) {
  const status = Number(error?.status)
  return status === 404 || status === 405
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
  } catch (newRouteError) {
    if (!isRouteUnavailable(newRouteError)) throw newRouteError
    try {
      status = await sub2ApiRequest<any>(account, "GET", "/user/check-in")
    } catch (legacyRouteError) {
      if (!isRouteUnavailable(legacyRouteError)) throw legacyRouteError
      // Sub2API 官方仓库当前未提供签到接口，兼容部署可继续返回禁用状态。
      return { enabled: false, min_quota: undefined, max_quota: undefined, stats: { total_quota: undefined, total_checkins: 0, checkin_count: 0, records: [] } } as CheckinStatus
    }
  }
  // 今日预期奖励金额（用于未签到时的预览与本地记录回退）：
  // 新版 status.today_reward（失败回退 reward_amount），旧版 status.reward_amount
  const previewRewardAmount = isNewApi ? (status?.today_reward ?? status?.reward_amount) : status?.reward_amount
  let records: CheckinRecord[] = []
  // 本地记录的签到奖励（仅旧版无历史接口时用于补充月历金额）
  const localRewards = account.checkinRewards ?? {}
  // 新版：拉取签到历史，用每条真实奖励金额填充记录（类似 newapi 签到信息）
  let historyItems: any[] = []
  if (isNewApi) {
    try {
      const history = await sub2ApiRequest<any>(account, "GET", "/check-in/history?page=1&page_size=100")
      historyItems = Array.isArray(history?.items) ? history.items : []
    } catch {}
  }
  // 历史记录按日期索引，便于用真实奖励金额覆盖日历记录
  const rewardByDate: Record<string, number | undefined> = {}
  for (const item of historyItems) {
    const date = item?.check_in_date
    const amount = Number(item?.reward_amount)
    if (date && Number.isFinite(amount)) rewardByDate[date] = amount
  }
  // 日历返回的当月累计天数（用于旧版 totalDays 回退，避免日历失败时丢失累计数）
  let calendarCheckedInDays: number | undefined
  // 当月签到日历：新版走 /check-in/calendar?month=YYYY-MM，旧版走 /user/check-in/calendar?year=Y&month=M
  try {
    const calendar = isNewApi
      ? await sub2ApiRequest<any>(account, "GET", `/check-in/calendar?month=${year}-${String(monthIndex).padStart(2, "0")}`)
      : await sub2ApiRequest<any>(account, "GET", `/user/check-in/calendar?year=${year}&month=${monthIndex}`)
    // 新版 API 返回 signed_dates 数组，旧版返回 checked_in_dates 数组
    const dates = calendar?.signed_dates ?? calendar?.checked_in_dates ?? []
    calendarCheckedInDays = calendar?.checked_in_days ?? calendar?.total_check_in_days
    records = dates.map((date: string) => ({
      checkin_date: date,
      // 金额优先级：新版历史真实金额 > 本地记录金额 > 单次预览金额（旧版 reward_amount 为固定单次奖励，作兜底）
      quota_awarded: quotaFromUsd(rewardByDate[date] ?? localRewards[date] ?? previewRewardAmount),
    }))
  } catch {}
  const checkedToday = status?.checked_in_today
  if (checkedToday && !records.some(record => record.checkin_date === localDateString())) {
    records.push({
      checkin_date: localDateString(),
      quota_awarded: quotaFromUsd(rewardByDate[localDateString()] ?? localRewards[localDateString()] ?? previewRewardAmount),
    })
  }
  // 奖励区间：新版用 rewards 数组（连续签到奖励序列），旧版仅单一值
  const rewards = isNewApi ? (status?.rewards ?? []) : []
  const previewRewardQuota = quotaFromUsd(previewRewardAmount)
  const minQuota = isNewApi
    ? (rewards.length > 0 ? quotaFromUsd(rewards[0]) : previewRewardQuota)
    : (quotaFromUsd(status?.min_quota) ?? previewRewardQuota)
  const maxQuota = isNewApi
    ? (rewards.length > 0 ? quotaFromUsd(rewards[rewards.length - 1]) : previewRewardQuota)
    : (quotaFromUsd(status?.max_quota) ?? previewRewardQuota)
  // 累计签到天数优先取服务端字段，日历失败时仍可用
  const totalDays = isNewApi ? (status?.total_check_in_days ?? records.length) : (status?.check_in_days ?? calendarCheckedInDays ?? records.length)
  // 累计奖励总额：
  // - 新版优先服务端 total_reward；否则按历史记录的 reward_amount 求和（含本月外历史）
  // - 旧版按累计天数 × 本地单次奖励估算（records 仅含当月，不可作累计基数）
  const historyTotalQuota = historyItems.length > 0
    ? historyItems.reduce((sum, item) => sum + (Number(item?.reward_amount) || 0), 0)
    : undefined
  const totalQuota = isNewApi
    ? (quotaFromUsd(status?.total_reward) ?? (historyTotalQuota !== undefined ? quotaFromUsd(historyTotalQuota) : undefined))
    : (previewRewardQuota !== undefined ? totalDays * previewRewardQuota : undefined)
  return {
    enabled: status?.enabled ?? true,
    min_quota: minQuota,
    max_quota: maxQuota,
    stats: {
      total_quota: totalQuota,
      // 累计签到天数取服务端字段；本月签到次数以当月日历记录数为准，避免复用累计值
      total_checkins: totalDays,
      checkin_count: records.length,
      records,
    },
  } as CheckinStatus
}

export async function doSub2ApiCheckin(account: Account) {
  // Sub2API 官方仓库当前未提供签到；仅在兼容站点的新路由不存在时尝试旧路由。
  try {
    return await sub2ApiRequest<any>(account, "POST", "/check-in", {})
  } catch (newRouteError) {
    if (!isRouteUnavailable(newRouteError)) throw newRouteError
    try {
      return await sub2ApiRequest<any>(account, "POST", "/user/check-in", {})
    } catch (legacyRouteError) {
      if (!isRouteUnavailable(legacyRouteError)) throw legacyRouteError
      throw new Error("该 Sub2API 站点未提供签到接口")
    }
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
    // 非 JSON 响应：附上 HTTP 状态，便于上层识别 404/405；authExpired 仅在非 2xx 时附带
    const status = Number(response?.status) || 0
    throw makeApiError(`响应不是 JSON：${raw.slice(0, 60)}`, { status, authExpired: !response.ok })
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
