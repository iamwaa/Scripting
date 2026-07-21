import type { Account } from "../types"
import { UA } from "../constants"
import { normalizeBaseUrl } from "../utils/format"
import { cookiesToHeader, getUrlHostname, parseCookieHeader } from "../utils/cookie"
import { getSecret, setSecret } from "./storage"
import { injectWebCookies } from "./webSession"

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
  return (
    /acw_sc__v2|arg1=|document\[[^\]]+\]\[[^\]]+\]\(\)/i.test(raw) ||
    /denied by http_custom/i.test(tengineError) ||
    /\b(acw_tc|cdn_sec_tc)=/i.test(setCookie)
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

async function waitForWebChallengeCookie(webView: WebViewController, baseUrl: string, oldCookie: string) {
  let latest = oldCookie
  for (let i = 0; i < 12; i++) {
    latest = await collectWebViewCookieHeader(webView, baseUrl, oldCookie)
    if (/\bacw_sc__v2=/i.test(latest)) return latest
    await new Promise<void>(resolve => setTimeout(resolve, 500))
  }
  return latest
}

let challengeRefreshTask: Promise<string> | undefined

async function runWebChallengeRefresh(account: Account) {
  const baseUrl = normalizeBaseUrl(account.baseUrl)
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) return ""

  const webView = new WebViewController()
  try {
    try { webView.setCustomUserAgent(UA) } catch {}
    const cookie = getSecret(account.cookieKey)
    if (cookie) {
      await injectWebCookies(webView, getUrlHostname(baseUrl), cookie, baseUrl.startsWith("https://"))
    }
    await webView.loadURL(baseUrl)
    const merged = await waitForWebChallengeCookie(webView, baseUrl, cookie)
    if (!/\bacw_sc__v2=/i.test(merged)) {
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
