import { AppIntentManager, AppIntentProtocol, Path, Script } from "scripting"

const KEY_WORKDAY_ALARM_IDS = "alarm_workday_alarm_ids"
const KEY_WORKDAY_ALARM_ID = "alarm_workday_alarm_id"
const KEY_WORKDAY_NEXT_ALARM_ID = "alarm_workday_next_alarm_id"
const KEY_SUB_CACHE = "alarm_sub_cache"
const KEY_OVERRIDES = "alarm_overrides"
const KEY_REST_RULE = "alarm_rest_rule"
const KEY_ALARM_ENABLED = "alarm_enabled"
const KEY_ALARM_HOUR = "alarm_hour"
const KEY_ALARM_MINUTE = "alarm_minute"
const KEY_ALARM_TYPE = "alarm_type"
const KEY_ALARM_SNOOZE_MINUTES = "alarm_snooze_minutes"
const KEY_ALARM_SOUND = "alarm_sound"
const DEFAULT_SNOOZE_MINUTES = 5
const DEFAULT_ALARM_SOUND = "Default"
const SCRIPT_NAME = "工作日闹钟"
const SNOOZE_LIVE_ACTIVITY_NAME = "WorkdaySnoozeCountdownActivity"

type AlarmType = "builtin" | "shortcut"

type DayEntry = {
  date: string
  type: "holiday" | "workday"
  name?: string
}

type LocalOverride = {
  date: string
  type: "holiday" | "workday"
}

type RestRule = {
  mode: "fixed" | "weekCycle" | "dayCycle"
  fixedWeekdays: number[]
  weekCycleStart: string
  weekCycleWeeks: number[][]
  dayCycleStart: string
  dayCycleWorkDays: number
  dayCycleRestDays: number
}

type StopWorkdayAlarmIntentParams = {
  alarmId: string
  scheduleNext?: boolean
}

type SnoozeWorkdayAlarmIntentParams = {
  alarmId: string
  title: string
  snoozeMinutes: number
  soundName: string
}

function rememberWorkdayAlarmId(id: string, asNextAlarm = false) {
  const ids = Storage.get<string[]>(KEY_WORKDAY_ALARM_IDS) || []
  Storage.set(KEY_WORKDAY_ALARM_ID, id)
  Storage.set(KEY_WORKDAY_ALARM_IDS, Array.from(new Set([...ids, id])))
  if (asNextAlarm) {
    Storage.set(KEY_WORKDAY_NEXT_ALARM_ID, id)
  }
}

function forgetWorkdayAlarmId(id: string) {
  const ids = Storage.get<string[]>(KEY_WORKDAY_ALARM_IDS) || []
  const nextIds = ids.filter((item) => item !== id)
  Storage.set(KEY_WORKDAY_ALARM_IDS, nextIds)
  if (Storage.get<string>(KEY_WORKDAY_ALARM_ID) === id) {
    Storage.set(KEY_WORKDAY_ALARM_ID, nextIds[0] || "")
  }
  if (Storage.get<string>(KEY_WORKDAY_NEXT_ALARM_ID) === id) {
    Storage.set(KEY_WORKDAY_NEXT_ALARM_ID, "")
  }
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
  return Storage.get<RestRule>(KEY_REST_RULE) || getDefaultRestRule()
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

function getAlarmSoundName(soundSetting: string): string {
  return soundSetting === DEFAULT_ALARM_SOUND || soundSetting === "default" ? "" : soundSetting.trim()
}

function alarmLibrarySoundsDirectoryPath(): string {
  return Path.join(Path.dirname(FileManager.temporaryDirectory), "Library", "Sounds")
}

function soundFilePath(name: string): string {
  return Path.join(alarmLibrarySoundsDirectoryPath(), name)
}

function ensureAlarmSoundImported(soundName: string) {
  const name = getAlarmSoundName(soundName)
  if (!name) return

  if (!FileManager.existsSync(soundFilePath(name))) {
    throw new Error(`铃声文件不存在，请先在铃声管理中导入：${name}`)
  }
}

function buildSound(soundName: string): AlarmManager.Sound {
  const name = getAlarmSoundName(soundName)
  if (!name) return AlarmManager.Sound.default()

  try {
    ensureAlarmSoundImported(soundName)
    return AlarmManager.Sound.named(name)
  } catch {
    return AlarmManager.Sound.default()
  }
}

function bindToCurrentScript<T extends { script: string }>(intent: T): T {
  return { ...intent, script: SCRIPT_NAME }
}

function getSnoozeMinutes(): number {
  return Storage.get<number>(KEY_ALARM_SNOOZE_MINUTES) ?? DEFAULT_SNOOZE_MINUTES
}

function getAlarmSoundSetting(): string {
  return Storage.get<string>(KEY_ALARM_SOUND) || DEFAULT_ALARM_SOUND
}

function buildAlarmAttributes(title: string, targetDateStr: string): AlarmManager.Attributes {
  const snoozeMinutes = getSnoozeMinutes()
  const alert = AlarmManager.AlertPresentation.create({
    title,
    secondaryButton: AlarmManager.Button.create({
      title: `稍后 ${snoozeMinutes} 分钟`,
      systemImageName: "zzz",
    }),
    secondaryBehavior: "custom",
  })
  const attributes = AlarmManager.Attributes.create({
    alert,
    tintColor: "orange",
    metadata: { source: "holiday-alarm", date: targetDateStr, snoozeMinutes: `${snoozeMinutes}` },
  })

  if (!attributes) throw new Error("闹钟属性创建失败")
  return attributes
}

async function cancelStoredNextWorkdayAlarm() {
  const nextAlarmId = Storage.get<string>(KEY_WORKDAY_NEXT_ALARM_ID) || ""
  if (!nextAlarmId) return

  Storage.set(KEY_WORKDAY_NEXT_ALARM_ID, "")
  try {
    await AlarmManager.cancel(nextAlarmId)
  } catch {}
  forgetWorkdayAlarmId(nextAlarmId)
}

async function scheduleNextWorkdayAlarm() {
  const alarmEnabled = Storage.get<boolean>(KEY_ALARM_ENABLED) ?? true
  const alarmType = Storage.get<AlarmType>(KEY_ALARM_TYPE) ?? "builtin"
  if (!alarmEnabled || alarmType !== "builtin" || !AlarmManager.isAvailable) return

  await cancelStoredNextWorkdayAlarm()

  const alarmHour = Storage.get<number>(KEY_ALARM_HOUR) ?? 7
  const alarmMinute = Storage.get<number>(KEY_ALARM_MINUTE) ?? 30
  const subDays = Storage.get<DayEntry[]>(KEY_SUB_CACHE) || []
  const overrides = Storage.get<LocalOverride[]>(KEY_OVERRIDES) || []
  const restRule = loadRestRule()
  const alarmTarget = getNextAlarmTarget(new Date(), alarmHour, alarmMinute, subDays, overrides, restRule)
  if (!alarmTarget) return

  const alarmId = UUID.string()
  const title = "工作日闹钟"
  const soundSetting = getAlarmSoundSetting()
  const alarmConfig = AlarmManager.Configuration.alarm({
    schedule: AlarmManager.Schedule.fixed(alarmTarget.date),
    attributes: buildAlarmAttributes(title, alarmTarget.dateStr),
    sound: buildSound(soundSetting),
    stopIntent: bindToCurrentScript(StopWorkdayAlarmIntent({
      alarmId,
    })) as any,
    secondaryIntent: bindToCurrentScript(SnoozeWorkdayAlarmIntent({
      alarmId,
      title,
      snoozeMinutes: getSnoozeMinutes(),
      soundName: soundSetting,
    })) as any,
  })

  if (!alarmConfig) return
  const alarm = await AlarmManager.schedule(alarmId, alarmConfig)
  rememberWorkdayAlarmId(alarm.id, true)
}

function buildSnoozeAttributes(params: SnoozeWorkdayAlarmIntentParams): AlarmManager.Attributes {
  const alert = AlarmManager.AlertPresentation.create({
    title: params.title,
    stopButton: AlarmManager.Button.create({
      title: "关闭",
      systemImageName: "xmark",
    }),
    secondaryButton: AlarmManager.Button.create({
      title: `稍后 ${params.snoozeMinutes} 分钟`,
      systemImageName: "zzz",
    }),
    secondaryBehavior: "custom",
  })
  const countdown = AlarmManager.CountdownPresentation.create(
    `稍后 ${params.snoozeMinutes} 分钟`,
    AlarmManager.Button.create({
      title: "暂停",
      systemImageName: "pause.fill",
    })
  )
  const paused = AlarmManager.PausedPresentation.create(
    `稍后 ${params.snoozeMinutes} 分钟已暂停`,
    AlarmManager.Button.create({
      title: "继续",
      systemImageName: "play.fill",
    })
  )

  const attributes = AlarmManager.Attributes.create({
    alert,
    countdown,
    paused,
    tintColor: "orange",
    metadata: {
      source: "holiday-alarm-snooze-timer",
      snoozeMinutes: `${params.snoozeMinutes}`,
    },
    liveActivity: {
      name: SNOOZE_LIVE_ACTIVITY_NAME,
    },
  })

  if (!attributes) throw new Error("稍后提醒闹钟属性创建失败")
  return attributes
}

function buildSnoozeConfiguration(params: SnoozeWorkdayAlarmIntentParams): AlarmManager.Configuration {
  const duration = Math.max(1, params.snoozeMinutes) * 60

  const configuration = AlarmManager.Configuration.timer({
    duration,
    attributes: buildSnoozeAttributes(params),
    sound: buildSound(params.soundName),
    stopIntent: bindToCurrentScript(StopWorkdayAlarmIntent({
      alarmId: params.alarmId,
      scheduleNext: false,
    })) as any,
    secondaryIntent: bindToCurrentScript(SnoozeWorkdayAlarmIntent({
      ...params,
      alarmId: params.alarmId,
    })) as any,
  })

  if (!configuration) throw new Error("稍后提醒闹钟配置创建失败")
  return configuration
}

async function stopOrCancelAlarm(id: string) {
  try {
    if (await AlarmManager.stop(id)) return
  } catch {}

  try {
    await AlarmManager.cancel(id)
  } catch {}
}

export const StopWorkdayAlarmIntent = AppIntentManager.register<StopWorkdayAlarmIntentParams>({
  name: "StopWorkdayAlarmIntent",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (params) => {
    try {
      await stopOrCancelAlarm(params.alarmId)
      forgetWorkdayAlarmId(params.alarmId)
      if (params.scheduleNext !== false) {
        await scheduleNextWorkdayAlarm()
      }
    } finally {
      try {
        Script.exit()
      } catch {}
    }
  },
})

export const SnoozeWorkdayAlarmIntent = AppIntentManager.register<SnoozeWorkdayAlarmIntentParams>({
  name: "SnoozeWorkdayAlarmIntent",
  protocol: AppIntentProtocol.LiveActivityIntent,
  perform: async (params) => {
    try {
      await stopOrCancelAlarm(params.alarmId)

      const nextAlarmId = UUID.string()
      const nextParams = {
        ...params,
        alarmId: nextAlarmId,
      }
      await AlarmManager.schedule(nextAlarmId, buildSnoozeConfiguration(nextParams))
      forgetWorkdayAlarmId(params.alarmId)
      rememberWorkdayAlarmId(nextAlarmId)
      await scheduleNextWorkdayAlarm()
    } finally {
      try {
        Script.exit()
      } catch {}
    }
  },
})
