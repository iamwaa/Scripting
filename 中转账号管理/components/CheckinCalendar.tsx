import { Text, HStack, VStack, Spacer, Button, Image, modifiers } from "scripting"
import type { CheckinStatus } from "../types"
import { fmtMonth, shiftMonth, getMonthDays, getCheckinRecordMap, sumCheckinAwards, fmtQuota, isTodayDate } from "../utils/format"
import { getCheckinRecords, getCheckinCount } from "../services/account"

// 日历单元格配色方案
export function getCalendarCellPalette() {
  return {
    todayBackground: {
      light: "rgba(0,122,255,0.14)",
      dark: "rgba(0,122,255,0.16)",
    },
    checkedBackground: {
      light: "rgba(34,197,94,0.14)",
      dark: "rgba(34,197,94,0.16)",
    },
    idleBackground: {
      light: "systemGroupedBackground",
      dark: "rgba(255,255,255,0.04)",
    },
  } as const
}

// 月份切换按钮组件
export function MonthIconButton({ title, systemName, action, disabled }: { title: string, systemName: string, action: () => void, disabled: boolean }) {
  return <Button title={title} systemImage={systemName} action={action} disabled={disabled} labelStyle="iconOnly" buttonStyle="borderless" />
}

// 签到日历组件
export function CheckinCalendar({ month, status, onChangeMonth, onRefresh, busy }: { month: string, status?: CheckinStatus, onChangeMonth: (nextMonth: string) => void, onRefresh: () => void, busy: boolean }) {
  const records = getCheckinRecords(status)
  const recordMap = getCheckinRecordMap(records)
  const palette = getCalendarCellPalette()
  const monthAward = sumCheckinAwards(records)
  const cells = getMonthDays(month)
  const rows: Array<Array<{ key: string, day?: number, date?: string }>> = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"]

  return <VStack alignment="leading" spacing={10}>
    <HStack spacing={8}>
      <MonthIconButton title="上一月" systemName="chevron.left" action={() => onChangeMonth(shiftMonth(month, -1))} disabled={busy} />
      <Spacer />
      <VStack spacing={2}>
        <HStack spacing={6}>
          <Text font="headline">{fmtMonth(month)}</Text>
          <Button title="刷新" systemImage={busy ? "hourglass" : "arrow.clockwise"} action={onRefresh} disabled={busy} labelStyle="iconOnly" buttonStyle="borderless" />
        </HStack>
        <Text font="caption" foregroundStyle="secondaryLabel">本月 {getCheckinCount(status, records)} 次 · 奖励 {fmtQuota(monthAward)}</Text>
      </VStack>
      <Spacer />
      <MonthIconButton title="下一月" systemName="chevron.right" action={() => onChangeMonth(shiftMonth(month, 1))} disabled={busy} />
    </HStack>
    <HStack spacing={4}>
      {weekdays.map(day => <Text key={`weekday-${day}`} font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "center" }}>{day}</Text>)}
    </HStack>
    <VStack spacing={6}>
      {rows.map((row, rowIndex) => <HStack key={`week-${rowIndex}`} spacing={4}>
        {row.map(cell => {
          const record = cell.date ? recordMap[cell.date] : undefined
          const checked = !!record
          const today = isTodayDate(cell.date)
          return <VStack
            key={cell.key}
            spacing={2}
            frame={{ minHeight: 58, maxWidth: "infinity" }}
            padding={{ vertical: 5, horizontal: 2 }}
            modifiers={modifiers()
              .background((today ? palette.todayBackground : checked ? palette.checkedBackground : palette.idleBackground) as any)
              .clipShape({ type: "rect", cornerRadius: 12 })}
          >
            {cell.day ? <Text font="caption" foregroundStyle="label">{cell.day}</Text> : <Text font="caption"> </Text>}
            {checked ? <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" /> : <Text font="caption2" foregroundStyle="systemGray4"> </Text>}
            {checked ? <Text font="caption2" foregroundStyle="systemGreen" lineLimit={1} minScaleFactor={0.6}>{fmtQuota(record?.quota_awarded)}</Text> : <Text font="caption2" foregroundStyle="systemGray4"> </Text>}
          </VStack>
        })}
      </HStack>)}
    </VStack>
    <HStack spacing={12}>
      <Text font="caption" foregroundStyle="secondaryLabel">累计签到：{status?.stats?.total_checkins ?? "-"}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">累计奖励：{fmtQuota(status?.stats?.total_quota)}</Text>
    </HStack>
  </VStack>
}
