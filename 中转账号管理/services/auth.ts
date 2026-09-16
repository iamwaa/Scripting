declare const fetch: any

import type { Account, SelfInfo, SiteStatus, CheckinStatus } from "../types"
import { isSub2ApiAccount, getPlatformCapability, isRecordOnlyAccount, normalizeBaseUrl, quotaFromUsd, localMonthString, localDateString, now } from "../utils/format"
import { translateErrorMessage, getErrorMessage } from "../utils/error"
import { mergeCookies } from "../utils/cookie"
import { sha256Hex } from "../utils/crypto"
import { getSecret, setSecret, removeSecret, loadAccounts, patchAccount, getRefreshTokenKey, getAccountApiKey } from "./storage"
import { unwrapSub2ApiJson, sub2ApiRequest, fetchSub2ApiSelf, fetchSub2ApiCheckinStatus, doSub2ApiCheckin, apiRequestWithMeta, apiRequest, isRouteUnavailable, fetchApiKeyBalance, type ApiRequestOptions } from "./api"
import {
  getWebLoginCookie,
  openManualCheckinWebView,
  loginByWebView,
  getWebViewLoadingHTML,
  presentWebViewAndLoadURL,
  findSelfInfo,
  extractSub2ApiToken,
  extractSelfInfoFromStorage,
  prepareWebLoginPage,
  installWebNavigationBridge,
  loadWebUrlWithFallback,
  readWebLoginStorage,
} from "./webAuth"

// 兼容旧入口：页面仍从 auth 导入网页登录相关 API
export {
  getWebLoginCookie,
  openManualCheckinWebView,
  loginByWebView,
  getWebViewLoadingHTML,
  presentWebViewAndLoadURL,
  findSelfInfo,
  extractSub2ApiToken,
  extractSelfInfoFromStorage,
  prepareWebLoginPage,
  installWebNavigationBridge,
  loadWebUrlWithFallback,
  readWebLoginStorage,
}

// 检测站点连通性
export async function checkSiteStatus(account: Account): Promise<SiteStatus> {
  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  const startedAt = Date.now()
  try {
    const response = await fetch(baseUrl, {
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/json,text/plain,*/*",
      },
      allowInsecureRequest: baseUrl.startsWith("http://"),
      timeout: 12,
    } as any)
    const statusCode = Number(response?.status) || undefined
    const latencyMs = Date.now() - startedAt
    const state: SiteStatus["state"] = !statusCode || statusCode < 400 ? "online" : "warning"
    // 根据常见的 HTTP 状态码给出更友好的 warning 提示
    const formatWarning = (code?: number) => {
      if (!code) return "站点访问异常"
      if (code === 401) return "需要登录（HTTP 401）"
      if (code === 403) return "站点拒绝访问（HTTP 403）"
      if (code === 404) return "站点地址可能有误（HTTP 404）"
      if (code === 429) return "请求过于频繁，请稍后再试（HTTP 429）"
      if (code >= 500) return `站点服务异常（HTTP ${code}）`
      return `站点返回 HTTP ${code}`
    }
    const message = state === "online" ? "站点可访问" : formatWarning(statusCode)
    return { state, statusCode, message, checkedAt: now(), latencyMs }
  } catch (e: any) {
    return {
      state: "offline",
      message: getErrorMessage(e),
      checkedAt: now(),
      latencyMs: Date.now() - startedAt,
    }
  }
}

// Sub2API 密码登录
export async function loginSub2ApiAccount(account: Account) {
  const password = getSecret(account.passwordKey)
  if (!account.username || !password) {
    throw new Error("未保存用户名/密码，请编辑账号或使用网页登录")
  }

  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "zh",
      "Content-Type": "application/json",
      "Origin": baseUrl,
      "Referer": `${baseUrl}/`,
    },
    body: JSON.stringify({
      email: account.username,
      password,
    }),
    allowInsecureRequest: baseUrl.startsWith("http://"),
    timeout: 25,
  } as any)

  const raw = await response.text()
  let json: any
  try {
    json = raw ? JSON.parse(raw) : {}
  } catch {
    throw new Error(`响应不是 JSON：${raw.slice(0, 60)}`)
  }
  if (!response.ok) throw new Error(translateErrorMessage(json?.message || json?.detail || `HTTP ${response.status}`))

  const data = unwrapSub2ApiJson<any>(json)
  if (data?.requires_2fa) throw new Error("该账号需要 2FA，请使用网页登录")
  const token = data?.access_token
  if (!token) throw new Error("登录成功但未返回 access_token")
  if (account.cookieKey) setSecret(account.cookieKey, token)
  // 存下 refresh_token，后续签到用它免 Turnstile 换新 access_token
  if (data?.refresh_token) setSecret(getRefreshTokenKey(account), data.refresh_token)

  const self = data?.user ? {
    id: data.user.id,
    username: data.user.username,
    display_name: data.user.display_name || data.user.username || data.user.email,
    email: data.user.email,
    group: data.user.role || data.user.status,
    quota: quotaFromUsd(data.user.balance),
    balance: data.user.balance,
    status: data.user.status,
  } as SelfInfo : await fetchSub2ApiSelf(account)
  patchAccount(account.id, { lastSelf: self, lastError: "", authSource: "password" })
  return self
}

// 统一登录入口
export async function loginAccount(account: Account) {
  if (isSub2ApiAccount(account)) return await loginSub2ApiAccount(account)
  // 优先尝试访问令牌认证（需要用户 ID 才能发起请求）
  const accessToken = getSecret(account.accessTokenKey)
  if (accessToken && account.lastSelf?.id) {
    try {
      const self = await apiRequest<SelfInfo>(account, "GET", "/api/user/self")
      patchAccount(account.id, { lastSelf: self, lastError: "", authSource: "accessToken" })
      return self
    } catch (e: any) {
      // 令牌失效：若该账号同时保存了账号密码，则回退到密码登录后再执行后续操作
      const password = getSecret(account.passwordKey)
      if (!account.username || !password) throw e
      // 清除已过期的访问令牌，避免后续请求继续优先使用失效令牌（否则 apiRequest 仍会用旧令牌覆盖新生成的会话 Cookie）
      if (account.accessTokenKey) removeSecret(account.accessTokenKey)
      // 落到下方密码登录逻辑
    }
  }
  const password = getSecret(account.passwordKey)
  if (!account.username || !password) {
    if (accessToken && !account.lastSelf?.id) {
      throw new Error("访问令牌登录需先填写用户 ID")
    }
    throw new Error("未保存用户名/密码或访问令牌，请编辑账号或使用网页登录")
  }
  const result = await apiRequestWithMeta<any>(account, "POST", "/api/user/login", {
    username: account.username,
    password,
  })
  const data = result.data
  if (data?.require_2fa) {
    throw new Error("该账号需要 2FA，请使用网页登录")
  }
  const mergedCookie = mergeCookies(getSecret(account.cookieKey), result.cookie)
  if (mergedCookie && account.cookieKey) setSecret(account.cookieKey, mergedCookie)
  patchAccount(account.id, { lastSelf: data, lastError: "", authSource: "password" })
  return data
}

// 检测错误是否为登录状态失效（需要重登）
// 优先读取 api.ts 附加的 authExpired 元数据；若无（例如本地校验或第三方抛错），回退到消息文本匹配
function isAuthExpiredError(error: any): boolean {
  if (error && typeof error === "object" && error.authExpired === true) return true
  const message = String(error?.message ?? error ?? "")
  return (
    // 本地校验类（apiRequestWithMeta 抛出，不带元数据）
    message.includes("缺少用户 ID") ||
    message.includes("缺少 Sub2API 登录令牌") ||
    // 翻译规则输出（如“登录状态已失效”“登录会话已失效”）
    /登录(状态|会话|令牌).{0,4}(已过期|已失效|无效)/.test(message) ||
    /访问令牌.{0,4}(已过期|无效)/.test(message)
  )
}

// 除 API Key 以外是否还有可用凭据（Cookie / 访问令牌 / 账号密码）
function hasNonApiKeyCredential(account: Account) {
  return !!getSecret(account.cookieKey) || !!getSecret(account.accessTokenKey) || !!(account.username && getSecret(account.passwordKey))
}

// 获取用户信息（含自动重登录）
export async function fetchSelf(account: Account, options?: ApiRequestOptions) {
  // 仅记录账号的平台不兼容 /api/user/*，只能靠 API Key 的计费接口拿额度
  if (isRecordOnlyAccount(account)) {
    if (!getAccountApiKey(account)) throw new Error("仅记录账号需填写 API Key 才能查余额")
    const billing = await fetchApiKeyBalance(account)
    return { ...(account.lastSelf ?? {}), ...billing } as SelfInfo
  }
  if (isSub2ApiAccount(account)) {
    try {
      return await fetchSub2ApiSelf(account)
    } catch (e: any) {
      if (isAuthExpiredError(e)) {
        return await loginAccount(account)
      }
      throw e
    }
  }
  // 填了 API Key 的账号优先走 OpenAI 兼容计费接口：这类站点多半把 /api/user/self 拦在防护层后面，
  // 直接请求只会反复触发防护；计费接口只需 Authorization，也不依赖用户 ID
  if (getAccountApiKey(account)) {
    try {
      const billing = await fetchApiKeyBalance(account)
      // 计费接口只能读到额度，用户名、分组等沿用上次查询结果
      return { ...(account.lastSelf ?? {}), ...billing } as SelfInfo
    } catch (e: any) {
      // 没有其他凭据时直接报错，避免把 API Key 的问题混成登录失败
      if (!hasNonApiKeyCredential(account)) throw new Error(`API Key 查余额失败：${getErrorMessage(e)}`)
    }
  }
  try {
    return await apiRequest<SelfInfo>(account, "GET", "/api/user/self", undefined, undefined, options)
  } catch (e: any) {
    if (isAuthExpiredError(e)) {
      await loginAccount(account)
      const latest = loadAccounts().find(a => a.id === account.id) ?? account
      return await apiRequest<SelfInfo>(latest, "GET", "/api/user/self", undefined, undefined, options)
    }
    throw e
  }
}

// 签到状态接口不返回历史的平台（如 Veloera 的 /api/user/check_in_status 只有 can_check_in）：
// 用本地已记录的当月签到 + 今日状态拼出可用的签到状态
function normalizeCheckinStatus(account: Account, month: string, data: any): CheckinStatus {
  const today = localDateString()
  const records = (account.lastCheckin?.stats?.records ?? [])
    .filter(record => record.checkin_date?.startsWith(month) && record.checkin_date !== today)
  // can_check_in 为 false 说明今日已签到
  if (data?.can_check_in === false && today.startsWith(month)) records.push({ checkin_date: today })
  return { enabled: true, stats: { checkin_count: records.length, records } }
}

// 获取签到状态（根据平台分发，先验证登录状态再查询）
export async function fetchCheckinStatus(account: Account, month = localMonthString(), options?: ApiRequestOptions) {
  // 验证登录状态，失效时自动重登，返回刷新后的账号
  const verified = await verifyLoginStatus(account, options)
  if (isSub2ApiAccount(verified)) return await fetchSub2ApiCheckinStatus(verified, month)
  const capability = getPlatformCapability(verified)
  const checkin = capability.checkin
  if (!checkin) return { enabled: false } as CheckinStatus
  const checkinPath = checkin.statusPath(month)
  const request = async (target: Account) => {
    const data = await apiRequest<any>(target, "GET", checkinPath, undefined, undefined, options)
    return capability.checkinHistory ? data as CheckinStatus : normalizeCheckinStatus(target, month, data)
  }
  try {
    return await request(verified)
  } catch (e: any) {
    // 站点没有签到路由（OneAPI / OneHub / DoneHub 等）：按未启用返回，不当错误处理
    if (isRouteUnavailable(e)) return { enabled: false } as CheckinStatus
    // 校验通过但查询接口仍报登录失效：登录后重试一次
    if (!isAuthExpiredError(e)) throw e
    await loginAccount(verified)
    const latest = loadAccounts().find(a => a.id === account.id) ?? account
    return await request(latest)
  }
}

// 检查账号登录状态是否有效（轻量验证，失效时自动重登，重登失败才抛错）
async function verifyLoginStatus(account: Account, options?: ApiRequestOptions): Promise<Account> {
  // 重登后返回最新的账号数据
  const reload = () => loadAccounts().find(a => a.id === account.id) ?? account
  // 该账号是否可用账号密码重登（决定校验失败后能否无条件回退登录）
  const hasPassword = !!(account.username && getSecret(account.passwordKey))

  // 判断是否为服务端明确拒绝访问，用于避免自动重登失败时误报登录失效。
  const isHttp403Error = (error: any) => {
    const status = Number(error?.status)
    const message = String(error?.message ?? error ?? "")
    return status === 403 || /^(HTTP\s*)?403(\s+Forbidden)?$/i.test(message)
  }

  // 统一重登失败抛错
  const throwReloginFailed = (loginError: any, originalError?: any) => {
    const preferredError = isHttp403Error(originalError) ? originalError : isHttp403Error(loginError) ? loginError : undefined
    if (preferredError) throw new Error(getErrorMessage(preferredError))
    throw new Error("登录状态已失效，自动重登失败")
  }

  // Sub2API 分支：仅在确认为登录失效时重登
  if (isSub2ApiAccount(account)) {
    try {
      await sub2ApiRequest(account, "GET", "/auth/me")
      return account
    } catch (e: any) {
      if (!isAuthExpiredError(e)) throw e
      try { await loginAccount(account); return reload() }
      catch (loginError: any) { throw throwReloginFailed(loginError, e) }
    }
  }

  // NewAPI 分支：根据现有凭据做轻量校验
  const accessToken = getSecret(account.accessTokenKey)
  const cookie = getSecret(account.cookieKey)
  const canUseToken = !!(accessToken && account.lastSelf?.id)
  // 没有任何可用凭据：有账号密码则直接登录，否则提示
  if (!canUseToken && !cookie) {
    if (hasPassword) {
      // 清除残留的失效令牌，避免重登后 apiRequest 仍优先使用旧令牌
      if (accessToken && account.accessTokenKey) removeSecret(account.accessTokenKey)
      try { await loginAccount(account); return reload() }
      catch (loginError: any) { throw throwReloginFailed(loginError) }
    }
    // 仅剩访问令牌但尚未解析出用户 ID：用裸令牌请求 /api/user/self 自动解析并回填（NewAPI 访问令牌自带用户身份）
    if (accessToken) {
      try {
        const self = await apiRequest<SelfInfo>(account, "GET", "/api/user/self", undefined, undefined, options)
        patchAccount(account.id, { lastSelf: self, lastError: "", authSource: "accessToken" })
        return loadAccounts().find(a => a.id === account.id) ?? account
      } catch (e: any) {
        const err = getErrorMessage(e)
        if (isAuthExpiredError(e)) {
          throw new Error(err || "访问令牌无效")
        }
        throw new Error(err || "访问令牌校验失败")
      }
    }
    throw new Error("缺少 Cookie 或访问令牌")
  }
  try {
    await apiRequest<SelfInfo>(account, "GET", "/api/user/self", undefined, undefined, options)
    return account
  } catch (e: any) {
    // 校验失败：有账号密码则无条件重登（与详情页“登录”按钮一致，不依赖错误文案匹配）
    if (hasPassword) {
      // 清除已确认失效的访问令牌，避免重登后 apiRequest 仍优先使用旧令牌覆盖新生成的会话 Cookie
      if (accessToken && account.accessTokenKey) removeSecret(account.accessTokenKey)
      try { await loginAccount(account); return reload() }
      catch (loginError: any) { throw throwReloginFailed(loginError, e) }
    }
    // 无账号密码：仅在确认为登录失效时才重登（尝试用现有凭据重登）
    if (!isAuthExpiredError(e)) throw e
    try { await loginAccount(account); return reload() }
    catch (loginError: any) { throw throwReloginFailed(loginError, e) }
  }
}

// 二开 new-api 站点（如 huaibao.top）启用 PoW 签到：POST 需带 X-Checkin-Timestamp / X-Checkin-Signature 头。
// 签名算法：sha256Hex(`${userId}:${timestamp}:${nonce}`)，其中 nonce 来自签到状态接口的 checkin_nonce 字段。

// 判断签到接口错误是否为签名/nonce 相关问题（需重新获取 nonce 重试）
function isCheckinSignatureError(error: any): boolean {
  const message = String(error?.message ?? error ?? "")
  return /签名|signature/i.test(message)
}

// 获取当日 nonce：优先使用缓存中今天的 nonce，否则现场拉取签到状态并缓存
async function fetchCheckinNonce(account: Account): Promise<string> {
  const cached = account.lastCheckin
  const cachedNonce = cached?.checkin_nonce
  if (cachedNonce && cached?.nonce_date === localDateString()) {
    return cachedNonce
  }
  // 现场拉取签到状态拿 nonce
  const status = await fetchCheckinStatus(account)
  const nonce = status?.checkin_nonce
  if (!nonce) throw new Error("该站点签到不需要签名或未返回 nonce")
  return nonce
}

// 发起一次签到 POST（可选带签名头），登录失效时自动重登一次后重试
async function postCheckinOnce(account: Account, doPath: string, extraHeaders?: Record<string, string>): Promise<any> {
  try {
    return await apiRequest<any>(account, "POST", doPath, {}, extraHeaders)
  } catch (e: any) {
    // 站点没有签到路由（OneAPI / OneHub / DoneHub 等）：给出未启用提示，供上层标记为不可签到
    if (isRouteUnavailable(e)) throw new Error("该站点签到功能未启用")
    if (!isAuthExpiredError(e)) throw e
    await loginAccount(account)
    const latest = loadAccounts().find(a => a.id === account.id) ?? account
    return await apiRequest<any>(latest, "POST", doPath, {}, extraHeaders)
  }
}

// 执行签到（根据平台分发，先验证登录状态再签到）
export async function doCheckin(account: Account) {
  // 验证登录状态，失效时自动重登，返回刷新后的账号
  const verified = await verifyLoginStatus(account)
  if (isSub2ApiAccount(verified)) return await doSub2ApiCheckin(verified)

  const checkin = getPlatformCapability(verified).checkin
  if (!checkin) throw new Error("该站点签到功能未启用")
  const doPath = checkin.doPath

  // 先尝试获取 PoW 签到 nonce：有 nonce 走签名签到，无 nonce（普通站点）走普通签到
  let nonce: string | undefined
  try {
    nonce = await fetchCheckinNonce(verified)
  } catch {
    // 站点不支持签名签到（未返回 nonce）：走普通签到流程
    return await postCheckinOnce(verified, doPath)
  }

  // 带 PoW 签名头签到；签名/nonce 失效则刷新 nonce 重试一次
  try {
    return await postCheckinOnce(verified, doPath, buildCheckinSignatureHeaders(verified, nonce))
  } catch (e: any) {
    if (!isCheckinSignatureError(e)) throw e
    const latest = loadAccounts().find(a => a.id === account.id) ?? verified
    const freshNonce = await fetchCheckinNonce({ ...latest, lastCheckin: undefined })
    return await postCheckinOnce(latest, doPath, buildCheckinSignatureHeaders(latest, freshNonce))
  }
}

// 构造 PoW 签名请求头（需在调用前确保 account.lastSelf.id 存在）
function buildCheckinSignatureHeaders(account: Account, nonce: string): Record<string, string> {
  const userId = account.lastSelf?.id
  if (!userId) throw new Error("缺少用户 ID，请先登录")
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = sha256Hex(`${userId}:${timestamp}:${nonce}`)
  return { "X-Checkin-Timestamp": timestamp, "X-Checkin-Signature": signature }
}
