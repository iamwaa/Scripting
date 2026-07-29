import { fetch } from "scripting"
import { CAIYUN_API_HOST, FORECAST_DAYS, FORECAST_HOURS } from "../constants"
import { loadApiToken } from "../services/settingsService"
import type { WeatherResponse } from "../types"

const WEATHER_CACHE_TTL = 60_000
const responseCache = new Map<string, { response: WeatherResponse; expiresAt: number }>()
const inFlightRequests = new Map<string, Promise<WeatherResponse>>()

export type FetchWeatherOptions = {
  longitude: number
  latitude: number
  dailysteps?: number
  hourlysteps?: number
  alert?: boolean
  // 可选覆盖 Token；默认读 Storage
  token?: string
}

// 请求彩云综合天气接口，路径格式为 经度,纬度
export async function fetchWeather(options: FetchWeatherOptions): Promise<WeatherResponse> {
  const {
    longitude,
    latitude,
    dailysteps = FORECAST_DAYS,
    hourlysteps = FORECAST_HOURS,
    alert = true,
    token,
  } = options

  const apiToken = (token ?? loadApiToken()).trim()
  if (!apiToken) {
    throw new Error("请先在设置中填写彩云 Token")
  }

  const lng = Number(longitude.toFixed(6))
  const lat = Number(latitude.toFixed(6))
  const query = new URLSearchParams({
    alert: String(alert),
    dailysteps: String(dailysteps),
    hourlysteps: String(hourlysteps),
    unit: "metric",
    lang: "zh_CN",
  })

  const url = `${CAIYUN_API_HOST}/${apiToken}/${lng},${lat}/weather?${query.toString()}`
  const cached = responseCache.get(url)
  if (cached && cached.expiresAt > Date.now()) return cached.response

  const inFlight = inFlightRequests.get(url)
  if (inFlight) return inFlight

  const request = (async () => {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`天气请求失败（HTTP ${response.status}）`)
    }

    const data = (await response.json()) as WeatherResponse
    if (!data || data.status !== "ok" || !data.result?.realtime) {
      throw new Error("天气数据无效，请检查 Token 或稍后重试")
    }
    responseCache.set(url, {
      response: data,
      expiresAt: Date.now() + WEATHER_CACHE_TTL,
    })
    return data
  })()

  inFlightRequests.set(url, request)
  try {
    return await request
  } finally {
    inFlightRequests.delete(url)
  }
}
