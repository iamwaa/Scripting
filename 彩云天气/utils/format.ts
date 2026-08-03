// 温度显示：统一四舍五入为整数
export function formatTemp(value?: number | null, unit = "°"): string {
  if (value == null || Number.isNaN(value)) return "—"
  return `${Math.round(value)}${unit}`
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

// 判断地址段行政级别，用于按“省 → 市 → 区 → 街道/POI”排序
function adminLevel(segment: string): number {
  // 省级 / 直辖市 / 特别行政区
  if (/(省|自治区|特别行政区)$/.test(segment)) return 4
  if (/^(北京市|上海市|天津市|重庆市)$/.test(segment)) return 4
  // 市级
  if (/(市|自治州|地区|盟)$/.test(segment)) return 3
  // 区县
  if (/(区|县|旗|自治县)$/.test(segment)) return 2
  // 街道 / 路 / 门牌 / POI
  return 1
}

// 清洗 MapSearch 返回的 formattedAddress：去掉与地点名重复的前缀和尾部的“中国”，
// 并按行政级别从大到小排列，用 “·” 连接。
// 示例："新建南路与永宁街新村东街交叉口西北100米，广州市，广东省，中国"
//       → "广东省 · 广州市"
export function formatLocationSubtitle(
  raw?: string | null,
  placeName?: string | null
): string | undefined {
  if (!raw) return undefined
  const segments = raw
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean)
  if (segments.length === 0) return undefined

  let cleaned = segments
  const name = placeName?.trim()
  if (name && cleaned[0] === name) {
    cleaned = cleaned.slice(1)
  }
  // 去掉末尾的“中国”
  if (cleaned[cleaned.length - 1] === "中国") {
    cleaned = cleaned.slice(0, -1)
  }
  if (cleaned.length === 0) return undefined

  // 按行政区划从大到小排列：省 → 市 → 区 → 街道/POI
  cleaned.sort((a, b) => adminLevel(b) - adminLevel(a))

  return cleaned.join(" · ")
}
