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
  Picker,
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
  email?: string
  group?: string
  quota?: number
  used_quota?: number
  request_count?: number
  balance?: number
  concurrency?: number
  status?: string
}

type AccountPlatform = "newapi" | "sub2api"

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

type SiteStatus = {
  state: "online" | "warning" | "offline"
  statusCode?: number
  message?: string
  checkedAt: number
  latencyMs?: number
}

type Account = {
  id: string
  name: string
  baseUrl: string
  platform?: AccountPlatform
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
  lastSiteStatus?: SiteStatus
  authSource?: "password" | "web" | "cookie"
  excludeFromBatchCheckin?: boolean
}

type AccountDraft = {
  id?: string
  name: string
  baseUrl: string
  platform?: AccountPlatform
  username: string
  password: string
  cookie: string
  checkinTime: string
  lastSelf?: SelfInfo
  authSource?: Account["authSource"]
}

type AccountSortKey = "name" | "platform" | "quota" | "checkin"
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
  authToken?: string
  storageSelf?: SelfInfo
  pageTitle?: string
}

const STORAGE_KEY = "newapi.accounts.v1"
const SORT_STORAGE_KEY = "newapi.accountSort.v1"
const SECRET_PREFIX = "newapi.secret."
const SHARED = { shared: false }
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1"
const QUOTA_PER_USD = 500000
const SITE_STATUS_AUTO_CHECK_INTERVAL = 60 * 60

function getAccountPlatform(account: Pick<Account, "platform">): AccountPlatform {
  return account.platform ?? "newapi"
}

function isSub2ApiAccount(account: Pick<Account, "platform">) {
  return getAccountPlatform(account) === "sub2api"
}

function getPlatformText(account: Pick<Account, "platform">) {
  return isSub2ApiAccount(account) ? "Sub2API" : "NewAPI"
}

function quotaFromUsd(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? n * QUOTA_PER_USD : undefined
}

function getSelfQuotaValue(self?: SelfInfo) {
  return self?.quota ?? quotaFromUsd(self?.balance)
}

function getSelfUsedQuotaValue(self?: SelfInfo) {
  return self?.used_quota
}

function getSelfDisplayName(self?: SelfInfo) {
  return self?.display_name || self?.username || self?.email
}

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

function fmtRawQuotaForAccount(account: Account, value: any) {
  if (isSub2ApiAccount(account)) return fmtQuota(value)
  return fmtRawQuota(value)
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

// 错误消息中文翻译规则
const ERROR_TRANSLATIONS: Array<[RegExp, string]> = [
  // API 兼容性
  [/can'?t\s+find\s+variable:\s*alert/i, "弹窗 API 不可用，请升级 Scripting 或重新运行脚本"],
  
  // 认证错误
  [/invalid\s+username\s+or\s+password|invalid\s+credentials|incorrect\s+password/i, "用户名或密码错误，请检查账号信息"],
  [/invalid\s+password/i, "密码错误，请重新输入"],
  [/invalid\s+email/i, "邮箱格式错误"],
  [/email\s+not\s+found|user\s+not\s+found|account\s+not\s+found/i, "账号不存在，请检查用户名/邮箱"],
  [/account\s+(is\s+)?(disabled|suspended|banned|blocked)/i, "账号已被禁用或封禁，请联系站点管理员"],
  [/unauthorized|not\s+logged\s+in|no\s+access\s+token|permission\s+denied|access\s+denied|forbidden|authentication\s+(is\s+)?required/i, "未登录或权限不足，请重新登录或检查 Cookie"],
  [/token\s+(has\s+)?expired|session\s+(has\s+)?expired|cookie\s+(has\s+)?expired|login\s+expired/i, "登录状态已过期，请重新获取 Cookie 或登录"],
  [/invalid\s+token|token\s+invalid|malformed\s+token/i, "登录令牌无效，请重新获取"],
  [/missing\s+token|no\s+token/i, "缺少登录令牌，请先登录"],
  [/requires?\s+2fa|two.?factor|需要.*验证码/i, "该账号需要二步验证，请使用\"网页登录\""],
  
  // 限流和配额
  [/too\s+many\s+requests|rate\s+limit(ed)?|请求.*频繁/i, "请求过于频繁，请稍后再试（建议等待 1-5 分钟）"],
  [/quota\s+exceeded|额度.*不足|余额不足/i, "账号额度不足，请充值后再试"],
  [/daily\s+limit|daily\s+quota/i, "已达到每日请求限制"],
  [/concurrency\s+limit/i, "并发请求数超限，请稍后再试"],
  
  // 资源错误
  [/not\s+found|404/i, "请求的资源不存在，请检查站点地址或 API 路径"],
  [/already\s+exists|duplicate/i, "资源已存在或重复"],
  [/invalid\s+request|bad\s+request|400/i, "请求参数错误"],
  [/method\s+not\s+allowed|405/i, "请求方法不支持"],
  
  // 网络错误
  [/network\s+request\s+failed|failed\s+to\s+fetch|fetch\s+failed/i, "网络请求失败，请检查网络连接"],
  [/timed?\s*out|timeout|请求超时/i, "请求超时，站点响应过慢或网络不稳定"],
  [/connection\s+(refused|reset)|ECONNREFUSED|ECONNRESET/i, "无法连接到站点，请检查站点地址和网络"],
  [/dns\s+resolution\s+failed|getaddrinfo\s+ENOTFOUND/i, "域名解析失败，请检查站点地址"],
  [/ssl|certificate|cert/i, "SSL 证书错误，站点可能不安全或证书过期"],
  
  // 服务器错误
  [/internal\s+server\s+error|server\s+error|500/i, "服务器内部错误，请稍后重试或联系站点管理员"],
  [/bad\s+gateway|502/i, "网关错误，站点服务可能暂时不可用"],
  [/service\s+unavailable|503/i, "服务暂不可用，站点可能正在维护"],
  [/gateway\s+timeout|504/i, "网关超时，站点响应过慢"],
  
  // 验证和防护
  [/turnstile|签名|signature|challenge/i, "站点启用了 Cloudflare Turnstile 验证，请使用\"网页签到\"或\"网页登录\""],
  [/captcha|验证码/i, "需要验证码，请使用\"网页登录\"完成验证"],
  [/cloudflare|cf.?ray/i, "站点触发了 Cloudflare 防护，请使用\"网页登录\"通过验证"],
  [/响应不是 JSON.*<html|<script>var\s+arg1=/i, "站点返回了网页而非 API 数据，可能触发了验证或重定向"],
  
  // 功能和配置
  [/签到.*未开启|check.?in.*(disabled|not\s+enabled)|sign.?in.*(disabled|not\s+enabled)/i, "该站点未启用签到功能"],
  [/功能.*关闭|feature.*disabled/i, "该功能已关闭"],
  [/maintenance|维护中/i, "站点正在维护中，请稍后再试"],
  
  // 数据格式
  [/unexpected\s+token|json\s+parse|invalid\s+json/i, "服务器返回了无效的数据格式"],
  [/syntax\s+error/i, "数据解析错误"],
  
  // Sub2API 特定
  [/缺少 Sub2API 登录令牌/i, "缺少 Sub2API 登录令牌，请使用\"网页登录获取 Cookie\"或粘贴 auth_token"],
  [/未获取到 Sub2API auth_token/i, "未获取到登录令牌，请确认已登录后再关闭页面"],
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
  return value === "name" || value === "platform" || value === "quota" || value === "checkin"
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

function getSiteStatusView(account: Account) {
  const status = account.lastSiteStatus
  if (!status) {
    return { color: "systemGray", text: "未检测", icon: "network" }
  }
  if (status.state === "online") {
    return { color: "systemGreen", text: "在线", icon: "server.rack" }
  }
  if (status.state === "warning") {
    return {
      color: "systemOrange",
      text: status.statusCode ? `HTTP ${status.statusCode}` : "异常",
      icon: "exclamationmark.triangle.fill",
    }
  }
  return { color: "systemRed", text: "离线", icon: "network.slash" }
}

function getSiteStatusDetail(status?: SiteStatus) {
  if (!status) return "站点状态：未检测"
  const time = new Date(status.checkedAt * 1000).toLocaleTimeString()
  const latency = status.latencyMs !== undefined ? `，${status.latencyMs}ms` : ""
  return `${status.message ?? "站点状态已更新"}${latency}，${time}`
}

function getSiteStatusLatencyText(status?: SiteStatus) {
  if (!status || status.state !== "online") return ""
  return status.latencyMs !== undefined ? `${status.latencyMs}ms` : ""
}

function getSiteStatusLatencyColor(status?: SiteStatus) {
  if (!status) return "secondaryLabel"
  if (status.state === "offline") return "systemRed"
  const latency = status.latencyMs
  if (latency === undefined) return "secondaryLabel"
  if (latency < 300) return "systemGreen"
  if (latency <= 800) return "systemOrange"
  return "systemRed"
}

function getOfflineSiteStatus(e: any): SiteStatus {
  return {
    state: "offline",
    message: getErrorMessage(e),
    checkedAt: now(),
  }
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

function isHttpUrl(url: string) {
  return /^https?:\/\//i.test(url)
}

function resolveWebUrl(url: string, baseUrl: string) {
  try {
    const URLCtor = (globalThis as any).URL
    return URLCtor ? new URLCtor(url, baseUrl).href : url
  } catch {
    return url
  }
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
      const loaded = await loadWebUrlWithFallback(webView, url, url)
      if (!loaded) throw new Error("页面加载失败，请检查站点地址或网络")
      await prepareWebLoginPage(webView, url)
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

function extractSub2ApiToken(items: Record<string, string>) {
  for (const key of ["auth_token", "token", "access_token"]) {
    const value = items[key]
    if (value) return value
  }
  for (const raw of Object.values(items)) {
    try {
      const parsed = JSON.parse(raw)
      const token = parsed?.auth_token || parsed?.access_token || parsed?.token || parsed?.state?.auth_token || parsed?.state?.token
      if (typeof token === "string" && token) return token
    } catch {}
  }
  return ""
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

async function prepareWebLoginPage(webView: WebViewController, baseUrl = "") {
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

    // 顶部加载进度条：显示页面加载状态
    const setupProgress = () => {
      if (window.__newapiProgressInit) return;
      window.__newapiProgressInit = true;
      const ensureBar = () => {
        if (!document.body) return null;
        let bar = document.getElementById('__newapiProgressBar');
        if (!bar) {
          bar = document.createElement('div');
          bar.id = '__newapiProgressBar';
          bar.style.cssText = 'position:fixed;top:0;left:0;height:3px;width:0%;z-index:2147483647;background:#0a84ff;box-shadow:0 0 8px #0a84ff;border-radius:0 2px 2px 0;transition:width .25s ease,opacity .4s ease;pointer-events:none;';
          document.body.appendChild(bar);
        }
        return bar;
      };
      let value = 8;
      let done = false;
      const rendered = () => {
        const root = document.getElementById('root') || document.querySelector('#app, main');
        if (root && root.innerText && root.innerText.trim().length > 0) return true;
        return (document.body && document.body.innerText && document.body.innerText.trim().length > 30) || false;
      };
      const finish = () => {
        if (done) return;
        done = true;
        const bar = ensureBar();
        if (!bar) return;
        bar.style.width = '100%';
        setTimeout(() => { bar.style.opacity = '0'; }, 200);
        setTimeout(() => { bar.remove(); }, 700);
      };
      const tick = () => {
        if (done) return;
        const bar = ensureBar();
        if (bar) {
          if (value < 90) value += Math.max(0.6, (90 - value) * 0.08);
          if (document.readyState === 'interactive' && value < 45) value = 45;
          if (document.readyState === 'complete' && value < 80) value = 80;
          bar.style.width = value.toFixed(1) + '%';
        }
        if (rendered()) { finish(); return; }
        setTimeout(tick, 200);
      };
      window.addEventListener('load', () => setTimeout(finish, 300));
      tick();
    };
    setupProgress();
    return true;
  `
  try { await webView.evaluateJavaScript(script) } catch {}
}

async function installWebNavigationBridge(webView: WebViewController, baseUrl: string) {
  try {
    await webView.addScriptMessageHandler("newapiNavigate", async (url: any) => {
      const targetUrl = resolveWebUrl(String(url ?? ""), baseUrl)
      if (!isHttpUrl(targetUrl)) return false
      const loaded = await loadWebUrlWithFallback(webView, targetUrl, baseUrl)
      setTimeout(() => prepareWebLoginPage(webView, targetUrl), 300)
      setTimeout(() => prepareWebLoginPage(webView, targetUrl), 1200)
      return loaded
    })
  } catch {}
}

async function loadWebUrlWithFallback(webView: WebViewController, url: string, fallbackBaseUrl: string) {
  const targetUrl = resolveWebUrl(url, fallbackBaseUrl)
  if (!isHttpUrl(targetUrl)) return false
  return await webView.loadURL(targetUrl)
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

function unwrapSub2ApiJson<T>(json: any): T {
  if (json && typeof json === "object" && "code" in json) {
    if (json.code === 0) return json.data as T
    throw new Error(translateErrorMessage(json.message || json.detail || `API code ${json.code}`))
  }
  return json as T
}

async function sub2ApiRequest<T = any>(account: Account, method: string, path: string, body?: any): Promise<T> {
  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  const token = getSecret(account.cookieKey)
  if (!token) throw new Error("缺少 Sub2API 登录令牌，请使用“网页登录获取 Cookie”或粘贴 auth_token")

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
    throw new Error(`响应不是 JSON：${raw.slice(0, 60)}`)
  }
  if (!response.ok) throw new Error(translateErrorMessage(json?.message || json?.detail || `HTTP ${response.status}`))
  return unwrapSub2ApiJson<T>(json)
}

function firstFiniteNumber(...values: any[]) {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

async function fetchSub2ApiSelf(account: Account) {
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

async function fetchSub2ApiCheckinStatus(account: Account, month = localMonthString()) {
  const [year, monthIndex] = month.split("-").map(Number)
  const status = await sub2ApiRequest<any>(account, "GET", "/user/check-in")
  let records: CheckinRecord[] = []
  try {
    const calendar = await sub2ApiRequest<any>(account, "GET", `/user/check-in/calendar?year=${year}&month=${monthIndex}`)
    records = (calendar?.checked_in_dates ?? []).map((date: string) => ({
      checkin_date: date,
      quota_awarded: quotaFromUsd(status?.reward_amount),
    }))
  } catch {}
  if (status?.checked_in_today && !records.some(record => record.checkin_date === localDateString())) {
    records.push({ checkin_date: localDateString(), quota_awarded: quotaFromUsd(status?.reward_amount) })
  }
  return {
    enabled: status?.enabled,
    min_quota: quotaFromUsd(status?.reward_amount),
    max_quota: quotaFromUsd(status?.reward_amount),
    stats: {
      total_quota: quotaFromUsd(status?.reward_amount) !== undefined ? records.length * (quotaFromUsd(status?.reward_amount) as number) : undefined,
      total_checkins: status?.check_in_days ?? records.length,
      checkin_count: status?.check_in_days ?? records.length,
      records,
    },
  } as CheckinStatus
}

async function doSub2ApiCheckin(account: Account) {
  return await sub2ApiRequest<any>(account, "POST", "/user/check-in", {})
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
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Origin": baseUrl,
    "Referer": `${baseUrl}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
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

async function checkSiteStatus(account: Account): Promise<SiteStatus> {
  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  const startedAt = Date.now()
  try {
    const response = await fetch(baseUrl, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/json,text/plain,*/*",
      },
      allowInsecureRequest: baseUrl.startsWith("http://"),
      timeout: 12,
    } as any)
    const statusCode = Number(response?.status) || undefined
    const latencyMs = Date.now() - startedAt
    const state: SiteStatus["state"] = !statusCode || statusCode < 400 ? "online" : "warning"
    const message = state === "online" ? "站点可访问" : `站点返回 HTTP ${statusCode}`
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

async function loginSub2ApiAccount(account: Account) {
  const password = getSecret(account.passwordKey)
  if (!account.username || !password) {
    throw new Error("该账号没有保存邮箱/密码；第三方登录请使用“网页登录获取 Cookie/令牌”")
  }

  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
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
  if (data?.requires_2fa) throw new Error("该账号需要 2FA，请使用“网页登录获取 Cookie/令牌”")
  const token = data?.access_token
  if (!token) throw new Error("登录成功但未返回 access_token")
  if (account.cookieKey) setSecret(account.cookieKey, token)

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

async function loginAccount(account: Account) {
  if (isSub2ApiAccount(account)) return await loginSub2ApiAccount(account)
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
  let capturedTitle: string | undefined
  
  try {
    try { webView.setCustomUserAgent(UA) } catch {}
    await installWebNavigationBridge(webView, normalizedBaseUrl)
    webView.shouldAllowRequest = async request => {
      const url = request.url || normalizedBaseUrl
      // 允许 http/https，同时允许站点内部跳转和 OAuth 回调
      if (isHttpUrl(url)) {
        setTimeout(() => prepareWebLoginPage(webView, url), 300)
        setTimeout(() => prepareWebLoginPage(webView, url), 1200)
        return true
      }
      // 对于非 HTTP scheme（如 about:, data:, blob:），允许通过以支持 CF 验证
      return /^(about|data|blob):/i.test(url)
    }
    
    // 加载页面并在加载完成后获取标题
    await webView.loadHTML(getWebViewLoadingHTML(normalizedBaseUrl, "正在打开网页..."), normalizedBaseUrl)
    const openPage = async () => {
      try {
        const loaded = await loadWebUrlWithFallback(webView, normalizedBaseUrl, normalizedBaseUrl)
        if (!loaded) throw new Error("页面加载失败，请检查站点地址或网络")
        await prepareWebLoginPage(webView, normalizedBaseUrl)
        // 页面加载完成，等待 JavaScript 执行后获取标题
        await new Promise<void>(resolve => setTimeout(resolve, 1500))
        try {
          const title = await webView.evaluateJavaScript("return document.title")
          if (title && typeof title === "string" && title.trim()) {
            capturedTitle = title.trim()
          }
        } catch {}
      } catch (e: any) {
        await webView.loadHTML(getWebViewLoadingHTML(normalizedBaseUrl, `网页打开失败：${getErrorMessage(e)}`), normalizedBaseUrl)
      }
    }
    setTimeout(() => { void openPage() }, 80)
    await webView.present({
      fullscreen: true,
      navigationTitle: "登录完成后关闭页面",
    })

    const cookies = await webView.getCookies(normalizedBaseUrl)
    const cookieHeader = cookiesToHeader(cookies)

    const storage = await readWebLoginStorage(webView)
    const storageItems = {
      ...(storage.localStorage ?? {}),
      ...(storage.sessionStorage ?? {}),
    }
    const storageSelf = extractSelfInfoFromStorage(storageItems)
    const authToken = extractSub2ApiToken(storageItems)
    
    if (!cookieHeader && !authToken) throw new Error("未获取到 Cookie 或登录令牌，请确认已在网页登录成功后再关闭页面")
    return { cookieHeader, authToken, storageSelf, pageTitle: capturedTitle }
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
  const credential = getSecret(account.cookieKey)
  if (!credential) throw new Error(isSub2ApiAccount(account) ? "该账号没有保存登录令牌，请先使用“网页登录获取 Cookie”" : "该账号没有保存 Cookie，请先使用“网页登录获取 Cookie”")

  if (isSub2ApiAccount(account)) {
    const webView = new WebViewController()
    try {
      try { webView.setCustomUserAgent(UA) } catch {}
      await installWebNavigationBridge(webView, normalizedBaseUrl)
      webView.shouldAllowRequest = async request => {
        const url = request.url || normalizedBaseUrl
        if (isHttpUrl(url)) {
          setTimeout(() => prepareWebLoginPage(webView, url), 300)
          return true
        }
        return /^(about|data|blob):/i.test(url)
      }
      await webView.loadHTML(getWebViewLoadingHTML(normalizedBaseUrl, "正在打开网页..."), normalizedBaseUrl)
      const openPage = async () => {
        try {
          const loaded = await loadWebUrlWithFallback(webView, normalizedBaseUrl, normalizedBaseUrl)
          if (!loaded) throw new Error("页面加载失败，请检查站点地址或网络")
          await webView.evaluateJavaScript(`localStorage.setItem('auth_token', ${JSON.stringify(credential)}); true;`)
          await loadWebUrlWithFallback(webView, `${normalizedBaseUrl}/home`, normalizedBaseUrl)
          await prepareWebLoginPage(webView, normalizedBaseUrl)
        } catch (e: any) {
          await webView.loadHTML(getWebViewLoadingHTML(normalizedBaseUrl, `网页打开失败：${getErrorMessage(e)}`), normalizedBaseUrl)
        }
      }
      setTimeout(() => { void openPage() }, 80)
      await webView.present({ fullscreen: true, navigationTitle: "网页签到后关闭页面" })
    } finally {
      webView.dispose()
    }
    return
  }

  const cookieHeader = credential

  const hostname = getUrlHostname(normalizedBaseUrl)
  const secure = normalizedBaseUrl.startsWith("https://")
  const webView = new WebViewController()
  try {
    try { webView.setCustomUserAgent(UA) } catch {}
    await installWebNavigationBridge(webView, normalizedBaseUrl)
    webView.shouldAllowRequest = async request => {
      const url = request.url || normalizedBaseUrl
      if (isHttpUrl(url)) {
        setTimeout(() => prepareWebLoginPage(webView, url), 300)
        setTimeout(() => prepareWebLoginPage(webView, url), 1200)
        return true
      }
      return /^(about|data|blob):/i.test(url)
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
      navigationTitle: "网页签到后关闭页面",
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
  const { cookieHeader, authToken, storageSelf } = await getWebLoginCookie(account.baseUrl)
  if (isSub2ApiAccount(account)) {
    if (!authToken) throw new Error("未获取到 Sub2API auth_token，请确认已登录后再关闭页面")
    setSecret(account.cookieKey, authToken)
    const tempAccount: Account = { ...account, lastSelf: storageSelf }
    const self = await fetchSub2ApiSelf(tempAccount)
    patchAccount(account.id, { lastSelf: self, lastError: "", authSource: "web" })
    return self
  }
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
  if (isSub2ApiAccount(account)) {
    try {
      return await fetchSub2ApiSelf(account)
    } catch (e: any) {
      const message = getErrorMessage(e)
      if (message.includes("缺少 Sub2API 登录令牌") || message.includes("登录状态已过期") || message.includes("未登录") || message.includes("权限不足")) {
        return await loginAccount(account)
      }
      throw e
    }
  }
  try {
    return await apiRequest<SelfInfo>(account, "GET", "/api/user/self")
  } catch (e: any) {
    const message = getErrorMessage(e)
    if (message.includes("缺少用户 ID") || message.includes("未登录") || message.includes("权限不足") || message.includes("登录状态已过期")) {
      await loginAccount(account)
      const latest = loadAccounts().find(a => a.id === account.id) ?? account
      return await apiRequest<SelfInfo>(latest, "GET", "/api/user/self")
    }
    throw e
  }
}

async function fetchCheckinStatus(account: Account, month = localMonthString()) {
  if (isSub2ApiAccount(account)) return await fetchSub2ApiCheckinStatus(account, month)
  return await apiRequest<CheckinStatus>(account, "GET", `/api/user/checkin?month=${encodeURIComponent(month)}`)
}

async function doCheckin(account: Account) {
  if (isSub2ApiAccount(account)) return await doSub2ApiCheckin(account)
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
    platform: draft.platform ?? prev?.platform ?? "newapi",
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
  if (draft.platform) account.platform = draft.platform
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
  const quota = getSelfQuotaValue(account.lastSelf)
  if (quota === undefined || quota === null) return undefined
  const value = Number(quota)
  return Number.isFinite(value) ? value : undefined
}

function compareAccounts(a: Account, b: Account, key: AccountSortKey, direction: SortDirection) {
  if (key === "name") {
    const result = a.name.localeCompare(b.name, "zh-Hans", { numeric: true, sensitivity: "base" })
    return direction === "asc" ? result : -result
  }
  if (key === "platform") {
    const result = getPlatformText(a).localeCompare(getPlatformText(b), "zh-Hans", { numeric: true, sensitivity: "base" })
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
  if (key === "platform") return "平台"
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

function getManualTodayCheckinPatch(account: Account, checked: boolean): Partial<Account> {
  const today = localDateString()
  if (checked) {
    const record = getTodayCheckinInfo(account).record ?? { checkin_date: today }
    return {
      lastTodayCheckinDate: today,
      lastTodayCheckin: { ...record, checkin_date: today },
      lastError: "",
    }
  }

  const records = getCheckinRecords(account.lastCheckin).filter(record => record.checkin_date !== today)
  const lastCheckin = account.lastCheckin ? {
    ...account.lastCheckin,
    stats: {
      ...(account.lastCheckin.stats ?? {}),
      records,
      checkin_count: records.length,
      total_checkins: records.length,
      total_quota: sumCheckinAwards(records),
    },
  } : account.lastCheckin
  return {
    lastCheckin,
    lastTodayCheckinDate: undefined,
    lastTodayCheckin: undefined,
    lastError: "",
  }
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
            {checked ? <Text font="caption2" foregroundStyle="systemGreen" lineLimit={1} minScaleFactor={0.6}>{fmtQuota(record?.quota_awarded)}</Text> : <Text font="caption2" foregroundStyle="systemGray4"> </Text>}
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
  const siteStatus = await checkSiteStatus(account)
  patchAccount(account.id, { lastSiteStatus: siteStatus })
  const latest = loadAccounts().find(item => item.id === account.id) ?? account
  const data = await fetchSelf(latest)
  patchAccount(account.id, { lastSelf: data, lastError: "" })
  return data
}

async function quickCheckinAccount(account: Account) {
  const data = await doCheckin(account)
  let self: SelfInfo | undefined
  let status: CheckinStatus | undefined
  let siteStatus: SiteStatus | undefined
  try { self = await fetchSelf(account) } catch {}
  try { status = await fetchCheckinStatus(account) } catch {}
  try { siteStatus = await checkSiteStatus(account) } catch {}
  patchAccount(account.id, { lastSelf: self, lastCheckin: status, lastSiteStatus: siteStatus, lastError: "", ...getTodayCheckinPatch(status) })
  return data
}

function AccountSummary({ accounts }: { accounts: Account[] }) {
  const totalQuota = accounts.reduce((sum, item) => sum + (Number(getSelfQuotaValue(item.lastSelf)) || 0), 0)
  const checkedCount = accounts.filter(account => getTodayCheckinInfo(account).checked).length

  return <Section title="总览">
    <HStack spacing={12}>
      <VStack alignment="leading" spacing={4} frame={{ width: 90, alignment: "leading" }}>
        <Text font="caption" foregroundStyle="secondaryLabel">账号</Text>
        <Text font="title2">{accounts.length}</Text>
      </VStack>
      <VStack alignment="leading" spacing={4} frame={{ width: 90, alignment: "leading" }}>
        <Text font="caption" foregroundStyle="secondaryLabel">已签到</Text>
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
  const siteStatus = getSiteStatusView(account)
  const latencyText = getSiteStatusLatencyText(account.lastSiteStatus)
  const todayCheckin = getTodayCheckinInfo(account)
  const checkinTime = account.checkinTime
  const checkinTimeReached = checkinTime ? isCheckinTimeReached(checkinTime) : true
  const checkinText = todayCheckin.checked
    ? `已签${todayCheckin.record?.quota_awarded !== undefined ? ` ${fmtCheckinAward(todayCheckin.record.quota_awarded)}` : ""}`
    : checkinTime && !checkinTimeReached
      ? `签到时间 ${checkinTime}`
      : "未签"

  return <HStack spacing={12}>
    <VStack alignment="center" spacing={2} frame={{ width: 52 }}>
      <Image systemName={siteStatus.icon} foregroundStyle={siteStatus.color as any} />
      <Text font="caption2" foregroundStyle={siteStatus.color as any}>{siteStatus.text}</Text>
      {latencyText ? <Text font="caption2" foregroundStyle={getSiteStatusLatencyColor(account.lastSiteStatus) as any}>{latencyText}</Text> : null}
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
      <HStack spacing={6}>
        <Text font="caption" foregroundStyle="secondaryLabel">{shortUrl(account.baseUrl)} · {getPlatformText(account)}</Text>
      </HStack>
      <HStack spacing={10}>
        <Text font="caption">余额 {fmtQuota(getSelfQuotaValue(account.lastSelf))}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">已用 {fmtQuota(getSelfUsedQuotaValue(account.lastSelf))}</Text>
      </HStack>
      {account.lastError ? <Text font="caption" foregroundStyle="systemRed">{getErrorMessage(account.lastError)}</Text> : null}
    </VStack>
  </HStack>
}

function AccountRowMenu({ account, onDelete, onQuickSync, onQuickCheckin, onOpenSite, onCheckSiteStatus, onToggleManualCheckin, onToggleExclude, disabled }: { account: Account, onDelete: (account: Account) => void, onQuickSync: (account: Account) => void, onQuickCheckin: (account: Account) => void, onOpenSite: (account: Account) => void, onCheckSiteStatus: (account: Account) => void, onToggleManualCheckin: (account: Account) => void, onToggleExclude: (account: Account) => void, disabled?: boolean }) {
  const todayCheckin = getTodayCheckinInfo(account)

  function openAccountSite() {
    onOpenSite(account)
  }

  return <Group>
    <Button title="查询余额" systemImage="arrow.clockwise" action={() => onQuickSync(account)} disabled={disabled} />
    <Button title="签到" systemImage="checkmark.seal" action={() => onQuickCheckin(account)} disabled={disabled} />
    <Button title="连通性检测" systemImage="network" action={() => onCheckSiteStatus(account)} disabled={disabled} />
    <Button title="网页签到" systemImage="safari" action={openAccountSite} disabled={disabled} />
    <Button
      title={todayCheckin.checked ? "标注未签" : "标注已签"}
      systemImage={todayCheckin.checked ? "xmark.seal" : "checkmark.seal.fill"}
      action={() => onToggleManualCheckin(account)}
      disabled={disabled}
    />
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
      <SortButton itemKey="platform" title="按平台" />
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
  const [platform, setPlatform] = useState<AccountPlatform>(initial?.platform ?? "newapi")
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
      const credential = platform === "sub2api" ? result.authToken : result.cookieHeader
      if (!credential) throw new Error(platform === "sub2api" ? "未获取到 Sub2API auth_token" : "未获取到 Cookie")
      setCookie(credential)
      setCookieAuthSource("web")
      if (result.storageSelf) {
        setWebSelf(result.storageSelf)
        if (!username && result.storageSelf.username) setUsername(result.storageSelf.username)
      }
      if (!name) {
        setName(result.pageTitle || shortUrl(normalizedBaseUrl))
      }
      setToastMessage(platform === "sub2api" ? "已获取登录令牌，保存后生效" : "已获取 Cookie，保存后生效")
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
        platform,
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
      <LabeledTextField title="站点地址" value={baseUrl} onChanged={setBaseUrl} prompt={platform === "sub2api" ? "https://api.luka77.cc" : "https://newapi.example.com"} />
      <Picker title="平台类型" value={platform} onChanged={(value: string) => setPlatform(value === "sub2api" ? "sub2api" : "newapi")}>
        <Text tag="newapi">NewAPI</Text>
        <Text tag="sub2api">Sub2API</Text>
      </Picker>
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
    <Section header={<Text>账号密码登录</Text>} footer={<Text>{platform === "sub2api" ? "Sub2API 账号密码登录使用邮箱和密码；如果站点启用了 Turnstile 或 2FA，建议改用网页登录获取登录令牌。" : "如果站点启用了 Turnstile 或 2FA，建议改用浏览器登录后的 Cookie。"}</Text>}>
      <LabeledTextField title={platform === "sub2api" ? "邮箱" : "用户名"} value={username} onChanged={setUsername} prompt="可选" />
      <LabeledSecureField title="密码" value={password} onChanged={setPassword} prompt={initial ? "留空则不修改" : "可选"} />
    </Section>
    <Section header={<Text>{platform === "sub2api" ? "网页登录令牌" : "第三方登录 Cookie"}</Text>} footer={<Text>{platform === "sub2api" ? "Sub2API 前端使用 localStorage.auth_token。推荐点“网页登录获取 Cookie/令牌”，也可以手动粘贴 auth_token。" : "适用于 GitHub / OIDC / LinuxDO / Discord / Telegram / 微信等第三方登录。粘贴浏览器请求头中的 Cookie。"}</Text>}>
      <LabeledTextField title={platform === "sub2api" ? "令牌" : "Cookie"} value={cookie} onChanged={value => { setCookie(value); setCookieAuthSource("cookie") }} axis="vertical" prompt={initial ? "留空则不修改" : platform === "sub2api" ? "auth_token" : "session=...; other=..."} />
      <Button action={webLoginCookie} disabled={webBusy}>
        {webBusy ? <HStack spacing={8} alignment="center">
          <ProgressView />
          <Text foregroundStyle="systemGray4">网页登录中...</Text>
        </HStack> : <HStack spacing={8} alignment="center">
          <Image systemName="globe" foregroundStyle="tintColor" font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle="tintColor">网页登录获取 Cookie/令牌</Text>
        </HStack>}
      </Button>
      <Button action={pasteCookie}>
        <HStack spacing={8} alignment="center">
          <Image systemName="doc.on.clipboard" foregroundStyle="tintColor" font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle="tintColor">{platform === "sub2api" ? "从剪贴板粘贴令牌" : "从剪贴板粘贴 Cookie"}</Text>
        </HStack>
      </Button>
    </Section>
  </Form>
}

function AccountDetailView({ accountId, onChanged }: { accountId: string, onChanged: () => void }) {
  const dismiss = Navigation.useDismiss()
  const initialAccount = loadAccounts().find(a => a.id === accountId)
  const [account, setAccount] = useState<Account | undefined>(initialAccount)
  const [refreshKey, setRefreshKey] = useState(0)
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
    if (next) {
      refreshDetailSilently(localMonthString(), next)
    }
  }, [accountId, refreshKey])

  function refreshLocal() {
    const next = loadAccounts().find(a => a.id === accountId)
    if (next) setAccount(next)
    setRefreshKey(prev => prev + 1)
    onChanged()
  }

  async function refreshDetailSilently(month = localMonthString(), target?: Account) {
    const latest = target ?? loadAccounts().find(item => item.id === accountId) ?? account
    if (!latest) return
    setBusy(true)
    const patch: Partial<Account> = {}
    try {
      patch.lastSelf = await fetchSelf(latest)
      patch.lastError = ""
    } catch (e: any) {
      patch.lastError = getErrorMessage(e)
    }
    try {
      const status = await fetchCheckinStatus(latest, month)
      patch.lastCheckin = status
      Object.assign(patch, getTodayCheckinPatch(status))
      if (!patch.lastError) patch.lastError = ""
    } catch (e: any) {
      if (!patch.lastError) patch.lastError = getErrorMessage(e)
      Object.assign(patch, getCheckinDisabledPatch(e?.message ?? e))
    }
    patchAccount(latest.id, patch)
    const next = loadAccounts().find(a => a.id === accountId)
    if (next) setAccount(next)
    onChanged()
    setBusy(false)
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
      <Text>平台：{getPlatformText(account)}</Text>
      <Text>站点：{account.baseUrl}</Text>
      <Text>站点状态：{getSiteStatusDetail(account.lastSiteStatus)}</Text>
      <Text>认证：{getAuthSourceText(account)}</Text>
      <Text>更新：{fmtTime(account.updatedAt)}</Text>
      {account.lastError ? <Text foregroundStyle="systemRed">错误：{getErrorMessage(account.lastError)}</Text> : null}
    </Section>
    
    <Section title="账号操作">
      <Button action={login} disabled={busy || !account?.username || !getSecret(account?.passwordKey)}>
        <HStack spacing={8} alignment="center">
          <Image systemName="person.crop.circle.badge.checkmark" foregroundStyle={busy || !account?.username || !getSecret(account?.passwordKey) ? "systemGray4" : "tintColor"} font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle={busy || !account?.username || !getSecret(account?.passwordKey) ? "systemGray4" : "tintColor"}>登录账号</Text>
        </HStack>
      </Button>
      <Button action={webLogin} disabled={busy}>
        <HStack spacing={8} alignment="center">
          <Image systemName="globe" foregroundStyle={busy ? "systemGray4" : "tintColor"} font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle={busy ? "systemGray4" : "tintColor"}>网页登录获取 Cookie/令牌</Text>
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
      <Text>用户名：{getSelfDisplayName(account.lastSelf) ?? account.username ?? "-"}</Text>
      <Text>分组：{account.lastSelf?.group ?? "-"}</Text>
      <Text>剩余额度：{fmtQuota(getSelfQuotaValue(account.lastSelf))} ({fmtRawQuotaForAccount(account, getSelfQuotaValue(account.lastSelf))})</Text>
      <Text>已用额度：{fmtQuota(getSelfUsedQuotaValue(account.lastSelf))} ({fmtRawQuotaForAccount(account, getSelfUsedQuotaValue(account.lastSelf))})</Text>
      {isSub2ApiAccount(account) ? <Text>并发：{account.lastSelf?.concurrency ?? "-"}</Text> : null}
      <Text>请求次数：{account.lastSelf?.request_count ?? "-"}</Text>
    </Section>

    <Section title="签到">
      {account.excludeFromBatchCheckin ? <Text foregroundStyle="systemOrange">⚠️ 已排除批量签到（仅网页签到）</Text> : null}
      <Text>今日状态：{todayCheckin.checked ? `已签到${todayCheckin.record?.quota_awarded !== undefined ? `，奖励 ${fmtCheckinAward(todayCheckin.record.quota_awarded)}` : ""}` : (() => {
        const checkinTime = account.checkinTime
        const checkinTimeReached = checkinTime ? isCheckinTimeReached(checkinTime) : true
        return checkinTime && !checkinTimeReached ? `未签到（签到时间 ${checkinTime}）` : "未签到"
      })()}</Text>
      <Text>功能启用：{account.lastCheckin?.enabled === undefined ? "未知" : account.lastCheckin.enabled ? "是" : "否"}</Text>
      <Text>奖励范围：{isSub2ApiAccount(account) ? fmtQuota(account.lastCheckin?.min_quota) : `${fmtQuota(account.lastCheckin?.min_quota)} ~ ${fmtQuota(account.lastCheckin?.max_quota)}`}</Text>
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

function shouldAutoCheckSiteStatus(account: Account) {
  const checkedAt = account.lastSiteStatus?.checkedAt
  return !checkedAt || now() - checkedAt >= SITE_STATUS_AUTO_CHECK_INTERVAL
}

// 清除已过期的连通性缓存数据（延迟/状态等）
function clearExpiredSiteStatuses(accounts: Account[]) {
  let changed = false
  for (const account of accounts) {
    if (shouldAutoCheckSiteStatus(account) && account.lastSiteStatus) {
      account.lastSiteStatus = undefined
      changed = true
    }
  }
  if (changed) saveAccounts(accounts)
  return changed
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
    void checkSiteStatuses()
  }, [])

  async function checkSiteStatuses(showResult = false) {
    const currentAccounts = loadAccounts()
    // 清除已过期的延迟缓存数据
    if (clearExpiredSiteStatuses(currentAccounts)) reload()
    const targetAccounts = showResult ? currentAccounts : currentAccounts.filter(shouldAutoCheckSiteStatus)
    if (currentAccounts.length === 0) {
      if (showResult) {
        setToastMessage("请先添加账号后再检测连通性")
        setShowToast(true)
      }
      return
    }
    if (targetAccounts.length === 0) return
    setBusy(true)
    setBusyLabel("检测连通性中...")
    if (showResult) {
      saveAccounts(currentAccounts.map(account => ({
        ...account,
        lastSiteStatus: undefined,
      })))
      reload()
    }
    let ok = 0
    let fail = 0
    const total = targetAccounts.length
    try {
      for (let i = 0; i < targetAccounts.length; i++) {
        const account = targetAccounts[i]
        setBusyLabel(`检测连通性中 (${i + 1}/${total})...`)
        try {
          const status = await checkSiteStatus(account)
          patchAccount(account.id, { lastSiteStatus: status })
          if (status.state === "offline") fail++
          else ok++
        } catch (e: any) {
          patchAccount(account.id, { lastSiteStatus: getOfflineSiteStatus(e) })
          fail++
        }
        reload()
      }
    } finally {
      setBusy(false)
      setBusyLabel("")
    }
    if (showResult) {
      setToastMessage(`连通性检测完成：正常 ${ok}，异常 ${fail}`)
      setShowToast(true)
    }
  }

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
    const allAccounts = loadAccounts()
    const total = allAccounts.length
    for (let i = 0; i < allAccounts.length; i++) {
      const account = allAccounts[i]
      setBusyLabel(`批量查余额中 (${i + 1}/${total})...`)
      try {
        const siteStatus = await checkSiteStatus(account)
        patchAccount(account.id, { lastSiteStatus: siteStatus })
        const latest = loadAccounts().find(item => item.id === account.id) ?? account
        const data = await fetchSelf(latest)
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
    const allAccounts = loadAccounts()
    const total = allAccounts.length
    let processed = 0
    for (const account of allAccounts) {
      processed++
      setBusyLabel(`批量签到中 (${processed}/${total})...`)
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

  async function quickCheckSiteStatus(account: Account) {
    setBusy(true)
    try {
      const status = await checkSiteStatus(account)
      patchAccount(account.id, { lastSiteStatus: status })
      const stateText = status.state === "online" ? "在线" : status.state === "warning" ? "异常" : "离线"
      const latencyText = status.state === "online" && status.latencyMs !== undefined ? `，${status.latencyMs}ms` : ""
      setToastMessage(`"${account.name}"${stateText}${latencyText}`)
    } catch (e: any) {
      patchAccount(account.id, { lastSiteStatus: getOfflineSiteStatus(e) })
      setToastMessage(`连通性检测失败：${getErrorMessage(e)}`)
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
      try {
        const status = await fetchCheckinStatus(latest)
        patchAccount(latest.id, { lastCheckin: status, lastError: "", ...getTodayCheckinPatch(status) })
        setToastMessage(`“${account.name}”签到状态已更新`)
      } catch (e: any) {
        const message = getErrorMessage(e)
        const balancePatch: Partial<Account> = { lastError: message, ...getCheckinDisabledPatch(message) }
        try {
          balancePatch.lastSelf = await fetchSelf(latest)
          setToastMessage(`网页已关闭，签到接口不可用`)
        } catch {
          setToastMessage(`网页已关闭，签到接口不可用`)
        }
        patchAccount(latest.id, balancePatch)
      }
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

  function quickToggleManualCheckin(account: Account) {
    const nextChecked = !getTodayCheckinInfo(account).checked
    patchAccount(account.id, getManualTodayCheckinPatch(account, nextChecked))
    reload()
    setToastMessage(nextChecked ? `“${account.name}”已标注为已签` : `“${account.name}”已标注为未签`)
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
      navigationTitle="账号管理"
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
        <BatchActionButton title="查询余额" busyTitle={busyLabel} systemImage="arrow.clockwise" active={busy && busyLabel.startsWith("批量查余额")} disabled={busy} action={syncAll} />
        <BatchActionButton title="签到" busyTitle={busyLabel} systemImage="checkmark.seal.fill" active={busy && busyLabel.startsWith("批量签到")} disabled={busy} action={checkinAll} />
        <BatchActionButton title="连通性检测" busyTitle={busyLabel} systemImage="network" active={busy && busyLabel.startsWith("检测连通性")} disabled={busy} action={() => checkSiteStatuses(true)} />
      </Section>

      <Section header={<AccountListHeader sortKey={sortKey} sortDirection={sortDirection} onSelectSort={selectSort} />}>
        {accounts.length === 0 ? <Text foregroundStyle="secondaryLabel">暂无账号，点击右上角“添加”。</Text> : null}
        {sortedAccounts.map(account => <NavigationLink
          key={account.id}
          destination={<AccountDetailView key={`detail-${account.id}`} accountId={account.id} onChanged={reload} />}
          contextMenu={{ menuItems: <AccountRowMenu account={account} onDelete={quickDelete} onQuickSync={quickSync} onQuickCheckin={quickCheckin} onOpenSite={quickOpenSite} onCheckSiteStatus={quickCheckSiteStatus} onToggleManualCheckin={quickToggleManualCheckin} onToggleExclude={quickToggleExclude} disabled={busy} /> }}
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
