declare const fetch: any

import type { Account, SelfInfo, WebLoginCookieResult, SiteStatus, CheckinStatus } from "../types"
import { UA } from "../constants"
import { isSub2ApiAccount, normalizeBaseUrl, quotaFromUsd, localDateString, localMonthString, shortUrl, now } from "../utils/format"
import { translateErrorMessage, getErrorMessage } from "../utils/error"
import { mergeCookies, cookiesToHeader, parseCookieHeader, getUrlHostname, isHttpUrl, resolveWebUrl, escapeHTML } from "../utils/cookie"
import { getSecret, setSecret, loadAccounts, patchAccount } from "./storage"
import { unwrapSub2ApiJson, sub2ApiRequest, fetchSub2ApiSelf, fetchSub2ApiCheckinStatus, doSub2ApiCheckin, apiRequestWithMeta, apiRequest } from "./api"

// 生成 WebView 加载中 HTML
export function getWebViewLoadingHTML(url: string, title: string) {
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

// 展示 WebView 并加载 URL
export async function presentWebViewAndLoadURL(webView: WebViewController, url: string, options: { fullscreen?: boolean, navigationTitle?: string }) {
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

// 递归从 JSON 中查找 SelfInfo
export function findSelfInfo(value: any): SelfInfo | undefined {
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

// 从 storage 中提取 Sub2API token
export function extractSub2ApiToken(items: Record<string, string>) {
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

// 从 storage 提取用户信息
export function extractSelfInfoFromStorage(items: Record<string, string>) {
  for (const raw of Object.values(items)) {
    try {
      const parsed = JSON.parse(raw)
      const found = findSelfInfo(parsed)
      if (found) return found
    } catch {}
  }
  return undefined
}

// 注入 JS：patch 弹窗、安装进度条
export async function prepareWebLoginPage(webView: WebViewController, baseUrl = "") {
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

// 安装导航桥
export async function installWebNavigationBridge(webView: WebViewController, baseUrl: string) {
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

// 加载 URL（含 resolve 处理）
export async function loadWebUrlWithFallback(webView: WebViewController, url: string, fallbackBaseUrl: string) {
  const targetUrl = resolveWebUrl(url, fallbackBaseUrl)
  if (!isHttpUrl(targetUrl)) return false
  return await webView.loadURL(targetUrl)
}

// 读取 WebView localStorage/sessionStorage
export async function readWebLoginStorage(webView: WebViewController) {
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

// Sub2API 密码登录
export async function loginSub2ApiAccount(account: Account) {
  const password = getSecret(account.passwordKey)
  if (!account.username || !password) {
    throw new Error("该账号未保存用户名/密码，请编辑账号补充，或使用“网页登录获取 Cookie/令牌”")
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
  if (data?.requires_2fa) throw new Error("该账号需要 2FA，请使用\u201c网页登录获取 Cookie/令牌\u201d")
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

// 统一登录入口
export async function loginAccount(account: Account) {
  if (isSub2ApiAccount(account)) return await loginSub2ApiAccount(account)
  // 优先尝试访问令牌认证（需要用户 ID 才能发起请求）
  const accessToken = getSecret(account.accessTokenKey)
  if (accessToken && account.lastSelf?.id) {
    const self = await apiRequest<SelfInfo>(account, "GET", "/api/user/self")
    patchAccount(account.id, { lastSelf: self, lastError: "", authSource: "accessToken" })
    return self
  }
  const password = getSecret(account.passwordKey)
  if (!account.username || !password) {
    if (accessToken && !account.lastSelf?.id) {
      throw new Error("访问令牌登录需要先记录用户 ID，请编辑账号填写用户 ID")
    }
    throw new Error("该账号未保存用户名/密码或访问令牌，请编辑账号补充，或使用“网页登录获取 Cookie/令牌”")
  }
  const result = await apiRequestWithMeta<any>(account, "POST", "/api/user/login", {
    username: account.username,
    password,
  })
  const data = result.data
  if (data?.require_2fa) {
    throw new Error("该账号需要 2FA，请使用\u201c网页登录获取 Cookie\u201d")
  }
  const mergedCookie = mergeCookies(getSecret(account.cookieKey), result.cookie)
  if (mergedCookie && account.cookieKey) setSecret(account.cookieKey, mergedCookie)
  patchAccount(account.id, { lastSelf: data, lastError: "", authSource: "password" })
  return data
}

// 网页登录核心函数
export async function getWebLoginCookie(baseUrl: string): Promise<WebLoginCookieResult> {
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

// 打开网页签到 WebView
export async function openManualCheckinWebView(account: Account) {
  const normalizedBaseUrl = normalizeBaseUrl(account.baseUrl)
  if (!normalizedBaseUrl) throw new Error("请先填写站点地址")
  if (!normalizedBaseUrl.startsWith("http://") && !normalizedBaseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }
  if (!account.cookieKey) throw new Error("账号 Cookie 存储键不存在，请重新保存账号")
  const credential = getSecret(account.cookieKey)
  if (!credential) throw new Error(isSub2ApiAccount(account) ? "该账号没有保存登录令牌，请先使用\u201c网页登录获取 Cookie\u201d" : "该账号没有保存 Cookie，请先使用\u201c网页登录获取 Cookie\u201d")

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
      // 综合读取 localStorage/sessionStorage 中的最新令牌并保存
      try {
        const storage = await readWebLoginStorage(webView)
        const storageItems = {
          ...(storage.localStorage ?? {}),
          ...(storage.sessionStorage ?? {}),
        }
        const latestToken = extractSub2ApiToken(storageItems)
        if (latestToken && latestToken !== credential) {
          setSecret(account.cookieKey, latestToken)
        }
      } catch {}
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
    // 直接使用 WebView 最新 cookie 替换旧值，避免 mergeCookies 保留已失效的旧 cookie
    if (nextCookieHeader) setSecret(account.cookieKey, nextCookieHeader)
  } finally {
    webView.dispose()
  }
}

// 网页登录完整流程
export async function loginByWebView(account: Account) {
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

// 检测错误是否为登录状态失效（需要重登）
function isAuthExpiredError(message: string): boolean {
  return (
    // 本地校验类
    message.includes("缺少用户 ID") ||
    message.includes("缺少 Sub2API 登录令牌") ||
    // NewAPI 常见中文失效提示
    message.includes("未登录") ||
    message.includes("权限不足") ||
    message.includes("无权进行此操作") ||
    message.includes("登录状态已过期") ||
    message.includes("访问令牌") ||
    message.includes("令牌无效") ||
    message.includes("令牌已过期") ||
    // session / token 失效
    /session\s*(not\s+found|expired|invalid)|no\s+session|session\s+失效/i.test(message) ||
    /access.?token/i.test(message) ||
    // HTTP 状态码 401/403
    /\bHTTP\s*40[13]\b/i.test(message) ||
    // 非 JSON 响应（通常是触发了验证或登录失效）
    /响应不是 JSON/.test(message)
  )
}

// 获取用户信息（含自动重登录）
export async function fetchSelf(account: Account) {
  if (isSub2ApiAccount(account)) {
    try {
      return await fetchSub2ApiSelf(account)
    } catch (e: any) {
      if (isAuthExpiredError(getErrorMessage(e))) {
        return await loginAccount(account)
      }
      throw e
    }
  }
  try {
    return await apiRequest<SelfInfo>(account, "GET", "/api/user/self")
  } catch (e: any) {
    if (isAuthExpiredError(getErrorMessage(e))) {
      await loginAccount(account)
      const latest = loadAccounts().find(a => a.id === account.id) ?? account
      return await apiRequest<SelfInfo>(latest, "GET", "/api/user/self")
    }
    throw e
  }
}

// 获取签到状态（根据平台分发，含自动重登录）
export async function fetchCheckinStatus(account: Account, month = localMonthString()) {
  try {
    if (isSub2ApiAccount(account)) return await fetchSub2ApiCheckinStatus(account, month)
    return await apiRequest<CheckinStatus>(account, "GET", `/api/user/checkin?month=${encodeURIComponent(month)}`)
  } catch (e: any) {
    if (isAuthExpiredError(getErrorMessage(e))) {
      await loginAccount(account)
      const latest = loadAccounts().find(a => a.id === account.id) ?? account
      if (isSub2ApiAccount(latest)) return await fetchSub2ApiCheckinStatus(latest, month)
      return await apiRequest<CheckinStatus>(latest, "GET", `/api/user/checkin?month=${encodeURIComponent(month)}`)
    }
    throw e
  }
}

// 执行签到（根据平台分发，含自动重登录）
export async function doCheckin(account: Account) {
  try {
    if (isSub2ApiAccount(account)) return await doSub2ApiCheckin(account)
    return await apiRequest<any>(account, "POST", "/api/user/checkin", {})
  } catch (e: any) {
    if (isAuthExpiredError(getErrorMessage(e))) {
      await loginAccount(account)
      const latest = loadAccounts().find(a => a.id === account.id) ?? account
      if (isSub2ApiAccount(latest)) return await doSub2ApiCheckin(latest)
      return await apiRequest<any>(latest, "POST", "/api/user/checkin", {})
    }
    throw e
  }
}
