// 地点坐标与展示名
export type Place = {
  id: string
  name: string
  // 用户自定义显示名；为空时回退 name
  displayName?: string
  subtitle?: string
  longitude: number
  latitude: number
  // 当前位置标记；收藏列表中为 false
  isCurrent?: boolean
}

export type SkyconCode =
  | "CLEAR_DAY"
  | "CLEAR_NIGHT"
  | "PARTLY_CLOUDY_DAY"
  | "PARTLY_CLOUDY_NIGHT"
  | "CLOUDY"
  | "OVERCAST"
  | "LIGHT_HAZE"
  | "MODERATE_HAZE"
  | "HEAVY_HAZE"
  | "LIGHT_RAIN"
  | "MODERATE_RAIN"
  | "HEAVY_RAIN"
  | "STORM_RAIN"
  | "FOG"
  | "LIGHT_SNOW"
  | "MODERATE_SNOW"
  | "HEAVY_SNOW"
  | "STORM_SNOW"
  | "DUST"
  | "SAND"
  | "WIND"
  | string

export type WindInfo = {
  speed: number
  direction: number
}

export type RealtimeWeather = {
  temperature: number
  apparent_temperature?: number
  humidity: number
  cloudrate?: number
  skycon: SkyconCode
  visibility?: number
  pressure?: number
  wind: WindInfo
  precipitation?: {
    local?: { intensity?: number; status?: string }
  }
  air_quality?: {
    pm25?: number
    pm10?: number
    aqi?: { chn?: number; usa?: number }
    description?: { chn?: string; usa?: string }
  }
  life_index?: {
    ultraviolet?: { index?: string | number; desc?: string }
    comfort?: { index?: string | number; desc?: string }
  }
}

export type DailyValueRange = {
  date: string
  max: number
  min: number
  avg?: number
}

export type DailySkycon = {
  date: string
  value: SkyconCode
}

export type DailyWind = {
  date: string
  max?: WindInfo
  min?: WindInfo
  avg?: WindInfo
}

export type LifeIndexItem = {
  date: string
  index?: string | number
  desc?: string
}

export type DailyAstro = {
  date: string
  sunrise?: { time?: string } | string
  sunset?: { time?: string } | string
}

export type DailyWeather = {
  temperature: DailyValueRange[]
  skycon: DailySkycon[]
  astro?: DailyAstro[]
  skycon_08h_20h?: DailySkycon[]
  skycon_20h_32h?: DailySkycon[]
  precipitation?: DailyValueRange[]
  wind?: DailyWind[]
  humidity?: DailyValueRange[]
  air_quality?: {
    aqi?: Array<{ date: string; max?: { chn?: number }; avg?: { chn?: number }; min?: { chn?: number } }>
    pm25?: DailyValueRange[]
  }
  life_index?: {
    ultraviolet?: LifeIndexItem[]
    carWashing?: LifeIndexItem[]
    dressing?: LifeIndexItem[]
    comfort?: LifeIndexItem[]
    coldRisk?: LifeIndexItem[]
  }
}

export type HourlyPoint<T = number> = {
  datetime: string
  value: T
}

export type HourlyPrecipitation = {
  datetime: string
  value?: number
  probability?: number
}

export type HourlyWeather = {
  description?: string
  temperature: HourlyPoint[]
  skycon: HourlyPoint<SkyconCode>[]
  // 彩云 hourly.precipitation 可能含 probability（0–1 或 0–100）
  precipitation?: HourlyPrecipitation[]
  humidity?: HourlyPoint[]
  wind?: Array<{ datetime: string; speed: number; direction: number }>
  air_quality?: {
    aqi?: Array<{ datetime: string; value: { chn?: number; usa?: number } }>
    pm25?: HourlyPoint[]
  }
}

export type WeatherAlertContent = {
  title?: string
  description?: string
  code?: string
  source?: string
  status?: string
  location?: string
}

export type WeatherResult = {
  realtime: RealtimeWeather
  minutely?: {
    description?: string
    precipitation?: number[]
    // 未来两小时降水概率，逐 30 分钟一个点（0–1）
    probability?: number[]
  }
  hourly?: HourlyWeather
  daily?: DailyWeather
  alert?: {
    content?: WeatherAlertContent[]
  }
  forecast_keypoint?: string
}

export type WeatherResponse = {
  status: string
  api_version?: string
  server_time?: number
  location?: [number, number]
  timezone?: string
  result: WeatherResult
}

export type SearchResult = {
  place: Place
}
