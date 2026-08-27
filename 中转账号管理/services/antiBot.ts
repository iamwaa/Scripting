import type { Account } from "../types"
import { normalizeBaseUrl } from "../utils/format"
import { cookiesToHeader, getUrlHostname, parseCookieHeader } from "../utils/cookie"
import { getSecret, setSecret } from "./storage"
import { injectWebCookies } from "./webSession"
import { presentWebViewWithToolbar } from "../components/WebViewPage"

export function isWebChallengeResponse(response: any, raw: string) {
  const header = (name: string) => {
    try {
      if (typeof response?.headers?.get === "function") return response.headers.get(name) ?? response.headers.get(name.toLowerCase()) ?? ""
      if (response?.headers && typeof response.headers === "object") return response.headers[name] ?? response.headers[name.toLowerCase()] ?? ""
    } catch {}
    return ""
  }
  const tengineError = header("x-tengine-error")
  const setCookie = header("set-cookie")
  const cfMitigated = header("cf-mitigated")
  return (
    /acw_sc__v2|arg1=|document\[[^\]]+\]\[[^\]]+\]\(\)/i.test(raw) ||
    /just a moment|challenge-platform|_cf_chl_opt/i.test(raw) ||
    /challenge/i.test(cfMitigated) ||
    /denied by http_custom/i.test(tengineError) ||
    /\b(acw_tc|cdn_sec_tc|cf_clearance)=/i.test(setCookie)
  )
}

function mergeCookieHeaders(...headers: string[]) {
  const jar: Record<string, string> = {}
  for (const header of headers) {
    for (const cookie of parseCookieHeader(header)) {
      jar[cookie.name] = cookie.value
    }
  }
  return Object.entries(jar).map(([name, value]) => `${name}=${value}`).join("; ")
}

export async function collectWebViewCookieHeader(webView: WebViewController, baseUrl: string, oldCookie = "") {
  const nativeCookie = cookiesToHeader(await webView.getCookies(baseUrl))
  let documentCookie = ""
  try {
    const value = await webView.evaluateJavaScript("return document.cookie")
    if (typeof value === "string") documentCookie = value
  } catch {}
  return mergeCookieHeaders(oldCookie, nativeCookie, documentCookie)
}

function getChallengeClearance(cookieHeader: string) {
  return parseCookieHeader(cookieHeader)
    .filter(cookie => /^(acw_sc__v2|cf_clearance)$/i.test(cookie.name))
    .map(cookie => `${cookie.name.toLowerCase()}=${cookie.value}`)
    .sort()
    .join("; ")
}

async function waitForWebChallengeCookie(webView: WebViewController, baseUrl: string, oldCookie: string) {
  const oldClearance = getChallengeClearance(oldCookie)
  let latest = oldCookie
  for (let i = 0; i < 12; i++) {
    latest = await collectWebViewCookieHeader(webView, baseUrl, oldCookie)
    const latestClearance = getChallengeClearance(latest)
    if (latestClearance && latestClearance !== oldClearance) return latest
    await new Promise<void>(resolve => setTimeout(resolve, 500))
  }
  return latest
}

export type WebViewApiResult = {
  status: number
  ok: boolean
  raw: string
}

function withTimeout<T>(task: Promise<T>, seconds: number, message: string): Promise<T> {
  return Promise.race([
    task,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), seconds * 1000)),
  ])
}

export async function requestApiThroughVerifiedWebViewImpl(
  account: Account,
  method: string,
  path: string,
  body: any,
  headers: Record<string, string>,
): Promise<WebViewApiResult> {
  const baseUrl = normalizeBaseUrl(account.baseUrl)
  const webView = new WebViewController()
  try {
    const cookie = getSecret(account.cookieKey)
    if (cookie) {
      await injectWebCookies(webView, getUrlHostname(baseUrl), cookie, baseUrl.startsWith("https://"))
    }
    await withTimeout(webView.loadURL(baseUrl), 20, "主站页面加载超时")
    let needsVerification = false
    try {
      const pageState = await webView.evaluateJavaScript<{ title: string, html: string }>(`
        return {
          title: document.title || '',
          html: document.documentElement?.outerHTML?.slice(0, 5000) || ''
        };
      `)
      needsVerification = /请稍候|just a moment|安全验证|challenge-platform|_cf_chl_opt/i.test(`${pageState?.title ?? ""}\n${pageState?.html ?? ""}`)
    } catch {
      needsVerification = true
    }
    if (needsVerification) {
      await presentWebViewWithToolbar(webView, "完成安全验证后关闭页面")
    }

    // Cookie、Origin 等受保护请求头由 WebView 自行生成，只传业务所需头。
    const browserHeaders = Object.fromEntries(
      Object.entries(headers).filter(([name]) => !/^(cookie|origin|referer|sec-fetch-|accept-encoding$)/i.test(name)),
    )
    const result = await withTimeout(webView.evaluateJavaScript<WebViewApiResult>(`
      return fetch(${JSON.stringify(`${baseUrl}${path}`)}, {
        method: ${JSON.stringify(method)},
        headers: ${JSON.stringify(browserHeaders)},
        body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))},
        credentials: 'include'
      }).then(function(response) {
        return response.text().then(function(raw) {
          return { status: response.status, ok: response.ok, raw: raw }
        })
      });
    `), 25, "主站数据请求超时")
    const merged = await collectWebViewCookieHeader(webView, baseUrl, cookie)
    if (merged && account.cookieKey) setSecret(account.cookieKey, merged)
    return result
  } finally {
    webView.dispose()
  }
}

let verifiedWebViewQueues: Record<string, Promise<unknown>> = {}

export function requestApiThroughVerifiedWebView(
  account: Account,
  method: string,
  path: string,
  body: any,
  headers: Record<string, string>,
) {
  const key = account.id
  const previous = verifiedWebViewQueues[key] ?? Promise.resolve()
  const task = previous
    .catch(() => undefined)
    .then(() => requestApiThroughVerifiedWebViewImpl(account, method, path, body, headers))
  verifiedWebViewQueues[key] = task
  return task.finally(() => {
    if (verifiedWebViewQueues[key] === task) delete verifiedWebViewQueues[key]
  })
}

let challengeRefreshTask: Promise<string> | undefined

async function runWebChallengeRefresh(account: Account) {
  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) return ""

  const webView = new WebViewController()
  try {
    const cookie = getSecret(account.cookieKey)
    if (cookie) {
      await injectWebCookies(webView, getUrlHostname(baseUrl), cookie, baseUrl.startsWith("https://"))
    }
    await webView.loadURL(baseUrl)
    const merged = await waitForWebChallengeCookie(webView, baseUrl, cookie)
    if (!getChallengeClearance(merged) || getChallengeClearance(merged) === getChallengeClearance(cookie)) {
      throw new Error("未获取到防护 Cookie，请先用网页登录获取 Cookie 后再试")
    }
    if (merged && account.cookieKey) setSecret(account.cookieKey, merged)
    return merged
  } finally {
    webView.dispose()
  }
}

export async function refreshWebChallengeCookies(account: Account) {
  if (!challengeRefreshTask) {
    challengeRefreshTask = runWebChallengeRefresh(account).finally(() => {
      challengeRefreshTask = undefined
    })
  }
  return await challengeRefreshTask
}
