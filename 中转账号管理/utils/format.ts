import type { Account, AccountPlatform, CheckinRecord, SelfInfo } from "../types"
import { QUOTA_PER_USD } from "../constants"

export function getAccountPlatform(account: Pick<Account, "platform">): AccountPlatform {
  return account.platform ?? "newapi"
}

export function isSub2ApiAccount(account: Pick<Account, "platform">) {
  return getAccountPlatform(account) === "sub2api"
}

export function getPlatformText(account: Pick<Account, "platform">) {
  return isSub2ApiAccount(account) ? "Sub2API" : "NewAPI"
}

// 仅记录账号：不参与余额查询与接口签到
export function isRecordOnlyAccount(account: Pick<Account, "recordOnly">) {
  return account.recordOnly === true
}

// 列表/详情展示的账号类型文本：仅记录账号不显示平台名
export function getAccountTypeText(account: Pick<Account, "platform" | "recordOnly">) {
  return isRecordOnlyAccount(account) ? "仅记录" : getPlatformText(account)
}

export function quotaFromUsd(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? n * QUOTA_PER_USD : undefined
}

export function getSelfQuotaValue(self?: SelfInfo) {
  return self?.quota ?? quotaFromUsd(self?.balance)
}

export function getSelfUsedQuotaValue(self?: SelfInfo) {
  return self?.used_quota
}

export function getSelfDisplayName(self?: SelfInfo) {
  return self?.display_name || self?.username || self?.email
}

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function now() {
  return Math.floor(Date.now() / 1000)
}

export function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function localMonthString(date = new Date()) {
  return localDateString(date).slice(0, 7)
}

// 将时间字符串转换为时间戳（用于 DatePicker）
export function timeStringToTimestamp(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date.getTime()
}

// 检查当前时间是否已过签到时间
export function isCheckinTimeReached(checkinTime: string): boolean {
  const now = new Date()
  const [hours, minutes] = checkinTime.split(':').map(Number)
  const checkinDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes)
  return now >= checkinDate
}

export function shouldSkipBatchCheckinByTime(account: Account) {
  return !!account.checkinTime && !isCheckinTimeReached(account.checkinTime)
}

export function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "")
}

export function fmtQuota(value: any) {
  if (value === null || value === undefined || value === "") return "-"
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return `$${(n / QUOTA_PER_USD).toFixed(2)}`
}

export function fmtRawQuota(value: any) {
  if (value === null || value === undefined || value === "") return "-"
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(2)}M q`
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K q`
  return `${n} q`
}

export function fmtRawQuotaForAccount(account: Account, value: any) {
  if (isSub2ApiAccount(account)) return fmtQuota(value)
  return fmtRawQuota(value)
}

export function fmtMonth(value: string) {
  const [year, month] = value.split("-")
  return `${year}年${Number(month)}月`
}

export function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number)
  const d = new Date(year, month - 1 + offset, 1)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, "0")
  return `${y}-${m}`
}

export function getMonthDays(month: string) {
  const [year, monthIndex] = month.split("-").map(Number)
  const daysInMonth = new Date(year, monthIndex, 0).getDate()
  const firstWeekday = new Date(year, monthIndex - 1, 1).getDay()
  const cells: Array<{ key: string, day?: number, date?: string }> = []
  for (let i = 0; i < firstWeekday; i++) cells.push({ key: `blank-${i}` })
  for (let day = 1; day <= daysInMonth; day++) {
    const dd = `${day}`.padStart(2, "0")
    cells.push({ key: `${month}-${dd}`, day, date: `${month}-${dd}` })
  }
  while (cells.length % 7 !== 0) cells.push({ key: `blank-tail-${cells.length}` })
  return cells
}

export function getCheckinRecordMap(records?: CheckinRecord[]) {
  const map: Record<string, CheckinRecord> = {}
  for (const record of records ?? []) {
    if (record.checkin_date) map[record.checkin_date] = record
  }
  return map
}

export function sumCheckinAwards(records?: CheckinRecord[]) {
  return (records ?? []).reduce((sum, record) => sum + (Number(record.quota_awarded) || 0), 0)
}

export function fmtCheckinAward(value: any) {
  if (value === null || value === undefined || value === "") return ""
  return `+${fmtQuota(value)}`
}

export function isTodayDate(value?: string) {
  if (!value) return false
  return value === localDateString()
}

export function fmtTime(ts?: number) {
  if (!ts) return "未同步"
  return new Date(ts * 1000).toLocaleString()
}

export function shortUrl(url: string) {
  return url.replace(/^https?:\/\//, "")
}