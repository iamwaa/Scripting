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

export type CheckinStatus = {
  enabled?: boolean
  min_quota?: number
  max_quota?: number
  stats?: CheckinStats
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
  platform?: AccountPlatform
  username?: string
  passwordKey?: string
  cookieKey?: string
  accessTokenKey?: string
  checkinTime?: string
  updatedAt: number
  lastSelf?: SelfInfo
  lastCheckin?: CheckinStatus
  lastTodayCheckin?: CheckinRecord
  lastTodayCheckinDate?: string
  lastError?: string
  lastSiteStatus?: SiteStatus
  authSource?: "password" | "web" | "cookie" | "accessToken"
  excludeFromBatchCheckin?: boolean
}

export type AccountDraft = {
  id?: string
  name: string
  baseUrl: string
  platform?: AccountPlatform
  username: string
  password: string
  cookie: string
  accessToken: string
  accessTokenUserId: string
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
  storageSelf?: SelfInfo
  pageTitle?: string
}
