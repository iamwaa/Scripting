import {
  AlarmLiveActivity,
  type AlarmLiveActivityState,
  Button,
  HStack,
  Image,
  Label,
  LiveActivityUI,
  LiveActivityUIExpandedBottom,
  LiveActivityUIExpandedCenter,
  LiveActivityUIExpandedLeading,
  LiveActivityUIExpandedTrailing,
  ProgressView,
  Spacer,
  Text,
  TimerIntervalLabel,
  VStack,
} from "scripting"

const WORKDAY_SNOOZE_ACTIVITY_NAME = "WorkdaySnoozeCountdownActivity"
const ACCENT_COLOR = "#FF8A00" as const
const ACCENT_DEEP = "#F97316" as const
const LOCK_BACKGROUND = { light: "#FFF7ED", dark: "#24160A" } as const
const PRIMARY_TEXT = { light: "#1F2937", dark: "#FFF7ED" } as const
const WHITE = "white" as const

type SnoozeMetadata = {
  source?: string
  snoozeMinutes?: string
}

function dateValue(value: Date | number | string | null | undefined) {
  if (value instanceof Date) return value
  if (value == null) return new Date()
  return new Date(value)
}

function getModeIcon(mode: string) {
  if (mode === "paused") return "pause.circle.fill"
  if (mode === "alerting") return "bell.and.waves.left.and.right.fill"
  return "alarm.fill"
}

function getTotalSeconds(state: AlarmLiveActivityState<SnoozeMetadata>) {
  const metadataMinutes = Number(state.metadata.snoozeMinutes || 0)
  const totalSeconds = state.countdown?.totalCountdownDuration
    ?? state.paused?.totalCountdownDuration
    ?? metadataMinutes * 60

  return Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0
}

function getRemainingSeconds(state: AlarmLiveActivityState<SnoozeMetadata>) {
  if (state.paused?.remainingDuration) return Math.max(0, state.paused.remainingDuration)
  return getTotalSeconds(state)
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "稍后"

  const totalMinutes = Math.max(1, Math.ceil(seconds / 60))
  if (totalMinutes < 60) return `${totalMinutes} 分钟`

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours}时${minutes}分` : `${hours} 小时`
}

function getDurationText(state: AlarmLiveActivityState<SnoozeMetadata>) {
  return formatDuration(getRemainingSeconds(state))
}

function getShortDurationText(state: AlarmLiveActivityState<SnoozeMetadata>) {
  const seconds = getRemainingSeconds(state)
  if (!Number.isFinite(seconds) || seconds <= 0) return "稍后"

  const totalMinutes = Math.max(1, Math.ceil(seconds / 60))
  return totalMinutes < 60 ? `${totalMinutes}m` : `${Math.floor(totalMinutes / 60)}h`
}

function getProgressValue(state: AlarmLiveActivityState<SnoozeMetadata>) {
  const totalSeconds = getTotalSeconds(state)
  if (totalSeconds <= 0) return 0

  // 显示剩余比例，与 timer countsDown 模式一致
  const remainingSeconds = getRemainingSeconds(state)
  return Math.min(totalSeconds, Math.max(0, remainingSeconds))
}

function formatClockDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00"

  const totalSeconds = Math.max(0, Math.ceil(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60
  const paddedSeconds = `${remainingSeconds}`.padStart(2, "0")

  if (hours > 0) return `${hours}:${`${minutes}`.padStart(2, "0")}:${paddedSeconds}`
  return `${minutes}:${paddedSeconds}`
}

// 倒计时列固定宽度 + trailing 对齐，确保暂停前后数字右边缘不漂移
const COUNTDOWN_COLUMN_WIDTH = 77
const COUNTDOWN_RIGHT_PADDING = 6
// 锁屏卡片左右内边距：数字倒计时所在行使用更小的 trailing，按钮/进度条另行补偿
const LOCK_PADDING_LEADING = 16
const LOCK_PADDING_TRAILING = 8
const LOCK_BOTTOM_TRAILING_COMPENSATION = LOCK_PADDING_LEADING - LOCK_PADDING_TRAILING

function RemainingCountdownLabel(state: AlarmLiveActivityState<SnoozeMetadata>) {
  // 统一声明相同的 frame 属性，直接应用于文本组件
  const sharedFrame = { width: COUNTDOWN_COLUMN_WIDTH, alignment: "trailing" as const }

  if (state.countdown?.fireDate) {
    return (
      <TimerIntervalLabel
        from={new Date()}
        to={dateValue(state.countdown.fireDate)}
        countsDown
        showsHours={false}
        font="largeTitle"
        fontWeight="bold"
        fontDesign="rounded"
        monospacedDigit
        foregroundStyle={ACCENT_DEEP}
        frame={sharedFrame}
        padding={{ trailing: COUNTDOWN_RIGHT_PADDING }}
      />
    )
  }

  return (
    <Text
      font="largeTitle"
      fontWeight="bold"
      fontDesign="rounded"
      monospacedDigit
      foregroundStyle={ACCENT_DEEP}
      frame={sharedFrame}
      padding={{ trailing: COUNTDOWN_RIGHT_PADDING }}>
      {formatClockDuration(getRemainingSeconds(state))}
    </Text>
  )
}

function CountdownProgress(state: AlarmLiveActivityState<SnoozeMetadata>) {
  if (state.countdown?.fireDate && state.countdown.totalCountdownDuration > 0) {
    const from = new Date(state.countdown.fireDate.getTime() - state.countdown.totalCountdownDuration * 1000)
    return (
      <ProgressView
        timerFrom={from}
        timerTo={state.countdown.fireDate}
        countsDown
        progressViewStyle="linear"
        tint={ACCENT_COLOR}
        label={<Text>{""}</Text>}
        currentValueLabel={<Text>{""}</Text>}
        frame={{ maxWidth: "infinity", height: 6 }}
      />
    )
  }

  return (
    <ProgressView
      value={getProgressValue(state)}
      total={Math.max(1, getTotalSeconds(state))}
      progressViewStyle="linear"
      tint={ACCENT_COLOR}
      label={<Text>{""}</Text>}
      currentValueLabel={<Text>{""}</Text>}
      frame={{ maxWidth: "infinity", height: 6 }}
    />
  )
}

function PrimaryAction(state: AlarmLiveActivityState<SnoozeMetadata>) {
  const action = state.mode === "paused" ? state.actions.resume : state.actions.pause
  if (!action) return null

  return (
    <Button intent={action.intent} buttonStyle="glassProminent" controlSize="small">
      <Label
        title={state.mode === "paused" ? "继续" : "暂停"}
        systemImage={action.systemImageName ?? (state.mode === "paused" ? "play.fill" : "pause.fill")}
      />
    </Button>
  )
}

function StopAction(state: AlarmLiveActivityState<SnoozeMetadata>) {
  return (
    <Button intent={state.actions.stop.intent} role="destructive" buttonStyle="glassProminent" controlSize="small">
      <Label title="关闭" systemImage={state.actions.stop.systemImageName ?? "xmark"} />
    </Button>
  )
}

// ── 灵动岛紧凑倒计时（共用组件，字号更小） ──────────
function CompactCountdownLabel(state: AlarmLiveActivityState<SnoozeMetadata>) {
  if (state.countdown?.fireDate) {
    return (
      <TimerIntervalLabel
        from={new Date()}
        to={dateValue(state.countdown.fireDate)}
        countsDown
        showsHours={false}
        font="headline"
        fontWeight="bold"
        fontDesign="rounded"
        monospacedDigit
        foregroundStyle={ACCENT_DEEP}
      />
    )
  }

  return (
    <Text
      font="headline"
      fontWeight="bold"
      fontDesign="rounded"
      monospacedDigit
      foregroundStyle={ACCENT_DEEP}>
      {formatClockDuration(getRemainingSeconds(state))}
    </Text>
  )
}

function CompactLeading(state: AlarmLiveActivityState<SnoozeMetadata>) {
  return (
    <Image
      systemName={getModeIcon(state.mode)}
      foregroundStyle={ACCENT_COLOR}
      font={16}
      frame={{ width: 22, height: 18, alignment: "center" }}
    />
  )
}

function CompactTrailing(state: AlarmLiveActivityState<SnoozeMetadata>) {
  return (
    <HStack frame={{ width: 40, height: 20, alignment: "center" }}>
      <CompactCountdownLabel {...state} />
    </HStack>
  )
}

function LockScreenContent(state: AlarmLiveActivityState<SnoozeMetadata>) {
  const totalText = formatDuration(getTotalSeconds(state))

  return (
    <VStack
      alignment="leading"
      spacing={14}
      padding={{ leading: LOCK_PADDING_LEADING, trailing: LOCK_PADDING_TRAILING, top: 14, bottom: 14 }}
      frame={{ maxWidth: "infinity" }}
      activityBackgroundTint={LOCK_BACKGROUND}>
      <HStack alignment="center" spacing={12} frame={{ maxWidth: "infinity" }}>
        <VStack
          alignment="center"
          spacing={0}
          frame={{ width: 48, height: 48 }}
          background={{ style: ACCENT_COLOR, shape: "circle" }}>
          <Image systemName={getModeIcon(state.mode)} foregroundStyle={WHITE} font="title2" />
        </VStack>
        <VStack alignment="leading" spacing={2}>
          <Text font="subheadline" fontWeight="semibold" foregroundStyle={ACCENT_DEEP} lineLimit={1}>稍后 {totalText}</Text>
          <Text font="footnote" foregroundStyle={PRIMARY_TEXT} lineLimit={1}>工作日闹钟</Text>
        </VStack>
        <Spacer />
        <RemainingCountdownLabel {...state} />
      </HStack>
      <VStack spacing={14} padding={{ trailing: LOCK_BOTTOM_TRAILING_COMPENSATION }}>
        <CountdownProgress {...state} />
        <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
          <Spacer />
          <PrimaryAction {...state} />
          <StopAction {...state} />
        </HStack>
      </VStack>
    </VStack>
  )
}

function ExpandedLeading(state: AlarmLiveActivityState<SnoozeMetadata>) {
  return (
    <Image
      systemName={getModeIcon(state.mode)}
      foregroundStyle={ACCENT_COLOR}
      font="largeTitle"
      fontWeight="bold"
      frame={{ width: COUNTDOWN_COLUMN_WIDTH, alignment: "center" }}
    />
  )
}

function ExpandedCenter(_state: AlarmLiveActivityState<SnoozeMetadata>) {
  return <Text>{""}</Text>
}

function ExpandedTrailing(state: AlarmLiveActivityState<SnoozeMetadata>) {
  return (
    <RemainingCountdownLabel {...state} />
  )
}

function ExpandedBottom(state: AlarmLiveActivityState<SnoozeMetadata>) {
  return (
    <VStack alignment="leading" spacing={16} padding={{ top: -4, bottom: 8 }}>
      <CountdownProgress {...state} />
      <HStack spacing={8}>
        <PrimaryAction {...state} />
        <Spacer />
        <StopAction {...state} />
      </HStack>
    </VStack>
  )
}

AlarmLiveActivity.register<SnoozeMetadata>(WORKDAY_SNOOZE_ACTIVITY_NAME, (state) => {
  return (
    <LiveActivityUI
      content={<LockScreenContent {...state} />}
      compactLeading={<CompactLeading {...state} />}
      compactTrailing={<CompactTrailing {...state} />}
      minimal={<Image systemName={getModeIcon(state.mode)} foregroundStyle={ACCENT_COLOR} />}>
      <LiveActivityUIExpandedLeading>
        <ExpandedLeading {...state} />
      </LiveActivityUIExpandedLeading>
      <LiveActivityUIExpandedTrailing>
        <ExpandedTrailing {...state} />
      </LiveActivityUIExpandedTrailing>
      <LiveActivityUIExpandedCenter>
        <ExpandedCenter {...state} />
      </LiveActivityUIExpandedCenter>
      <LiveActivityUIExpandedBottom>
        <ExpandedBottom {...state} />
      </LiveActivityUIExpandedBottom>
    </LiveActivityUI>
  )
})
