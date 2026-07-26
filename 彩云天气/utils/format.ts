// 温度显示：保留一位小数并去掉多余 0
export function formatTemp(value?: number | null, unit = "°"): string {
  if (value == null || Number.isNaN(value)) return "—"
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text}${unit}`
}

export function formatPercent(ratio?: number | null): string {
  if (ratio == null || Number.isNaN(ratio)) return "—"
  return `${Math.round(ratio * 100)}%`
}

// 降水概率：兼容 0–1 小数与 0–100 百分数
export function formatPrecipProbability(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "—"
  const pct = value <= 1 ? value * 100 : value
  return `${Math.round(Math.max(0, Math.min(100, pct)))}%`
}

export function formatAqi(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "—"
  return String(Math.round(value))
}

export function formatHour(datetime: string): string {
  // 解析彩云 datetime，例如 2026-07-26T10:06+08:00
  const match = datetime.match(/T(\d{2}):/)
  if (match) return `${match[1]}时`
  const d = new Date(datetime)
  if (Number.isNaN(d.getTime())) return datetime
  return `${String(d.getHours()).padStart(2, "0")}时`
}

export function formatWeekday(dateStr: string, index = 0): string {
  if (index === 0) return "今天"
  if (index === 1) return "明天"
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr.slice(5, 10)
  const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
  return labels[d.getDay()]
}

export function formatMonthDay(dateStr: string): string {
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[2]}/${match[3]}`
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`
}

export function placeId(longitude: number, latitude: number): string {
  return `${longitude.toFixed(4)},${latitude.toFixed(4)}`
}

export function formatCoords(longitude: number, latitude: number): string {
  return `${longitude.toFixed(4)}, ${latitude.toFixed(4)}`
}
