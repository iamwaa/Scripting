import {
  Button,
  DatePicker,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Path,
  Picker,
  Script,
  Section,
  Spacer,
  Text,
  useEffect,
  useState,
} from "scripting"
import { StopWorkdayAlarmIntent, SnoozeWorkdayAlarmIntent } from "./app_intents"

const KEY_ALARM_SOUND = "alarm_sound"
const DEFAULT_ALARM_SOUND = "Default"
const SUPPORTED_SOUND_EXTENSIONS = new Set([".aiff", ".wav", ".caf", ".mp3"])
const SNOOZE_MINUTE_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 30]

function defaultTestTime(): number {
  const date = new Date(Date.now() + 3 * 60 * 1000)
  date.setSeconds(0, 0)
  return date.getTime()
}

function getAlarmSoundSetting(): string {
  return Storage.get<string>(KEY_ALARM_SOUND) || DEFAULT_ALARM_SOUND
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

function ensureAlarmSoundImported(soundSetting: string) {
  const name = getAlarmSoundName(soundSetting)
  if (!name) return

  if (!FileManager.existsSync(soundFilePath(name))) {
    throw new Error(`铃声文件不存在，请先在铃声管理中导入：${name}`)
  }
}

function buildAlarmSound(soundSetting: string): AlarmManager.Sound {
  const name = getAlarmSoundName(soundSetting)
  if (!name) return AlarmManager.Sound.default()

  ensureAlarmSoundImported(soundSetting)
  return AlarmManager.Sound.named(name)
}

function soundDisplayName(soundSetting: string): string {
  const name = getAlarmSoundName(soundSetting)
  if (!name) return "默认铃声"

  const ext = Path.extname(name)
  return ext ? name.slice(0, -ext.length) : name
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function buildAlarmTime(selectedTime: number): Date {
  const selectedDate = new Date(selectedTime)
  const now = new Date()
  const alarmTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    selectedDate.getHours(),
    selectedDate.getMinutes(),
    0
  )

  if (alarmTime.getTime() <= now.getTime()) {
    alarmTime.setDate(alarmTime.getDate() + 1)
  }

  return alarmTime
}

function bindToCurrentScript<T extends { script: string }>(intent: T): T {
  return { ...intent, script: "工作日闹钟" }
}

function TestAlarmPage() {
  const dismiss = Navigation.useDismiss()
  const [alarmTimeInput, setAlarmTimeInput] = useState(defaultTestTime())
  const [snoozeMinutes, setSnoozeMinutes] = useState(1)
  const [availableSounds, setAvailableSounds] = useState<string[]>([DEFAULT_ALARM_SOUND])
  const [soundSetting, setSoundSetting] = useState(getAlarmSoundSetting())
  const [statusText, setStatusText] = useState("等待创建测试闹钟")

  useEffect(() => {
    loadAvailableSoundNames()
      .then((sounds) => {
        const currentSound = getAlarmSoundSetting()
        const mergedSounds = normalizeSoundNames([...sounds, currentSound])
        setAvailableSounds(mergedSounds)
        setSoundSetting(mergedSounds.includes(currentSound) ? currentSound : DEFAULT_ALARM_SOUND)
      })
      .catch((error: any) => {
        console.error("加载铃声列表失败:", error)
        setStatusText(`加载铃声列表失败: ${error.message}`)
      })
  }, [])

  async function createTestAlarm() {
    try {
      const alarmTime = buildAlarmTime(alarmTimeInput)
      const alarmId = UUID.string()

      const attributes = AlarmManager.Attributes.create({
        alert: AlarmManager.AlertPresentation.create({
          title: "测试闹钟",
          stopButton: AlarmManager.Button.create({
            title: "关闭",
            systemImageName: "xmark",
          }),
          secondaryButton: AlarmManager.Button.create({
            title: `稍后 ${snoozeMinutes} 分钟`,
            systemImageName: "zzz",
          }),
          secondaryBehavior: "custom",
        }),
        tintColor: "orange",
        metadata: {
          source: "test-alarm",
          snoozeMinutes: `${snoozeMinutes}`,
        },
        liveActivity: {
          name: "WorkdaySnoozeCountdownActivity",
        },
      })

      if (!attributes) {
        throw new Error("闹钟属性创建失败")
      }

      const sound = buildAlarmSound(soundSetting)
      const alarmConfig = AlarmManager.Configuration.alarm({
        schedule: AlarmManager.Schedule.fixed(alarmTime),
        attributes,
        sound,
        stopIntent: bindToCurrentScript(StopWorkdayAlarmIntent({
          alarmId,
        })) as any,
        secondaryIntent: bindToCurrentScript(SnoozeWorkdayAlarmIntent({
          alarmId,
          title: "测试闹钟",
          snoozeMinutes,
          soundName: soundSetting,
        })) as any,
      })

      if (!alarmConfig) {
        throw new Error("闹钟配置创建失败")
      }

      const alarm = await AlarmManager.schedule(alarmId, alarmConfig)
      const status = `已创建 ${alarmTime.toLocaleString()} · 稍后 ${snoozeMinutes} 分钟 · ${soundDisplayName(soundSetting)}`

      console.log(`测试闹钟已创建: ${alarmTime.toLocaleString()}`)
      console.log(`闹钟 ID: ${alarm.id}`)
      console.log(`稍后提醒: ${snoozeMinutes} 分钟`)
      console.log(`铃声: ${soundDisplayName(soundSetting)}`)
      setStatusText(status)
    } catch (error: any) {
      console.error("创建测试闹钟失败:", error)
      setStatusText(`创建失败: ${error.message}`)
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="测试闹钟"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
        }}>
        <Section header={<Text>测试参数</Text>}>
          <DatePicker
            title="闹钟时间"
            displayedComponents={["hourAndMinute"]}
            value={alarmTimeInput}
            onChanged={setAlarmTimeInput}
          />
          <Picker
            title="稍后分钟"
            value={snoozeMinutes}
            onChanged={(v: number) => setSnoozeMinutes(v)}>
            {SNOOZE_MINUTE_OPTIONS.map((minutes) => (
              <Text key={`snooze-${minutes}`} tag={minutes}>{`${minutes} 分钟`}</Text>
            ))}
          </Picker>
          <Picker
            title="铃声"
            value={Math.max(0, availableSounds.indexOf(soundSetting))}
            onChanged={(index: number) => setSoundSetting(availableSounds[index] ?? DEFAULT_ALARM_SOUND)}>
            {availableSounds.map((sound, index) => (
              <Text key={`sound-${sound}`} tag={index}>{soundDisplayName(sound)}</Text>
            ))}
          </Picker>
        </Section>

        <Section>
          <Button action={createTestAlarm} buttonStyle="glassProminent">
            <HStack frame={{ maxWidth: "infinity" }}>
              <Spacer />
              <Text>创建测试闹钟</Text>
              <Spacer />
            </HStack>
          </Button>
          <Text font="caption" foregroundStyle="secondaryLabel">
            将创建 {formatTime(alarmTimeInput)} 的测试闹钟，触发后点击“稍后 {snoozeMinutes} 分钟”测试 Live Activity。
          </Text>
        </Section>

        <Section header={<Text>状态</Text>}>
          <Text font="footnote" foregroundStyle="secondaryLabel">{statusText}</Text>
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<TestAlarmPage />)
  Script.exit()
}

run()
