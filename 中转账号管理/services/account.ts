import type { Account, AccountDraft, SelfInfo, SiteStatus, CheckinRecord, CheckinStatus, AccountSortKey, SortDirection, AccountSortPreference } from "../types"
import { isSub2ApiAccount, getAccountTypeText, isRecordOnlyAccount, localDateString, getSelfQuotaValue, getCheckinRecordMap, sumCheckinAwards, uid, now, normalizeBaseUrl } from "../utils/format"
import { getErrorMessage, CHECKIN_DISABLED_PATTERN, isAlreadyCheckedInError } from "../utils/error"
import { loadAccounts, saveAccounts, setSecret, removeSecret, secretKey, getSecret, patchAccount } from "./storage"
import { removeAccountSecrets } from "./api"
import { fetchSelf, fetchCheckinStatus, doCheckin } from "./auth"

// 参与首页操作的账号：归档账号不计入总览，也不参与批量与自动操作
export function getActiveAccounts(accounts: Account[]) {
  return accounts.filter(account => !account.archived)
}

// 参与接口操作（余额查询 / 接口签到）的账号：排除归档与仅记录账号
export function getApiOperableAccounts(accounts: Account[]) {
  return accounts.filter(account => !account.archived && !isRecordOnlyAccount(account))
}

// 查找站点地址重复的账号：按规范化后的地址忽略大小写比较，排除自身
export function findDuplicateSiteAccounts(accounts: Account[], baseUrl: string, excludeId?: string) {
  const target = normalizeBaseUrl(baseUrl).toLowerCase()
  if (!target) return []
  return accounts.filter(account => account.id !== excludeId && normalizeBaseUrl(account.baseUrl).toLowerCase() === target)
}

// 认证来源文本
export function getAuthSourceText(account: Account) {
  if (isRecordOnlyAccount(account)) return "无需登录"
  if (account.authSource === "password") return "账号"
  if (account.authSource === "web") return "网页"
  if (account.authSource === "cookie") return "Cookie"
  if (account.authSource === "accessToken") return "令牌"
  if (getSecret(account.cookieKey)) return "Cookie"
  if (getSecret(account.accessTokenKey)) return "令牌"
  if (account.username && getSecret(account.passwordKey)) return "账号"
  return "未配置"
}

// 站点状态视图数据
export function getSiteStatusView(account: Account) {
  const status = account.lastSiteStatus
  if (!status) {
    return { color: "systemGray", text: "未检测", icon: "network" }
  }
  if (status.state === "online") {
    return { color: "systemGreen", text: "在线", icon: "server.rack" }
  }
  if (status.state === "warning") {
    return {
      color: "systemOrange",
      text: status.statusCode ? `HTTP ${status.statusCode}` : "异常",
      icon: "exclamationmark.triangle.fill",
    }
  }
  return { color: "systemRed", text: "离线", icon: "network.slash" }
}

// 站点状态详情文本
export function getSiteStatusDetail(status?: SiteStatus) {
  if (!status) return "站点状态：未检测"
  const time = new Date(status.checkedAt * 1000).toLocaleTimeString()
  const latency = status.latencyMs !== undefined ? `，${status.latencyMs}ms` : ""
  return `${status.message ?? "站点状态已更新"}${latency}，${time}`
}

// 延迟文本
export function getSiteStatusLatencyText(status?: SiteStatus) {
  if (!status || status.state !== "online") return ""
  return status.latencyMs !== undefined ? `${status.latencyMs}ms` : ""
}

// 延迟颜色
export function getSiteStatusLatencyColor(status?: SiteStatus) {
  if (!status) return "secondaryLabel"
  if (status.state === "offline") return "systemRed"
  const latency = status.latencyMs
  if (latency === undefined) return "secondaryLabel"
  if (latency < 300) return "systemGreen"
  if (latency <= 800) return "systemOrange"
  return "systemRed"
}

// 构建离线状态对象
export function getOfflineSiteStatus(e: any): SiteStatus {
  return {
    state: "offline",
    message: getErrorMessage(e),
    checkedAt: now(),
  }
}

// 账户创建/更新
export function upsertAccount(draft: AccountDraft) {
  const accounts = loadAccounts()
  const id = draft.id || uid()
  const idx = accounts.findIndex(a => a.id === id)
  const prev = idx >= 0 ? accounts[idx] : undefined
  const passwordKey = prev?.passwordKey ?? secretKey(id, "password")
  const cookieKey = prev?.cookieKey ?? secretKey(id, "cookie")
  const accessTokenKey = prev?.accessTokenKey ?? secretKey(id, "accessToken")
  const refreshTokenKey = prev?.refreshTokenKey ?? secretKey(id, "refreshToken")

  const checkinSite = normalizeBaseUrl(draft.checkinSite)
  if (checkinSite && !checkinSite.startsWith("http://") && !checkinSite.startsWith("https://")) {
    throw new Error("签到站点必须以 http:// 或 https:// 开头")
  }

  const account: Account = {
    ...(prev ?? {} as Account),
    id,
    name: draft.name.trim(),
    baseUrl: normalizeBaseUrl(draft.baseUrl),
    checkinSite: checkinSite || undefined,
    platform: draft.platform ?? prev?.platform ?? "newapi",
    username: draft.username.trim() || undefined,
    passwordKey,
    cookieKey,
    accessTokenKey,
    refreshTokenKey,
    checkinTime: draft.checkinTime.trim() || undefined,
    recordOnly: draft.recordOnly ? true : undefined,
    updatedAt: now(),
  }

  if (!account.name) throw new Error("请填写显示名称")
  if (!account.baseUrl) throw new Error("请填写站点地址")
  if (!account.baseUrl.startsWith("http://") && !account.baseUrl.startsWith("https://")) {
    throw new Error("站点地址必须以 http:// 或 https:// 开头")
  }

  if (draft.cookie.trim()) account.authSource = draft.authSource ?? "cookie"
  if (draft.platform) account.platform = draft.platform
  if (draft.lastSelf) account.lastSelf = draft.lastSelf

  // 处理访问令牌（用户 ID 于保存后由 /api/user/self 自动解析回填到 lastSelf.id）
  if (draft.accessToken.trim()) {
    account.authSource = draft.authSource ?? "accessToken"
  }

  if (draft.password.trim()) setSecret(passwordKey, draft.password)
  else if (prev?.passwordKey) removeSecret(passwordKey)
  if (draft.cookie.trim()) setSecret(cookieKey, draft.cookie)
  else if (prev?.cookieKey) removeSecret(cookieKey)
  if (draft.accessToken.trim()) setSecret(accessTokenKey, draft.accessToken)
  else if (prev?.accessTokenKey) removeSecret(accessTokenKey)

  if (idx >= 0) accounts[idx] = account
  else accounts.unshift(account)
  saveAccounts(accounts)
  return account
}

// 部分更新账户（委托给 storage 中的实现）
export { patchAccount } from "./storage"

// 删除账户
export function deleteAccount(accountId: string) {
  const accounts = loadAccounts()
  const account = accounts.find(a => a.id === accountId)
  if (account) removeAccountSecrets(account)
  saveAccounts(accounts.filter(a => a.id !== accountId))
}

// 获取签到记录
export function getCheckinRecords(status?: CheckinStatus): CheckinRecord[] {
  const records = status?.stats?.records
  return Array.isArray(records) ? records : []
}

// 获取今日签到记录
export function getTodayCheckinRecord(status?: CheckinStatus) {
  const today = localDateString()
  return getCheckinRecords(status).find(record => record.checkin_date === today)
}

// 获取今日签到信息
export function getTodayCheckinInfo(account?: Account) {
  const today = localDateString()
  const statusRecord = getTodayCheckinRecord(account?.lastCheckin)
  const savedRecord = account?.lastTodayCheckinDate === today ? account?.lastTodayCheckin : undefined
  const record = statusRecord ?? savedRecord
  const checked = !!record || account?.lastTodayCheckinDate === today
  return { checked, record }
}

// 比较可能为 undefined 的数字
export function compareMaybeNumber(a: number | undefined, b: number | undefined, direction: SortDirection) {
  const aValid = Number.isFinite(a)
  const bValid = Number.isFinite(b)
  if (!aValid && !bValid) return 0
  if (!aValid) return 1
  if (!bValid) return -1
  return direction === "asc" ? (a as number) - (b as number) : (b as number) - (a as number)
}

// 获取账户配额值
export function getAccountQuotaValue(account: Account) {
  const quota = getSelfQuotaValue(account.lastSelf)
  if (quota === undefined || quota === null) return undefined
  const value = Number(quota)
  return Number.isFinite(value) ? value : undefined
}

// 比较账户
export function compareAccounts(a: Account, b: Account, key: AccountSortKey, direction: SortDirection) {
  if (key === "name") {
    const result = a.name.localeCompare(b.name, "zh-Hans", { numeric: true, sensitivity: "base" })
    return direction === "asc" ? result : -result
  }
  if (key === "platform") {
    const result = getAccountTypeText(a).localeCompare(getAccountTypeText(b), "zh-Hans", { numeric: true, sensitivity: "base" })
    return direction === "asc" ? result : -result
  }
  if (key === "quota") {
    return compareMaybeNumber(getAccountQuotaValue(a), getAccountQuotaValue(b), direction)
  }
  const aChecked = getTodayCheckinInfo(a).checked ? 1 : 0
  const bChecked = getTodayCheckinInfo(b).checked ? 1 : 0
  return direction === "asc" ? aChecked - bChecked : bChecked - aChecked
}

// 排序账户列表
export function sortAccounts(accounts: Account[], key: AccountSortKey, direction: SortDirection) {
  return [...accounts].sort((a, b) => compareAccounts(a, b, key, direction) || a.updatedAt - b.updatedAt)
}

// 获取排序标题
export function getAccountSortTitle(key: AccountSortKey) {
  if (key === "name") return "名称"
  if (key === "platform") return "平台"
  if (key === "quota") return "金额"
  return "签到"
}

// 获取今日签到 patch
export function getTodayCheckinPatch(status?: CheckinStatus): Partial<Account> {
  const today = localDateString()
  const record = getTodayCheckinRecord(status)
  if (record) {
    return {
      lastTodayCheckinDate: today,
      lastTodayCheckin: record,
    }
  }
  return {}
}

// 构造本地签到奖励记录 patch：签到响应含 reward_amount 时，按今天日期记入 checkinRewards。
// 仅用于无签到历史接口的旧版 sub2api 站点补充月历金额；新版有历史接口时不依赖此记录。
export function getCheckinRewardPatch(account: Account, checkinResult: any): Partial<Account> {
  const amount = Number(checkinResult?.reward_amount)
  if (!Number.isFinite(amount) || amount <= 0) return {}
  const today = localDateString()
  const existing = account.checkinRewards ?? {}
  if (existing[today] === amount) return {}
  return { checkinRewards: { ...existing, [today]: amount } }
}

// 获取手动签到 patch
export function getManualTodayCheckinPatch(account: Account, checked: boolean): Partial<Account> {
  const today = localDateString()
  if (checked) {
    const record = getTodayCheckinInfo(account).record ?? { checkin_date: today }
    return {
      lastTodayCheckinDate: today,
      lastTodayCheckin: { ...record, checkin_date: today },
      lastError: "",
    }
  }

  const records = getCheckinRecords(account.lastCheckin).filter(record => record.checkin_date !== today)
  const lastCheckin = account.lastCheckin ? {
    ...account.lastCheckin,
    stats: {
      ...(account.lastCheckin.stats ?? {}),
      records,
      checkin_count: records.length,
      // new-api 签到统计为当月口径，可用当月记录重算；sub2api 的 total_* 是累计口径，不能用当月值覆盖，保留原值待下次刷新矫正
      ...(isSub2ApiAccount(account) ? {} : {
        total_checkins: records.length,
        total_quota: sumCheckinAwards(records),
      }),
    },
  } : account.lastCheckin
  return {
    lastCheckin,
    lastTodayCheckinDate: undefined,
    lastTodayCheckin: undefined,
    lastError: "",
  }
}

// 获取签到次数
export function getCheckinCount(status: CheckinStatus | undefined, records: CheckinRecord[]) {
  const count = Number(status?.stats?.checkin_count)
  return Number.isFinite(count) ? count : records.length
}

// 检查签到功能是否未开启并生成补丁
export function getCheckinDisabledPatch(message: any): Partial<Account> {
  const text = String(message ?? "")
  if (CHECKIN_DISABLED_PATTERN.test(text)) {
    return { lastCheckin: { enabled: false } }
  }
  return {}
}

// 快速账户操作（带错误处理和签到禁用检测）
export async function runQuickAccountAction(account: Account, label: string, task: (account: Account) => Promise<any>, checkinAware = false) {
  try {
    const latest = loadAccounts().find(item => item.id === account.id) ?? account
    const data = await task(latest)
    patchAccount(latest.id, { lastError: "" })
    return data
  } catch (e: any) {
    const message = getErrorMessage(e)
    patchAccount(account.id, { lastError: message, ...(checkinAware ? getCheckinDisabledPatch(message) : {}) })
    throw e
  }
}

// 快速同步账户余额：不更新站点状态，连通性由专门的检测负责
export async function quickSyncAccount(account: Account) {
  const latest = loadAccounts().find(item => item.id === account.id) ?? account
  const data = await fetchSelf(latest)
  patchAccount(account.id, { lastSelf: data, lastError: "" })
  return data
}

// 快速签到并同步状态：不更新站点状态，连通性由专门的检测负责
export async function quickCheckinAccount(account: Account) {
  // 服务端提示今日已签时按已签处理：继续刷新状态并本地标记，避免每次签到都重复尝试并报失败
  const data = await doCheckin(account).catch((e: any) => {
    if (!isAlreadyCheckedInError(e)) throw e
    return { already_checked: true }
  })
  const alreadyChecked = data?.already_checked === true
  let self: SelfInfo | undefined
  let status: CheckinStatus | undefined
  try { self = await fetchSelf(account) } catch {}
  try { status = await fetchCheckinStatus(account) } catch {}
  // 本地记录本次签到奖励金额（仅旧版 sub2api 无签到历史时用于补充月历金额）
  const checkinRewardsPatch = getCheckinRewardPatch(account, data)
  // 仅写入成功获取的字段，避免刷新失败时用 undefined 覆盖已有缓存
  const patch: Partial<Account> = { lastError: "", ...getTodayCheckinPatch(status), ...checkinRewardsPatch }
  if (self) patch.lastSelf = self
  if (status) patch.lastCheckin = status
  // 已签但状态刷新失败时用本地记录兜底，保证下次批量签到跳过该账号
  if (alreadyChecked && !patch.lastTodayCheckinDate) {
    patch.lastTodayCheckinDate = localDateString()
    patch.lastTodayCheckin = { checkin_date: localDateString() }
  }
  patchAccount(account.id, patch)
  return data
}
