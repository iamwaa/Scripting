// WebView 会话注入 / 回收
// new-api: cookie + localStorage.user
// Sub2API: localStorage.auth_token + localStorage.auth_user（前端 isAuthenticated 要求两者都在）
import type { Account, SelfInfo } from "../types"
import { parseCookieHeader } from "../utils/cookie"
import { getSecret, setSecret, patchAccount, getRefreshTokenKey } from "./storage"

// 构造 new-api 前端 localStorage.user 对象
export function buildNewApiLocalUser(account: Account): Record<string, any> | undefined {
  const self = account.lastSelf
  if (!self?.id) return undefined
  const user: Record<string, any> = { ...self }
  const accessToken = getSecret(account.accessTokenKey)
  // 有访问令牌时一并写入，前端可用 Authorization: Bearer
  if (accessToken && !user.token) user.token = accessToken
  return user
}

// 构造 Sub2API 前端 localStorage.auth_user（见 Wei-Shaw/sub2api stores/auth.ts）
export function buildSub2ApiAuthUser(account: Account): Record<string, any> | undefined {
  const self = account.lastSelf
  if (!self?.id && !self?.username && !self?.email) return undefined
  // 尽量按 Sub2API User 字段回填；缺的字段由前端 refreshUser 补齐
  return {
    id: self.id,
    username: self.username,
    display_name: self.display_name || self.username,
    email: self.email,
    role: self.group,
    status: self.status,
    balance: self.balance,
    concurrency: self.concurrency,
  }
}

// 向 WebView 注入 session cookie（同时写 host 与 .host，提高命中率）
export async function injectWebCookies(
  webView: WebViewController,
  hostname: string,
  cookieHeader: string,
  secure: boolean,
) {
  if (!cookieHeader.trim() || !hostname) return
  const expiresDate = new Date(Date.now() + 30 * 24 * 3600 * 1000)
  for (const cookie of parseCookieHeader(cookieHeader)) {
    for (const domain of [hostname, `.${hostname}`]) {
      try {
        await webView.setCookie({
          name: cookie.name,
          value: cookie.value,
          domain,
          path: "/",
          isSecure: secure,
          isHTTPOnly: true,
          isSessionOnly: false,
          expiresDate,
        })
      } catch {}
    }
  }
}

// 注入 new-api localStorage.user，供前端生成 New-API-User 请求头与路由守卫
export async function injectNewApiLocalUser(webView: WebViewController, user: Record<string, any> | undefined) {
  if (!user?.id) return false
  const script = `
    try {
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
      return true;
    } catch (e) {
      return false;
    }
  `
  try {
    return !!(await webView.evaluateJavaScript(script))
  } catch {
    return false
  }
}

// 注入 Sub2API 登录态：auth_token 必写；有用户缓存时同步写 auth_user
// 前端 checkAuth 要求 savedToken && savedUser 才算已登录
export async function injectSub2ApiLocalAuth(
  webView: WebViewController,
  authToken: string,
  authUser?: Record<string, any>,
) {
  if (!authToken.trim()) return false
  const script = `
    try {
      localStorage.setItem('auth_token', ${JSON.stringify(authToken)});
      ${authUser ? `localStorage.setItem('auth_user', ${JSON.stringify(JSON.stringify(authUser))});` : ""}
      return true;
    } catch (e) {
      return false;
    }
  `
  try {
    return !!(await webView.evaluateJavaScript(script))
  } catch {
    return false
  }
}

// 关闭网页后回收 new-api 会话：新 cookie 直接替换旧值，并回写用户信息
export function recycleNewApiWebSession(account: Account, cookieHeader: string, storageSelf?: SelfInfo) {
  if (!account.cookieKey) return
  // 直接用 WebView 最新 cookie 覆盖，避免 merge 保留失效旧值
  if (cookieHeader.trim()) setSecret(account.cookieKey, cookieHeader)

  const patch: Partial<Account> = {}
  if (cookieHeader.trim() || storageSelf) patch.authSource = "web"
  if (storageSelf?.id) {
    patch.lastSelf = { ...(account.lastSelf ?? {}), ...storageSelf }
    patch.lastError = ""
  } else if (cookieHeader.trim()) {
    // 只有 cookie 时也清空临时错误，让后续接口刷新
    patch.lastError = ""
  }
  if (Object.keys(patch).length) patchAccount(account.id, patch)
}

// 关闭网页后回收 Sub2API 令牌，并在有 storage 用户信息时回写 lastSelf
export function recycleSub2ApiWebSession(
  account: Account,
  authToken: string | undefined,
  previousToken: string,
  storageSelf?: SelfInfo,
  refreshToken?: string,
) {
  if (!account.cookieKey) return
  if (authToken && authToken !== previousToken) setSecret(account.cookieKey, authToken)
  // 网页登录抽到的 refresh_token 一并存下，后续签到用它换新 access_token
  if (refreshToken) setSecret(getRefreshTokenKey(account), refreshToken)

  const patch: Partial<Account> = {}
  if (authToken || storageSelf) {
    patch.authSource = "web"
    patch.lastError = ""
  }
  if (storageSelf?.id || storageSelf?.username || storageSelf?.email) {
    patch.lastSelf = { ...(account.lastSelf ?? {}), ...storageSelf }
  }
  if (Object.keys(patch).length) patchAccount(account.id, patch)
}
