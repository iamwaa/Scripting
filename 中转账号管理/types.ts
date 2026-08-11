// 中转账号管理 - 类型定义

export type SelfInfo = {
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

export type AccountPlatform = "newapi" | "sub2api"

export type CheckinRecord = {
  checkin_date?: string
  quota_awarded?: number
}

export type CheckinStats = {
  total_quota?: number
  total_checkins?: number
  checkin_count?: number
  records?: CheckinRecord[]
}

// 签到状态（含部分二开站点扩展的 PoW 签到字段）
export type CheckinStatus = {
  enabled?: boolean
  min_quota?: number
  max_quota?: number
  stats?: CheckinStats
  // 二开 new-api（如 huaibao.top）启用的签到签名挑战字段：
  // checkin_nonce 为当日 nonce，nonce_date 标记其归属日期，签到 POST 需据此计算签名头
  checkin_nonce?: string
  nonce_date?: string
}

export type SiteStatus = {
  state: "online" | "warning" | "offline"
  statusCode?: number
  message?: string
  checkedAt: number
  latencyMs?: number
}

export type Account = {
  id: string
  name: string
  baseUrl: string
  // 可选：网页签到单独打开的站点；为空时网页签到仍打开 baseUrl
  checkinSite?: string
  platform?: AccountPlatform
  username?: string
  passwordKey?: string
  cookieKey?: string
  accessTokenKey?: string
  // Sub2API JWT 刷新令牌存储键：用它调 /auth/refresh 换新 access_token，避开登录时的 Turnstile
  refreshTokenKey?: string
  checkinTime?: string
  updatedAt: number
  lastSelf?: SelfInfo
  lastCheckin?: CheckinStatus
  lastTodayCheckin?: CheckinRecord
  lastTodayCheckinDate?: string
  // 本地记录的签到奖励（日期 -> 金额美元），仅用于无签到历史接口的旧版 sub2api 站点补充月历金额
  checkinRewards?: Record<string, number>
  lastError?: string
  lastSiteStatus?: SiteStatus
  authSource?: "password" | "web" | "cookie" | "accessToken"
  excludeFromBatchCheckin?: boolean
}

export type AccountDraft = {
  id?: string
  name: string
  baseUrl: string
  checkinSite: string
  platform?: AccountPlatform
  username: string
  password: string
  cookie: string
  accessToken: string
  checkinTime: string
  lastSelf?: SelfInfo
  authSource?: Account["authSource"]
}

export type AccountSortKey = "name" | "platform" | "quota" | "checkin"
export type SortDirection = "asc" | "desc"

export type AccountSortPreference = {
  key: AccountSortKey
  direction: SortDirection
}

export type ApiJson<T = any> = {
  success?: boolean
  message?: string
  data?: T
}

export type ApiResult<T = any> = {
  data: T
  cookie?: string
}

export type WebLoginCookieResult = {
  cookieHeader: string
  authToken?: string
  refreshToken?: string
  storageSelf?: SelfInfo
  pageTitle?: string
}
