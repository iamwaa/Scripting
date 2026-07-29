import type { SkyconCode } from "./types"

// 无内置 Token，必须由用户在设置页自行填写
export const CAIYUN_API_HOST = "https://api.caiyunapp.com/v2.6"

export const STORAGE_KEYS = {
  favorites: "caiyun_weather_favorites",
  lastPlace: "caiyun_weather_last_place",
  apiToken: "caiyun_weather_api_token",
} as const

export const FORECAST_DAYS = 7
export const FORECAST_HOURS = 24

type SkyconMeta = {
  label: string
  symbol: string
}

// 天气现象 → 中文名与 SF Symbol
export const SKYCON_META: Record<string, SkyconMeta> = {
  CLEAR_DAY: { label: "晴", symbol: "sun.max.fill" },
  CLEAR_NIGHT: { label: "晴", symbol: "moon.stars.fill" },
  PARTLY_CLOUDY_DAY: { label: "多云", symbol: "cloud.sun.fill" },
  PARTLY_CLOUDY_NIGHT: { label: "多云", symbol: "cloud.moon.fill" },
  CLOUDY: { label: "阴", symbol: "cloud.fill" },
  OVERCAST: { label: "阴", symbol: "cloud.fill" },
  LIGHT_HAZE: { label: "轻度雾霾", symbol: "sun.haze.fill" },
  MODERATE_HAZE: { label: "中度雾霾", symbol: "sun.haze.fill" },
  HEAVY_HAZE: { label: "重度雾霾", symbol: "sun.haze.fill" },
  LIGHT_RAIN: { label: "小雨", symbol: "cloud.drizzle.fill" },
  MODERATE_RAIN: { label: "中雨", symbol: "cloud.rain.fill" },
  HEAVY_RAIN: { label: "大雨", symbol: "cloud.heavyrain.fill" },
  STORM_RAIN: { label: "暴雨", symbol: "cloud.bolt.rain.fill" },
  FOG: { label: "雾", symbol: "cloud.fog.fill" },
  LIGHT_SNOW: { label: "小雪", symbol: "cloud.snow.fill" },
  MODERATE_SNOW: { label: "中雪", symbol: "cloud.snow.fill" },
  HEAVY_SNOW: { label: "大雪", symbol: "cloud.snow.fill" },
  STORM_SNOW: { label: "暴雪", symbol: "cloud.snow.fill" },
  DUST: { label: "浮尘", symbol: "sun.dust.fill" },
  SAND: { label: "沙尘", symbol: "sun.dust.fill" },
  WIND: { label: "大风", symbol: "wind" },
}

export function skyconLabel(code?: SkyconCode | null): string {
  if (!code) return "—"
  return SKYCON_META[code]?.label ?? code
}

export function skyconSymbol(code?: SkyconCode | null): string {
  if (!code) return "questionmark.circle"
  return SKYCON_META[code]?.symbol ?? "cloud.fill"
}

// 风向角度 → 中文方位
export function windDirectionLabel(degree?: number | null): string {
  if (degree == null || Number.isNaN(degree)) return "—"
  const dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
  const idx = Math.round((((degree % 360) + 360) % 360) / 45) % 8
  return dirs[idx]
}

export function windLevelLabel(speedMs?: number | null): string {
  if (speedMs == null || Number.isNaN(speedMs)) return "—"
  // 彩云 metric 风速单位为 m/s，按阈值粗略换算风力等级
  const thresholds = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7]
  let level = 0
  for (let i = 0; i < thresholds.length; i++) {
    if (speedMs >= thresholds[i]) level = i + 1
  }
  return `${level} 级`
}
