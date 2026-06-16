import { AnniversaryEvent, Person, AppSettings } from './types'
import { localDate, getDateForYear, getReferenceDate } from './dateUtils'
import { Notification } from 'scripting'

const SCHEDULE_YEARS_AHEAD = 2

// 计算提醒触发时间：目标日零点 9:00
function reminderDateFor(baseDate: Date, daysBefore: number): Date {
  const date = localDate(baseDate.getFullYear(), baseDate.getMonth() + 1, baseDate.getDate())
  date.setDate(date.getDate() - daysBefore)
  date.setHours(9, 0, 0, 0)
  return date
}

// 从事件与人物生成通知文案
function buildNotificationContent(event: AnniversaryEvent, person: Person, daysBefore: number): { title: string; body: string } {
  if (daysBefore === 0) {
    const verb = event.type === 'birthday' ? '生日' : '重要日子'
    return {
      title: `今天 ${person.name} 的${verb}`,
      body: event.title || `${person.name} 的${verb}就是今天，别忘了送上祝福。`
    }
  }
  const unit = daysBefore === 1 ? '明天' : `${daysBefore} 天后`
  return {
    title: `${unit} ${person.name} 的 ${event.title}`,
    body: `还有 ${daysBefore} 天就是 ${person.name} 的${event.type === 'birthday' ? '生日' : '重要日子'}。`
  }
}

// 调度单条通知
async function scheduleOne(
  event: AnniversaryEvent,
  person: Person,
  targetDate: Date,
  year: number,
  daysBefore: number
): Promise<boolean> {
  const triggerDate = reminderDateFor(targetDate, daysBefore)
  const now = new Date()
  // 不调度已经过期的时间点
  if (triggerDate <= now) return true

  const { title, body } = buildNotificationContent(event, person, daysBefore)
  const dateComponents = new DateComponents({
    year: triggerDate.getFullYear(),
    month: triggerDate.getMonth() + 1,
    day: triggerDate.getDate(),
    hour: triggerDate.getHours(),
    minute: triggerDate.getMinutes()
  })
  return await Notification.schedule({
    title,
    body,
    userInfo: { eventId: event.id, personId: person.id, daysBefore, year },
    trigger: new CalendarNotificationTrigger({ dateMatching: dateComponents, repeats: false })
  })
}

// 为某个事件调度未来若干年的通知
async function scheduleForEvent(
  event: AnniversaryEvent,
  person: Person,
  settings: AppSettings
): Promise<void> {
  if (!settings.notificationsEnabled) return
  if (event.reminderDays.length === 0 && !event.remindOnDay) return

  const currentYear = new Date().getFullYear()
  const ref = getReferenceDate(event)
  const refYear = ref ? ref.getFullYear() : currentYear
  // 对未来的重复/一次性事件，从设定年份开始调度，避免在设定日期前产生通知
  const startYear = Math.max(currentYear, refYear)
  for (let offset = 0; offset < SCHEDULE_YEARS_AHEAD; offset++) {
    const year = startYear + offset
    const date = getDateForYear(event, year)
    if (!date) continue
    if (event.repeatYearly && ref && date < ref) continue

    if (event.remindOnDay) {
      await scheduleOne(event, person, date, year, 0)
    }
    for (const days of event.reminderDays) {
      if (days > 0) {
        await scheduleOne(event, person, date, year, days)
      }
    }
  }
}

// 重新调度全部通知
export async function refreshNotifications(
  events: AnniversaryEvent[],
  persons: Person[],
  settings: AppSettings
): Promise<void> {
  // 清除本脚本的全部待通知
  await Notification.removeAllPendingsOfCurrentScript()

  if (!settings.notificationsEnabled) return

  const personMap = new Map(persons.map(p => [p.id, p]))
  for (const event of events) {
    const person = personMap.get(event.personId)
    if (person) {
      await scheduleForEvent(event, person, settings)
    }
  }
}

// 移除某个事件的所有通知
export async function removeNotificationsForEvent(eventId: string): Promise<void> {
  const pendings = await Notification.getAllPendingsOfCurrentScript()
  const ids = pendings
    .filter(p => p.content?.userInfo?.eventId === eventId)
    .map(p => p.identifier)
  if (ids.length > 0) {
    await Notification.removePendings(ids)
  }
}
