declare const fetch: any

import type { AccountPlatform } from "../types"
import { normalizeBaseUrl } from "../utils/format"

// 站点地址关键字 → 平台：域名里带品牌名的站点直接命中（前缀要求非字母，避免 done-api 命中 one-api）
const URL_HINTS: Array<[RegExp, AccountPlatform]> = [
  [/done-?hub/i, "donehub"],
  [/one-?hub/i, "onehub"],
  [/veloera/i, "veloera"],
  [/sub2api/i, "sub2api"],
  [/(^|[^a-z])one-?api/i, "oneapi"],
  [/(^|[^a-z])new-?api/i, "newapi"],
]

// 读取 JSON，失败统一返回 undefined（探测阶段不抛错）
async function fetchJson(url: string): Promise<any> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json, text/plain, */*" },
      allowInsecureRequest: url.startsWith("http://"),
      timeout: 12,
    } as any)
    const raw = await response.text()
    if (!raw) return undefined
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  } catch {
    return undefined
  }
}

// 按 /api/status 的字段特征区分 NewAPI 系分支（各分支在 one-api 基础上新增的字段不同）
function matchStatusPlatform(status: Record<string, any>): AccountPlatform | undefined {
  const brand = `${status.system_name ?? ""} ${status.version ?? ""}`.toLowerCase()
  if (brand.includes("veloera")) return "veloera"
  if (brand.replace(/-/g, "").includes("donehub")) return "donehub"
  if (brand.replace(/-/g, "").includes("onehub")) return "onehub"

  const has = (...keys: string[]) => keys.some(key => key in status)
  // done-hub：聊天入口与飞书 / LinuxDO 登录字段
  if (has("chat_links", "linuxDo_oauth", "lark_login")) return "donehub"
  // new-api：初始化、内置聊天与额度展示字段
  if (has("setup", "chats", "quota_display_type", "checkin_enabled")) return "newapi"
  // one-api 系：OIDC 与充值链接字段（one-hub 同源，无法再细分时归为 one-api）
  if (has("oidc_well_known", "oidc_token_endpoint", "lark_client_id", "top_up_link", "chat_link")) return "oneapi"
  return undefined
}

// 探测站点平台类型：站点地址关键字 → /api/status 字段特征 → Sub2API 接口探测
export async function detectPlatform(baseUrl: string): Promise<AccountPlatform | undefined> {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  const hint = URL_HINTS.find(([pattern]) => pattern.test(normalized))
  if (hint) return hint[1]

  const status = await fetchJson(`${normalized}/api/status`)
  const data = status?.data
  if (data && typeof data === "object") {
    const matched = matchStatusPlatform(data)
    if (matched) return matched
    // 有 /api/status 信封但认不出分支：按覆盖面最广的 NewAPI 处理
    if (status?.success === true) return "newapi"
  }

  // Sub2API：未登录访问 /api/v1/auth/me 会返回 { code, message } 信封（NewAPI 系用 success 字段）
  const me = await fetchJson(`${normalized}/api/v1/auth/me`)
  if (me && typeof me === "object" && "code" in me && !("success" in me)) return "sub2api"
  return undefined
}
