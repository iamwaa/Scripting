import { Script, Intent, Notification } from "scripting"
import { WorkdayStorage } from "./storage"

const KEY_SUB_CACHE = "alarm_sub_cache"
const KEY_OVERRIDES = "alarm_overrides"
const KEY_REST_RULE = "alarm_rest_rule"
const KEY_NOTIFY_ENABLED = "alarm_notify_enabled"
const KEY_ALARM_TYPE = "alarm_type"
const DEFAULT_NOTIFY_ENABLED = true

type AlarmType = "builtin" | "shortcut"

interface DayEntry {
  date: string
  type: "holiday" | "workday"
  name?: string
}

interface LocalOverride {
  date: string
  type: "holiday" | "workday"
}

interface RestRule {
  mode: "fixed" | "weekCycle" | "dayCycle"
  fixedWeekdays: number[]
  weekCycleStart: string
  weekCycleWeeks: number[][]
  dayCycleStart: string
  dayCycleWorkDays: number
  dayCycleRestDays: number
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function dateStr(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

function formatDateObj(d: Date): string {
  return dateStr(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map((v) => parseInt(v))
  return new Date(y, m - 1, d)
}

function dayDiff(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.floor((end - start) / 86400000)
}

function getDefaultRestRule(): RestRule {
  const today = formatDateObj(new Date())
  return {
    mode: "fixed",
    fixedWeekdays: [0, 6],
    weekCycleStart: today,
    weekCycleWeeks: [[0, 6], [0]],
    dayCycleStart: today,
    dayCycleWorkDays: 1,
    dayCycleRestDays: 1,
  }
}

function loadRestRule(): RestRule {
  return WorkdayStorage.get<RestRule>(KEY_REST_RULE) || getDefaultRestRule()
}

function getRuleDayType(dateKey: string, rule: RestRule): "holiday" | "normal" {
  const [y, m, d] = dateKey.split("-").map((v) => parseInt(v))
  const date = new Date(y, m - 1, d)
  const weekday = date.getDay()

  if (rule.mode === "fixed") {
    return rule.fixedWeekdays.includes(weekday) ? "holiday" : "normal"
  }

  if (rule.mode === "weekCycle") {
    const start = parseDateKey(rule.weekCycleStart)
    const diff = dayDiff(start, date)
    const weekCount = Math.max(1, rule.weekCycleWeeks.length)
    const weekIndex = ((Math.floor(diff / 7) % weekCount) + weekCount) % weekCount
    const restDays = rule.weekCycleWeeks[weekIndex] || []
    return restDays.includes(weekday) ? "holiday" : "normal"
  }

  const start = parseDateKey(rule.dayCycleStart)
  const period = Math.max(1, rule.dayCycleWorkDays + rule.dayCycleRestDays)
  const position = ((dayDiff(start, date) % period) + period) % period
  return position >= rule.dayCycleWorkDays ? "holiday" : "normal"
}

function getDayType(
  dateKey: string,
  subDays: DayEntry[],
  overrides: LocalOverride[],
  restRule: RestRule
): "holiday" | "workday" | "weekend" | "normal" {
  const ovr = overrides.find((o) => o.date === dateKey)
  if (ovr) return ovr.type

  const sub = subDays.find((d) => d.date === dateKey)
  if (sub) return sub.type

  const ruleType = getRuleDayType(dateKey, restRule)
  if (ruleType === "holiday") return "holiday"

  return "normal"
}

function isRestDay(type: "holiday" | "workday" | "weekend" | "normal"): boolean {
  return type === "holiday" || type === "weekend"
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectStrings)
  }
  return []
}

function isKnownQuery(value: string): boolean {
  return (value.includes("明天") && value.includes("休息"))
    || value.includes("下一个工作日")
    || value.includes("下一个休息日")
}

function getShortcutQuery(): string {
  const candidates: string[] = []
  const shortcutInput = Intent.shortcutParameter

  if (shortcutInput?.type === "text") {
    candidates.push(shortcutInput.value)
  } else if (shortcutInput?.type === "json") {
    candidates.push(...collectStrings(shortcutInput.value))
  } else if (shortcutInput?.type === "fileURL") {
    candidates.push(shortcutInput.value)
  }

  candidates.push(...(Intent.textsParameter || []))
  candidates.push(...collectStrings(Script.queryParameters))

  const cleaned = candidates.map((v) => v.trim()).filter(Boolean)
  return cleaned.find(isKnownQuery) || cleaned[0] || ""
}

// 明天休息吗：按 是/否 即时推送，不占用 pending 配额
async function maybeNotifyTomorrowRest(isRest: boolean, tomorrowStr: string) {
  const notifyEnabled = WorkdayStorage.get<boolean>(KEY_NOTIFY_ENABLED) ?? DEFAULT_NOTIFY_ENABLED
  if (!notifyEnabled) return

  const alarmType = WorkdayStorage.get<AlarmType>(KEY_ALARM_TYPE) ?? "builtin"
  const body = isRest
    ? (alarmType === "shortcut" ? "明天是休息日，好好享受假期" : "明天是休息日，闹钟将自动跳过")
    : "明天是工作日，记得早睡"

  await Notification.schedule({
    title: "工作日闹钟",
    body,
    silent: false,
    threadIdentifier: "holiday-alarm",
    userInfo: {
      source: "holiday-alarm-intent",
      date: tomorrowStr,
      rest: isRest,
    },
  })
}

function answerTomorrowRest(
  subDays: DayEntry[],
  overrides: LocalOverride[],
  restRule: RestRule
): { result: string; isRest: boolean; tomorrowStr: string } {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = formatDateObj(tomorrow)
  const type = getDayType(tomorrowStr, subDays, overrides, restRule)
  const isRest = isRestDay(type)
  return {
    result: isRest ? "是" : "否",
    isRest,
    tomorrowStr,
  }
}

async function main() {
  const query = getShortcutQuery()
  const subDays = WorkdayStorage.get<DayEntry[]>(KEY_SUB_CACHE) || []
  const overrides = WorkdayStorage.get<LocalOverride[]>(KEY_OVERRIDES) || []
  const restRule = loadRestRule()

  function findNextDate(isTargetRest: boolean, startDate: Date): string {
    const d = new Date(startDate)
    d.setDate(d.getDate() + 1)
    for (let i = 0; i < 365; i++) {
      const key = formatDateObj(d)
      const type = getDayType(key, subDays, overrides, restRule)
      if (isRestDay(type) === isTargetRest) return key
      d.setDate(d.getDate() + 1)
    }
    return "未找到"
  }

  let result: string
  let notifyTomorrow: { isRest: boolean; tomorrowStr: string } | null = null

  if (query.includes("明天") && query.includes("休息")) {
    const answer = answerTomorrowRest(subDays, overrides, restRule)
    result = answer.result
    notifyTomorrow = answer
  } else if (query.includes("下一个工作日")) {
    result = findNextDate(false, new Date())
  } else if (query.includes("下一个休息日")) {
    result = findNextDate(true, new Date())
  } else {
    // 默认与「明天休息吗」相同：返回 是/否，并尝试推送通知
    const answer = answerTomorrowRest(subDays, overrides, restRule)
    result = answer.result
    notifyTomorrow = answer
  }

  if (notifyTomorrow) {
    try {
      await maybeNotifyTomorrowRest(notifyTomorrow.isRest, notifyTomorrow.tomorrowStr)
    } catch {
      // 通知失败不影响快捷指令返回值
    }
  }

  Script.exit(Intent.text(result))
}

main()
