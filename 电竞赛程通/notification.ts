import { Notification } from "scripting"
import type { Match, Subscription } from "./types"
import { formatNotifyTime } from "./utils/format"
import { getStageDisplayName } from "./utils/stageTerms"

function notifyTitle(match: Match): string {
  // 去掉阶段名后的冒号,如 "总决赛: BLG vs HLE" -> "总决赛 BLG vs HLE"
  return getStageDisplayName(match.name).replace(/\s*[:：]\s*/g, " ").trim()
}

// 通知副标题:比赛绝对时间(如 "7/10 · 16:00"),不使用"今天/明天"等相对描述
function notifySubtitle(match: Match): string {
  return formatNotifyTime(match.scheduled_at)
}

export async function scheduleAdvanceNotification(
  match: Match,
  minutesBefore: number,
): Promise<boolean> {
  // minutesBefore 为 0 表示关闭提前提醒
  if (minutesBefore <= 0) return false

  const scheduledTime = new Date(match.scheduled_at).getTime() - minutesBefore * 60 * 1000
  const now = Date.now()

  // 时间已过,不再提醒
  if (scheduledTime <= now) {
    return false
  }

  const components = DateComponents.fromDate(new Date(scheduledTime))
  const trigger = new CalendarNotificationTrigger({ dateMatching: components, repeats: false })

  return Notification.schedule({
    title: notifyTitle(match),
    subtitle: notifySubtitle(match),
    body: `${minutesBefore} 分钟后开始`,
    trigger,
    userInfo: { matchId: match.id, kind: "advance" },
  })
}

export async function scheduleStartNotification(match: Match): Promise<boolean> {
  const scheduledTime = new Date(match.scheduled_at).getTime()
  const now = Date.now()

  // 时间已过,不再提醒
  if (scheduledTime <= now) {
    return false
  }

  const components = DateComponents.fromDate(new Date(scheduledTime))
  const trigger = new CalendarNotificationTrigger({ dateMatching: components, repeats: false })

  return Notification.schedule({
    title: notifyTitle(match),
    subtitle: notifySubtitle(match),
    body: "已开始",
    trigger,
    userInfo: { matchId: match.id, kind: "start" },
  })
}

export async function cancelMatchNotification(matchId: number): Promise<void> {
  const pending = await Notification.getAllPendingsOfCurrentScript()
  const targets = pending
    .filter((p) => p.content.userInfo?.matchId === matchId)
    .map((p) => p.identifier)

  if (targets.length > 0) {
    await Notification.removePendings(targets)
  }
}

export interface NotifySettings {
  defaultNotifyMinutesBefore: number
  notifyAtStart: boolean
}

export async function syncMatchNotifications(
  matches: Match[],
  subs: Subscription[],
  notifySettings: NotifySettings,
): Promise<void> {
  const targetIds = new Set(subs.map((s) => s.matchId))
  const pending = await Notification.getAllPendingsOfCurrentScript()
  const idsToCancel = pending
    .filter((p) => {
      const id = p.content.userInfo?.matchId
      const kind = p.content.userInfo?.kind
      if (kind === "advance" || kind === "start") return true
      return typeof id !== "number" || !targetIds.has(id)
    })
    .map((p) => p.identifier)

  if (idsToCancel.length > 0) {
    await Notification.removePendings(idsToCancel)
  }

  // 按最新设置重建所有订阅通知,避免设置变更后留下旧通知
  for (const sub of subs) {
    const match = sub.match ?? matches.find((m) => m.id === sub.matchId)
    if (!match) continue
    await scheduleAdvanceNotification(match, sub.notifyMinutesBefore)
    if (notifySettings.notifyAtStart) {
      await scheduleStartNotification(match)
    }
  }
}
