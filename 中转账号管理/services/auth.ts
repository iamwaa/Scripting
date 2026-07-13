declare const fetch: any

import type { Account, SelfInfo, WebLoginCookieResult, SiteStatus, CheckinStatus } from "../types"
import { UA } from "../constants"
import { isSub2ApiAccount, normalizeBaseUrl, quotaFromUsd, localDateString, localMonthString, shortUrl, now } from "../utils/format"
import { translateErrorMessage, getErrorMessage } from "../utils/error"
import { mergeCookies, cookiesToHeader, parseCookieHeader, getUrlHostname, isHttpUrl, resolveWebUrl, escapeHTML } from "../utils/cookie"
import { getSecret, setSecret, removeSecret, loadAccounts, patchAccount } from "./storage"
import { unwrapSub2ApiJson, sub2ApiRequest, fetchSub2ApiSelf, fetchSub2ApiCheckinStatus, doSub2ApiCheckin, apiRequestWithMeta, apiRequest } from "./api"
import { presentWebViewWithToolbar } from "../components/WebViewPage"

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
      if (!loaded) throw new Error("页面加载失败")
      await prepareWebLoginPage(webView, url)
    } catch (e: any) {
      await webView.loadHTML(getWebViewLoadingHTML(url, `网页打开失败：${getErrorMessage(e)}`), url)
    }
  }
  setTimeout(() => { void openPage() }, 80)
  // 以原生工具栏模式呈现（右上角刷新按钮）
  await presentWebViewWithToolbar(webView, options.navigationTitle || "网页")
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

// 已知需要打平跨域 iframe 首页的站点白名单（域名或域名后缀，忽略大小写）
// 只有账号 host 命中白名单时才启用 flatten，避免误伤其他使用大 iframe 的站点
const FLATTEN_IFRAME_HOSTS = ["x666.me"]

function shouldEnableFlatten(host: string) {
  if (!host) return false
  const h = host.toLowerCase()
  return FLATTEN_IFRAME_HOSTS.some(rule => h === rule || h.endsWith("." + rule))
}

// 注入 JS：patch 弹窗、安装进度条
export async function prepareWebLoginPage(webView: WebViewController, baseUrl = "") {
  // 提取账号原始站点主机名，作为 flatten iframe 逻辑的守卫：
  // 只有当前文档仍在这个 host 上时才允许打平，避免打平后跳到 boheapi/qd.x666.me 等子站又被继续打平导致连环跳转
  const originHost = getUrlHostname(baseUrl)
  // 只有账号 host 命中白名单时才启用 flatten；其他站点即便有大 iframe 也不打平
  const flattenEnabled = shouldEnableFlatten(originHost)
  const script = `
    const __newapiOriginHost = ${JSON.stringify(originHost)};
    const __newapiFlattenEnabled = ${JSON.stringify(flattenEnabled)};
    // 同页跳转辅助：忽略空/占位 URL，兼容相对路径
    const navigate = (url) => {
      if (!url) return;
      const s = String(url);
      if (s === '' || s === 'about:blank') return;
      try { location.href = new URL(s, location.href).href; }
      catch { location.href = s; }
    };
    // 构造一个假的 window 代理：拦截后续对 location 的赋值 / assign / replace / postMessage 等，都落到当前 WebView
    const makeFakeWindow = () => {
      const locationProxy = new Proxy({}, {
        get: (_, prop) => {
          if (prop === 'href') return location.href;
          if (prop === 'assign' || prop === 'replace') return (u) => navigate(u);
          if (prop === 'reload') return () => location.reload();
          try { const v = location[prop]; return typeof v === 'function' ? v.bind(location) : v; }
          catch { return undefined; }
        },
        set: (_, prop, value) => { if (prop === 'href') navigate(value); return true; },
      });
      const fake = new Proxy({ closed: false }, {
        get: (target, prop) => {
          if (prop === 'location') return locationProxy;
          if (prop === 'close' || prop === 'focus' || prop === 'blur') return () => {};
          if (prop === 'closed') return false;
          if (prop === 'opener') return null;
          if (prop === 'postMessage') return () => {};
          if (prop === 'document') return { write: () => {}, writeln: () => {}, close: () => {} };
          if (prop === 'window' || prop === 'self') return target;
          return undefined;
        },
        set: (target, prop, value) => {
          if (prop === 'location') {
            if (typeof value === 'string') navigate(value);
            else if (value && typeof value === 'object' && value.href) navigate(value.href);
          }
          return true;
        },
      });
      return fake;
    };
    // 打平大面积跨域 iframe：若首页把主要内容放在跨域 iframe 内（例如 new-api 的自定义首页），
    // shim 无法注入到跨域 iframe，iOS WKWebView 也不响应 iframe 里 target=_blank 弹新窗口。
    // 检测到跨域 iframe 占据视口 ≥60% 时，直接把主 frame 跳到 iframe URL，让子页的链接落回主 frame 由 shim 接管。
    // 关键守卫：只允许在账号的原始 host 上打平；打平后当前 host 会变为 iframe 的 host，此时此函数直接跳过，
    // 避免 boheapi 内又有大 iframe（或后续 qd.x666.me/up.x666.me 有嵌套 iframe）触发链式跳转。
    const flattenIframe = () => {
      if (!__newapiFlattenEnabled) return;
      if (window.__newapiFlattened) return;
      if (__newapiOriginHost && location.hostname !== __newapiOriginHost) return;
      const iframes = document.querySelectorAll('iframe[src]');
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const viewportArea = vw * vh;
      if (viewportArea <= 0) return;
      for (const iframe of iframes) {
        const src = iframe.getAttribute('src') || '';
        if (!/^https?:/i.test(src)) continue;
        try {
          const u = new URL(src, location.href);
          if (u.origin === location.origin) continue;
          const rect = iframe.getBoundingClientRect();
          if (rect.width * rect.height < viewportArea * 0.6) continue;
          window.__newapiFlattened = true;
          navigate(u.href);
          return;
        } catch {}
      }
    };
    const patch = () => {
      // window.open 只覆盖一次；有 URL 立即同页跳，无 URL 时也返回代理，后续给 w.location.href 赋值一样能触发跳转
      if (!window.__newapiOpenPatched) {
        window.__newapiOpenPatched = true;
        window.open = (url) => { navigate(url); return makeFakeWindow(); };
      }
      // 已存在的 target=_blank 链接 / 表单改为当前页导航
      document.querySelectorAll('a[target="_blank"], a[target="blank"]').forEach(a => a.setAttribute('target', '_self'));
      document.querySelectorAll('form[target="_blank"], form[target="blank"]').forEach(f => f.setAttribute('target', '_self'));
      // 兜底：捕获阶段拦截 target=_blank 链接的点击，避免动态 SPA 加载后未及时改写 target
      if (!window.__newapiClickBound) {
        window.__newapiClickBound = true;
        document.addEventListener('click', (event) => {
          const a = event.target?.closest?.('a[target="_blank"], a[target="blank"]');
          if (!a || !a.href) return;
          event.preventDefault();
          location.href = a.href;
        }, true);
      }
      // 检测并打平跨域大 iframe（新 iframe 可能是 SPA 动态渲染，因此需要每次 tick 都试一下）
      flattenIframe();
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
      // 始终传入账号原始 baseUrl，避免 flatten iframe 守卫误判当前 host
      setTimeout(() => prepareWebLoginPage(webView, baseUrl), 300)
      setTimeout(() => prepareWebLoginPage(webView, baseUrl), 1200)
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
    throw new Error("未保存用户名/密码，请编辑账号或使用网页登录")
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
  if (data?.requires_2fa) throw new Error("该账号需要 2FA，请使用网页登录")
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
        // 传入账号原始 baseUrl 而非当前 url，让 flatten iframe 守卫按原始 host 判断
        setTimeout(() => prepareWebLoginPage(webView, normalizedBaseUrl), 300)
        setTimeout(() => prepareWebLoginPage(webView, normalizedBaseUrl), 1200)
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
        if (!loaded) throw new Error("页面加载失败")
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
    // 以原生工具栏模式呈现（右上角刷新按钮）
    await presentWebViewWithToolbar(webView, "登录完成后关闭页面")

    const cookies = await webView.getCookies(normalizedBaseUrl)
    const cookieHeader = cookiesToHeader(cookies)

    const storage = await readWebLoginStorage(webView)
    const storageItems = {
      ...(storage.localStorage ?? {}),
      ...(storage.sessionStorage ?? {}),
    }
    const storageSelf = extractSelfInfoFromStorage(storageItems)
    const authToken = extractSub2ApiToken(storageItems)
    
    if (!cookieHeader && !authToken) throw new Error("未获取到 Cookie 或登录令牌")
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
  if (!account.cookieKey) throw new Error("Cookie 存储键缺失，请重新保存账号")
  // 允许在没有已保存凭据的情况下打开网页签到：让用户在 WebView 内自行登录并完成签到，
  // 关闭后再从 Cookie / localStorage 中回收最新的登录信息。
  const credential = getSecret(account.cookieKey)

  if (isSub2ApiAccount(account)) {
    const webView = new WebViewController()
    try {
      try { webView.setCustomUserAgent(UA) } catch {}
      await installWebNavigationBridge(webView, normalizedBaseUrl)
      webView.shouldAllowRequest = async request => {
        const url = request.url || normalizedBaseUrl
        if (isHttpUrl(url)) {
          // 始终传入账号原始 baseUrl，flatten iframe 守卫依赖它判断当前 host
          setTimeout(() => prepareWebLoginPage(webView, normalizedBaseUrl), 300)
          return true
        }
        return /^(about|data|blob):/i.test(url)
      }
      await webView.loadHTML(getWebViewLoadingHTML(normalizedBaseUrl, "正在打开网页..."), normalizedBaseUrl)
      const openPage = async () => {
        try {
          const loaded = await loadWebUrlWithFallback(webView, normalizedBaseUrl, normalizedBaseUrl)
          if (!loaded) throw new Error("页面加载失败")
          // 有已保存令牌则预置到 localStorage 免登录；没有则直接留在站点首页由用户手动登录
          if (credential) {
            await webView.evaluateJavaScript(`localStorage.setItem('auth_token', ${JSON.stringify(credential)}); true;`)
            await loadWebUrlWithFallback(webView, `${normalizedBaseUrl}/home`, normalizedBaseUrl)
          }
          await prepareWebLoginPage(webView, normalizedBaseUrl)
        } catch (e: any) {
          await webView.loadHTML(getWebViewLoadingHTML(normalizedBaseUrl, `网页打开失败：${getErrorMessage(e)}`), normalizedBaseUrl)
        }
      }
      setTimeout(() => { void openPage() }, 80)
      // 以原生工具栏模式呈现（右上角刷新按钮）
      await presentWebViewWithToolbar(webView, "网页签到后关闭页面")
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
        // 始终传入账号原始 baseUrl，flatten iframe 守卫依赖它判断当前 host
        setTimeout(() => prepareWebLoginPage(webView, normalizedBaseUrl), 300)
        setTimeout(() => prepareWebLoginPage(webView, normalizedBaseUrl), 1200)
        return true
      }
      return /^(about|data|blob):/i.test(url)
    }
    // 有已保存 Cookie 则预置免登录；没有则直接打开网页由用户手动登录
    if (cookieHeader) {
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
  if (!account.cookieKey) throw new Error("Cookie 存储键缺失，请重新保存账号")
  const { cookieHeader, authToken, storageSelf } = await getWebLoginCookie(account.baseUrl)
  if (isSub2ApiAccount(account)) {
    if (!authToken) throw new Error("未获取到 Sub2API auth_token")
    setSecret(account.cookieKey, authToken)
    const tempAccount: Account = { ...account, lastSelf: storageSelf }
    const self = await fetchSub2ApiSelf(tempAccount)
    patchAccount(account.id, { lastSelf: self, lastError: "", authSource: "web" })
    return self
  }
  setSecret(account.cookieKey, cookieHeader)

  const id = storageSelf?.id ?? account.lastSelf?.id
    if (!id) {
      patchAccount(account.id, { lastError: "Cookie 已保存，但未识别到用户 ID", authSource: "web" })
      throw new Error("Cookie 已保存，但未识别到用户 ID")
    }

  const tempAccount: Account = { ...account, lastSelf: { ...(account.lastSelf ?? {}), ...(storageSelf ?? {}), id } }
  const self = await apiRequest<SelfInfo>(tempAccount, "GET", "/api/user/self")
  patchAccount(account.id, { lastSelf: self, lastError: "", authSource: "web" })
  return self
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

// 获取用户信息（含自动重登录）
export async function fetchSelf(account: Account) {
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
  try {
    return await apiRequest<SelfInfo>(account, "GET", "/api/user/self")
  } catch (e: any) {
    if (isAuthExpiredError(e)) {
      await loginAccount(account)
      const latest = loadAccounts().find(a => a.id === account.id) ?? account
      return await apiRequest<SelfInfo>(latest, "GET", "/api/user/self")
    }
    throw e
  }
}

// 获取签到状态（根据平台分发，先验证登录状态再查询）
export async function fetchCheckinStatus(account: Account, month = localMonthString()) {
  // 验证登录状态，失效时自动重登，返回刷新后的账号
  const verified = await verifyLoginStatus(account)
  if (isSub2ApiAccount(verified)) return await fetchSub2ApiCheckinStatus(verified, month)
  const checkinPath = `/api/user/checkin?month=${encodeURIComponent(month)}`
  try {
    return await apiRequest<CheckinStatus>(verified, "GET", checkinPath)
  } catch (e: any) {
    // 校验通过但查询接口仍报登录失效：登录后重试一次
    if (!isAuthExpiredError(e)) throw e
    await loginAccount(verified)
    const latest = loadAccounts().find(a => a.id === account.id) ?? account
    return await apiRequest<CheckinStatus>(latest, "GET", checkinPath)
  }
}

// 检查账号登录状态是否有效（轻量验证，失效时自动重登，重登失败才抛错）
async function verifyLoginStatus(account: Account): Promise<Account> {
  // 重登后返回最新的账号数据
  const reload = () => loadAccounts().find(a => a.id === account.id) ?? account
  // 该账号是否可用账号密码重登（决定校验失败后能否无条件回退登录）
  const hasPassword = !!(account.username && getSecret(account.passwordKey))

  // 统一重登失败抛错
  const throwReloginFailed = (loginError: any) => {
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
      catch (loginError: any) { throw throwReloginFailed(loginError) }
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
    throw new Error("缺少 Cookie 或访问令牌")
  }
  try {
    await apiRequest<SelfInfo>(account, "GET", "/api/user/self")
    return account
  } catch (e: any) {
    // 校验失败：有账号密码则无条件重登（与详情页“登录”按钮一致，不依赖错误文案匹配）
    if (hasPassword) {
      // 清除已确认失效的访问令牌，避免重登后 apiRequest 仍优先使用旧令牌覆盖新生成的会话 Cookie
      if (accessToken && account.accessTokenKey) removeSecret(account.accessTokenKey)
      try { await loginAccount(account); return reload() }
      catch (loginError: any) { throw throwReloginFailed(loginError) }
    }
    // 无账号密码：仅在确认为登录失效时才重登（尝试用现有凭据重登）
    if (!isAuthExpiredError(e)) throw e
    try { await loginAccount(account); return reload() }
    catch (loginError: any) { throw throwReloginFailed(loginError) }
  }
}

// 执行签到（根据平台分发，先验证登录状态再签到）
export async function doCheckin(account: Account) {
  // 验证登录状态，失效时自动重登，返回刷新后的账号
  const verified = await verifyLoginStatus(account)
  if (isSub2ApiAccount(verified)) return await doSub2ApiCheckin(verified)
  try {
    return await apiRequest<any>(verified, "POST", "/api/user/checkin", {})
  } catch (e: any) {
    // 校验通过但签到接口仍报登录失效：登录后重试一次
    if (!isAuthExpiredError(e)) throw e
    await loginAccount(verified)
    const latest = loadAccounts().find(a => a.id === account.id) ?? account
    return await apiRequest<any>(latest, "POST", "/api/user/checkin", {})
  }
}
