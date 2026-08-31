// WebView 页内取数：在 WebView 会话仍存活时用页面上下文 fetch 取数。
// 部分站点的会话 Cookie（尤其 cf_clearance）绑定 WebView 的 UA/IP，关页后导出的 Cookie
// 交给原生 fetch 已失效；页内 fetch 由浏览器自动携带完整 Cookie jar，可绕开该问题。
import type { Account, ApiJson, CheckinStatus, SelfInfo } from "../types"
import { localMonthString } from "../utils/format"

// 网页签到关闭后的页内预查结果：缺失的字段由调用方回退到原生请求
export type ManualCheckinRefresh = {
  self?: SelfInfo
  checkin?: CheckinStatus
}

// 页内单个请求的原始结果
type PageFetchResult = {
  status: number
  raw: string
  failed?: boolean
}

type PageRefreshResult = {
  self?: PageFetchResult
  checkin?: PageFetchResult
}

function withTimeout<T>(task: Promise<T>, seconds: number, message: string): Promise<T> {
  return Promise.race([
    task,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), seconds * 1000)),
  ])
}

function safeOrigin(url: string) {
  const match = /^https?:\/\/[^/?#]+/i.exec(url)
  return match ? match[0] : ""
}

// 页内 fetch 要求文档与接口同源，且当前文档必须是真正从站点加载的页面：
// 加载失败时页面会停在 loadHTML 写入的占位页（location 仍是站点地址但没有会话上下文），此时页内请求会直接 Load failed
async function ensurePageReady(webView: WebViewController, baseUrl: string) {
  const script = `
    return {
      origin: location.origin || '',
      placeholder: !!(document.documentElement && document.documentElement.getAttribute('data-newapi-placeholder'))
    };
  `
  const expected = safeOrigin(baseUrl)
  if (!expected) return false
  const isReady = async () => {
    try {
      const state = await withTimeout(
        webView.evaluateJavaScript<{ origin: string, placeholder: boolean }>(script),
        10,
        "页面状态读取超时",
      )
      return !!state && state.origin === expected && !state.placeholder
    } catch {
      return false
    }
  }
  if (await isReady()) return true
  // 停在占位页或其他域（如独立签到站）时重新加载主站后再判一次
  try {
    await withTimeout(webView.loadURL(baseUrl), 15, "主站页面加载超时")
    await new Promise<void>(resolve => setTimeout(resolve, 800))
  } catch {
    return false
  }
  return await isReady()
}

// 解析页内响应：new-api 统一为 { success, message, data }，任何异常都视为预查失败并交由调用方降级
function parsePageJson<T>(result: PageFetchResult | undefined): T | undefined {
  if (!result || result.failed || !result.raw) return undefined
  let json: ApiJson<T>
  try {
    json = JSON.parse(result.raw)
  } catch {
    return undefined
  }
  if (json.success !== true) return undefined
  return json.data as T
}

// 在页面上下文并发请求余额与签到状态：
// New-Api-User 头优先取页面 localStorage.user 的 id，缺失时用本地缓存的用户 ID 兜底
function buildPageRefreshScript(selfUrl: string, checkinUrl: string, fallbackUserId: string) {
  return `
    return (async function () {
      let userId = ${JSON.stringify(fallbackUserId)};
      try {
        const stored = JSON.parse(localStorage.getItem('user') || 'null');
        if (stored && stored.id) userId = String(stored.id);
      } catch (e) {}
      const headers = { 'Accept': 'application/json, text/plain, */*' };
      if (userId) headers['New-Api-User'] = String(userId);
      const request = async (url) => {
        try {
          const response = await fetch(url, { method: 'GET', headers: headers, credentials: 'include' });
          const raw = await response.text();
          return { status: response.status, raw: raw };
        } catch (e) {
          return { status: 0, raw: '', failed: true };
        }
      };
      const results = await Promise.all([
        request(${JSON.stringify(selfUrl)}),
        request(${JSON.stringify(checkinUrl)}),
      ]);
      return { self: results[0], checkin: results[1] };
    })();
  `
}

// 关闭网页后、dispose 之前在页内刷新余额与签到状态
export async function refreshNewApiDataInWebView(
  webView: WebViewController,
  account: Account,
  baseUrl: string,
  month = localMonthString(),
): Promise<ManualCheckinRefresh | undefined> {
  if (!(await ensurePageReady(webView, baseUrl))) return undefined
  const script = buildPageRefreshScript(
    `${baseUrl}/api/user/self`,
    `${baseUrl}/api/user/checkin?month=${encodeURIComponent(month)}`,
    account.lastSelf?.id ? String(account.lastSelf.id) : "",
  )
  let result: PageRefreshResult
  try {
    result = await withTimeout(webView.evaluateJavaScript<PageRefreshResult>(script), 30, "页内数据请求超时")
  } catch {
    return undefined
  }

  const refresh: ManualCheckinRefresh = {}
  const self = parsePageJson<SelfInfo>(result?.self)
  if (self?.id) refresh.self = self
  const checkin = parsePageJson<CheckinStatus>(result?.checkin)
  if (checkin) refresh.checkin = checkin
  return refresh
}
