declare const fetch: any

import {
  Script,
  Navigation,
  NavigationStack,
  List,
  Form,
  Section,
  Text,
  TextField,
  SecureField,
  Button,
  Menu,
  NavigationLink,
  VStack,
  HStack,
  Spacer,
  Group,
  Image,
  ProgressView,
  Toolbar,
  ToolbarItem,
  DatePicker,
  modifiers,
  useEffect,
  useState,
} from "scripting"

type SelfInfo = {
  id?: number
  username?: string
  display_name?: string
  group?: string
  quota?: number
  used_quota?: number
  request_count?: number
}

type CheckinRecord = {
  checkin_date?: string
  quota_awarded?: number
}

type CheckinStats = {
  total_quota?: number
  total_checkins?: number
  checkin_count?: number
  records?: CheckinRecord[]
}

type CheckinStatus = {
  enabled?: boolean
  min_quota?: number
  max_quota?: number
  stats?: CheckinStats
}

type Account = {
  id: string
  name: string
  baseUrl: string
  username?: string
  passwordKey?: string
  cookieKey?: string
  checkinTime?: string
  updatedAt: number
  lastSelf?: SelfInfo
  lastCheckin?: CheckinStatus
  lastTodayCheckin?: CheckinRecord
  lastTodayCheckinDate?: string
  lastError?: string
  authSource?: "password" | "web" | "cookie"
  excludeFromBatchCheckin?: boolean
}

type AccountDraft = {
  id?: string
  name: string
  baseUrl: string
  username: string
  password: string
  cookie: string
  checkinTime: string
  lastSelf?: SelfInfo
  authSource?: Account["authSource"]
}

type AccountSortKey = "name" | "quota" | "checkin"
type SortDirection = "asc" | "desc"

type AccountSortPreference = {
  key: AccountSortKey
  direction: SortDirection
}

type ApiJson<T = any> = {
  success?: boolean
  message?: string
  data?: T
}

type ApiResult<T = any> = {
  data: T
  cookie?: string
}

type WebLoginCookieResult = {
  cookieHeader: string
  storageSelf?: SelfInfo
}

const STORAGE_KEY = "newapi.accounts.v1"
const SORT_STORAGE_KEY = "newapi.accountSort.v1"
const SECRET_PREFIX = "newapi.secret."
const SHARED = { shared: false }
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1"
const QUOTA_PER_USD = 500000

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function now() {
  return Math.floor(Date.now() / 1000)
}

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function localMonthString(date = new Date()) {
  return localDateString(date).slice(0, 7)
}

// 将时间字符串转换为时间戳（用于 DatePicker）
function timeStringToTimestamp(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date.getTime()
}

// 检查当前时间是否已过签到时间
function isCheckinTimeReached(checkinTime: string): boolean {
  const now = new Date()
  const [hours, minutes] = checkinTime.split(':').map(Number)
  const checkinDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes)
  return now >= checkinDate
}

function shouldSkipBatchCheckinByTime(account: Account) {
  return !!account.checkinTime && !isCheckinTimeReached(account.checkinTime)
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function fmtQuota(value: any) {
  if (value === null || value === undefined || value === "") return "-"
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return `$${(n / QUOTA_PER_USD).toFixed(2)}`
}

function fmtRawQuota(value: any) {
  if (value === null || value === undefined || value === "") return "-"
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(2)}M q`
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K q`
  return `${n} q`
}

function fmtMonth(value: string) {
  const [year, month] = value.split("-")
  return `${year}年${Number(month)}月`
}

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number)
  const d = new Date(year, month - 1 + offset, 1)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, "0")
  return `${y}-${m}`
}

function getMonthDays(month: string) {
  const [year, monthIndex] = month.split("-").map(Number)
  const daysInMonth = new Date(year, monthIndex, 0).getDate()
  const firstWeekday = new Date(year, monthIndex - 1, 1).getDay()
  const cells: Array<{ key: string, day?: number, date?: string }> = []
  for (let i = 0; i < firstWeekday; i++) cells.push({ key: `blank-${i}` })
  for (let day = 1; day <= daysInMonth; day++) {
    const dd = `${day}`.padStart(2, "0")
    cells.push({ key: `${month}-${dd}`, day, date: `${month}-${dd}` })
  }
  while (cells.length % 7 !== 0) cells.push({ key: `blank-tail-${cells.length}` })
  return cells
}

function getCheckinRecordMap(records?: CheckinRecord[]) {
  const map: Record<string, CheckinRecord> = {}
  for (const record of records ?? []) {
    if (record.checkin_date) map[record.checkin_date] = record
  }
  return map
}

function sumCheckinAwards(records?: CheckinRecord[]) {
  return (records ?? []).reduce((sum, record) => sum + (Number(record.quota_awarded) || 0), 0)
}

function fmtCheckinAward(value: any) {
  if (value === null || value === undefined || value === "") return ""
  return `+${fmtQuota(value)}`
}

function isTodayDate(value?: string) {
  if (!value) return false
  return value === localDateString()
}

function fmtTime(ts?: number) {
  if (!ts) return "未同步"
  return new Date(ts * 1000).toLocaleString()
}

function shortUrl(url: string) {
  return url.replace(/^https?:\/\//, "")
}

const ERROR_TRANSLATIONS: Array<[RegExp, string]> = [
  [/can'?t\s+find\s+variable:\s*alert/i, "弹窗 API 不可用，请升级 Scripting 或重新运行脚本"],
  [/invalid\s+username\s+or\s+password/i, "用户名或密码错误"],
  [/invalid\s+password/i, "密码错误"],
  [/user\s+not\s+found/i, "用户不存在"],
  [/unauthorized|not\s+logged\s+in|no\s+access\s+token|permission\s+denied|forbidden/i, "未登录或权限不足，请检查 Cookie/登录状态"],
  [/token\s+expired|session\s+expired|cookie\s+expired/i, "登录状态已过期，请重新复制 Cookie"],
  [/too\s+many\s+requests|rate\s+limit/i, "请求过于频繁，请稍后再试"],
  [/not\s+found/i, "请求的资源不存在"],
  [/network\s+request\s+failed|failed\s+to\s+fetch|timed\s*out|timeout/i, "网络请求失败或超时，请检查站点地址和网络"],
  [/internal\s+server\s+error/i, "服务器内部错误"],
  [/bad\s+gateway/i, "网关错误"],
  [/service\s+unavailable/i, "服务暂不可用"],
  [/turnstile|签名|signature/i, "站点启用了 Turnstile 验证，请使用“手动网页签到”"],
]

function translateErrorMessage(message: any) {
  const text = String(message ?? "未知错误")
  const hit = ERROR_TRANSLATIONS.find(([pattern]) => pattern.test(text))
  if (hit) return hit[1]
  return text
}

function getErrorMessage(e: any) {
  const msg = translateErrorMessage(e?.message ?? e)
  const lines = msg.split('\n')
  if (lines.length > 2) {
    return lines.slice(0, 2).join('\n') + '...'
  }
  if (msg.length > 60) {
    return msg.slice(0, 60) + '...'
  }
  return msg
}

function getCheckinDisabledPatch(message: any): Partial<Account> {
  const text = String(message ?? "")
  if (/签到功能未开启|签到.*未开启|check-?in.*(disabled|not\s+enabled)|sign-?in.*(disabled|not\s+enabled)/i.test(text)) {
    return { lastCheckin: { enabled: false } }
  }
  return {}
}

async function showConfirm(options: string | { title?: string, message: string, confirmLabel?: string, cancelLabel?: string }) {
  const fn = (globalThis as any).confirm
  if (typeof fn === "function") return await fn(options)
  console.log(typeof options === "string" ? options : `${options.title ?? "确认"}: ${options.message}`)
  return true
}

function loadAccounts(): Account[] {
  return Storage.get<Account[]>(STORAGE_KEY, SHARED) ?? []
}

function saveAccounts(accounts: Account[]) {
  const ok = Storage.set(STORAGE_KEY, accounts, SHARED)
  if (!ok) throw new Error("保存到本地存储失败")
}

function isAccountSortKey(value: any): value is AccountSortKey {
  return value === "name" || value === "quota" || value === "checkin"
}

function isSortDirection(value: any): value is SortDirection {
  return value === "asc" || value === "desc"
}

function loadAccountSortPreference(): AccountSortPreference {
  const saved = Storage.get<Partial<AccountSortPreference>>(SORT_STORAGE_KEY, SHARED)
  return {
    key: isAccountSortKey(saved?.key) ? saved.key : "name",
    direction: isSortDirection(saved?.direction) ? saved.direction : "asc",
  }
}

function saveAccountSortPreference(preference: AccountSortPreference) {
  Storage.set(SORT_STORAGE_KEY, preference, SHARED)
}

function secretKey(accountId: string, kind: "password" | "cookie") {
  return `${SECRET_PREFIX}${accountId}.${kind}`
}

function getSecret(key?: string) {
  if (!key) return ""
  return Keychain.get(key) ?? ""
}

function setSecret(key: string, value: string) {
  if (value.trim()) {
    const ok = Keychain.set(key, value)
    if (!ok) throw new Error("保存敏感信息到 Keychain 失败")
  }
}

function getAuthSourceText(account: Account) {
  if (account.authSource === "password") return "账号"
  if (account.authSource === "web") return "网页"
  if (account.authSource === "cookie") return "手动Cookie"
  if (getSecret(account.cookieKey)) return "Cookie"
  if (account.username && getSecret(account.passwordKey)) return "账号密码"
  return "未配置"
}

function mergeCookies(oldCookie: string, setCookieHeader?: string, responseCookies?: Array<{ name: string, value: string }>) {
  if (!setCookieHeader && !responseCookies?.length) return oldCookie
  const jar: Record<string, string> = {}
  for (const part of oldCookie.split(";")) {
    const item = part.trim()
    const eq = item.indexOf("=")
    if (eq > 0) jar[item.slice(0, eq)] = item.slice(eq + 1)
  }
  const lines = setCookieHeader ? String(setCookieHeader).split(/,(?=\s*[^;,\s]+=)/) : []
  for (const line of lines) {
    const first = line.split(";")[0]?.trim()
    const eq = first?.indexOf("=") ?? -1
    if (first && eq > 0) jar[first.slice(0, eq)] = first.slice(eq + 1)
  }
  for (const cookie of responseCookies ?? []) {
    if (cookie.name) jar[cookie.name] = cookie.value
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ")
}

function cookiesToHeader(cookies: Array<{ name: string, value: string }>) {
  const jar: Record<string, string> = {}
  for (const cookie of cookies) {
    if (cookie.name) jar[cookie.name] = cookie.value
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ")
}

function parseCookieHeader(cookieHeader: string) {
  const items: Array<{ name: string, value: string }> = []
  for (const part of cookieHeader.split(";")) {
    const item = part.trim()
    const eq = item.indexOf("=")
    if (eq <= 0) continue
    const name = item.slice(0, eq).trim()
    const value = item.slice(eq + 1).trim()
    if (name && !name.startsWith("$")) items.push({ name, value })
  }
  return items
}

function getUrlHostname(url: string) {
  return url.replace(/^https?:\/\//, "").split("/")[0].split(":")[0]
}

function escapeHTML(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function getWebViewLoadingHTML(url: string, title: string) {
  const safeTitle = escapeHTML(title)
  const safeUrl = escapeHTML(shortUrl(url))
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 28px;
      box-sizing: border-box;
      font: -apple-system-body;
      background: Canvas;
      color: CanvasText;
    }
    main { width: min(320px, 100%); text-align: center; }
    .spinner {
      width: 34px;
      height: 34px;
      margin: 0 auto 18px;
      border: 3px solid color-mix(in srgb, CanvasText 16%, transparent);
      border-top-color: #0a84ff;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    h1 { margin: 0 0 8px; font: -apple-system-headline; }
    p { margin: 0; color: color-mix(in srgb, CanvasText 60%, transparent); line-height: 1.45; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <main>
    <div class="spinner" aria-hidden="true"></div>
    <h1>${safeTitle}</h1>
    <p>${safeUrl}</p>
  </main>
</body>
</html>`
}

async function presentWebViewAndLoadURL(webView: WebViewController, url: string, options: { fullscreen?: boolean, navigationTitle?: string }) {
  await webView.loadHTML(getWebViewLoadingHTML(url, "正在打开网页..."), url)
  const openPage = async () => {
    try {
      const loaded = await webView.loadURL(url)
      if (!loaded) throw new Error("页面加载失败，请检查站点地址或网络")
      await prepareWebLoginPage(webView)
    } catch (e: any) {
      await webView.loadHTML(getWebViewLoadingHTML(url, `网页打开失败：${getErrorMessage(e)}`), url)
    }
  }
  setTimeout(() => { void openPage() }, 80)
  await webView.present(options)
}

function findSelfInfo(value: any): SelfInfo | undefined {
  if (!value || typeof value !== "object") return undefined
  if (typeof value.id === "number" && (typeof value.username === "string" || typeof value.display_name === "string" || typeof value.group === "string")) {
    return value as SelfInfo
  }
  for (const key of ["user", "self", "data", "account", "profile"]) {
    const found = findSelfInfo(value[key])
    if (found) return found
  }
  return undefined
}

function extractSelfInfoFromStorage(items: Record<string, string>) {
  for (const raw of Object.values(items)) {
    try {
      const parsed = JSON.parse(raw)
      const found = findSelfInfo(parsed)
      if (found) return found
    } catch {}
  }
  return undefined
}

async function prepareWebLoginPage(webView: WebViewController) {
  const script = `
    const patch = () => {
      window.open = (url) => {
        if (url) {
          try { location.href = new URL(url, location.href).href; }
          catch { location.href = url; }
        }
        return window;
      };
      document.querySelectorAll('a[target="_blank"], a[target="blank"]').forEach(a => a.setAttribute('target', '_self'));
      document.querySelectorAll('form[target="_blank"], form[target="blank"]').forEach(f => f.setAttribute('target', '_self'));
      document.addEventListener('click', (event) => {
        const a = event.target?.closest?.('a[target="_blank"], a[target="blank"]');
        if (!a || !a.href) return;
        event.preventDefault();
        location.href = a.href;
      }, true);
      return true;
    };
    patch();
    if (!window.__newapiPopupPatchTimer) window.__newapiPopupPatchTimer = setInterval(patch, 500);
    return true;
  `
  try { await webView.evaluateJavaScript(script) } catch {}
}

async function readWebLoginStorage(webView: WebViewController) {
  const script = `
    const dump = (storage) => {
      const obj = {};
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        obj[key] = storage.getItem(key);
      }
      return obj;
    };
    return { localStorage: dump(localStorage), sessionStorage: dump(sessionStorage) };
  `
  try {
    return await webView.evaluateJavaScript<{ localStorage?: Record<string, string>, sessionStorage?: Record<string, string> }>(script)
  } catch {
    return {}
  }
}

function getHeader(response: any, name: string) {
  try {
    if (typeof response?.headers?.get === "function") return response.headers.get(name) ?? response.headers.get(name.toLowerCase()) ?? ""
    if (response?.headers && typeof response.headers === "object") return response.headers[name] ?? response.headers[name.toLowerCase()] ?? ""
  } catch {}
  return ""
}

function removeAccountSecrets(account: Account) {
  if (account.passwordKey) Keychain.remove(account.passwordKey)
  if (account.cookieKey) Keychain.remove(account.cookieKey)
}

async function apiRequestWithMeta<T = any>(account: Account, method: string, path: string, body?: any): Promise<ApiResult<T>> {
  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  const cookie = getSecret(account.cookieKey)
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Origin": baseUrl,
    "Referer": `${baseUrl}/`,
  }
  if (cookie) headers.Cookie = cookie
  if (account.lastSelf?.id) headers["New-Api-User"] = String(account.lastSelf.id)
  else if (path !== "/api/user/login") throw new Error("缺少用户 ID，请先执行一次登录")
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
    throw new Error(`响应不是 JSON：${raw.slice(0, 60)}`)
  }

  const setCookie = getHeader(response, "set-cookie")
  const responseCookies = Array.isArray(response?.cookies) ? response.cookies : []

  if (json.success !== true) {
    throw new Error(translateErrorMessage(json.message || `HTTP ${response.status}`))
  }
  return { data: json.data as T, cookie: mergeCookies("", setCookie, responseCookies) }
}

async function apiRequest<T = any>(account: Account, method: string, path: string, body?: any): Promise<T> {
  return (await apiRequestWithMeta<T>(account, method, path, body)).data
}

async function loginAccount(account: Account) {
  const password = getSecret(account.passwordKey)
  if (!account.username || !password) {
    throw new Error("该账号没有保存用户名/密码；第三方登录请使用“网页登录获取 Cookie”")
  }
  const result = await apiRequestWithMeta<any>(account, "POST", "/api/user/login", {
    username: account.username,
    password,
  })
  const data = result.data
  if (data?.require_2fa) {
    throw new Error("该账号需要 2FA，请使用“网页登录获取 Cookie”")
  }
  const mergedCookie = mergeCookies(getSecret(account.cookieKey), result.cookie)
  if (mergedCookie && account.cookieKey) setSecret(account.cookieKey, mergedCookie)
  patchAccount(account.id, { lastSelf: data, lastError: "", authSource: "password" })
  return data
}

async function getWebLoginCookie(baseUrl: string): Promise<WebLoginCookieResult> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  if (!normalizedBaseUrl) throw new Error("请先填写站点地址")
  if (!normalizedBaseUrl.startsWith("http://") && !normalizedBaseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  const webView = new WebViewController()
  try {
    try { webView.setCustomUserAgent(UA) } catch {}
    webView.shouldAllowRequest = async () => {
      setTimeout(() => prepareWebLoginPage(webView), 300)
      setTimeout(() => prepareWebLoginPage(webView), 1200)
      return true
    }
    await presentWebViewAndLoadURL(webView, normalizedBaseUrl, {
      fullscreen: true,
      navigationTitle: "登录完成后关闭页面",
    })

    const cookies = await webView.getCookies(normalizedBaseUrl)
    const cookieHeader = cookiesToHeader(cookies)
    if (!cookieHeader) throw new Error("未获取到 Cookie，请确认已在网页登录成功后再关闭页面")

    const storage = await readWebLoginStorage(webView)
    const storageSelf = extractSelfInfoFromStorage({
      ...(storage.localStorage ?? {}),
      ...(storage.sessionStorage ?? {}),
    })
    return { cookieHeader, storageSelf }
  } finally {
    webView.dispose()
  }
}

async function openManualCheckinWebView(account: Account) {
  const normalizedBaseUrl = normalizeBaseUrl(account.baseUrl)
  if (!normalizedBaseUrl) throw new Error("请先填写站点地址")
  if (!normalizedBaseUrl.startsWith("http://") && !normalizedBaseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }
  if (!account.cookieKey) throw new Error("账号 Cookie 存储键不存在，请重新保存账号")
  const cookieHeader = getSecret(account.cookieKey)
  if (!cookieHeader) throw new Error("该账号没有保存 Cookie，请先使用“网页登录获取 Cookie”")

  const hostname = getUrlHostname(normalizedBaseUrl)
  const secure = normalizedBaseUrl.startsWith("https://")
  const webView = new WebViewController()
  try {
    try { webView.setCustomUserAgent(UA) } catch {}
    webView.shouldAllowRequest = async () => {
      setTimeout(() => prepareWebLoginPage(webView), 300)
      setTimeout(() => prepareWebLoginPage(webView), 1200)
      return true
    }
    for (const cookie of parseCookieHeader(cookieHeader)) {
      await webView.setCookie({
        name: cookie.name,
        value: cookie.value,
        domain: hostname,
        path: "/",
        isSecure: secure,
        isHTTPOnly: false,
        isSessionOnly: true,
      })
    }
    await presentWebViewAndLoadURL(webView, normalizedBaseUrl, {
      fullscreen: true,
      navigationTitle: "手动签到后关闭页面",
    })

    const cookies = await webView.getCookies(normalizedBaseUrl)
    const nextCookieHeader = cookiesToHeader(cookies)
    if (nextCookieHeader) setSecret(account.cookieKey, mergeCookies(cookieHeader, undefined, cookies))
  } finally {
    webView.dispose()
  }
}

async function loginByWebView(account: Account) {
  if (!account.cookieKey) throw new Error("账号 Cookie 存储键不存在，请重新保存账号")
  const { cookieHeader, storageSelf } = await getWebLoginCookie(account.baseUrl)
  setSecret(account.cookieKey, cookieHeader)

  const id = storageSelf?.id ?? account.lastSelf?.id
    if (!id) {
      patchAccount(account.id, { lastError: "已保存 Cookie，但未能自动识别用户 ID。请在网页确认已登录后再试，或先用账号密码登录一次。", authSource: "web" })
      throw new Error("已保存 Cookie，但未能自动识别用户 ID，暂时无法调用 /api/user/self")
    }

  const tempAccount: Account = { ...account, lastSelf: { ...(account.lastSelf ?? {}), ...(storageSelf ?? {}), id } }
  const self = await apiRequest<SelfInfo>(tempAccount, "GET", "/api/user/self")
  patchAccount(account.id, { lastSelf: self, lastError: "", authSource: "web" })
  return self
}

async function fetchSelf(account: Account) {
  try {
    return await apiRequest<SelfInfo>(account, "GET", "/api/user/self")
  } catch (e: any) {
    const message = getErrorMessage(e)
    if (message.includes("缺少用户 ID") || message.includes("未登录") || message.includes("权限不足")) {
      await loginAccount(account)
      const latest = loadAccounts().find(a => a.id === account.id) ?? account
      return await apiRequest<SelfInfo>(latest, "GET", "/api/user/self")
    }
    throw e
  }
}

async function fetchCheckinStatus(account: Account, month = localMonthString()) {
  return await apiRequest<CheckinStatus>(account, "GET", `/api/user/checkin?month=${encodeURIComponent(month)}`)
}

async function doCheckin(account: Account) {
  return await apiRequest<any>(account, "POST", "/api/user/checkin", {})
}

function upsertAccount(draft: AccountDraft) {
  const accounts = loadAccounts()
  const id = draft.id || uid()
  const idx = accounts.findIndex(a => a.id === id)
  const prev = idx >= 0 ? accounts[idx] : undefined
  const passwordKey = prev?.passwordKey ?? secretKey(id, "password")
  const cookieKey = prev?.cookieKey ?? secretKey(id, "cookie")

  const account: Account = {
    ...(prev ?? {} as Account),
    id,
    name: draft.name.trim(),
    baseUrl: normalizeBaseUrl(draft.baseUrl),
    username: draft.username.trim() || undefined,
    passwordKey,
    cookieKey,
    checkinTime: draft.checkinTime.trim() || undefined,
    updatedAt: now(),
  }

  if (!account.name) throw new Error("请填写显示名称")
  if (!account.baseUrl) throw new Error("请填写站点地址")
  if (!account.baseUrl.startsWith("http://") && !account.baseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  if (draft.cookie.trim()) account.authSource = draft.authSource ?? "cookie"
  if (draft.lastSelf) account.lastSelf = draft.lastSelf

  setSecret(passwordKey, draft.password)
  setSecret(cookieKey, draft.cookie)

  if (idx >= 0) accounts[idx] = account
  else accounts.unshift(account)
  saveAccounts(accounts)
  return account
}

function patchAccount(accountId: string, patch: Partial<Account>) {
  const accounts = loadAccounts()
  const idx = accounts.findIndex(a => a.id === accountId)
  if (idx < 0) return accounts
  accounts[idx] = { ...accounts[idx], ...patch, updatedAt: now() }
  saveAccounts(accounts)
  return accounts
}

function deleteAccount(accountId: string) {
  const accounts = loadAccounts()
  const account = accounts.find(a => a.id === accountId)
  if (account) removeAccountSecrets(account)
  saveAccounts(accounts.filter(a => a.id !== accountId))
}

function getCheckinRecords(status?: CheckinStatus): CheckinRecord[] {
  const records = status?.stats?.records
  return Array.isArray(records) ? records : []
}

function getTodayCheckinRecord(status?: CheckinStatus) {
  const today = localDateString()
  return getCheckinRecords(status).find(record => record.checkin_date === today)
}

function getTodayCheckinInfo(account?: Account) {
  const today = localDateString()
  const statusRecord = getTodayCheckinRecord(account?.lastCheckin)
  const savedRecord = account?.lastTodayCheckinDate === today ? account?.lastTodayCheckin : undefined
  const record = statusRecord ?? savedRecord
  const checked = !!record || account?.lastTodayCheckinDate === today
  return { checked, record }
}

function compareMaybeNumber(a: number | undefined, b: number | undefined, direction: SortDirection) {
  const aValid = Number.isFinite(a)
  const bValid = Number.isFinite(b)
  if (!aValid && !bValid) return 0
  if (!aValid) return 1
  if (!bValid) return -1
  return direction === "asc" ? (a as number) - (b as number) : (b as number) - (a as number)
}

function getAccountQuotaValue(account: Account) {
  const quota = account.lastSelf?.quota
  if (quota === undefined || quota === null) return undefined
  const value = Number(quota)
  return Number.isFinite(value) ? value : undefined
}

function compareAccounts(a: Account, b: Account, key: AccountSortKey, direction: SortDirection) {
  if (key === "name") {
    const result = a.name.localeCompare(b.name, "zh-Hans", { numeric: true, sensitivity: "base" })
    return direction === "asc" ? result : -result
  }
  if (key === "quota") {
    return compareMaybeNumber(getAccountQuotaValue(a), getAccountQuotaValue(b), direction)
  }
  const aChecked = getTodayCheckinInfo(a).checked ? 1 : 0
  const bChecked = getTodayCheckinInfo(b).checked ? 1 : 0
  return direction === "asc" ? aChecked - bChecked : bChecked - aChecked
}

function sortAccounts(accounts: Account[], key: AccountSortKey, direction: SortDirection) {
  return [...accounts].sort((a, b) => compareAccounts(a, b, key, direction) || a.updatedAt - b.updatedAt)
}

function getAccountSortTitle(key: AccountSortKey) {
  if (key === "name") return "名称"
  if (key === "quota") return "金额"
  return "签到"
}

function getTodayCheckinPatch(status?: CheckinStatus): Partial<Account> {
  const today = localDateString()
  const record = getTodayCheckinRecord(status)
  if (record) {
    return {
      lastTodayCheckinDate: today,
      lastTodayCheckin: record,
    }
  }
  return {}
}

function getCheckinCount(status: CheckinStatus | undefined, records: CheckinRecord[]) {
  const count = Number(status?.stats?.checkin_count)
  return Number.isFinite(count) ? count : records.length
}

function getCalendarCellPalette() {
  return {
    todayBackground: {
      light: "rgba(0,122,255,0.14)",
      dark: "rgba(0,122,255,0.16)",
    },
    checkedBackground: {
      light: "rgba(34,197,94,0.14)",
      dark: "rgba(34,197,94,0.16)",
    },
    idleBackground: {
      light: "systemGroupedBackground",
      dark: "rgba(255,255,255,0.04)",
    },
  } as const
}

function MonthIconButton({ title, systemName, action, disabled }: { title: string, systemName: string, action: () => void, disabled: boolean }) {
  return <Button title={title} systemImage={systemName} action={action} disabled={disabled} labelStyle="iconOnly" buttonStyle="borderless" />
}

function CheckinCalendar({ month, status, onChangeMonth, onRefresh, busy }: { month: string, status?: CheckinStatus, onChangeMonth: (nextMonth: string) => void, onRefresh: () => void, busy: boolean }) {
  const records = getCheckinRecords(status)
  const recordMap = getCheckinRecordMap(records)
  const palette = getCalendarCellPalette()
  const monthAward = sumCheckinAwards(records)
  const cells = getMonthDays(month)
  const rows: Array<Array<{ key: string, day?: number, date?: string }>> = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"]

  return <VStack alignment="leading" spacing={10}>
    <HStack spacing={8}>
      <MonthIconButton title="上一月" systemName="chevron.left" action={() => onChangeMonth(shiftMonth(month, -1))} disabled={busy} />
      <Spacer />
      <VStack spacing={2}>
        <HStack spacing={6}>
          <Text font="headline">{fmtMonth(month)}</Text>
          <Button title="刷新" systemImage={busy ? "hourglass" : "arrow.clockwise"} action={onRefresh} disabled={busy} labelStyle="iconOnly" buttonStyle="borderless" />
        </HStack>
        <Text font="caption" foregroundStyle="secondaryLabel">本月 {getCheckinCount(status, records)} 次 · 奖励 {fmtQuota(monthAward)}</Text>
      </VStack>
      <Spacer />
      <MonthIconButton title="下一月" systemName="chevron.right" action={() => onChangeMonth(shiftMonth(month, 1))} disabled={busy} />
    </HStack>
    <HStack spacing={4}>
      {weekdays.map(day => <Text key={`weekday-${day}`} font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "center" }}>{day}</Text>)}
    </HStack>
    <VStack spacing={6}>
      {rows.map((row, rowIndex) => <HStack key={`week-${rowIndex}`} spacing={4}>
        {row.map(cell => {
          const record = cell.date ? recordMap[cell.date] : undefined
          const checked = !!record
          const today = isTodayDate(cell.date)
          return <VStack
            key={cell.key}
            spacing={2}
            frame={{ minHeight: 58, maxWidth: "infinity" }}
            padding={{ vertical: 5, horizontal: 2 }}
            modifiers={modifiers()
              .background((today ? palette.todayBackground : checked ? palette.checkedBackground : palette.idleBackground) as any)
              .clipShape({ type: "rect", cornerRadius: 12 })}
          >
            {cell.day ? <Text font="caption" foregroundStyle="label">{cell.day}</Text> : <Text font="caption"> </Text>}
            {checked ? <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" /> : <Text font="caption2" foregroundStyle="systemGray4"> </Text>}
            {checked ? <Text font="caption2" foregroundStyle="systemGreen">{fmtCheckinAward(record?.quota_awarded)}</Text> : <Text font="caption2" foregroundStyle="systemGray4"> </Text>}
          </VStack>
        })}
      </HStack>)}
    </VStack>
    <HStack spacing={12}>
      <Text font="caption" foregroundStyle="secondaryLabel">累计签到：{status?.stats?.total_checkins ?? "-"}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">累计奖励：{fmtQuota(status?.stats?.total_quota)}</Text>
    </HStack>
  </VStack>
}

async function runQuickAccountAction(account: Account, label: string, task: (account: Account) => Promise<any>, checkinAware = false) {
  try {
    const latest = loadAccounts().find(item => item.id === account.id) ?? account
    const data = await task(latest)
    patchAccount(latest.id, { lastError: "" })
    return data
  } catch (e: any) {
    const message = getErrorMessage(e)
    patchAccount(account.id, { lastError: message, ...(checkinAware ? getCheckinDisabledPatch(message) : {}) })
    throw e
  }
}

async function quickSyncAccount(account: Account) {
  const data = await fetchSelf(account)
  patchAccount(account.id, { lastSelf: data, lastError: "" })
  return data
}

async function quickCheckinAccount(account: Account) {
  const data = await doCheckin(account)
  let self: SelfInfo | undefined
  let status: CheckinStatus | undefined
  try { self = await fetchSelf(account) } catch {}
  try { status = await fetchCheckinStatus(account) } catch {}
  patchAccount(account.id, { lastSelf: self, lastCheckin: status, lastError: "", ...getTodayCheckinPatch(status) })
  return data
}

function AccountSummary({ accounts }: { accounts: Account[] }) {
  const totalQuota = accounts.reduce((sum, item) => sum + (Number(item.lastSelf?.quota) || 0), 0)
  const checkedCount = accounts.filter(account => getTodayCheckinInfo(account).checked).length

  return <Section title="总览">
    <HStack spacing={12}>
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="caption" foregroundStyle="secondaryLabel">账号</Text>
        <Text font="title2">{accounts.length}</Text>
      </VStack>
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="caption" foregroundStyle="secondaryLabel">已签</Text>
        <Text font="title2">{checkedCount}</Text>
      </VStack>
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="caption" foregroundStyle="secondaryLabel">总余额</Text>
        <Text font="title2">{fmtQuota(totalQuota)}</Text>
      </VStack>
    </HStack>
  </Section>
}

function AccountRowContent({ account }: { account: Account }) {
  const authText = getAuthSourceText(account)
  const statusColor = account.lastError ? "systemRed" : account.lastSelf ? "systemGreen" : "systemOrange"
  const statusText = account.lastError ? "异常" : account.lastSelf ? "已同步" : "未同步"
  const todayCheckin = getTodayCheckinInfo(account)
  const checkinTime = account.checkinTime
  const checkinTimeReached = checkinTime ? isCheckinTimeReached(checkinTime) : true
  const checkinText = todayCheckin.checked
    ? `已签${todayCheckin.record?.quota_awarded !== undefined ? ` ${fmtCheckinAward(todayCheckin.record.quota_awarded)}` : ""}`
    : checkinTime && !checkinTimeReached
      ? `签到时间 ${checkinTime}`
      : "未签"

  return <HStack spacing={12}>
    <VStack alignment="center" spacing={2} frame={{ width: 34 }}>
      <Image systemName={account.lastError ? "exclamationmark.triangle.fill" : "server.rack"} foregroundStyle={statusColor as any} />
      <Text font="caption2" foregroundStyle="secondaryLabel">{statusText}</Text>
    </VStack>
    <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <HStack>
        {account.excludeFromBatchCheckin ? <Image systemName="minus.circle" foregroundStyle="systemOrange" font={13} frame={{ width: 18, alignment: "center" }} /> : null}
        <Text font="headline">{account.name}</Text>
        <HStack spacing={3}>
          <Image font={13} systemName={todayCheckin.checked ? "checkmark.seal.fill" : "seal"} foregroundStyle={todayCheckin.checked ? "systemGreen" : "secondaryLabel"} frame={{ width: 18, alignment: "center" }} />
          <Text font="caption" foregroundStyle={todayCheckin.checked ? "systemGreen" : "secondaryLabel"}>{checkinText}</Text>
        </HStack>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel">{authText}</Text>
      </HStack>
      <Text font="caption" foregroundStyle="secondaryLabel">{shortUrl(account.baseUrl)}</Text>
      <HStack spacing={10}>
        <Text font="caption">余额 {fmtQuota(account.lastSelf?.quota)}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">已用 {fmtQuota(account.lastSelf?.used_quota)}</Text>
      </HStack>
      {account.lastError ? <Text font="caption" foregroundStyle="systemRed">{getErrorMessage(account.lastError)}</Text> : null}
    </VStack>
  </HStack>
}

function AccountRowMenu({ account, onDelete, onQuickSync, onQuickCheckin, onOpenSite, onToggleExclude, disabled }: { account: Account, onDelete: (account: Account) => void, onQuickSync: (account: Account) => void, onQuickCheckin: (account: Account) => void, onOpenSite: (account: Account) => void, onToggleExclude: (account: Account) => void, disabled?: boolean }) {
  function openAccountSite() {
    onOpenSite(account)
  }

  return <Group>
    <Button title="查询余额" systemImage="arrow.clockwise" action={() => onQuickSync(account)} disabled={disabled} />
    <Button title="签到" systemImage="checkmark.seal" action={() => onQuickCheckin(account)} disabled={disabled} />
    <Button title="手动网页签到" systemImage="globe" action={openAccountSite} disabled={disabled} />
    <Button
      title={account.excludeFromBatchCheckin ? "加入批量签到" : "排除批量签到"}
      systemImage={account.excludeFromBatchCheckin ? "plus.circle" : "minus.circle"}
      action={() => onToggleExclude(account)}
      disabled={disabled}
    />
    <Button title="删除账号" systemImage="trash" role="destructive" action={() => onDelete(account)} disabled={disabled} />
  </Group>
}

function AccountListHeader({ sortKey, sortDirection, onSelectSort }: { sortKey: AccountSortKey, sortDirection: SortDirection, onSelectSort: (key: AccountSortKey) => void }) {
  const directionIcon = sortDirection === "asc" ? "arrow.up" : "arrow.down"

  function SortButton({ itemKey, title }: { itemKey: AccountSortKey, title: string }) {
    const active = sortKey === itemKey
    return <Button
      title={title}
      systemImage={active ? directionIcon : undefined}
      action={() => onSelectSort(itemKey)}
    />
  }

  return <HStack>
    <Text>账号列表</Text>
    <Spacer />
    <Menu label={<HStack spacing={4}>
      <Text font="caption" foregroundStyle="secondaryLabel">{getAccountSortTitle(sortKey)}</Text>
      <Image systemName={directionIcon} foregroundStyle="secondaryLabel" font="caption2" />
    </HStack>}>
      <SortButton itemKey="name" title="按名称" />
      <SortButton itemKey="quota" title="按金额" />
      <SortButton itemKey="checkin" title="按签到状态" />
    </Menu>
  </HStack>
}

function BatchActionButton({ title, busyTitle, systemImage, active, disabled, action }: { title: string, busyTitle: string, systemImage: string, active: boolean, disabled: boolean, action: () => void }) {
  if (active) {
    return <Button action={() => {}} disabled={false}>
      <HStack spacing={8}><ProgressView /><Text>{busyTitle}</Text></HStack>
    </Button>
  }
  const color = disabled ? "systemGray4" : "tintColor"
  return <Button action={action} disabled={disabled}>
    <HStack spacing={8} alignment="center">
      <Image systemName={systemImage} foregroundStyle={color} font="body" frame={{ width: 24, alignment: "center" }} />
      <Text foregroundStyle={color}>{title}</Text>
    </HStack>
  </Button>
}

function LabeledTextField({ title, value, onChanged, prompt, axis }: { title: string, value: string, onChanged: (value: string) => void, prompt?: string, axis?: "horizontal" | "vertical" }) {
  const [focused, setFocused] = useState(false)
  return <HStack spacing={12}>
    <Text frame={{ width: 86, alignment: "leading" }} foregroundStyle="label">{title}</Text>
    <TextField title="" value={value} onChanged={onChanged} prompt={prompt} axis={axis as any} frame={{ maxWidth: "infinity" }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
    {focused && value ? <Button action={() => onChanged("")}><Image systemName="xmark.circle.fill" foregroundStyle="secondaryLabel" /></Button> : null}
  </HStack>
}

function LabeledSecureField({ title, value, onChanged, prompt }: { title: string, value: string, onChanged: (value: string) => void, prompt?: string }) {
  const [focused, setFocused] = useState(false)
  return <HStack spacing={12}>
    <Text frame={{ width: 86, alignment: "leading" }} foregroundStyle="label">{title}</Text>
    <SecureField title="" value={value} onChanged={onChanged} prompt={prompt} frame={{ maxWidth: "infinity" }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
    {focused && value ? <Button action={() => onChanged("")}><Image systemName="xmark.circle.fill" foregroundStyle="secondaryLabel" /></Button> : null}
  </HStack>
}

function AddEditView({ initial, onSaved }: { initial?: Account, onSaved: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(initial?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "")
  const [username, setUsername] = useState(initial?.username ?? "")
  const [password, setPassword] = useState("")
  const [cookie, setCookie] = useState("")
  const [checkinTime, setCheckinTime] = useState(initial?.checkinTime ?? "")
  const [webSelf, setWebSelf] = useState<SelfInfo | undefined>(initial?.lastSelf)
  const [cookieAuthSource, setCookieAuthSource] = useState<Account["authSource"] | undefined>(undefined)
  const [webBusy, setWebBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toastMessage, setToastMessage] = useState("")
  const [showToast, setShowToast] = useState(false)

  async function pasteCookie() {
    const text = await Pasteboard.getString()
    if (text) {
      setCookie(text)
      setCookieAuthSource("cookie")
    }
  }

  async function webLoginCookie() {
    setWebBusy(true)
    try {
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
      const result = await getWebLoginCookie(normalizedBaseUrl)
      setCookie(result.cookieHeader)
      setCookieAuthSource("web")
      if (result.storageSelf) {
        setWebSelf(result.storageSelf)
        if (!username && result.storageSelf.username) setUsername(result.storageSelf.username)
        if (!name) setName(result.storageSelf.display_name || result.storageSelf.username || shortUrl(normalizedBaseUrl))
      } else if (!name) {
        setName(shortUrl(normalizedBaseUrl))
      }
      setToastMessage("已获取 Cookie，保存后生效")
      setShowToast(true)
    } catch (e: any) {
      setToastMessage(`网页登录失败：${getErrorMessage(e)}`)
      setShowToast(true)
    } finally {
      setWebBusy(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      const saved = upsertAccount({
        id: initial?.id,
        name,
        baseUrl,
        username,
        password,
        cookie,
        checkinTime,
        lastSelf: webSelf,
        authSource: cookie.trim() ? (cookieAuthSource ?? "cookie") : undefined,
      })
      let balanceMessage = "，余额已更新"
      try {
        const self = await fetchSelf(saved)
        patchAccount(saved.id, { lastSelf: self, lastError: "" })
      } catch (e: any) {
        balanceMessage = `，但余额查询失败：${getErrorMessage(e)}`
        patchAccount(saved.id, { lastError: getErrorMessage(e) })
      }
      onSaved()
      setToastMessage(`“${saved.name}”已保存${balanceMessage}`)
      setShowToast(true)
      setTimeout(() => dismiss(), 900)
    } catch (e: any) {
      setToastMessage(`保存失败：${getErrorMessage(e)}`)
      setShowToast(true)
    } finally {
      setSaving(false)
    }
  }

  return <Form
    navigationTitle={initial ? "编辑账号" : "添加账号"}
    navigationBarTitleDisplayMode="inline"
    toolbar={<Toolbar>
        <ToolbarItem placement="topBarLeading">
          <Button action={dismiss}>
            <Image systemName="chevron.left" fontWeight="semibold" foregroundStyle="tintColor"/>
          </Button>
        </ToolbarItem>
        <ToolbarItem placement="topBarTrailing"><Button action={save} disabled={saving || webBusy}><Text fontWeight="semibold" foregroundStyle="tintColor">{saving ? "保存中..." : "保存"}</Text></Button></ToolbarItem>
    </Toolbar>}
    toast={{ message: toastMessage, isPresented: showToast, onChanged: setShowToast, position: "top" }}
  >
    <Section title="基础信息">
      <LabeledTextField title="显示名称" value={name} onChanged={setName} prompt="主站 / 小号 A" />
      <LabeledTextField title="站点地址" value={baseUrl} onChanged={setBaseUrl} prompt="https://newapi.example.com" />
      <HStack spacing={12}>
        <Text>签到时间</Text>
        <Spacer />
        <HStack spacing={0}>
          {checkinTime ? <Button action={() => setCheckinTime("")} buttonStyle="borderless" padding={{ horizontal: 0 }}>
            <Text font="subheadline" foregroundStyle="systemRed">清除</Text>
          </Button> : null}
          <DatePicker
            title=""
            displayedComponents={["hourAndMinute"]}
            value={checkinTime ? timeStringToTimestamp(checkinTime) : timeStringToTimestamp("00:00")}
            frame={{ width: 80 }}
            onChanged={(value: number) => {
              const date = new Date(value)
              const hours = `${date.getHours()}`.padStart(2, "0")
              const minutes = `${date.getMinutes()}`.padStart(2, "0")
              setCheckinTime(`${hours}:${minutes}`)
            }}
          />
        </HStack>
      </HStack>
    </Section>
    <Section header={<Text>账号密码登录</Text>} footer={<Text>如果站点启用了 Turnstile 或 2FA，建议改用浏览器登录后的 Cookie。</Text>}>
      <LabeledTextField title="用户名" value={username} onChanged={setUsername} prompt="可选" />
      <LabeledSecureField title="密码" value={password} onChanged={setPassword} prompt={initial ? "留空则不修改" : "可选"} />
    </Section>
    <Section header={<Text>第三方登录 Cookie</Text>} footer={<Text>适用于 GitHub / OIDC / LinuxDO / Discord / Telegram / 微信等第三方登录。粘贴浏览器请求头中的 Cookie。</Text>}>
      <LabeledTextField title="Cookie" value={cookie} onChanged={value => { setCookie(value); setCookieAuthSource("cookie") }} axis="vertical" prompt={initial ? "留空则不修改" : "session=...; other=..."} />
      <Button action={webLoginCookie} disabled={webBusy}>
        {webBusy ? <HStack spacing={8} alignment="center">
          <ProgressView />
          <Text foregroundStyle="systemGray4">网页登录中...</Text>
        </HStack> : <HStack spacing={8} alignment="center">
          <Image systemName="globe" foregroundStyle="tintColor" font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle="tintColor">网页登录获取 Cookie</Text>
        </HStack>}
      </Button>
      <Button action={pasteCookie}>
        <HStack spacing={8} alignment="center">
          <Image systemName="doc.on.clipboard" foregroundStyle="tintColor" font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle="tintColor">从剪贴板粘贴 Cookie</Text>
        </HStack>
      </Button>
    </Section>
  </Form>
}

function AccountDetailView({ accountId, onChanged }: { accountId: string, onChanged: () => void }) {
  const dismiss = Navigation.useDismiss()
  const initialAccount = loadAccounts().find(a => a.id === accountId)
  const [account, setAccount] = useState<Account | undefined>(initialAccount)
  const [busy, setBusy] = useState(false)
  const [checkinMonth, setCheckinMonth] = useState(localMonthString())
  const [toastMessage, setToastMessage] = useState("")
  const [showToast, setShowToast] = useState(false)

  function notify(message: string) {
    setToastMessage(message)
    setShowToast(true)
  }

  useEffect(() => {
    const next = loadAccounts().find(a => a.id === accountId)
    setAccount(next)
    setCheckinMonth(localMonthString())
    setBusy(false)
    if (next && !getTodayCheckinRecord(next.lastCheckin)) {
      refreshStatusSilently(localMonthString(), next)
    }
  }, [accountId])

  function refreshLocal() {
    const next = loadAccounts().find(a => a.id === accountId)
    if (next) setAccount(next)
    onChanged()
  }

  async function refreshStatusSilently(month = localMonthString(), target?: Account) {
    const latest = target ?? loadAccounts().find(item => item.id === accountId) ?? account
    if (!latest) return
    setBusy(true)
    try {
      const data = await fetchCheckinStatus(latest, month)
      patchAccount(latest.id, { lastCheckin: data, lastError: "", ...getTodayCheckinPatch(data) })
      const next = loadAccounts().find(a => a.id === accountId)
      if (next) setAccount(next)
      onChanged()
    } catch (e: any) {
      const message = getErrorMessage(e)
      patchAccount(latest.id, { lastError: message, ...getCheckinDisabledPatch(message) })
      const next = loadAccounts().find(a => a.id === accountId)
      if (next) setAccount(next)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function runAction(label: string, task: (account: Account) => Promise<any>, checkinAware = false) {
    if (!account) {
      notify(`${label}失败：账号不存在或已被删除`)
      return
    }
    setBusy(true)
    try {
      await task(account)
      patchAccount(account.id, { lastError: "" })
      refreshLocal()
      notify(`${label}完成`)
    } catch (e: any) {
      const message = getErrorMessage(e)
      patchAccount(account.id, { lastError: message, ...(checkinAware ? getCheckinDisabledPatch(message) : {}) })
      refreshLocal()
      notify(`${label}失败：${message}`)
    } finally {
      setBusy(false)
    }
  }

  async function syncStatus(month = checkinMonth) {
    await runAction("签到状态", async current => {
      const latest = loadAccounts().find(item => item.id === accountId) ?? current
      const data = await fetchCheckinStatus(latest, month)
      patchAccount(latest.id, { lastCheckin: data, ...getTodayCheckinPatch(data) })
      return data
    }, true)
  }

  async function changeCheckinMonth(nextMonth: string) {
    setCheckinMonth(nextMonth)
    setBusy(true)
    try {
      const latest = loadAccounts().find(item => item.id === accountId) ?? account
      if (!latest) {
        notify("签到状态失败：账号不存在或已被删除")
        return
      }
      const data = await fetchCheckinStatus(latest, nextMonth)
      patchAccount(latest.id, { lastCheckin: data, lastError: "", ...getTodayCheckinPatch(data) })
      setAccount(loadAccounts().find(a => a.id === accountId))
      onChanged()
    } catch (e: any) {
      const message = getErrorMessage(e)
      if (account) patchAccount(account.id, { lastError: message, ...getCheckinDisabledPatch(message) })
      notify(`签到状态失败：${message}`)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function webLogin() {
    await runAction("网页登录", async a => {
      await loginByWebView(a)
      const latest = loadAccounts().find(item => item.id === a.id) ?? a
      const self = await fetchSelf(latest)
      patchAccount(a.id, { lastSelf: self, lastError: "" })
      refreshLocal()
      return self
    })
  }

  async function login() {
    await runAction("登录", async a => {
      await loginAccount(a)
      const latest = loadAccounts().find(item => item.id === a.id) ?? a
      const self = await fetchSelf(latest)
      patchAccount(a.id, { lastSelf: self, lastError: "" })
      refreshLocal()
      return self
    })
  }

  async function remove() {
    if (!account) {
      notify("删除失败：账号不存在或已被删除")
      return
    }
    const ok = await showConfirm({ title: "删除账号？", message: `确定删除 ${account.name} 吗？`, confirmLabel: "删除", cancelLabel: "取消" })
    if (!ok) return
    const deletedName = account.name
    setBusy(true)
    try {
      deleteAccount(account.id)
      onChanged()
      notify(`“${deletedName}”已删除`)
      setTimeout(() => dismiss(), 700)
    } finally {
      setBusy(false)
    }
  }

  if (!account) {
    return <List navigationTitle="账号不存在" navigationBarTitleDisplayMode="inline">
      <Section>
        <Text foregroundStyle="systemRed">账号不存在或已被删除，请返回刷新列表。</Text>
      </Section>
    </List>
  }

  const todayCheckin = getTodayCheckinInfo(account)

  return <List
    navigationTitle={account.name}
    navigationBarTitleDisplayMode="inline"
    navigationBarBackButtonHidden
    toolbar={<Toolbar>
      <ToolbarItem placement="topBarLeading">
        <Button action={dismiss}>
          <Image systemName="chevron.left" foregroundStyle="tintColor" fontWeight="semibold" />
        </Button>
      </ToolbarItem>
      <ToolbarItem placement="topBarTrailing">
        <Button action={async () => await Navigation.present(<NavigationStack><AddEditView initial={account} onSaved={refreshLocal} /></NavigationStack>)}>
          <Text fontWeight="semibold" foregroundStyle="tintColor">编辑</Text>
        </Button>
      </ToolbarItem>
    </Toolbar>}
    toast={{ message: toastMessage, isPresented: showToast, onChanged: setShowToast, position: "top" }}
  >
    <Section title="状态">
      {busy ? <HStack spacing={8}><ProgressView /><Text>处理中...</Text></HStack> : null}
      <Text>站点：{account.baseUrl}</Text>
      <Text>认证：{getAuthSourceText(account)}</Text>
      <Text>更新：{fmtTime(account.updatedAt)}</Text>
      {account.lastError ? <Text foregroundStyle="systemRed">错误：{getErrorMessage(account.lastError)}</Text> : null}
    </Section>
    
    <Section title="账号操作">
      <Button action={login} disabled={busy}>
        <HStack spacing={8} alignment="center">
          <Image systemName="person.crop.circle.badge.checkmark" foregroundStyle={busy ? "systemGray4" : "tintColor"} font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle={busy ? "systemGray4" : "tintColor"}>登录账号</Text>
        </HStack>
      </Button>
      <Button action={webLogin} disabled={busy}>
        <HStack spacing={8} alignment="center">
          <Image systemName="globe" foregroundStyle={busy ? "systemGray4" : "tintColor"} font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle={busy ? "systemGray4" : "tintColor"}>网页登录获取 Cookie</Text>
        </HStack>
      </Button>
      <Button action={remove} disabled={busy}>
        <HStack spacing={8} alignment="center">
          <Image systemName="trash" foregroundStyle={busy ? "systemGray4" : "systemRed"} font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle={busy ? "systemGray4" : "systemRed"}>删除账号</Text>
        </HStack>
      </Button>
    </Section>
    
    <Section title="余额">
      <Text>用户名：{account.lastSelf?.username ?? account.username ?? "-"}</Text>
      <Text>分组：{account.lastSelf?.group ?? "-"}</Text>
      <Text>剩余额度：{fmtQuota(account.lastSelf?.quota)} ({fmtRawQuota(account.lastSelf?.quota)})</Text>
      <Text>已用额度：{fmtQuota(account.lastSelf?.used_quota)} ({fmtRawQuota(account.lastSelf?.used_quota)})</Text>
      <Text>请求次数：{account.lastSelf?.request_count ?? "-"}</Text>
    </Section>

    <Section title="签到">
      {account.excludeFromBatchCheckin ? <Text foregroundStyle="systemOrange">⚠️ 已排除批量签到（仅手动网页签到）</Text> : null}
      <Text>今日状态：{todayCheckin.checked ? `已签到${todayCheckin.record?.quota_awarded !== undefined ? `，奖励 ${fmtCheckinAward(todayCheckin.record.quota_awarded)}` : ""}` : (() => {
        const checkinTime = account.checkinTime
        const checkinTimeReached = checkinTime ? isCheckinTimeReached(checkinTime) : true
        return checkinTime && !checkinTimeReached ? `未签到（签到时间 ${checkinTime}）` : "未签到"
      })()}</Text>
      <Text>功能启用：{account.lastCheckin?.enabled === undefined ? "未知" : account.lastCheckin.enabled ? "是" : "否"}</Text>
      <Text>奖励范围：{fmtQuota(account.lastCheckin?.min_quota)} ~ {fmtQuota(account.lastCheckin?.max_quota)}</Text>
      <CheckinCalendar
        month={checkinMonth}
        status={account.lastCheckin}
        busy={busy}
        onChangeMonth={changeCheckinMonth}
        onRefresh={() => syncStatus(checkinMonth)}
      />
    </Section>
  </List>
}

function MainView() {
  const dismiss = Navigation.useDismiss()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState("")
  const [toastMessage, setToastMessage] = useState("")
  const [showToast, setShowToast] = useState(false)
  const initialSort = loadAccountSortPreference()
  const [sortKey, setSortKey] = useState<AccountSortKey>(initialSort.key)
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialSort.direction)

  function reload() {
    setAccounts(loadAccounts())
  }

  useEffect(() => {
    reload()
  }, [])

  async function syncAll() {
    if (accounts.length === 0) {
      setToastMessage("请先添加账号后再批量查询")
      setShowToast(true)
      return
    }
    setBusy(true)
    setBusyLabel("批量查余额中...")
    let ok = 0
    let fail = 0
    for (const account of loadAccounts()) {
      try {
        const data = await fetchSelf(account)
        patchAccount(account.id, { lastSelf: data, lastError: "" })
        ok++
      } catch (e: any) {
        patchAccount(account.id, { lastError: getErrorMessage(e) })
        fail++
      }
      reload()
    }
    setBusy(false)
    setBusyLabel("")
    setToastMessage(`批量查询完成：成功 ${ok}，失败 ${fail}`)
    setShowToast(true)
  }

  async function checkinAll() {
    if (accounts.length === 0) {
      setToastMessage("请先添加账号后再批量签到")
      setShowToast(true)
      return
    }
    setBusy(true)
    setBusyLabel("批量签到中...")
    let ok = 0
    let fail = 0
    let skipped = 0
    let skippedExcluded = 0
    let skippedTime = 0
    let skippedSigned = 0
    for (const account of loadAccounts()) {
      if (account.excludeFromBatchCheckin) {
        skipped++
        skippedExcluded++
        continue
      }
      if (shouldSkipBatchCheckinByTime(account)) {
        skipped++
        skippedTime++
        continue
      }
      if (getTodayCheckinInfo(account).checked) {
        skipped++
        skippedSigned++
        continue
      }
      try {
        await doCheckin(account)
        let self: SelfInfo | undefined
        let status: CheckinStatus | undefined
        try { self = await fetchSelf(account) } catch {}
        try { status = await fetchCheckinStatus(account) } catch {}
        patchAccount(account.id, { lastSelf: self, lastCheckin: status, lastError: "", ...getTodayCheckinPatch(status) })
        ok++
      } catch (e: any) {
        const message = getErrorMessage(e)
        patchAccount(account.id, { lastError: message, ...getCheckinDisabledPatch(message) })
        fail++
      }
      reload()
    }
    setBusy(false)
    setBusyLabel("")
    const skippedParts = [
      skippedExcluded ? `排除 ${skippedExcluded}` : "",
      skippedTime ? `未到时间 ${skippedTime}` : "",
      skippedSigned ? `已签 ${skippedSigned}` : "",
    ].filter(Boolean).join("，")
    if (ok === 0 && fail === 0) {
      setToastMessage(skipped > 0 ? `没有符合签到条件的账号：已跳过 ${skipped} 个${skippedParts ? `（${skippedParts}）` : ""}` : "没有账号需要签到")
      setShowToast(true)
      return
    }
    const message = skipped > 0 ? `成功 ${ok}，失败 ${fail}，跳过 ${skipped}${skippedParts ? `（${skippedParts}）` : ""}` : `成功 ${ok}，失败 ${fail}`
    setToastMessage(`批量签到完成：${message}`)
    setShowToast(true)
  }

  async function quickSync(account: Account) {
    setBusy(true)
    try {
      await runQuickAccountAction(account, "快捷查询", quickSyncAccount)
      setToastMessage(`“${account.name}”余额已更新`)
    } catch (e: any) {
      setToastMessage(`查询失败：${getErrorMessage(e)}`)
    } finally {
      reload()
      setBusy(false)
      setShowToast(true)
    }
  }

  async function quickCheckin(account: Account) {
    setBusy(true)
    try {
      await runQuickAccountAction(account, "快捷签到", quickCheckinAccount, true)
      setToastMessage(`“${account.name}”签到完成`)
    } catch (e: any) {
      setToastMessage(`签到失败：${getErrorMessage(e)}`)
    } finally {
      reload()
      setBusy(false)
      setShowToast(true)
    }
  }

  async function quickOpenSite(account: Account) {
    setBusy(true)
    setToastMessage(`正在打开“${account.name}”网页签到...`)
    setShowToast(true)
    try {
      await openManualCheckinWebView(account)
      const latest = loadAccounts().find(item => item.id === account.id) ?? account
      const status = await fetchCheckinStatus(latest)
      patchAccount(latest.id, { lastCheckin: status, lastError: "", ...getTodayCheckinPatch(status) })
      setToastMessage(`“${account.name}”签到状态已更新`)
    } catch (e: any) {
      const message = getErrorMessage(e)
      patchAccount(account.id, { lastError: message, ...getCheckinDisabledPatch(message) })
      setToastMessage(`网页签到失败：${message}`)
    } finally {
      reload()
      setBusy(false)
      setShowToast(true)
    }
  }

  function quickDelete(account: Account) {
    deleteAccount(account.id)
    reload()
    setToastMessage(`“${account.name}”已删除`)
    setShowToast(true)
  }

  function quickToggleExclude(account: Account) {
    patchAccount(account.id, { excludeFromBatchCheckin: !account.excludeFromBatchCheckin })
    reload()
    const newState = !account.excludeFromBatchCheckin
    setToastMessage(newState ? `“${account.name}”已排除批量签到` : `“${account.name}”已加入批量签到`)
    setShowToast(true)
  }

  function selectSort(nextKey: AccountSortKey) {
    if (nextKey === sortKey) {
      const nextDirection = sortDirection === "asc" ? "desc" : "asc"
      setSortDirection(nextDirection)
      saveAccountSortPreference({ key: sortKey, direction: nextDirection })
      return
    }
    setSortKey(nextKey)
    setSortDirection("asc")
    saveAccountSortPreference({ key: nextKey, direction: "asc" })
  }

  const sortedAccounts = sortAccounts(accounts, sortKey, sortDirection)

  return <NavigationStack>
    <List
      navigationTitle="NewAPI 账号管理"
      navigationBarTitleDisplayMode="large"
      refreshable={async () => reload()}
      toolbar={<Toolbar>
        <ToolbarItem placement="topBarLeading">
          <Button action={dismiss}>
            <Image systemName="xmark" foregroundStyle="systemRed" fontWeight="semibold" />
          </Button>
        </ToolbarItem>
        <ToolbarItem placement="topBarTrailing">
          <Button action={async () => await Navigation.present(<NavigationStack><AddEditView onSaved={reload} /></NavigationStack>)} disabled={busy}>
            <Text fontWeight="semibold" foregroundStyle="tintColor">添加</Text>
          </Button>
        </ToolbarItem>
      </Toolbar>}
      toast={{ message: toastMessage, isPresented: showToast, onChanged: setShowToast, position: "top" }}
    >
      <AccountSummary accounts={accounts} />

      <Section header={<Text>批量操作</Text>} footer={<Text>如果站点开启 Turnstile/2FA，请使用浏览器登录后的 Cookie。脚本不会绕过验证码。</Text>}>
        <BatchActionButton title="查询余额" busyTitle="批量查余额中..." systemImage="arrow.clockwise" active={busy && busyLabel === "批量查余额中..."} disabled={busy} action={syncAll} />
        <BatchActionButton title="签到" busyTitle="批量签到中..." systemImage="checkmark.seal.fill" active={busy && busyLabel === "批量签到中..."} disabled={busy} action={checkinAll} />
      </Section>

      <Section header={<AccountListHeader sortKey={sortKey} sortDirection={sortDirection} onSelectSort={selectSort} />}>
        {accounts.length === 0 ? <Text foregroundStyle="secondaryLabel">暂无账号，点击右上角“添加”。</Text> : null}
        {sortedAccounts.map(account => <NavigationLink
          key={account.id}
          destination={<AccountDetailView key={`detail-${account.id}`} accountId={account.id} onChanged={reload} />}
          contextMenu={{ menuItems: <AccountRowMenu account={account} onDelete={quickDelete} onQuickSync={quickSync} onQuickCheckin={quickCheckin} onOpenSite={quickOpenSite} onToggleExclude={quickToggleExclude} disabled={busy} /> }}
        >
          <AccountRowContent account={account} />
        </NavigationLink>)}
      </Section>
    </List>
  </NavigationStack>
}

async function run() {
  await Navigation.present(<MainView />)
  Script.exit()
}

run()
