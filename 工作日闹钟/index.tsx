import {
  Script,
  Navigation,
  NavigationStack,
  List,
  Section,
  HStack,
  VStack,
  Text,
  Button,
  Image,
  RoundedRectangle,
  Spacer,
  Toggle,
  Label,
  TextField,
  LazyVGrid,
  Toolbar,
  ToolbarItem,
  TabView,
  Tab,
  DatePicker,
  Divider,
  Picker,
  Stepper,
  Notification,
  Path,
  useState,
  useEffect,
  fetch,
  useColorScheme,
  Font,
  FontWeight,
  ShapeStyle,
  DynamicShapeStyle,
} from "scripting"
import { StopWorkdayAlarmIntent, SnoozeWorkdayAlarmIntent } from "./app_intents"
import { WorkdayStorage } from "./storage"

declare const Dialog: any
const TextWithLayout = Text as any

interface DayEntry {
  date: string
  type: "holiday" | "workday"
  name?: string
}

interface LocalOverride {
  date: string
  type: "holiday" | "workday"
}

interface OverrideYearStat {
  year: number
  holidayCount: number
  workdayCount: number
}

type RestRuleMode = "fixed" | "weekCycle" | "dayCycle"

interface RestRule {
  mode: RestRuleMode
  fixedWeekdays: number[]
  weekCycleStart: string
  weekCycleWeeks: number[][]
  dayCycleStart: string
  dayCycleWorkDays: number
  dayCycleRestDays: number
}

const KEY_SUB_URL = "alarm_sub_url"
const KEY_SUB_CACHE = "alarm_sub_cache"
const KEY_OVERRIDES = "alarm_overrides"
const KEY_ALARM_ENABLED = "alarm_enabled"
const KEY_ALARM_HOUR = "alarm_hour"
const KEY_ALARM_MINUTE = "alarm_minute"
const KEY_NOTIFY_ENABLED = "alarm_notify_enabled"
const KEY_NOTIFY_HOUR = "alarm_notify_hour"
const KEY_NOTIFY_MINUTE = "alarm_notify_minute"
const KEY_WORKDAY_ALARM_ID = "alarm_workday_alarm_id"
const KEY_WORKDAY_ALARM_IDS = "alarm_workday_alarm_ids"
const KEY_WORKDAY_NEXT_ALARM_ID = "alarm_workday_next_alarm_id"
const KEY_REST_RULE = "alarm_rest_rule"
const KEY_DAY_NOTES = "alarm_day_notes"
const KEY_ALARM_TYPE = "alarm_type"
const KEY_ALARM_SOUND = "alarm_sound"
const KEY_ALARM_SNOOZE_MINUTES = "alarm_snooze_minutes"
type AlarmType = "builtin" | "shortcut"
const WORKDAY_ALARM_ID_FALLBACK = ""
const DEFAULT_ALARM_SOUND = "Default"
const DEFAULT_SNOOZE_MINUTES = 5
const DEFAULT_NOTIFY_ENABLED = true
const DEFAULT_NOTIFY_HOUR = 20
const DEFAULT_NOTIFY_MINUTE = 0
const SNOOZE_MINUTE_OPTIONS = [5, 10, 15, 20, 30]
const SUPPORTED_SOUND_EXTENSIONS = new Set([".aiff", ".wav", ".caf", ".mp3"])

function MarqueeText({
  text,
  font = "caption2",
  fontWeight = "semibold",
  foregroundStyle = "#1C1C1E",
  maxChars = 3,
  cycleDuration = 6,
  frame = { maxWidth: "infinity" },
}: {
  text: string
  font?: Font | number | { name: string; size: number }
  fontWeight?: FontWeight
  foregroundStyle?: ShapeStyle | DynamicShapeStyle
  maxChars?: number
  cycleDuration?: number
  frame?: Record<string, unknown>
}) {
  const needsScroll = text.length > maxChars
  const [isScrolling, setIsScrolling] = useState(false)
  const [restartKey, setRestartKey] = useState(0)

  useEffect(() => {
    setIsScrolling(false)
    setRestartKey((value) => value + 1)

    if (!needsScroll) return

    const timer = setTimeout(() => setIsScrolling(true), 200)
    return () => clearTimeout(timer)
  }, [needsScroll, text])

  if (!text) {
    return <Text frame={frame} foregroundStyle="clear">{" "}</Text>
  }

  if (!needsScroll) {
    return (
      <Text
        font={font}
        fontWeight={fontWeight}
        foregroundStyle={foregroundStyle}
        lineLimit={1}
        frame={frame}
      >
        {text}
      </Text>
    )
  }

  const gap = 42
  const charWidth = 14
  const scrollDistance = text.length * charWidth + gap
  const scrollDuration = Math.max(cycleDuration, text.length * 1.4)
  const scrollOffset = isScrolling ? -scrollDistance : 0

  return (
    <HStack
      key={`marquee-${restartKey}`}
      spacing={gap}
      frame={frame}
      clipShape={{ type: "rect", cornerRadius: 0 }}
    >
      {[0, 1].map((index) => (
        <Text
          key={`marquee-text-${index}`}
          font={font}
          fontWeight={fontWeight}
          foregroundStyle={foregroundStyle}
          lineLimit={1}
          fixedSize={{ horizontal: true, vertical: false }}
          offset={{ x: scrollOffset, y: 0 }}
          animation={{
            animation: Animation.linear(scrollDuration).repeatForever(false),
            value: scrollOffset,
          }}
        >
          {text}
        </Text>
      ))}
    </HStack>
  )
}

function alarmLibrarySoundsDirectoryPath(): string {
  return Path.join(Path.dirname(FileManager.temporaryDirectory), "Library", "Sounds")
}

function ensureAlarmLibrarySoundsDirectory(): string {
  const dir = alarmLibrarySoundsDirectoryPath()
  if (!FileManager.existsSync(dir)) {
    FileManager.createDirectorySync(dir, true)
  }
  return dir
}

function sanitizeSoundFileName(name: string, fallbackExt = ""): string {
  const basename = Path.basename(name.trim()).replace(/[\\/:*?"<>|]/g, "-")
  const ext = Path.extname(basename).toLowerCase() || fallbackExt.toLowerCase()
  const rawStem = ext && basename.toLowerCase().endsWith(ext)
    ? basename.slice(0, -ext.length)
    : basename
  const stem = rawStem.trim() || "铃声"

  if (!SUPPORTED_SOUND_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的铃声格式：${ext || "无扩展名"}`)
  }

  return `${stem}${ext}`
}

function uniqueSoundFileName(name: string, currentName = ""): string {
  const dir = ensureAlarmLibrarySoundsDirectory()
  const ext = Path.extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  let candidate = name
  let index = 2

  while (candidate !== currentName && FileManager.existsSync(Path.join(dir, candidate))) {
    candidate = `${stem} ${index}${ext}`
    index += 1
  }

  return candidate
}

function soundFilePath(name: string): string {
  return Path.join(alarmLibrarySoundsDirectoryPath(), name)
}

function importSoundFileToLibrary(filePath: string): string {
  const sourceName = Path.basename(filePath)
  const ext = Path.extname(sourceName).toLowerCase()
  const targetName = uniqueSoundFileName(sanitizeSoundFileName(sourceName, ext))
  FileManager.copyFileSync(filePath, soundFilePath(targetName))
  return targetName
}

function removeManagedSound(name: string) {
  if (name === DEFAULT_ALARM_SOUND) return
  const path = soundFilePath(name)
  if (FileManager.existsSync(path)) {
    FileManager.removeSync(path)
  }
}

function renameManagedSound(oldName: string, newNameInput: string): string {
  if (oldName === DEFAULT_ALARM_SOUND) return DEFAULT_ALARM_SOUND
  const ext = Path.extname(oldName)
  const newName = uniqueSoundFileName(sanitizeSoundFileName(newNameInput, ext), oldName)
  if (newName === oldName) return oldName

  FileManager.renameSync(soundFilePath(oldName), soundFilePath(newName))
  return newName
}

function ensureAlarmSoundImported(soundSetting: string) {
  const name = getAlarmSoundName(soundSetting)
  if (!name) return

  const targetPath = soundFilePath(name)
  if (!FileManager.existsSync(targetPath)) {
    throw new Error(`铃声文件不存在，请先在铃声管理中导入：${name}`)
  }
}

function normalizeSoundNames(names: string[]): string[] {
  const seen = new Set<string>()
  const result = [DEFAULT_ALARM_SOUND]

  for (const name of names) {
    const trimmed = String(name ?? "").trim()
    if (!trimmed || trimmed === DEFAULT_ALARM_SOUND || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

function soundDisplayName(name: string): string {
  if (name === DEFAULT_ALARM_SOUND) return "默认铃声"
  const ext = Path.extname(name)
  return ext ? name.slice(0, -ext.length) : name
}

async function loadAvailableSoundNames(): Promise<string[]> {
  const soundsDir = alarmLibrarySoundsDirectoryPath()
  if (!FileManager.existsSync(soundsDir)) return [DEFAULT_ALARM_SOUND]

  const entries = await FileManager.readDirectory(soundsDir, false)
  const names = entries
    .map((entry) => Path.basename(entry))
    .filter((name) => SUPPORTED_SOUND_EXTENSIONS.has(Path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))

  return normalizeSoundNames(names)
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function dateStr(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map((v) => parseInt(v))
  return new Date(y, m - 1, d)
}

function formatDateObj(d: Date): string {
  return dateStr(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

function getDaysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

function getFirstDayOfWeek(y: number, m: number): number {
  return new Date(y, m - 1, 1).getDay()
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

function saveRestRule(rule: RestRule) {
  WorkdayStorage.set(KEY_REST_RULE, rule)
}

function dayDiff(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.floor((end - start) / 86400000)
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
  restRule: RestRule = loadRestRule()
): "holiday" | "workday" | "weekend" | "normal" {
  const ovr = overrides.find((o) => o.date === dateKey)
  if (ovr) return ovr.type

  const sub = subDays.find((d) => d.date === dateKey)
  if (sub) return sub.type

  const ruleType = getRuleDayType(dateKey, restRule)
  if (ruleType === "holiday") return "holiday"

  return "normal"
}

function getHolidayLabel(dateKey: string, subDays: DayEntry[]): string {
  const entry = subDays.find((d) => d.date === dateKey)
  if (!entry?.name) return ""
  const label = entry.name
    .replace("假期", "")
    .replace("补班", "")
    .trim()
  return label
}

function isRestDay(type: "holiday" | "workday" | "weekend" | "normal"): boolean {
  return type === "holiday" || type === "weekend"
}

function parseICS(icsText: string): DayEntry[] {
  const entries: DayEntry[] = []
  const events = icsText.split("BEGIN:VEVENT")

  for (let i = 1; i < events.length; i++) {
    const block = events[i]
    const endIdx = block.indexOf("END:VEVENT")
    const content = endIdx > 0 ? block.substring(0, endIdx) : block
    let dtstart = ""
    let summary = ""

    const lines = content.split(/\r?\n/)
    for (const line of lines) {
      if (line.startsWith("DTSTART")) {
        const colonIdx = line.indexOf(":")
        if (colonIdx > 0) {
          dtstart = line.substring(colonIdx + 1).trim().substring(0, 8)
        }
      } else if (line.startsWith("SUMMARY:")) {
        summary = line.substring(8).trim()
      }
    }

    if (dtstart.length === 8) {
      const y = dtstart.substring(0, 4)
      const m = dtstart.substring(4, 6)
      const d = dtstart.substring(6, 8)
      const type: "holiday" | "workday" = summary.includes("补班") ? "workday" : "holiday"
      entries.push({ date: `${y}-${m}-${d}`, type, name: summary })
    }
  }

  return entries
}

function loadSubUrl(): string {
  return WorkdayStorage.get<string>(KEY_SUB_URL) || ""
}

function saveSubUrl(url: string) {
  WorkdayStorage.set(KEY_SUB_URL, url)
}

function loadSubCache(): DayEntry[] {
  return WorkdayStorage.get<DayEntry[]>(KEY_SUB_CACHE) || []
}

function saveSubCache(days: DayEntry[]) {
  WorkdayStorage.set(KEY_SUB_CACHE, days)
}

function loadOverrides(): LocalOverride[] {
  return WorkdayStorage.get<LocalOverride[]>(KEY_OVERRIDES) || []
}

function loadDayNotes(): Record<string, string> {
  return WorkdayStorage.get<Record<string, string>>(KEY_DAY_NOTES) || {}
}

function saveDayNotes(notes: Record<string, string>) {
  WorkdayStorage.set(KEY_DAY_NOTES, notes)
}

function saveOverrides(overrides: LocalOverride[]) {
  WorkdayStorage.set(KEY_OVERRIDES, overrides)
}

function getOverrideYearStats(overrides: LocalOverride[]): OverrideYearStat[] {
  const stats = new Map<number, OverrideYearStat>()

  for (const override of overrides) {
    const year = Number(override.date.slice(0, 4))
    if (!Number.isFinite(year)) continue

    const stat = stats.get(year) || { year, holidayCount: 0, workdayCount: 0 }
    if (override.type === "holiday") {
      stat.holidayCount += 1
    } else {
      stat.workdayCount += 1
    }
    stats.set(year, stat)
  }

  return Array.from(stats.values()).sort((a, b) => b.year - a.year)
}

async function fetchSubscription(url: string): Promise<DayEntry[] | null> {
  if (!url) return null
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const text = await resp.text()

    if (text.trimStart().startsWith("BEGIN:VCALENDAR")) {
      return parseICS(text)
    }

    try {
      const data = JSON.parse(text)
      if (data && Array.isArray(data.days)) {
        return data.days
      }
      if (Array.isArray(data)) {
        return data as DayEntry[]
      }
    } catch {
      return null
    }

    return null
  } catch {
    return null
  }
}

let notificationScheduleGeneration = 0
let notificationSchedulePromise: Promise<void> = Promise.resolve()

async function scheduleNotification(
  subDays: DayEntry[],
  overrides: LocalOverride[],
  restRule: RestRule = loadRestRule()
) {
  const runGeneration = ++notificationScheduleGeneration
  const sync = async () => {
    if (runGeneration !== notificationScheduleGeneration) return

    await Notification.removeAllPendingsOfCurrentScript()

    const notifyEnabled = WorkdayStorage.get<boolean>(KEY_NOTIFY_ENABLED) ?? DEFAULT_NOTIFY_ENABLED
    if (!notifyEnabled) return

    // 快捷指令模式由 intent「明天休息吗」即时推送，不预排 pending，避免占用通知配额
    const alarmType = WorkdayStorage.get<AlarmType>(KEY_ALARM_TYPE) ?? "builtin"
    if (alarmType === "shortcut") return

    const notifyHour = WorkdayStorage.get<number>(KEY_NOTIFY_HOUR) ?? DEFAULT_NOTIFY_HOUR
    const notifyMinute = WorkdayStorage.get<number>(KEY_NOTIFY_MINUTE) ?? DEFAULT_NOTIFY_MINUTE
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = formatDateObj(tomorrow)
    const tomorrowType = getDayType(tomorrowStr, subDays, overrides, restRule)
    const tomorrowIsRest = isRestDay(tomorrowType)

    const title = "工作日闹钟"
    const body = tomorrowIsRest
      ? "明天是休息日，闹钟将自动跳过"
      : "明天是工作日，记得早睡"

    if (runGeneration !== notificationScheduleGeneration) return

    const trigger = new CalendarNotificationTrigger({
      dateMatching: new DateComponents({ hour: notifyHour, minute: notifyMinute }),
      repeats: true,
    })

    await Notification.schedule({
      title,
      body,
      silent: false,
      trigger,
      threadIdentifier: "holiday-alarm",
      userInfo: { source: "holiday-alarm", date: tomorrowStr },
    })
  }

  notificationSchedulePromise = notificationSchedulePromise.then(sync, sync)
  return notificationSchedulePromise
}

let alarmScheduleGeneration = 0

function rememberWorkdayAlarmId(id: string, asNextAlarm = false) {
  const ids = WorkdayStorage.get<string[]>(KEY_WORKDAY_ALARM_IDS) || []
  WorkdayStorage.set(KEY_WORKDAY_ALARM_ID, id)
  WorkdayStorage.set(KEY_WORKDAY_ALARM_IDS, Array.from(new Set([...ids, id])))
  if (asNextAlarm) {
    WorkdayStorage.set(KEY_WORKDAY_NEXT_ALARM_ID, id)
  }
}

async function cancelAlarmIds(ids: string[]) {
  let cancelled = 0
  for (const id of Array.from(new Set(ids.filter(Boolean)))) {
    try {
      if (await AlarmManager.cancel(id)) cancelled += 1
    } catch {
      // 闹钟可能已经不存在，继续清理剩余 id。
    }
  }
  return cancelled
}

async function cancelWorkdayAlarm() {
  const storedId = WorkdayStorage.get<string>(KEY_WORKDAY_ALARM_ID) || WORKDAY_ALARM_ID_FALLBACK
  const storedIds = WorkdayStorage.get<string[]>(KEY_WORKDAY_ALARM_IDS) || []
  const storedNextId = WorkdayStorage.get<string>(KEY_WORKDAY_NEXT_ALARM_ID) || ""
  WorkdayStorage.set(KEY_WORKDAY_ALARM_ID, "")
  WorkdayStorage.set(KEY_WORKDAY_ALARM_IDS, [])
  WorkdayStorage.set(KEY_WORKDAY_NEXT_ALARM_ID, "")

  if (!AlarmManager.isAvailable) return "闹钟 API 不可用"

  const cancelled = await cancelAlarmIds([...storedIds, storedId, storedNextId])
  return cancelled > 0 ? `已取消 ${cancelled} 个闹钟` : "未找到可取消的闹钟"
}

function getSnoozeMinutes(): number {
  return WorkdayStorage.get<number>(KEY_ALARM_SNOOZE_MINUTES) ?? DEFAULT_SNOOZE_MINUTES
}

function buildAlarmAttributes(title: string, targetDateStr: string) {
  const snoozeMinutes = getSnoozeMinutes()
  const alert = AlarmManager.AlertPresentation.create({
    title,
    secondaryButton: AlarmManager.Button.create({
      title: `稍后 ${snoozeMinutes} 分钟`,
      systemImageName: "zzz",
    }),
    secondaryBehavior: "custom",
  })
  return AlarmManager.Attributes.create({
    alert,
    tintColor: "orange",
    metadata: { source: "holiday-alarm", date: targetDateStr, snoozeMinutes: `${snoozeMinutes}` },
  })
}

function getAlarmSoundSetting(): string {
  return WorkdayStorage.get<string>(KEY_ALARM_SOUND) || DEFAULT_ALARM_SOUND
}

function getAlarmSoundName(soundSetting: string = getAlarmSoundSetting()): string {
  return soundSetting === DEFAULT_ALARM_SOUND || soundSetting === "default" ? "" : soundSetting.trim()
}

function buildAlarmSound(soundSetting: string = getAlarmSoundSetting()): AlarmManager.Sound {
  const name = getAlarmSoundName(soundSetting)
  if (!name) {
    return AlarmManager.Sound.default()
  }

  ensureAlarmSoundImported(soundSetting)
  return AlarmManager.Sound.named(name)
}

function bindAlarmIntent<T extends { script: string }>(intent: T): T {
  return { ...intent, script: "工作日闹钟" }
}

function getNextAlarmTarget(
  now: Date,
  alarmHour: number,
  alarmMinute: number,
  subDays: DayEntry[],
  overrides: LocalOverride[],
  restRule: RestRule
) {
  for (let offset = 0; offset < 365; offset++) {
    const candidate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      alarmHour,
      alarmMinute,
      0
    )

    if (candidate.getTime() <= now.getTime()) continue

    const candidateStr = formatDateObj(candidate)
    const candidateType = getDayType(candidateStr, subDays, overrides, restRule)
    if (!isRestDay(candidateType)) {
      return { date: candidate, dateStr: candidateStr }
    }
  }

  return null
}

function formatAlarmTargetDayLabel(targetDate: Date, now: Date): string {
  const targetDateStr = formatDateObj(targetDate)
  const todayStr = formatDateObj(now)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (targetDateStr === todayStr) return "今天"
  if (targetDateStr === formatDateObj(tomorrow)) return "明天"
  return `${targetDate.getMonth() + 1}月${targetDate.getDate()}日`
}

function formatAlarmTargetMessage(targetDate: Date, now: Date, alarmHour: number, alarmMinute: number): string {
  return `已设置${formatAlarmTargetDayLabel(targetDate, now)} ${pad(alarmHour)}:${pad(alarmMinute)} 闹钟`
}

async function scheduleWorkdayAlarm(
  subDays: DayEntry[],
  overrides: LocalOverride[],
  restRule: RestRule = loadRestRule()
) {
  const runGeneration = ++alarmScheduleGeneration
  const alarmEnabled = WorkdayStorage.get<boolean>(KEY_ALARM_ENABLED) ?? true
  const alarmHour = WorkdayStorage.get<number>(KEY_ALARM_HOUR) ?? 7
  const alarmMinute = WorkdayStorage.get<number>(KEY_ALARM_MINUTE) ?? 30
  const now = new Date()
  const alarmTarget = getNextAlarmTarget(now, alarmHour, alarmMinute, subDays, overrides, restRule)

  await cancelWorkdayAlarm()

  if (runGeneration !== alarmScheduleGeneration) return "已跳过过期的闹钟同步"
  if (!alarmEnabled) return "闹钟已关闭"
  if (!alarmTarget) return "未来一年内没有可用工作日，已跳过闹钟"
  if (!AlarmManager.isAvailable) return "闹钟 API 不可用，需要 iOS 26+"

  const soundSetting = getAlarmSoundSetting()
  let sound: AlarmManager.Sound
  try {
    sound = buildAlarmSound(soundSetting)
  } catch {
    return "闹钟铃声不可用"
  }

  const schedule = AlarmManager.Schedule.fixed(alarmTarget.date)
  const alarmTitle = "工作日闹钟"
  const attributes = buildAlarmAttributes(alarmTitle, alarmTarget.dateStr)
  if (!attributes) return "闹钟配置创建失败"

  const alarmId = UUID.string()
  const alarmConfig = AlarmManager.Configuration.alarm({
    schedule,
    attributes,
    sound,
    stopIntent: bindAlarmIntent(StopWorkdayAlarmIntent({
      alarmId,
    })) as any,
    secondaryIntent: bindAlarmIntent(SnoozeWorkdayAlarmIntent({
      alarmId,
      title: alarmTitle,
      snoozeMinutes: getSnoozeMinutes(),
      soundName: soundSetting,
    })) as any,
  })

  if (!alarmConfig) return "闹钟配置创建失败"

  try {
    const alarm = await AlarmManager.schedule(alarmId, alarmConfig)
    if (runGeneration !== alarmScheduleGeneration) {
      await cancelAlarmIds([alarm.id])
      return "已取消过期的闹钟同步"
    }
    rememberWorkdayAlarmId(alarm.id, true)
    return formatAlarmTargetMessage(alarmTarget.date, now, alarmHour, alarmMinute)
  } catch (error) {
    return `闹钟创建失败：${String(error)}`
  }
}

async function syncAlarmAndNotification(
  subDays: DayEntry[],
  overrides: LocalOverride[],
  restRule: RestRule = loadRestRule()
) {
  const alarmType = WorkdayStorage.get<AlarmType>(KEY_ALARM_TYPE) ?? "builtin"
  let alarmStatus: string
  if (alarmType === "shortcut") {
    alarmStatus = "已委托快捷指令管理闹钟"
  } else {
    alarmStatus = await scheduleWorkdayAlarm(subDays, overrides, restRule)
  }
  await scheduleNotification(subDays, overrides, restRule)
  return alarmStatus
}

function MonthPickerPopover(props: {
  year: number
  month: number
  currentYear: number
  onYearChange: (year: number) => void
  onMonthChange: (month: number) => void
}) {
  const years = Array.from({ length: 21 }, (_, i) => props.currentYear - 10 + i)

  return (
    <VStack spacing={0} padding={10} frame={{ width: 260, height: 174 }}>
      <HStack spacing={8} frame={{ height: 160 }}>
        <Picker
          title="年份"
          value={props.year}
          onChanged={(v: number) => props.onYearChange(v)}
          pickerStyle="wheel"
          frame={{ width: 136, height: 154 }}
        >
          {years.map((y) => (
            <Text key={`year-${y}`} tag={y}>{`${y}年`}</Text>
          ))}
        </Picker>
        <Picker
          title="月份"
          value={props.month}
          onChanged={(v: number) => props.onMonthChange(v)}
          pickerStyle="wheel"
          frame={{ width: 96, height: 154 }}
        >
          {Array.from({ length: 12 }, (_, i) => {
            const m = i + 1
            return <Text key={`month-${m}`} tag={m}>{`${m}月`}</Text>
          })}
        </Picker>
      </HStack>
    </VStack>
  )
}

function CalendarPage(props: {
  subDays: DayEntry[]
  overrides: LocalOverride[]
  restRule: RestRule
  alarmTime: number
  alarmEnabled: boolean
  dayNotes: Record<string, string>
  onSubDaysChange: (days: DayEntry[]) => void
  onOverridesChange: (overrides: LocalOverride[]) => void
  onDayNotesChange: (notes: Record<string, string>) => void
}) {
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const dismiss = Navigation.useDismiss()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"

  useEffect(() => {
    const url = loadSubUrl()
    if (url) {
      fetchSubscription(url).then((days) => {
        if (days) {
          props.onSubDaysChange(days)
          saveSubCache(days)
          syncAlarmAndNotification(days, props.overrides, props.restRule)
        }
      })
    }
  }, [])

  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfWeek(year, month)
  const cells: (number | null)[] = []

  for (let i = 0; i < firstDay; i++) {
    cells.push(null)
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(d)
  }

  const todayStr = formatDateObj(today)
  const alarmEnabled = props.alarmEnabled
  const alarmDate = new Date(props.alarmTime)
  const alarmHour = alarmDate.getHours()
  const alarmMinute = alarmDate.getMinutes()
  const todayAlarmDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    alarmHour,
    alarmMinute,
    0
  )
  const statusDate = todayAlarmDate.getTime() > today.getTime() ? todayAlarmDate : tomorrow
  const statusDayLabel = formatAlarmTargetDayLabel(statusDate, today)
  const statusDateStr = formatDateObj(statusDate)
  const statusType = getDayType(statusDateStr, props.subDays, props.overrides, props.restRule)
  const statusIsRest = isRestDay(statusType)

  function handleTapDay(day: number) {
    const key = dateStr(year, month, day)
    const currentType = getDayType(key, props.subDays, props.overrides, props.restRule)
    const existingIdx = props.overrides.findIndex((o) => o.date === key)
    let updated: LocalOverride[]

    if (existingIdx >= 0) {
      const existing = props.overrides[existingIdx]
      if (existing.type === "holiday") {
        updated = [...props.overrides]
        updated[existingIdx] = { date: key, type: "workday" }
      } else {
        updated = props.overrides.filter((_, i) => i !== existingIdx)
      }
    } else if (isRestDay(currentType)) {
      updated = [...props.overrides, { date: key, type: "workday" }]
    } else {
      updated = [...props.overrides, { date: key, type: "holiday" }]
    }

    props.onOverridesChange(updated)
    saveOverrides(updated)
    syncAlarmAndNotification(props.subDays, updated, props.restRule)
  }

  async function handleLongPressDay(day: number) {
    const key = dateStr(year, month, day)
    const current = props.dayNotes[key] || ""

    const result = await Dialog.prompt({
      title: "日期备注",
      message: key,
      defaultValue: current,
      placeholder: "为这个日期添加备注",
      confirmButtonTitle: "保存",
      cancelButtonTitle: "取消",
    })

    if (result === undefined) return

    const text = String(result).trim()
    const next = { ...props.dayNotes }

    if (text) {
      next[key] = text
    } else {
      delete next[key]
    }

    props.onDayNotesChange(next)
    saveDayNotes(next)
  }

  function handlePrevMonth() {
    if (month === 1) {
      setYear(year - 1)
      setMonth(12)
    } else {
      setMonth(month - 1)
    }
  }

  function handleNextMonth() {
    if (month === 12) {
      setYear(year + 1)
      setMonth(1)
    } else {
      setMonth(month + 1)
    }
  }

  function handleToday() {
    const now = new Date()
    setYear(now.getFullYear())
    setMonth(now.getMonth() + 1)
  }

  const weekLabels = ["日", "一", "二", "三", "四", "五", "六"]
  const dayCellSize = 42
  const dayCellSpacing = 8
  const gridColumns = Array.from({ length: 7 }, () => ({
    size: dayCellSize,
    spacing: dayCellSpacing,
  }))

  const monthPickerContent = (
    <MonthPickerPopover
      year={year}
      month={month}
      currentYear={today.getFullYear()}
      onYearChange={setYear}
      onMonthChange={setMonth}
    />
  )

  return (
    <NavigationStack>
      <List
        navigationTitle="日历"
        navigationBarTitleDisplayMode="inline"
        toolbar={<Toolbar>
          <ToolbarItem placement="topBarLeading">
            <Button action={() => dismiss()}>
              <Image systemName="xmark" foregroundStyle="red" fontWeight="semibold" />
            </Button>
          </ToolbarItem>
          <ToolbarItem placement="topBarTrailing">
            <Button action={() => Navigation.present(<HelpPage />)}>
              <Image systemName="questionmark.circle" foregroundStyle="#007AFF" fontWeight="semibold" />
            </Button>
          </ToolbarItem>
        </Toolbar>}
      >
        <Section>
          <HStack spacing={12}>
            <Image
              systemName={statusIsRest ? "moon.zzz.fill" : "alarm.fill"}
              foregroundStyle={statusIsRest ? "#34C759" : "#007AFF"}
              font="title2"
            />
            <VStack alignment="leading" spacing={2}>
              <Text font="headline">
                {`${statusDayLabel}${statusIsRest ? "休息" : "上班"}`}
              </Text>
              <Text font="caption" foregroundStyle="#8E8E93">
                {statusIsRest
                  ? `${statusDayLabel}是休息日，闹钟将跳过`
                  : alarmEnabled
                    ? `${statusDayLabel} ${pad(alarmHour)}:${pad(alarmMinute)} 闹钟响起`
                    : "工作日闹钟已关闭"}
              </Text>
            </VStack>
            <Spacer />
          </HStack>
        </Section>

        <Section>
          <VStack spacing={10}>
            <HStack buttonStyle="plain" frame={{ minHeight: 30 }} padding={{ horizontal: 18 }}>
              <Button action={handlePrevMonth}>
                <Image systemName="arrowtriangle.left.fill" foregroundStyle="#007AFF" font="caption" />
              </Button>
              <Spacer />
              <HStack spacing={8} buttonStyle="plain">
                <Button
                  action={() => setShowMonthPicker(true)}
                  popover={{
                    isPresented: showMonthPicker,
                    onChanged: (v) => setShowMonthPicker(v),
                    content: monthPickerContent,
                    arrowEdge: "top",
                    presentationCompactAdaptation: "popover",
                  }}
                >
                  <Text font="headline">{`${year}年${month}月`}</Text>
                </Button>
                <Button action={handleToday}>
                  <Image systemName={`${today.getDate()}.calendar`} foregroundStyle="#007AFF" font="body" />
                </Button>
              </HStack>
              <Spacer />
              <Button action={handleNextMonth}>
                <Image systemName="arrowtriangle.right.fill" foregroundStyle="#007AFF" font="caption" />
              </Button>
            </HStack>

            <Divider />

            <VStack spacing={8}>
              <HStack spacing={dayCellSpacing} padding={5}>
                {weekLabels.map((label, i) => (
                  <Text
                    key={`wh-${i}`}
                    font="callout"
                    fontWeight="semibold"
                    foregroundStyle={i === 0 || i === 6 ? "#8E8E93" : isDark ? "#EBEBF5" : "#3C3C43"}
                    frame={{ width: dayCellSize }}
                    multilineTextAlignment="center"
                  >
                    {label}
                  </Text>
                ))}
              </HStack>
              <LazyVGrid columns={gridColumns} alignment="center" spacing={dayCellSpacing} buttonStyle="plain">
                {cells.map((day, idx) => {
                  if (day === null) {
                    return <Text key={`e-${idx}`} frame={{ width: dayCellSize, height: dayCellSize }}>{" "}</Text>
                  }

                  const key = dateStr(year, month, day)
                  const type = getDayType(key, props.subDays, props.overrides, props.restRule)
                  const isToday = key === todayStr
                  const holidayLabel = getHolidayLabel(key, props.subDays)
                  const noteLabel = props.dayNotes[key] || ""
                  const isRest = isRestDay(type)
                  const isWorkdayOverride = type === "workday"
                  const cardBackground: `#${string}` = isWorkdayOverride ? "#FF9500" : isRest ? "#34C759" : isDark ? "#2C2C2E" : "#FFFFFF"
                  const textColor: `#${string}` = isRest || isWorkdayOverride ? "#FFFFFF" : isDark ? "#EBEBF5" : "#1C1C1E"
                  const todayOutline = isToday ? (
                    <RoundedRectangle
                      cornerRadius={8}
                      stroke={{ shapeStyle: "#007AFF", strokeStyle: { lineWidth: 2 } }}
                    />
                  ) : undefined

                  return (
                    <VStack
                      key={`d-${idx}`}
                      spacing={2}
                      frame={{ width: dayCellSize, height: dayCellSize }}
                      padding={{ horizontal: 2, vertical: 4 }}
                      background={cardBackground}
                      clipShape={{ type: "rect", cornerRadius: 8 }}
                      contentShape={{ type: "rect", cornerRadius: 8 }}
                      overlay={todayOutline}
                      onTapGesture={() => handleTapDay(day)}
                      onLongPressGesture={() => handleLongPressDay(day)}
                    >
                      <Text
                        font="callout"
                        fontWeight={isToday ? "bold" : "regular"}
                        foregroundStyle={isToday && !isRest && !isWorkdayOverride ? "#007AFF" : textColor}
                      >
                        {day.toString()}
                      </Text>
                      <MarqueeText
                        text={noteLabel || holidayLabel}
                        font="caption2"
                        fontWeight="semibold"
                        foregroundStyle={isToday && !isRest && !isWorkdayOverride ? "#007AFF" : textColor}
                        maxChars={3}
                        cycleDuration={6}
                        frame={{ maxWidth: "infinity" }}
                      />
                    </VStack>
                  )
                })}
              </LazyVGrid>
            </VStack>

            <Divider />

            <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
              <HStack spacing={18}>
                <HStack spacing={5}>
                  <Image systemName="square.fill" foregroundStyle="#34C759" font="caption" />
                  <Text font="caption">休息日</Text>
                </HStack>
                <HStack spacing={5}>
                  <Image systemName="square.fill" foregroundStyle="#FF9500" font="caption" />
                  <Text font="caption">工作日（调休）</Text>
                </HStack>
                <Spacer />
              </HStack>
              <Text font="caption2" foregroundStyle="#8E8E93">
                点击日期可手动标注：休息→上班→还原；长按日期可输入备注
              </Text>
            </VStack>
          </VStack>
        </Section>
      </List>
    </NavigationStack>
  )
}

function WeekdaySelector(props: {
  days: number[]
  onChange: (days: number[]) => void
}) {
  const labels = ["日", "一", "二", "三", "四", "五", "六"]
  return (
    <HStack spacing={8} buttonStyle="plain">
      {labels.map((label, index) => {
        const selected = props.days.includes(index)
        return (
          <Button
            key={`weekday-${index}-${selected ? "on" : "off"}`}
            action={() => props.onChange(
              selected
                ? props.days.filter((d) => d !== index)
                : [...props.days, index].sort((a, b) => a - b)
            )}
          >
            <Text
              font="body"
              foregroundStyle={selected ? "#FFFFFF" : "#1C1C1E"}
              frame={{ maxWidth: "infinity", minHeight: 40 }}
              background={selected ? "#34C759" : undefined}
              clipShape="capsule"
            >
              {label}
            </Text>
          </Button>
        )
      })}
    </HStack>
  )
}

function SoundManagerPage(props: {
  currentSound: string
  onSoundSelected: (sound: string) => Promise<void>
}) {
  const dismiss = Navigation.useDismiss()
  const colorScheme = useColorScheme()
  const primaryTextColor = colorScheme === "dark" ? "#EBEBF5" : "#1C1C1E"
  const [sounds, setSounds] = useState<string[]>([DEFAULT_ALARM_SOUND])
  const [selectedSound, setSelectedSound] = useState(props.currentSound)
  const [toastMessage, setToastMessage] = useState("")
  const [showToast, setShowToast] = useState(false)

  function showTopToast(message: string) {
    setToastMessage(message)
    setShowToast(false)
    setTimeout(() => setShowToast(true), 0)
  }

  async function reloadSounds() {
    try {
      setSounds(await loadAvailableSoundNames())
    } catch (error) {
      showTopToast(`读取铃声失败：${String(error)}`)
    }
  }

  useEffect(() => {
    reloadSounds()
  }, [])

  async function handleImportSounds() {
    const files = await DocumentPicker.pickFiles({
      types: [
        "public.mp3",
        "public.aiff-audio",
        "com.microsoft.waveform-audio",
        "com.apple.coreaudio-format" as UTType,
      ],
      shouldShowFileExtensions: true,
      allowsMultipleSelection: true,
    })
    if (!files.length) return

    const imported: string[] = []
    const skipped: string[] = []
    for (const file of files) {
      try {
        imported.push(importSoundFileToLibrary(file))
      } catch {
        skipped.push(Path.basename(file))
      }
    }

    await reloadSounds()
    if (imported.length > 0) {
      const nextSound = imported[imported.length - 1]
      setSelectedSound(nextSound)
      await props.onSoundSelected(nextSound)
    }
    showTopToast(
      skipped.length
        ? `已导入 ${imported.length} 个，跳过 ${skipped.length} 个不支持文件`
        : `已导入 ${imported.length} 个铃声`
    )
  }

  async function handleSelectSound(sound: string) {
    setSelectedSound(sound)
    await props.onSoundSelected(sound)
    showTopToast(sound === DEFAULT_ALARM_SOUND ? "已选择默认铃声" : `已选择 ${soundDisplayName(sound)}`)
  }

  async function renameSoundWithPrompt(sound: string) {
    const ext = Path.extname(sound)
    const currentName = ext ? sound.slice(0, -ext.length) : sound
    const nextName = await Dialog.prompt({
      title: "重命名铃声",
      message: `请输入「${soundDisplayName(sound)}」的新名称`,
      defaultValue: currentName,
    })
    if (!nextName?.trim() || nextName.trim() === currentName) return

    try {
      const renamed = renameManagedSound(sound, `${nextName}${ext}`)
      setSounds((items) => normalizeSoundNames(items.map((item) => item === sound ? renamed : item)))
      if (selectedSound === sound) {
        setSelectedSound(renamed)
        await props.onSoundSelected(renamed)
      }
      showTopToast(`已重命名为 ${soundDisplayName(renamed)}`)
    } catch (error) {
      showTopToast(`重命名失败：${String(error).replace(/^Error: /, "")}`)
    }
  }

  async function deleteSoundWithConfirm(sound: string) {
    const index = await Dialog.actionSheet({
      title: "删除确认",
      message: `确定删除「${soundDisplayName(sound)}」吗？此操作不可恢复。`,
      actions: [{ label: "取消" }, { label: "删除", destructive: true }],
      cancelButton: false,
    })

    if (index !== 1) return

    try {
      removeManagedSound(sound)
      setSounds((items) => items.filter((item) => item !== sound))
      if (selectedSound === sound) {
        setSelectedSound(DEFAULT_ALARM_SOUND)
        await props.onSoundSelected(DEFAULT_ALARM_SOUND)
      }
      showTopToast(`已删除 ${soundDisplayName(sound)}`)
    } catch (error) {
      showTopToast(`删除失败：${String(error).replace(/^Error: /, "")}`)
    }
  }

  return (
    <NavigationStack>
      <List
        toast={{
          message: toastMessage,
          isPresented: showToast,
          onChanged: setShowToast,
          position: "top",
          duration: 2,
        }}
        navigationTitle="铃声管理"
        navigationBarTitleDisplayMode="inline"
        toolbar={<Toolbar>
          <ToolbarItem placement="topBarLeading">
            <Button action={() => dismiss()}>
              <Image systemName="chevron.left" foregroundStyle="#007AFF" fontWeight="semibold" />
            </Button>
          </ToolbarItem>
          <ToolbarItem placement="topBarTrailing">
            <Button action={handleImportSounds}>
              <Image systemName="plus" foregroundStyle="#007AFF" fontWeight="semibold" />
            </Button>
          </ToolbarItem>
        </Toolbar>}
      >
        <Section>
          {sounds.map((sound) => {
            const isDefault = sound === DEFAULT_ALARM_SOUND
            const isSelected = sound === selectedSound
            return (
              <Button
                key={`managed-sound-${sound}`}
                action={() => handleSelectSound(sound)}
                buttonStyle="plain"
                trailingSwipeActions={isDefault ? undefined : {
                  allowsFullSwipe: false,
                  actions: [
                    <Button title="重命名" systemImage="pencil" action={() => renameSoundWithPrompt(sound)} />,
                    <Button title="删除" systemImage="trash" tint="#FF3B30" action={() => deleteSoundWithConfirm(sound)} />,
                  ],
                }}
              >
                <HStack
                  spacing={12}
                  frame={{ maxWidth: "infinity", minHeight: 44, alignment: "leading" }}
                  contentShape="rect"
                >
                  <HStack alignment="top" spacing={12}>
                    <Image
                      systemName={isDefault ? "speaker.wave.2.fill" : "music.note"}
                      foregroundStyle="#007AFF"
                      frame={{ width: 22, height: 20, alignment: "center" }}
                    />
                    <VStack alignment="leading" spacing={2}>
                      <Text foregroundStyle={primaryTextColor}>{soundDisplayName(sound)}</Text>
                      <Text font="caption2" foregroundStyle="#8E8E93">
                        {isDefault ? "系统默认" : `${Path.extname(sound).replace(".", "").toUpperCase()} 音频`}
                      </Text>
                    </VStack>
                  </HStack>
                  <Spacer />
                  {isSelected ? <Image systemName="checkmark" foregroundStyle="#34C759" /> : null}
                </HStack>
              </Button>
            )
          })}
        </Section>
      </List>
    </NavigationStack>
  )
}

function SettingsPage(props: {
  subDays: DayEntry[]
  overrides: LocalOverride[]
  restRule: RestRule
  alarmEnabled: boolean
  alarmType: AlarmType
  alarmTime: number
  onAlarmEnabledChange: (enabled: boolean) => void
  onAlarmTypeChange: (type: AlarmType) => void
  onAlarmTimeChange: (timestamp: number) => void
  onSubDaysChange: (days: DayEntry[]) => void
  onOverridesChange: (overrides: LocalOverride[]) => void
  onRestRuleChange: (rule: RestRule) => void
}) {
  const [availableSounds, setAvailableSounds] = useState<string[]>([DEFAULT_ALARM_SOUND])
  const [alarmSound, setAlarmSound] = useState(getAlarmSoundSetting)
  const [snoozeMinutes, setSnoozeMinutes] = useState(getSnoozeMinutes)
  const [notifyEnabled, setNotifyEnabled] = useState(
    () => WorkdayStorage.get<boolean>(KEY_NOTIFY_ENABLED) ?? DEFAULT_NOTIFY_ENABLED
  )
  const [notifyTime, setNotifyTime] = useState(() => {
    const h = WorkdayStorage.get<number>(KEY_NOTIFY_HOUR) ?? DEFAULT_NOTIFY_HOUR
    const m = WorkdayStorage.get<number>(KEY_NOTIFY_MINUTE) ?? DEFAULT_NOTIFY_MINUTE
    return new Date(2026, 0, 1, h, m, 0).getTime()
  })
  const [selectedOverrideYear, setSelectedOverrideYear] = useState(() => new Date().getFullYear())
  const [subUrl, setSubUrl] = useState(loadSubUrl)
  const [urlInput, setUrlInput] = useState(loadSubUrl)
  const [fetchStatus, setFetchStatus] = useState("")
  const [alarmStatus, setAlarmStatus] = useState("正在同步闹钟...")
  const [restRuleExpanded, setRestRuleExpanded] = useState(false)
  const dismiss = Navigation.useDismiss()
  const colorScheme = useColorScheme()
  const primaryTextColor = colorScheme === "dark" ? "#EBEBF5" : "#1C1C1E"

  useEffect(() => {
    syncAlarmAndNotification(props.subDays, props.overrides, props.restRule).then(setAlarmStatus)
  }, [props.subDays, props.overrides, props.restRule, props.alarmEnabled])

  async function refreshAvailableSounds() {
    const sounds = await loadAvailableSoundNames()
    setAvailableSounds(sounds)
    const current = getAlarmSoundSetting()
    if (!sounds.includes(current)) {
      WorkdayStorage.set(KEY_ALARM_SOUND, DEFAULT_ALARM_SOUND)
      setAlarmSound(DEFAULT_ALARM_SOUND)
    }
    return sounds
  }

  useEffect(() => {
    refreshAvailableSounds().catch(() => {
      setAvailableSounds([DEFAULT_ALARM_SOUND])
      WorkdayStorage.set(KEY_ALARM_SOUND, DEFAULT_ALARM_SOUND)
      setAlarmSound(DEFAULT_ALARM_SOUND)
    })
  }, [])

  async function handleToggleAlarm(enabled: boolean) {
    props.onAlarmEnabledChange(enabled)
    WorkdayStorage.set(KEY_ALARM_ENABLED, enabled)
    setAlarmStatus(enabled ? "正在开启闹钟..." : "正在关闭闹钟...")
    setAlarmStatus(await syncAlarmAndNotification(props.subDays, props.overrides, props.restRule))
  }

  async function handleAlarmTimeChange(timestamp: number) {
    props.onAlarmTimeChange(timestamp)
    const d = new Date(timestamp)
    WorkdayStorage.set(KEY_ALARM_HOUR, d.getHours())
    WorkdayStorage.set(KEY_ALARM_MINUTE, d.getMinutes())
    setAlarmStatus(await syncAlarmAndNotification(props.subDays, props.overrides, props.restRule))
  }

  async function selectAlarmSound(sound: string) {
    try {
      ensureAlarmSoundImported(sound)
    } catch (error) {
      setAlarmStatus(`铃声不可用：${String(error)}`)
      return
    }
    setAlarmSound(sound)
    WorkdayStorage.set(KEY_ALARM_SOUND, sound)
    await refreshAvailableSounds()
    setAlarmStatus(await syncAlarmAndNotification(props.subDays, props.overrides, props.restRule))
  }

  async function handleAlarmSoundChange(index: number) {
    const sound = availableSounds[index] || DEFAULT_ALARM_SOUND
    await selectAlarmSound(sound)
  }

  async function handleOpenSoundManager() {
    await Navigation.present(
      <SoundManagerPage
        currentSound={alarmSound}
        onSoundSelected={selectAlarmSound}
      />
    )
    await refreshAvailableSounds()
  }

  async function handleSnoozeMinutesChange(minutes: number) {
    setSnoozeMinutes(minutes)
    WorkdayStorage.set(KEY_ALARM_SNOOZE_MINUTES, minutes)
    setAlarmStatus(await syncAlarmAndNotification(props.subDays, props.overrides, props.restRule))
  }

  async function handleAlarmTypeChange(type: AlarmType) {
    props.onAlarmTypeChange(type)
    WorkdayStorage.set(KEY_ALARM_TYPE, type)
    if (type === "shortcut") {
      await cancelWorkdayAlarm()
    }
    setAlarmStatus(await syncAlarmAndNotification(props.subDays, props.overrides, props.restRule))
  }

  async function handleToggleNotify(enabled: boolean) {
    setNotifyEnabled(enabled)
    WorkdayStorage.set(KEY_NOTIFY_ENABLED, enabled)
    setAlarmStatus(await syncAlarmAndNotification(props.subDays, props.overrides, props.restRule))
  }

  async function handleNotifyTimeChange(timestamp: number) {
    setNotifyTime(timestamp)
    const d = new Date(timestamp)
    WorkdayStorage.set(KEY_NOTIFY_HOUR, d.getHours())
    WorkdayStorage.set(KEY_NOTIFY_MINUTE, d.getMinutes())
    setAlarmStatus(await syncAlarmAndNotification(props.subDays, props.overrides, props.restRule))
  }

  async function handleSaveUrl() {
    const url = urlInput.trim()
    saveSubUrl(url)
    setSubUrl(url)
    if (!url) {
      props.onSubDaysChange([])
      saveSubCache([])
      setFetchStatus("已清除订阅")
      setAlarmStatus(await syncAlarmAndNotification([], props.overrides, props.restRule))
      return
    }

    setFetchStatus("正在获取...")
    const days = await fetchSubscription(url)
    if (days) {
      props.onSubDaysChange(days)
      saveSubCache(days)
      setFetchStatus(`成功获取 ${days.length} 条日历数据`)
      setAlarmStatus(await syncAlarmAndNotification(days, props.overrides, props.restRule))
    } else {
      setFetchStatus("获取失败，请检查 URL")
    }
  }

  async function handleClearSelectedYearOverrides() {
    const updated = props.overrides.filter(
      (override) => Number(override.date.slice(0, 4)) !== selectedOverrideYear
    )
    props.onOverridesChange(updated)
    saveOverrides(updated)
    setAlarmStatus(await syncAlarmAndNotification(props.subDays, updated, props.restRule))
  }

  async function handleClearOverrides() {
    props.onOverridesChange([])
    saveOverrides([])
    setAlarmStatus(await syncAlarmAndNotification(props.subDays, [], props.restRule))
  }

  async function updateRestRule(rule: RestRule) {
    props.onRestRuleChange(rule)
    saveRestRule(rule)
    setAlarmStatus(await syncAlarmAndNotification(props.subDays, props.overrides, rule))
  }

  const notifyDate = new Date(notifyTime)
  const currentYear = new Date().getFullYear()
  const overrideYearStats = getOverrideYearStats(props.overrides)
  const overrideYearOptions = Array.from(
    new Set([currentYear, ...overrideYearStats.map((stat) => stat.year)])
  ).sort((a, b) => b - a)
  const selectedOverrideStat = overrideYearStats.find((stat) => stat.year === selectedOverrideYear) || {
    year: selectedOverrideYear,
    holidayCount: 0,
    workdayCount: 0,
  }
  const hasSelectedYearOverrides = selectedOverrideStat.holidayCount + selectedOverrideStat.workdayCount > 0
  const restRuleTitle = props.restRule.mode === "fixed"
    ? "固定休息日"
    : props.restRule.mode === "weekCycle"
      ? "多周循环（大小周）"
      : "多天循环（轮休/倒班）"

  return (
    <NavigationStack>
      <List navigationTitle="设置" navigationBarTitleDisplayMode="inline"
        toolbar={<Toolbar>
          <ToolbarItem placement="topBarLeading">
            <Button action={() => dismiss()}>
              <Image systemName="xmark" foregroundStyle="red" fontWeight="semibold" />
            </Button>
          </ToolbarItem>
        </Toolbar>}
      >
        <Section
          header={<Text>闹钟设置</Text>}
          footer={
            <Text>
              {props.alarmType === "shortcut"
                ? "快捷指令模式不会创建内置闹钟；脚本只同步日历和提醒，由快捷指令接收结果后自行设置闹钟"
                : "内置模式会设置下一个未过的工作日闹钟：今天闹钟时间未过则优先今天，否则再判断明天；休息日会自动跳过"}
            </Text>
          }
        >
          <HStack>
            <Label title="工作日闹钟" systemImage="alarm.fill" />
            <Spacer />
            <Toggle
              title=""
              value={props.alarmEnabled}
              onChanged={handleToggleAlarm}
              tint="#007AFF"
            />
          </HStack>
          <Picker
            title="闹钟类型"
            value={props.alarmType === "shortcut" ? 1 : 0}
            onChanged={(v: number) => handleAlarmTypeChange(v === 1 ? "shortcut" : "builtin")}
          >
            <Text tag={0}>内置</Text>
            <Text tag={1}>快捷指令</Text>
          </Picker>
          {props.alarmType === "builtin" ? (
            <DatePicker
              title="闹钟时间"
              displayedComponents={["hourAndMinute"]}
              value={props.alarmTime}
              onChanged={handleAlarmTimeChange}
            />
          ) : null}
          {props.alarmType === "builtin" ? (
            <Picker
              title="稍后提醒"
              value={snoozeMinutes}
              onChanged={(v: number) => handleSnoozeMinutesChange(v)}
            >
              {SNOOZE_MINUTE_OPTIONS.map((minutes) => (
                <Text key={`snooze-${minutes}`} tag={minutes}>{`${minutes} 分钟`}</Text>
              ))}
            </Picker>
          ) : null}
          {props.alarmType === "builtin" ? (
            <Picker
              title="闹钟铃声"
              value={Math.max(0, availableSounds.indexOf(alarmSound))}
              onChanged={handleAlarmSoundChange}
            >
              {availableSounds.map((item, index) => (
                <Text key={`sound-${item}`} tag={index}>{soundDisplayName(item)}</Text>
              ))}
            </Picker>
          ) : null}
          {props.alarmType === "builtin" ? (
            <Button action={handleOpenSoundManager} buttonStyle="plain">
              <HStack
                frame={{ maxWidth: "infinity", minHeight: 20, alignment: "leading" }}
                contentShape="rect"
              >
                <Text foregroundStyle={primaryTextColor}>铃声管理</Text>
                <Spacer />
                <Image systemName="chevron.right" foregroundStyle="#8E8E93" font="caption" />
              </HStack>
            </Button>
          ) : null}
          <HStack>
            <Text>闹钟状态</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="#8E8E93">
              {alarmStatus}
            </Text>
          </HStack>
        </Section>

        <Section
          header={<Text>日历设置</Text>}
          footer={
            <VStack alignment="leading" spacing={4}>
              <Text font="caption2" foregroundStyle="#8E8E93">
                订阅和手动标注会覆盖自定义休息规则；保存订阅链接会立即获取数据，打开日历页也会自动刷新一次
              </Text>
              <Text font="caption2" foregroundStyle="#8E8E93">
                支持 JSON 和 ICS 格式（如 https://ical.muhan.org/），手动标注优先级最高
              </Text>
            </VStack>
          }
        >
          <VStack alignment="leading" spacing={6}>
            <HStack spacing={8}>
              <Label title="订阅链接" systemImage="link" />
              <TextField
                title=""
                prompt="输入日历订阅地址"
                value={urlInput}
                onChanged={setUrlInput}
                multilineTextAlignment="leading"
              />
              <Button action={handleSaveUrl} buttonStyle="plain">
                <Image
                  systemName={subUrl ? "checkmark.circle.fill" : "arrow.down.circle.fill"}
                  foregroundStyle={subUrl ? "#34C759" : "#007AFF"}
                  font="title3"
                />
              </Button>
            </HStack>
            <HStack>
              <Spacer />
              <Text font="caption2" foregroundStyle="#8E8E93">
                {subUrl ? `已获取 ${props.subDays.length} 条日历数据` : "未配置订阅链接"}{fetchStatus ? ` · ${fetchStatus}` : ""}
              </Text>
            </HStack>
          </VStack>

          <Button
            action={() => setRestRuleExpanded(!restRuleExpanded)}
            buttonStyle="plain"
          >
            <HStack>
              <Label title="休息日类型" systemImage="calendar.badge.clock" />
              <Spacer />
              <Text foregroundStyle="#8E8E93">
                {restRuleTitle}
              </Text>
              <Image
                systemName={restRuleExpanded ? "chevron.up" : "chevron.down"}
                foregroundStyle="#8E8E93"
                font="caption"
              />
            </HStack>
          </Button>

          {restRuleExpanded ? (
            <HStack
              contentShape="rect"
              onTapGesture={() => updateRestRule({ ...props.restRule, mode: "fixed" })}
            >
              <Text>固定休息日</Text>
              <Spacer />
              {props.restRule.mode === "fixed" ? (
                <Image systemName="checkmark" foregroundStyle="#007AFF" font="title3" />
              ) : null}
            </HStack>
          ) : null}
          {restRuleExpanded ? (
            <HStack
              contentShape="rect"
              onTapGesture={() => updateRestRule({ ...props.restRule, mode: "weekCycle" })}
            >
              <Text>多周循环（大小周）</Text>
              <Spacer />
              {props.restRule.mode === "weekCycle" ? (
                <Image systemName="checkmark" foregroundStyle="#007AFF" font="title3" />
              ) : null}
            </HStack>
          ) : null}
          {restRuleExpanded ? (
            <HStack
              contentShape="rect"
              onTapGesture={() => updateRestRule({ ...props.restRule, mode: "dayCycle" })}
            >
              <Text>多天循环（轮休/倒班）</Text>
              <Spacer />
              {props.restRule.mode === "dayCycle" ? (
                <Image systemName="checkmark" foregroundStyle="#007AFF" font="title3" />
              ) : null}
            </HStack>
          ) : null}

          {restRuleExpanded && props.restRule.mode === "fixed" ? (
            <VStack alignment="leading" spacing={10}>
              <Text font="subheadline">选择每周固定休息日</Text>
              <WeekdaySelector
                days={props.restRule.fixedWeekdays}
                onChange={(days) => updateRestRule({ ...props.restRule, fixedWeekdays: days })}
              />
            </VStack>
          ) : null}

          {restRuleExpanded && props.restRule.mode === "weekCycle" ? (
            <VStack alignment="leading" spacing={12}>
              <DatePicker
                title="循环开始于"
                displayedComponents={["date"]}
                value={parseDateKey(props.restRule.weekCycleStart).getTime()}
                onChanged={(timestamp: number) => updateRestRule({
                  ...props.restRule,
                  weekCycleStart: formatDateObj(new Date(timestamp)),
                })}
              />
              <VStack alignment="leading" spacing={8}>
                <Text font="subheadline">第一周休息</Text>
                <WeekdaySelector
                  days={props.restRule.weekCycleWeeks[0] || []}
                  onChange={(days) => updateRestRule({
                    ...props.restRule,
                    weekCycleWeeks: [days, props.restRule.weekCycleWeeks[1] || []],
                  })}
                />
              </VStack>
              <VStack alignment="leading" spacing={8}>
                <Text font="subheadline">第二周休息</Text>
                <WeekdaySelector
                  days={props.restRule.weekCycleWeeks[1] || []}
                  onChange={(days) => updateRestRule({
                    ...props.restRule,
                    weekCycleWeeks: [props.restRule.weekCycleWeeks[0] || [], days],
                  })}
                />
              </VStack>
            </VStack>
          ) : null}

          {restRuleExpanded && props.restRule.mode === "dayCycle" ? (
            <VStack alignment="leading" spacing={10}>
              <DatePicker
                title="循环开始于"
                displayedComponents={["date"]}
                value={parseDateKey(props.restRule.dayCycleStart).getTime()}
                onChanged={(timestamp: number) => updateRestRule({
                  ...props.restRule,
                  dayCycleStart: formatDateObj(new Date(timestamp)),
                })}
              />
              <Stepper
                onIncrement={() => updateRestRule({
                  ...props.restRule,
                  dayCycleWorkDays: Math.min(30, props.restRule.dayCycleWorkDays + 1),
                })}
                onDecrement={() => updateRestRule({
                  ...props.restRule,
                  dayCycleWorkDays: Math.max(1, props.restRule.dayCycleWorkDays - 1),
                })}
              >
                <HStack padding={10}>
                  <Text>先工作</Text>
                  <Spacer />
                  <Text foregroundStyle="#8E8E93">{`${props.restRule.dayCycleWorkDays}天`}</Text>
                </HStack>
              </Stepper>
              <Stepper
                onIncrement={() => updateRestRule({
                  ...props.restRule,
                  dayCycleRestDays: Math.min(30, props.restRule.dayCycleRestDays + 1),
                })}
                onDecrement={() => updateRestRule({
                  ...props.restRule,
                  dayCycleRestDays: Math.max(1, props.restRule.dayCycleRestDays - 1),
                })}
              >
                <HStack padding={10}>
                  <Text>再休息</Text>
                  <Spacer />
                  <Text foregroundStyle="#8E8E93">{`${props.restRule.dayCycleRestDays}天`}</Text>
                </HStack>
              </Stepper>
            </VStack>
          ) : null}
        </Section>

        <Section
          header={<Text>通知设置</Text>}
          footer={
            <Text>
              {props.alarmType === "shortcut"
                ? "开启后，由快捷指令调用「明天休息吗」时即时推送通知"
                : "每天在设定时间推送通知，提前告知明天是工作日还是休息日"}
            </Text>
          }
        >
          <HStack>
            <Label title="启用明日提醒" systemImage="bell.fill" />
            <Spacer />
            <Toggle
              title=""
              value={notifyEnabled}
              onChanged={handleToggleNotify}
              tint="#007AFF"
            />
          </HStack>
          {props.alarmType !== "shortcut" ? (
            <DatePicker
              title="通知时间"
              displayedComponents={["hourAndMinute"]}
              value={notifyTime}
              onChanged={handleNotifyTimeChange}
            />
          ) : null}
          {props.alarmType !== "shortcut" ? (
            <HStack>
              <Text>当前设定</Text>
              <Spacer />
              <Text foregroundStyle="#8E8E93">
                {`每天 ${pad(notifyDate.getHours())}:${pad(notifyDate.getMinutes())} 推送`}
              </Text>
            </HStack>
          ) : null}
        </Section>

        <Section
          header={<Text>手动标注管理</Text>}
          footer={<Text>在日历页点击日期可快速切换：休息 → 上班 → 还原</Text>}
        >
          <HStack>
            <Label title="已标注日期" systemImage="hand.tap.fill" />
            <Spacer />
            <Picker
              title=""
              value={selectedOverrideYear}
              onChanged={(year: number) => setSelectedOverrideYear(year)}
              frame={{ width: 112 }}
            >
              {overrideYearOptions.map((year) => (
                <Text key={`override-year-${year}`} tag={year}>{`${year}年`}</Text>
              ))}
            </Picker>
          </HStack>
          <VStack alignment="leading" spacing={8} padding={{ vertical: 4 }}>
            <HStack>
              <Text foregroundStyle="#8E8E93">休息日</Text>
              <Spacer />
              <Text foregroundStyle="#34C759">{`${selectedOverrideStat.holidayCount} 天`}</Text>
            </HStack>
            <HStack>
              <Text foregroundStyle="#8E8E93">工作日（调休）</Text>
              <Spacer />
              <Text foregroundStyle="#FF9500">{`${selectedOverrideStat.workdayCount} 天`}</Text>
            </HStack>
          </VStack>
          {hasSelectedYearOverrides && (
            <Button role="destructive" action={handleClearSelectedYearOverrides}>
              <Label title={`清除${selectedOverrideYear}年手动标注`} systemImage="trash" />
            </Button>
          )}
          {props.overrides.length > 0 && (
            <Button role="destructive" action={handleClearOverrides}>
              <Label title="清除所有手动标注" systemImage="trash.fill" />
            </Button>
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}

function HelpPage() {
  const dismiss = Navigation.useDismiss()

  return (
    <NavigationStack>
      <List
        navigationTitle="使用说明"
        navigationBarTitleDisplayMode="inline"
        toolbar={<Toolbar>
          <ToolbarItem placement="topBarLeading">
            <Button action={() => dismiss()}>
              <Image systemName="chevron.left" foregroundStyle="#007AFF" fontWeight="semibold" />
            </Button>
          </ToolbarItem>
        </Toolbar>}
      >
        <Section header={<Text>日历查看</Text>}>
          <VStack alignment="leading" spacing={8}>
            <HStack spacing={8}>
              <Image systemName="alarm.fill" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">顶部显示今天或明天的休息/上班状态，以及对应闹钟提示</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="chevron.left.forwardslash.chevron.right" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">左右箭头切换月份，点击年月可快速选择年月</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="calendar" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">年月右侧日历图标可回到今天所在月份</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="character" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">节假日名称会显示在日期下方</Text>
            </HStack>
          </VStack>
        </Section>

        <Section header={<Text>休息日判定</Text>}>
          <VStack alignment="leading" spacing={8}>
            <HStack spacing={8}>
              <Image systemName="1.circle.fill" foregroundStyle="#FF9500" font="subheadline" />
              <Text font="subheadline">手动标注优先级最高</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="2.circle.fill" foregroundStyle="#FF9500" font="subheadline" />
              <Text font="subheadline">其次使用订阅的节假日或补班数据</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="3.circle.fill" foregroundStyle="#FF9500" font="subheadline" />
              <Text font="subheadline">最后使用自定义休息规则</Text>
            </HStack>
          </VStack>
        </Section>

        <Section header={<Text>自定义规则</Text>}>
          <VStack alignment="leading" spacing={8}>
            <HStack spacing={8}>
              <Image systemName="calendar.badge.clock" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">固定休息日：按每周固定星期休息</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="repeat" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">多周循环：适合大小周等按周循环排班</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="arrow.triangle.2.circlepath" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">多天循环：适合做几休几、轮休或倒班</Text>
            </HStack>
          </VStack>
        </Section>

        <Section header={<Text>闹钟模式</Text>}>
          <VStack alignment="leading" spacing={8}>
            <HStack spacing={8}>
              <Image systemName="alarm.fill" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">内置：使用系统闹钟能力，自动设置下一个未过的工作日闹钟</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="arrow.turn.down.right" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">当天闹钟时间未过且当天为工作日时，会优先保留/设置当天闹钟</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="arrow.turn.down.right" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">内置模式默认开启稍后提醒，可在设置页选择时长</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="square.2.layers.3d.fill" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">快捷指令：不创建内置闹钟，由快捷指令接收脚本结果后自行处理</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="arrow.turn.down.right" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">切换到快捷指令模式时，会清空已记录的内置闹钟</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="music.note" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">内置模式可在设置页选择系统默认或指定名称的铃声</Text>
            </HStack>
            <HStack spacing={8}>
               <Image systemName="arrow.turn.down.right" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">自定义铃声可在设置页的铃声管理中从文件管理导入</Text>
            </HStack>
            <HStack spacing={8}>
               <Image systemName="arrow.turn.down.right" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">支持格式：.aiff、.wav、.caf、.mp3</Text>
            </HStack>
          </VStack>
        </Section>

        <Section header={<Text>快捷指令参数</Text>}>
          <VStack alignment="leading" spacing={8}>
            <HStack spacing={8}>
              <Image systemName="questionmark.circle.fill" foregroundStyle="#34C759" font="subheadline" />
              <Text font="subheadline">传入"明天是否休息日？"，返回"是"或"否"</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="briefcase.fill" foregroundStyle="#34C759" font="subheadline" />
              <Text font="subheadline">传入"下一个工作日是？"，返回日期</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="moon.zzz.fill" foregroundStyle="#34C759" font="subheadline" />
              <Text font="subheadline">传入"下一个休息日是？"，返回日期</Text>
            </HStack>
          </VStack>
        </Section>

        <Section header={<Text>订阅与提醒</Text>}>
          <VStack alignment="leading" spacing={8}>
            <HStack spacing={8}>
              <Image systemName="globe" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">订阅支持 JSON 和 ICS 格式的节假日日历 URL</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="arrow.clockwise" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">保存订阅链接会立即获取数据，打开日历页时也会自动刷新一次</Text>
            </HStack>
            <HStack spacing={8}>
              <Image systemName="bell.fill" foregroundStyle="#007AFF" font="subheadline" />
              <Text font="subheadline">可开启每日提醒，提前告知明天上班或休息</Text>
            </HStack>
          </VStack>
        </Section>
      </List>
    </NavigationStack>
  )
}

function MainView() {
  const [subDays, setSubDays] = useState<DayEntry[]>(loadSubCache)
  const [overrides, setOverrides] = useState<LocalOverride[]>(loadOverrides)
  const [restRule, setRestRule] = useState<RestRule>(loadRestRule)
  const [dayNotes, setDayNotes] = useState<Record<string, string>>(loadDayNotes)
  const [alarmEnabled, setAlarmEnabled] = useState(
    () => WorkdayStorage.get<boolean>(KEY_ALARM_ENABLED) ?? true
  )
  const [alarmType, setAlarmType] = useState<AlarmType>(
    () => WorkdayStorage.get<AlarmType>(KEY_ALARM_TYPE) ?? "builtin"
  )
  const [alarmTime, setAlarmTime] = useState(() => {
    const h = WorkdayStorage.get<number>(KEY_ALARM_HOUR) ?? 7
    const m = WorkdayStorage.get<number>(KEY_ALARM_MINUTE) ?? 30
    return new Date(2026, 0, 1, h, m, 0).getTime()
  })

  return (
    <TabView>
      <Tab title="日历" systemImage="calendar">
        <CalendarPage
          subDays={subDays}
          overrides={overrides}
          restRule={restRule}
          alarmTime={alarmTime}
          alarmEnabled={alarmEnabled}
          dayNotes={dayNotes}
          onSubDaysChange={setSubDays}
          onOverridesChange={setOverrides}
          onDayNotesChange={setDayNotes}
        />
      </Tab>
      <Tab title="设置" systemImage="gearshape">
        <SettingsPage
          subDays={subDays}
          overrides={overrides}
          restRule={restRule}
          alarmEnabled={alarmEnabled}
          alarmType={alarmType}
          alarmTime={alarmTime}
          onAlarmEnabledChange={setAlarmEnabled}
          onAlarmTypeChange={setAlarmType}
          onAlarmTimeChange={setAlarmTime}
          onSubDaysChange={setSubDays}
          onOverridesChange={setOverrides}
          onRestRuleChange={setRestRule}
        />
      </Tab>
    </TabView>
  )
}

async function run() {
  const subDays = loadSubCache()
  const overrides = loadOverrides()
  const restRule = loadRestRule()
  await syncAlarmAndNotification(subDays, overrides, restRule)
  await Navigation.present(<MainView />)
  Script.exit()
}

run()
