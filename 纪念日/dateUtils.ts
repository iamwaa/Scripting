import { AnniversaryEvent } from './types'

// 农历月份显示名称
export const LUNAR_MONTH_NAMES = [
  '', '正月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '冬月', '腊月'
]

// 农历日期显示名称
export const LUNAR_DAY_NAMES = [
  '', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
]

// 天干
const HEAVENLY_STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']

// 地支
const EARTHLY_BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']

// 干支纪年锚点：1984 年为甲子年
const LUNAR_YEAR_CYCLE_ANCHOR = 1984
const LUNAR_YEAR_CYCLE_LENGTH = 60

// 获取指定公历年份的干支名称（用于农历年份显示）
export function getLunarYearGanZhi(year: number): string {
  let offset = (year - LUNAR_YEAR_CYCLE_ANCHOR) % LUNAR_YEAR_CYCLE_LENGTH
  if (offset < 0) {
    offset += LUNAR_YEAR_CYCLE_LENGTH
  }
  const stem = HEAVENLY_STEMS[offset % HEAVENLY_STEMS.length]
  const branch = EARTHLY_BRANCHES[offset % EARTHLY_BRANCHES.length]
  return `${stem}${branch}`
}

// 创建不带时区误差的本地日期（仅年月日）
export function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

// 返回 yyyy-MM-dd 字符串
export function formatDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 解析 yyyy-MM-dd 为本地日期
export function parseDateKey(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = parseInt(match[1], 10)
  const month = parseInt(match[2], 10)
  const day = parseInt(match[3], 10)
  const date = localDate(year, month, day)
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
    return null
  }
  return date
}

// 格式化日期为中文显示
export function formatDateCN(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

// 提取某公历日期对应的农历信息
const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric'
})

export interface LunarParts {
  year: number
  month: number
  day: number
  isLeapMonth: boolean
}

export function getLunarParts(date: Date): LunarParts {
  const parts = lunarFormatter.formatToParts(date)
  let year = 0
  let month = 0
  let day = 0
  let isLeapMonth = false
  for (const part of parts) {
    // iOS 中文农历返回的年份类型是 relatedYear，月份为中文名称（如“五月”或“闰五月”）
    if ((part.type as string) === 'relatedYear' || part.type === 'year') {
      year = parseInt(part.value, 10) || 0
    } else if (part.type === 'month') {
      let raw = part.value
      if (raw.startsWith('闰')) {
        isLeapMonth = true
        raw = raw.slice(1)
      }
      const index = LUNAR_MONTH_NAMES.indexOf(raw)
      month = index > 0 ? index : (parseInt(raw, 10) || 0)
    } else if (part.type === 'day') {
      day = parseInt(part.value, 10) || 0
    }
  }
  return { year, month, day, isLeapMonth }
}

// 将农历日期格式化为中文显示
export function formatLunar(lunarMonth: number, lunarDay: number, isLeapMonth: boolean): string {
  const monthName = LUNAR_MONTH_NAMES[lunarMonth] ?? `${lunarMonth}月`
  const prefix = isLeapMonth ? '闰' : ''
  const dayName = LUNAR_DAY_NAMES[lunarDay] ?? `${lunarDay}`
  return `农历${prefix}${monthName}${dayName}`
}

// 在指定公历年份中查找对应农历月日的日期
export function findGregorianDateForLunar(
  lunarMonth: number,
  lunarDay: number,
  isLeapMonth: boolean,
  gregorianYear: number
): Date | null {
  const start = localDate(gregorianYear, 1, 1)
  const end = localDate(gregorianYear + 1, 1, 1)
  for (let date = new Date(start); date < end; date.setDate(date.getDate() + 1)) {
    const parts = getLunarParts(date)
    if (parts.month === lunarMonth && parts.day === lunarDay && parts.isLeapMonth === isLeapMonth) {
      return new Date(date)
    }
  }
  // 若查无闰月日期，退回到非闰月同名日期
  if (isLeapMonth) {
    return findGregorianDateForLunar(lunarMonth, lunarDay, false, gregorianYear)
  }
  return null
}

// 获取事件的原始基准日期（公历）
export function getReferenceDate(event: AnniversaryEvent): Date | null {
  return parseDateKey(event.gregorianDate)
}

// 计算事件在指定公历年份的日期
export function getDateForYear(event: AnniversaryEvent, gregorianYear: number): Date | null {
  if (!event.repeatYearly) {
    return getReferenceDate(event)
  }
  if (event.isLunar && event.lunarMonth && event.lunarDay) {
    return findGregorianDateForLunar(
      event.lunarMonth,
      event.lunarDay,
      event.isLeapMonth,
      gregorianYear
    )
  }
  const ref = getReferenceDate(event)
  if (!ref) return null
  return localDate(gregorianYear, ref.getMonth() + 1, ref.getDate())
}

// 获取下一个即将到来的目标日期（从今天起包含今天）
export function getNextOccurrence(event: AnniversaryEvent, from: Date = new Date()): Date | null {
  const ref = getReferenceDate(event)
  if (!ref) return null
  const today = localDate(from.getFullYear(), from.getMonth() + 1, from.getDate())
  const refLocal = localDate(ref.getFullYear(), ref.getMonth() + 1, ref.getDate())
  if (!event.repeatYearly) {
    if (refLocal >= today) {
      return refLocal
    }
    // 一次性事件已过期时，取次年同月同日作为下一个虚拟目标日，统一展示倒数
    return localDate(ref.getFullYear() + 1, ref.getMonth() + 1, ref.getDate())
  }
  // 重复事件：从设定年份（或今年）开始查找，不返回早于设定日期的目标
  const startYear = Math.max(from.getFullYear(), refLocal.getFullYear())
  for (let offset = 0; offset <= 1; offset++) {
    const date = getDateForYear(event, startYear + offset)
    if (date) {
      const candidate = localDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
      if (candidate >= today && candidate >= refLocal) {
        return candidate
      }
    }
  }
  return null
}

// 计算 today 到 target 的天数差（target 更晚为正，更早为负）
export function daysBetween(from: Date, to: Date): number {
  const a = localDate(from.getFullYear(), from.getMonth() + 1, from.getDate())
  const b = localDate(to.getFullYear(), to.getMonth() + 1, to.getDate())
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

// 计算事件当前经过年数（周岁/周年）
export function getYearsPassed(event: AnniversaryEvent, targetYear: number): number | undefined {
  const ref = getReferenceDate(event)
  if (!ref) return undefined
  if (event.isLunar) {
    // 以农历转换后的目標年作为参考，近似计算
    return Math.max(0, targetYear - ref.getFullYear())
  }
  return Math.max(0, targetYear - ref.getFullYear())
}

// 计算周岁（生日用）
export function getAge(event: AnniversaryEvent, today: Date = new Date()): number | undefined {
  if (event.type !== 'birthday') return undefined
  const ref = getReferenceDate(event)
  if (!ref) return undefined
  let age = today.getFullYear() - ref.getFullYear()
  const next = getNextOccurrence(event, today)
  if (next) {
    const nextYear = next.getFullYear()
    age = nextYear - ref.getFullYear()
    // 若今年生日已过，nextYear 等于 today.getFullYear()，否则为 today.getFullYear() + 1
    // 这里直接用 nextYear 减参考年即得到当前周岁
  }
  return Math.max(0, age)
}

// 判断两个日期是否同年同月同日
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// 中国传统结婚周年称谓映射
const WEDDING_ANNIVERSARY_NAMES: Record<number, string> = {
  1: '纸婚',
  2: '棉婚',
  3: '皮婚',
  4: '花果婚',
  5: '木婚',
  6: '糖婚',
  7: '手婚',
  8: '古铜婚',
  9: '陶器婚',
  10: '锡婚',
  11: '钢婚',
  12: '丝婚',
  13: '花边婚',
  14: '象牙婚',
  15: '水晶婚',
  20: '瓷婚',
  25: '银婚',
  30: '珍珠婚',
  35: '珊瑚婚',
  40: '红宝石婚',
  45: '蓝宝石婚',
  50: '金婚',
  55: '绿宝石婚',
  60: '钻石婚',
  70: '白金婚',
  80: '钻石婚'
}

// 根据周年数获取结婚彩蛋称谓（按阶段显示，如 70-79 年都是白金婚）
export function getWeddingAnniversaryName(years: number): string | undefined {
  if (years >= 80) return '钻石婚'
  if (years >= 70) return '白金婚'
  if (years >= 60) return '钻石婚'
  if (years >= 55) return '绿宝石婚'
  if (years >= 50) return '金婚'
  if (years >= 45) return '蓝宝石婚'
  if (years >= 40) return '红宝石婚'
  if (years >= 35) return '珊瑚婚'
  if (years >= 30) return '珍珠婚'
  if (years >= 25) return '银婚'
  if (years >= 20) return '瓷婚'
  if (years >= 15) return '水晶婚'
  return WEDDING_ANNIVERSARY_NAMES[years]
}

// 根据婚龄周年数获取对应展示颜色
export function getWeddingNameColor(years: number): string {
  if (years >= 80) return '#5856D6' // 钻石婚
  if (years >= 70) return '#A1A1AA' // 白金婚
  if (years >= 60) return '#5856D6' // 钻石婚
  if (years >= 55) return '#34C759' // 绿宝石婚
  if (years >= 50) return '#FFCC00' // 金婚
  if (years >= 45) return '#007AFF' // 蓝宝石婚
  if (years >= 40) return '#FF3B30' // 红宝石婚
  if (years >= 35) return '#FF9500' // 珊瑚婚
  if (years >= 30) return '#D1D1D6' // 珍珠婚
  if (years >= 25) return '#A1A1AA' // 银婚
  if (years >= 20) return '#5AC8FA' // 瓷婚
  if (years >= 15) return '#AF52DE' // 水晶婚
  return '#8E8E93'
}

// 计算从起始日到目标日之间的累计年数与剩余天数，返回中文展示文本
export function formatElapsedYearsAndDays(from: Date, to: Date): string {
  const fromLocal = localDate(from.getFullYear(), from.getMonth() + 1, from.getDate())
  const toLocal = localDate(to.getFullYear(), to.getMonth() + 1, to.getDate())
  let years = toLocal.getFullYear() - fromLocal.getFullYear()
  const anchor = localDate(fromLocal.getFullYear() + years, fromLocal.getMonth() + 1, fromLocal.getDate())
  if (anchor > toLocal) {
    years -= 1
  }
  const start = localDate(fromLocal.getFullYear() + years, fromLocal.getMonth() + 1, fromLocal.getDate())
  const days = daysBetween(start, toLocal)
  if (years <= 0) return `${days} 天`
  if (days === 0) return `${years} 年`
  return `${years} 年 ${days} 天`
}

// 将所有事件按日期排序（包含非重复且已过期的事件）
export function buildOccurrenceList(
  events: AnniversaryEvent[],
  getPerson: (id: string) => { id: string; name: string; avatarPath: string | null } | undefined,
  from: Date = new Date()
): any[] {
  const result: any[] = []
  for (const event of events) {
    const person = getPerson(event.personId)
    if (!person) continue
    // 重复事件展示下一次未来日期；非重复事件始终展示原始参考日期，确保分组与列表行右侧日期一致
    let displayDate = event.repeatYearly
      ? (getNextOccurrence(event, from) ?? getReferenceDate(event))
      : getReferenceDate(event)
    if (!displayDate) continue
    result.push({
      event,
      person,
      nextDate: displayDate,
      daysLeft: daysBetween(from, displayDate),
      age: getAge(event, from),
      yearsPassed: event.repeatYearly
        ? getYearsPassed(event, displayDate.getFullYear())
        : undefined
    })
  }
  result.sort((a, b) => a.daysLeft - b.daysLeft)
  return result
}
