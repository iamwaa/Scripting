import { fetch } from "scripting"
import { CAIYUN_API_HOST, FORECAST_DAYS, FORECAST_HOURS } from "../constants"
import { loadApiToken } from "../services/settingsService"
import type { WeatherResponse } from "../types"

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
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`天气请求失败（HTTP ${response.status}）`)
  }

  const data = (await response.json()) as WeatherResponse
  if (!data || data.status !== "ok" || !data.result?.realtime) {
    throw new Error("天气数据无效，请检查 Token 或稍后重试")
  }
  return data
}
