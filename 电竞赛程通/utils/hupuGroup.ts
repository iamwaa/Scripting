import type { HupuMatch } from "../hupuTypes"

export interface HupuDayGroup {
  key: string
  label: string
  items: HupuMatch[]
}

// 按自然日倒序分组,日期内按开始时间倒序(近的在前)
export function groupHupuMatchesByDay(matches: HupuMatch[]): HupuDayGroup[] {
  const map = new Map<string, { label: string; items: HupuMatch[] }>()
  const now = new Date()
  const todayKey = now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const tomorrowKey = tomorrow.toDateString()

  for (const match of matches) {
    const date = new Date(match.startTime)
    const key = date.toDateString()
    if (!map.has(key)) {
      let label: string
      if (key === todayKey) label = "今天"
      else if (key === tomorrowKey) label = "明天"
      else label = `${date.getMonth() + 1}月${date.getDate()}日`
      map.set(key, { label, items: [] })
    }
    map.get(key)!.items.push(match)
  }

  return Array.from(map.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      items: value.items.sort((a, b) => b.startTime - a.startTime),
      stamp: value.items[0]?.startTime ?? 0,
    }))
    .sort((a, b) => b.stamp - a.stamp)
}
