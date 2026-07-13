export function formatMatchTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const isTomorrow = date.toDateString() === tomorrow.toDateString()

  const timeStr = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })

  if (isToday) return `今天 · ${timeStr}`
  if (isTomorrow) return `明天 · ${timeStr}`
  return `${date.getMonth() + 1}/${date.getDate()} · ${timeStr}`
}

// 通知专用时间格式:使用绝对日期(如 "7/10 · 16:00"),不依赖"今天/明天"
// 因为通知在触发时才显示,订阅时的相对描述会失效
export function formatNotifyTime(iso: string): string {
  const date = new Date(iso)
  const timeStr = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })
  return `${date.getMonth() + 1}/${date.getDate()} · ${timeStr}`
}


export function formatRelativeTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  const minutes = Math.floor(diff / 60 / 1000)
  if (minutes < 60) return `${minutes} 分钟后`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时后`
  const days = Math.floor(hours / 24)
  return `${days} 天后`
}

export function opponentNames(match: { opponents: { name: string }[]; name: string }): string {
  if (match.opponents.length === 0) return match.name
  return match.opponents.map((o) => o.name).join(" vs ")
}

export interface DateGroup<T> {
  key: string
  label: string
  items: T[]
}

export function groupByDate<T extends { scheduled_at: string }>(
  items: T[],
): DateGroup<T>[] {
  const map = new Map<string, { label: string; items: T[] }>()
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)

  for (const item of items) {
    const date = new Date(item.scheduled_at)
    const key = date.toDateString()
    if (!map.has(key)) {
      let label: string
      if (date.toDateString() === now.toDateString()) {
        label = "今天"
      } else if (date.toDateString() === tomorrow.toDateString()) {
        label = "明天"
      } else {
        label = `${date.getMonth() + 1}月${date.getDate()}日`
      }
      map.set(key, { label, items: [] })
    }
    map.get(key)!.items.push(item)
  }

  return Array.from(map.entries()).map(([key, { label, items }]) => ({
    key,
    label,
    items,
  }))
}
