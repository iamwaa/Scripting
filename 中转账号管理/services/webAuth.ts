// WebView 网页登录 / 签到：注入登录态、打开页面、关闭后回收会话
declare const fetch: any

import type { Account, SelfInfo, WebLoginCookieResult } from "../types"
import { isSub2ApiAccount, normalizeBaseUrl, shortUrl } from "../utils/format"
import { getErrorMessage } from "../utils/error"
import { cookiesToHeader, getUrlHostname, isHttpUrl, resolveWebUrl, escapeHTML, mergeCookies } from "../utils/cookie"
import { getSecret, patchAccount } from "./storage"
import { fetchSub2ApiSelf, apiRequest } from "./api"
import { presentWebViewWithToolbar } from "../components/WebViewPage"
import {
  buildNewApiLocalUser,
  buildSub2ApiAuthUser,
  injectWebCookies,
  injectNewApiLocalUser,
  injectSub2ApiLocalAuth,
  recycleNewApiWebSession,
  recycleSub2ApiWebSession,
} from "./webSession"

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

// 展示 WebView 并加载 URL；afterLoad 在页面加载后注入登录态等
export async function presentWebViewAndLoadURL(
  webView: WebViewController,
  url: string,
  options: {
    fullscreen?: boolean
    navigationTitle?: string
    afterLoad?: (webView: WebViewController) => Promise<void>
  } = {},
) {
  await webView.loadHTML(getWebViewLoadingHTML(url, "正在打开网页..."), url)
  const openPage = async () => {
    try {
      const loaded = await loadWebUrlWithFallback(webView, url, url)
      if (!loaded) throw new Error("页面加载失败")
      if (options.afterLoad) await options.afterLoad(webView)
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

// 从 storage 提取 Sub2API refresh_token（用于免 Turnstile 刷新 access_token）
export function extractSub2ApiRefreshToken(items: Record<string, string>) {
  for (const key of ["refresh_token", "refreshToken"]) {
    const value = items[key]
    if (value) return value
  }
  for (const raw of Object.values(items)) {
    try {
      const parsed = JSON.parse(raw)
      const token = parsed?.refresh_token || parsed?.refreshToken || parsed?.state?.refresh_token
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
    await installWebNavigationBridge(webView, normalizedBaseUrl)
    webView.shouldAllowRequest = async request => {
      const url = request.url || normalizedBaseUrl
      // 允许 http/https，同时允许站点内部跳转和 OAuth 回调
      if (isHttpUrl(url)) {
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
    const refreshToken = extractSub2ApiRefreshToken(storageItems)
    
    if (!cookieHeader && !authToken) throw new Error("未获取到 Cookie 或登录令牌")
    return { cookieHeader, authToken, refreshToken, storageSelf, pageTitle: capturedTitle }
  } finally {
    webView.dispose()
  }
}

// 解析网页签到实际打开地址：优先签到站点，否则回退原站点
function resolveManualCheckinOpenUrl(account: Account) {
  const checkinSite = normalizeBaseUrl(account.checkinSite || "")
  if (checkinSite) {
    if (!checkinSite.startsWith("http://") && !checkinSite.startsWith("https://")) {
      throw new Error("签到站点必须以 http:// 或 https:// 开头")
    }
    return checkinSite
  }
  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl) throw new Error("请先填写站点地址")
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }
  return baseUrl
}

// 只回收主站可发送的 Cookie，避免签到站点的同名 Cookie 覆盖主站登录态。
async function collectMainSiteCookies(webView: WebViewController, accountBaseUrl: string, oldCookie: string) {
  try {
    const cookies = await webView.getCookies(accountBaseUrl)
    return mergeCookies(oldCookie, undefined, cookies.map(cookie => ({ name: cookie.name, value: cookie.value })))
  } catch {
    return oldCookie
  }
}

async function withWebViewTimeout<T>(task: Promise<T>, seconds: number, message: string): Promise<T> {
  return await Promise.race([
    task,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), seconds * 1000)),
  ])
}

// 网页签到可能打开独立域名；关闭后只回收主站 Cookie，并让主站重新生成自己的 CF Cookie。
async function recycleNewApiCookiesAfterWebCheckin(webView: WebViewController, accountBaseUrl: string, openUrl: string) {
  if (openUrl !== accountBaseUrl) {
    try {
      await withWebViewTimeout(webView.loadURL(accountBaseUrl), 15, "主站页面加载超时")
      await new Promise<void>(resolve => setTimeout(resolve, 1200))
    } catch {}
  }
  return await collectMainSiteCookies(webView, accountBaseUrl, "")
}

// 打开网页签到 WebView
export async function openManualCheckinWebView(account: Account) {
  // 账号主站：用于登录态注入/回收 cookie 与 localStorage
  const accountBaseUrl = normalizeBaseUrl(account.baseUrl)
  if (!accountBaseUrl) throw new Error("请先填写站点地址")
  if (!accountBaseUrl.startsWith("http://") && !accountBaseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }
  // 实际打开地址：签到站点有内容则用签到站点，否则用原站点
  const openUrl = resolveManualCheckinOpenUrl(account)
  if (!account.cookieKey) throw new Error("Cookie 存储键缺失，请重新保存账号")
  // 允许在没有已保存凭据的情况下打开网页签到：让用户在 WebView 内自行登录并完成签到，
  // 关闭后再从 Cookie / localStorage 中回收最新的登录信息。
  const credential = getSecret(account.cookieKey)

  if (isSub2ApiAccount(account)) {
    // Sub2API 前端 isAuthenticated = auth_token && auth_user，两者都要注入
    const authUser = buildSub2ApiAuthUser(account)
    const webView = new WebViewController()
    try {
      await installWebNavigationBridge(webView, accountBaseUrl)
      webView.shouldAllowRequest = async request => {
        const url = request.url || openUrl
        if (isHttpUrl(url)) {
          setTimeout(() => prepareWebLoginPage(webView, accountBaseUrl), 300)
          return true
        }
        return /^(about|data|blob):/i.test(url)
      }
      await webView.loadHTML(getWebViewLoadingHTML(openUrl, "正在打开网页..."), openUrl)
      const openPage = async () => {
        try {
          const loaded = await loadWebUrlWithFallback(webView, openUrl, accountBaseUrl)
          if (!loaded) throw new Error("页面加载失败")
          // 有已保存令牌则预置 auth_token(+auth_user) 免登录；没有则由用户手动登录
          if (credential) {
            await injectSub2ApiLocalAuth(webView, credential, authUser)
            // 注入登录态后仍回到签到打开地址；未单独配置签到站点时保持原 /home 行为
            const nextUrl = openUrl === accountBaseUrl ? `${accountBaseUrl}/home` : openUrl
            await loadWebUrlWithFallback(webView, nextUrl, accountBaseUrl)
          }
          await prepareWebLoginPage(webView, accountBaseUrl)
        } catch (e: any) {
          await webView.loadHTML(getWebViewLoadingHTML(openUrl, `网页打开失败：${getErrorMessage(e)}`), openUrl)
        }
      }
      setTimeout(() => { void openPage() }, 80)
      // 以原生工具栏模式呈现（右上角刷新按钮）
      await presentWebViewWithToolbar(webView, "网页签到后关闭页面")
      // 关闭后回收最新 auth_token，并在有 auth_user 时回写 lastSelf
      try {
        const storage = await readWebLoginStorage(webView)
        const storageItems = {
          ...(storage.localStorage ?? {}),
          ...(storage.sessionStorage ?? {}),
        }
        recycleSub2ApiWebSession(
          account,
          extractSub2ApiToken(storageItems),
          credential,
          extractSelfInfoFromStorage(storageItems),
          extractSub2ApiRefreshToken(storageItems),
        )
      } catch {}
    } finally {
      webView.dispose()
    }
    return
  }

  // new-api：同时注入 cookie + localStorage.user，关闭后用最新会话覆盖旧凭据
  const cookieHeader = credential
  const hostname = getUrlHostname(accountBaseUrl)
  const secure = accountBaseUrl.startsWith("https://")
  const localUser = buildNewApiLocalUser(account)
  const webView = new WebViewController()
  try {
    await installWebNavigationBridge(webView, accountBaseUrl)
    webView.shouldAllowRequest = async request => {
      const url = request.url || openUrl
      if (isHttpUrl(url)) {
        setTimeout(() => prepareWebLoginPage(webView, accountBaseUrl), 300)
        setTimeout(() => prepareWebLoginPage(webView, accountBaseUrl), 1200)
        return true
      }
      return /^(about|data|blob):/i.test(url)
    }
    // 有已保存 Cookie 则预置；没有则打开网页由用户手动登录，关闭后再回收
    if (cookieHeader) await injectWebCookies(webView, hostname, cookieHeader, secure)
    await presentWebViewAndLoadURL(webView, openUrl, {
      fullscreen: true,
      navigationTitle: "网页签到后关闭页面",
      afterLoad: async controller => {
        // 页面同域加载后再写 localStorage.user，否则前端仍判未登录
        if (localUser) await injectNewApiLocalUser(controller, localUser)
      },
    })

    // 关闭后：新 cookie 直接替换旧值；同时回收 localStorage.user 中的用户信息
    try {
      const cookieHeader = await recycleNewApiCookiesAfterWebCheckin(webView, accountBaseUrl, openUrl)
      const storage = await readWebLoginStorage(webView)
      const storageItems = {
        ...(storage.localStorage ?? {}),
        ...(storage.sessionStorage ?? {}),
      }
      const storageSelf = extractSelfInfoFromStorage(storageItems)
      recycleNewApiWebSession(account, cookieHeader, storageSelf)
    } catch {}
  } finally {
    webView.dispose()
  }
}

// 网页登录完整流程
export async function loginByWebView(account: Account) {
  if (!account.cookieKey) throw new Error("Cookie 存储键缺失，请重新保存账号")
  const { cookieHeader, authToken, refreshToken, storageSelf } = await getWebLoginCookie(account.baseUrl)
  if (isSub2ApiAccount(account)) {
    if (!authToken) throw new Error("未获取到 Sub2API auth_token")
    // 网页登录拿到的新令牌覆盖旧凭据；storage 有用户信息时先回写 lastSelf
    recycleSub2ApiWebSession(account, authToken, "", storageSelf, refreshToken)
    const tempAccount: Account = { ...account, lastSelf: storageSelf ?? account.lastSelf }
    const self = await fetchSub2ApiSelf(tempAccount)
    patchAccount(account.id, { lastSelf: self, lastError: "", authSource: "web" })
    return self
  }
  // 网页登录拿到的新 cookie 保存为 Cloudflare / 会话辅助凭据，不覆盖长期访问令牌
  recycleNewApiWebSession(account, cookieHeader, storageSelf)

  const id = storageSelf?.id ?? account.lastSelf?.id
  if (!id) {
    patchAccount(account.id, { lastError: "Cookie 已保存，但未识别到用户 ID" })
    throw new Error("Cookie 已保存，但未识别到用户 ID")
  }

  const tempAccount: Account = { ...account, lastSelf: { ...(account.lastSelf ?? {}), ...(storageSelf ?? {}), id } }
  const self = await apiRequest<SelfInfo>(tempAccount, "GET", "/api/user/self")
  patchAccount(account.id, { lastSelf: self, lastError: "", authSource: getSecret(account.accessTokenKey) ? "accessToken" : "web" })
  return self
}

