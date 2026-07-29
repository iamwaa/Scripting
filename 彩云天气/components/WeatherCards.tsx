import {
  AreaChart,
  Button,
  Capsule,
  Chart,
  HStack,
  Image,
  LineChart,
  ProgressView,
  ScrollView,
  Text,
  VStack,
  ZStack,
} from "scripting"
import {
  skyconLabel,
  skyconSymbol,
  windDirectionLabel,
  windLevelLabel,
} from "../constants"
import type { Color } from "scripting"
import type {
  DailyAstro,
  DailyWeather,
  HourlyWeather,
  Place,
  RealtimeWeather,
  WeatherResult,
} from "../types"
import {
  formatAqi,
  formatHour,
  formatMonthDay,
  formatPercent,
  formatPrecipProbability,
  formatTemp,
  formatWeekday,
} from "../utils/format"
import { placeAddress, placeDisplayName } from "../utils/place"
import { GlassBadge } from "./glass"
import { textColor, weatherCardProps, type GlassBadgeStyle } from "./tokens"

function astroTime(value?: { time?: string } | string): string | null {
  if (typeof value === "string") return value
  return value?.time ?? null
}

function parseAstroMoment(date: string, value?: { time?: string } | string): Date | null {
  const time = astroTime(value)
  if (!time) return null
  const direct = new Date(time)
  if (!Number.isNaN(direct.getTime()) && /\d{4}-\d{2}-\d{2}/.test(time)) return direct
  const match = time.match(/(\d{1,2}):(\d{2})/)
  if (!match) return null
  const dateMatch = date.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!dateMatch) return null
  const moment = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(match[1]),
    Number(match[2])
  )
  return Number.isNaN(moment.getTime()) ? null : moment
}

function nextSolarEvent(astro?: DailyAstro[]): {
  label: "日出" | "日落"
  time: string
  icon: string
} | null {
  if (!astro?.length) return null
  const now = new Date()
  const events = astro.flatMap(day => {
    const sunrise = parseAstroMoment(day.date, day.sunrise)
    const sunset = parseAstroMoment(day.date, day.sunset)
    return [
      sunrise ? { label: "日出" as const, moment: sunrise, icon: "sunrise.fill" } : null,
      sunset ? { label: "日落" as const, moment: sunset, icon: "sunset.fill" } : null,
    ].filter((event): event is NonNullable<typeof event> => event != null)
  })
  const next = events
    .filter(event => event.moment.getTime() > now.getTime())
    .sort((a, b) => a.moment.getTime() - b.moment.getTime())[0]
  if (!next) return null
  return {
    label: next.label,
    time: `${String(next.moment.getHours()).padStart(2, "0")}:${String(next.moment.getMinutes()).padStart(2, "0")}`,
    icon: next.icon,
  }
}

// 紫外线等级 → 胶囊色（优先 index，其次中文 desc）
function ultravioletBadgeStyle(
  index?: string | number | null,
  desc?: string | null
): GlassBadgeStyle {
  const n = typeof index === "number" ? index : Number(index)
  if (Number.isFinite(n)) {
    if (n <= 2) return "success"
    if (n <= 5) return "info"
    if (n <= 7) return "warning"
    return "error"
  }
  const text = `${desc ?? ""}${index ?? ""}`
  if (/最弱|很弱|弱/.test(text)) return "success"
  if (/中等|中/.test(text)) return "info"
  if (/强|较强/.test(text) && !/很强|极强/.test(text)) return "warning"
  if (/很强|极强|超强/.test(text)) return "error"
  return "neutral"
}

// 地点信息：标题用显示名（收藏），副标题始终是地址
export function PlaceHeader({
  place,
  favorited,
  onToggleFavorite,
}: {
  place: Place
  favorited?: boolean
  onToggleFavorite?: () => void
}) {
  const title = placeDisplayName(place)
  const address = placeAddress(place)

  return (
    <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <HStack spacing={6}>
        {place.isCurrent ? (
          <Image systemName="location.fill" font={12} foregroundStyle="systemBlue" />
        ) : null}
        <Text font="headline" foregroundStyle={textColor.primary} lineLimit={1}>
          {title}
        </Text>
        {onToggleFavorite ? (
          <Button action={onToggleFavorite} buttonStyle="plain">
            <Image
              systemName={favorited ? "star.fill" : "star"}
              font={14}
              foregroundStyle={favorited ? "systemYellow" : textColor.secondary}
            />
          </Button>
        ) : null}
      </HStack>
      <HStack spacing={6} alignment="firstTextBaseline">
        <Text font={12} foregroundStyle={textColor.secondary} lineLimit={2}>
          {address}
        </Text>
      </HStack>
    </VStack>
  )
}

export function RealtimeCard({
  place,
  realtime,
  daily,
  refreshing = false,
  favorited,
  onToggleFavorite,
}: {
  place: Place
  realtime: RealtimeWeather
  daily?: DailyWeather
  refreshing?: boolean
  favorited?: boolean
  onToggleFavorite?: () => void
}) {
  const aqi = realtime.air_quality?.aqi?.chn
  const aqiDesc = realtime.air_quality?.description?.chn
  const uv = realtime.life_index?.ultraviolet
  const uvDesc = uv?.desc
  const precipIntensity = realtime.precipitation?.local?.intensity
  const solarEvent = nextSolarEvent(daily?.astro)
  const uvStyle = ultravioletBadgeStyle(uv?.index, uvDesc)

  return (
    <VStack spacing={14} {...weatherCardProps}>
      <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <PlaceHeader
          place={place}
          favorited={favorited}
          onToggleFavorite={onToggleFavorite}
        />
        {refreshing ? <ProgressView progressViewStyle="circular" /> : null}
      </HStack>

      <HStack alignment="center" spacing={16} frame={{ maxWidth: "infinity" }}>
        <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <HStack alignment="firstTextBaseline" spacing={2}>
            <Text font={54} fontWeight="bold" foregroundStyle={textColor.primary}>
              {formatTemp(realtime.temperature, "")}
            </Text>
            <Text font={54} fontWeight="semibold" foregroundStyle={textColor.primary}>
              °
            </Text>
          </HStack>
          <HStack spacing={8}>
            <Image
              systemName={skyconSymbol(realtime.skycon)}
              font={22}
              symbolRenderingMode="multicolor"
            />
            <Text font="title3" fontWeight="semibold" foregroundStyle={textColor.primary}>
              {skyconLabel(realtime.skycon)}
            </Text>
          </HStack>
          {realtime.apparent_temperature != null ? (
            <Text font="footnote" foregroundStyle={textColor.secondary}>
              体感 {formatTemp(realtime.apparent_temperature)}
            </Text>
          ) : null}
        </VStack>
        <VStack alignment="trailing" spacing={6}>
          {aqi != null ? (
            <GlassBadge style={aqi <= 50 ? "success" : aqi <= 100 ? "info" : aqi <= 150 ? "warning" : "error"}>
              <HStack spacing={4}>
                <Image systemName="aqi.medium" font={11} />
                <Text font={12} fontWeight="medium">
                  AQI {formatAqi(aqi)}
                  {aqiDesc ? ` · ${aqiDesc}` : ""}
                </Text>
              </HStack>
            </GlassBadge>
          ) : null}
          {uvDesc ? (
            <GlassBadge style={uvStyle}>
              <HStack spacing={4}>
                <Image systemName="sun.max.fill" font={11} />
                <Text font={12} fontWeight="medium">
                  紫外线 {uvDesc}
                </Text>
              </HStack>
            </GlassBadge>
          ) : null}
          {precipIntensity != null && !Number.isNaN(precipIntensity) ? (
            <GlassBadge style="info">
              <HStack spacing={4}>
                <Image systemName="umbrella.fill" font={11} />
                <Text font={12} fontWeight="medium">
                  降水概率 {formatPrecipProbability(precipIntensity)}
                </Text>
              </HStack>
            </GlassBadge>
          ) : null}
          {solarEvent ? (
            <GlassBadge style={solarEvent.label === "日出" ? "warning" : "teal"}>
              <HStack spacing={4}>
                <Image systemName={solarEvent.icon} font={11} />
                <Text font={12} fontWeight="medium">
                  {solarEvent.label} {solarEvent.time}
                </Text>
              </HStack>
            </GlassBadge>
          ) : null}
        </VStack>
      </HStack>

      <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
        <MetricChip
          icon="drop.fill"
          label="湿度"
          value={formatPercent(realtime.humidity)}
        />
        <MetricChip
          icon="wind"
          label="风力"
          value={`${windDirectionLabel(realtime.wind?.direction)} ${windLevelLabel(realtime.wind?.speed)}`}
        />
        <MetricChip
          icon="barometer"
          label="气压"
          value={
            realtime.pressure != null
              ? `${Math.round(realtime.pressure / 100)} hPa`
              : "—"
          }
        />
      </HStack>
    </VStack>
  )
}

function MetricChip({
  icon,
  label,
  value,
}: {
  icon: string
  label: string
  value: string
}) {
  return (
    <VStack
      alignment="leading"
      spacing={4}
      padding={12}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={{
        style: {
          light: "rgba(120,120,128,0.10)",
          dark: "rgba(120,120,128,0.18)",
        },
        shape: { type: "rect", cornerRadius: 14, style: "continuous" },
      }}
    >
      <HStack spacing={4}>
        <Image systemName={icon} font={12} foregroundStyle={textColor.secondary} />
        <Text font="caption2" foregroundStyle={textColor.secondary}>
          {label}
        </Text>
      </HStack>
      <Text font="footnote" fontWeight="semibold" foregroundStyle={textColor.primary} lineLimit={1}>
        {value}
      </Text>
    </VStack>
  )
}

// ── 未来两小时降水概率折线图 ──────────────────────────
// 数据源：彩云 minutely.probability（逐 30 分钟一个概率点，0–1）
// 显示条件：正在下雨或即将下雨（skycon 含 RAIN / 实况降水强度 >0 / 任一概率点 >0）

type RainProbPoint = {
  label: string
  value: number
}

// 是否显示降水概率图：有概率数据，且正在下雨或未来两小时任一时段有降水概率
export function shouldShowRainProbability(
  realtime: RealtimeWeather,
  minutely?: WeatherResult["minutely"]
): boolean {
  const probability = minutely?.probability
  if (!probability?.length) return false
  const intensity = realtime.precipitation?.local?.intensity ?? 0
  const raining = realtime.skycon?.includes("RAIN") || intensity > 0
  const willRain = probability.some(raw => (raw <= 1 ? raw * 100 : raw) > 0)
  return raining || willRain
}

// 概率数组按 30 分钟锚点线性重采样为 15 分钟一个点（0–1 与 0–100 都兼容）
function resampleTo15Min(probability: number[]): number[] {
  const toPct = (raw: number) => {
    const pct = raw <= 1 ? raw * 100 : raw
    return Math.max(0, Math.min(100, pct))
  }
  const anchors = probability.map(toPct)
  if (anchors.length < 2) return anchors.map(v => Math.round(v))
  const spanMin = (anchors.length - 1) * 30
  const out: number[] = []
  for (let t = 0; t <= spanMin; t += 15) {
    const pos = t / 30
    const lo = Math.floor(pos)
    const hi = Math.min(lo + 1, anchors.length - 1)
    const frac = pos - lo
    out.push(Math.round(anchors[lo] + (anchors[hi] - anchors[lo]) * frac))
  }
  return out
}

// 把概率数组转成折线点；标签从当前时间起按 15 分钟递推
function buildRainProbPoints(probability: number[]): RainProbPoint[] {
  const now = new Date()
  return resampleTo15Min(probability).map((value, index) => {
    const moment = new Date(now.getTime() + index * 15 * 60 * 1000)
    // 仅整点位给语义标签；其余保留唯一时间串，保证折线连续且类别轴不塌陷
    let label: string
    if (index === 0) label = "现在"
    else if (index === 4) label = "1 小时"
    else if (index === 8) label = "2 小时"
    else
      label = `${String(moment.getHours()).padStart(2, "0")}:${String(moment.getMinutes()).padStart(2, "0")}`
    return { label, value }
  })
}

export function RainProbabilitySection({
  realtime,
  minutely,
}: {
  realtime: RealtimeWeather
  minutely?: WeatherResult["minutely"]
}) {
  const probability = minutely?.probability
  if (!probability?.length) return null

  const points = buildRainProbPoints(probability)
  const intensity = realtime.precipitation?.local?.intensity ?? 0
  const raining = realtime.skycon?.includes("RAIN") || intensity > 0
  const willRain = points.some(point => point.value > 0)
  // 既不在下雨也无即将降水趋势时不显示
  if (!raining && !willRain) return null

  const peak = points.reduce((max, point) => Math.max(max, point.value), 0)
  const marks = points.map(point => ({ label: point.label, value: point.value }))

  return (
    <VStack alignment="leading" spacing={12} {...weatherCardProps}>
      <HStack spacing={6}>
        <Text font="headline" foregroundStyle={textColor.primary}>
          未来两小时降水概率
        </Text>
      </HStack>
      <Text font={14} foregroundStyle={textColor.secondary}>
        {raining ? "当前有降水" : "预计即将降水"}，峰值概率 {peak}%
      </Text>
      <VStack spacing={4}>
        <Chart
          frame={{ height: 100 }}
          chartYScale={{ from: 0, to: 1 }}
          chartXAxis={{ gridLine: false, tick: false, valueLabel: false }}
          chartYAxis={{
            position: "leading",
            gridLine: false,
            valueLabel: { format: ChartAxisLabelFormat.percent() },
          }}
        >
          <AreaChart
            marks={marks.map(mark => ({
              ...mark,
              value: mark.value / 100,
              foregroundStyle: {
                light: {
                  colors: ["rgba(0,122,255,0.32)", "rgba(0,122,255,0.02)"],
                  startPoint: "top",
                  endPoint: "bottom",
                },
                dark: {
                  colors: ["rgba(10,132,255,0.36)", "rgba(10,132,255,0.02)"],
                  startPoint: "top",
                  endPoint: "bottom",
                },
              },
              interpolationMethod: "catmullRom",
            }))}
          />
          <LineChart
            marks={marks.map(mark => ({
              ...mark,
              value: mark.value / 100,
              foregroundStyle: "systemBlue",
              interpolationMethod: "catmullRom",
              lineStyle: { lineWidth: 2.5, lineCap: "round" },
            }))}
          />
        </Chart>
        {/* 自绘 x 轴标签：Y 轴在左侧，标签行 leading 留白对齐绘图区起点，三段占满剩余宽度 */}
        <HStack padding={{ leading: 50 }} frame={{ maxWidth: "infinity" }}>
          <Text
            font="caption"
            foregroundStyle={textColor.tertiary}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            现在
          </Text>
          <Text
            font="caption"
            foregroundStyle={textColor.tertiary}
            frame={{ maxWidth: "infinity", alignment: "center" }}
          >
            1 小时
          </Text>
          <Text
            font="caption"
            foregroundStyle={textColor.tertiary}
            frame={{ maxWidth: "infinity", alignment: "trailing" }}
          >
            2 小时
          </Text>
        </HStack>
      </VStack>
    </VStack>
  )
}

export function HourlySection({ hourly }: { hourly?: HourlyWeather }) {
  if (!hourly?.temperature?.length) return null
  const count = Math.min(hourly.temperature.length, 12)
  const items = Array.from({ length: count }, (_, i) => {
    const temp = hourly.temperature[i]
    const sky = hourly.skycon?.[i]
    return {
      key: temp.datetime,
      hour: formatHour(temp.datetime),
      temp: formatTemp(temp.value),
      skycon: sky?.value,
    }
  })

  return (
    <VStack alignment="leading" spacing={12} {...weatherCardProps}>
      <Text font="headline" foregroundStyle={textColor.primary}>
        小时预报
      </Text>
      {/* 概括单独占一行，避免和标题挤在一起 */}
      {hourly.description ? (
        <Text font={14} foregroundStyle={textColor.secondary} lineLimit={3}>
          {hourly.description}
        </Text>
      ) : null}
      <ScrollView axes="horizontal" scrollIndicator="hidden">
        <HStack spacing={12} padding={{ vertical: 2, trailing: 4 }}>
          {items.map(item => (
            <VStack key={item.key} spacing={8} frame={{ width: 56 }} alignment="center">
              <Text font="caption" foregroundStyle={textColor.secondary}>
                {item.hour}
              </Text>
              <Image
                systemName={skyconSymbol(item.skycon)}
                font={18}
                symbolRenderingMode="multicolor"
              />
              <Text font="callout" fontWeight="semibold" foregroundStyle={textColor.primary}>
                {item.temp}
              </Text>
            </VStack>
          ))}
        </HStack>
      </ScrollView>
    </VStack>
  )
}

// 温度→冷暖色：低温偏蓝、高温偏橙，用于温度条渐变端点
function tempColor(value: number): Color {
  const stops: Array<{ t: number; rgb: [number, number, number] }> = [
    { t: -10, rgb: [80, 150, 235] },
    { t: 0, rgb: [90, 180, 235] },
    { t: 10, rgb: [110, 205, 190] },
    { t: 20, rgb: [245, 200, 90] },
    { t: 30, rgb: [245, 150, 60] },
    { t: 40, rgb: [235, 90, 55] },
  ]
  if (value <= stops[0].t) return `rgb(${stops[0].rgb.join(",")})` as Color
  const last = stops[stops.length - 1]
  if (value >= last.t) return `rgb(${last.rgb.join(",")})` as Color
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i]
    const hi = stops[i + 1]
    if (value >= lo.t && value <= hi.t) {
      const frac = (value - lo.t) / (hi.t - lo.t)
      const rgb = lo.rgb.map((c, k) => Math.round(c + (hi.rgb[k] - c) * frac))
      return `rgb(${rgb.join(",")})` as Color
    }
  }
  return `rgb(${last.rgb.join(",")})` as Color
}

// 单日温度条：按当天 min–max 在全周范围内定位，冷蓝→暖橙渐变
function DailyTempBar({
  min,
  max,
  rangeMin,
  rangeMax,
}: {
  min: number
  max: number
  rangeMin: number
  rangeMax: number
}) {
  const trackWidth = 92
  const span = Math.max(1, rangeMax - rangeMin)
  const leftFrac = (min - rangeMin) / span
  const widthFrac = Math.max(0.12, (max - min) / span)
  const barWidth = Math.round(trackWidth * widthFrac)
  const leftPad = Math.round(trackWidth * leftFrac)

  return (
    <ZStack alignment="leading" frame={{ width: trackWidth, height: 6 }}>
      <Capsule
        fill={{ light: "rgba(0,0,0,0.06)", dark: "rgba(255,255,255,0.12)" }}
        frame={{ width: trackWidth, height: 6 }}
      />
      <Capsule
        fill={{
          colors: [tempColor(min), tempColor(max)],
          startPoint: "leading",
          endPoint: "trailing",
        }}
        frame={{ width: barWidth, height: 6 }}
        offset={{ x: leftPad, y: 0 }}
      />
    </ZStack>
  )
}

export function DailySection({ daily }: { daily?: DailyWeather }) {
  if (!daily?.temperature?.length) return null
  const count = Math.min(daily.temperature.length, 7)
  const days = daily.temperature.slice(0, count)
  const rangeMin = Math.min(...days.map(d => d.min))
  const rangeMax = Math.max(...days.map(d => d.max))

  return (
    <VStack alignment="leading" spacing={2} {...weatherCardProps}>
      <Text font="headline" foregroundStyle={textColor.primary} padding={{ bottom: 6 }}>
        每日预报
      </Text>
      {days.map((temp, index) => {
        const sky = daily.skycon?.[index]
        return (
          <HStack
            key={temp.date}
            spacing={8}
            padding={{ vertical: 6 }}
            frame={{ maxWidth: "infinity" }}
          >
            <VStack alignment="leading" spacing={1} frame={{ width: 46, alignment: "leading" }}>
              <Text font="callout" fontWeight="semibold" foregroundStyle={textColor.primary}>
                {formatWeekday(temp.date, index)}
              </Text>
              <Text font="caption2" foregroundStyle={textColor.tertiary}>
                {formatMonthDay(temp.date)}
              </Text>
            </VStack>
            <Image
              systemName={skyconSymbol(sky?.value)}
              font={18}
              symbolRenderingMode="multicolor"
              frame={{ width: 24, alignment: "center" }}
              padding={{ leading: 12 }}
            />
            <Text
              font={16}
              foregroundStyle={textColor.secondary}
              lineLimit={1}
              frame={{ width: 42, alignment: "leading" }}
            >
              {skyconLabel(sky?.value)}
            </Text>
            <Text
              font="callout"
              foregroundStyle={textColor.tertiary}
              lineLimit={1}
              frame={{ width: 58, alignment: "trailing" }}
            >
              {formatTemp(temp.min, "")}°
            </Text>
            <DailyTempBar
              min={temp.min}
              max={temp.max}
              rangeMin={rangeMin}
              rangeMax={rangeMax}
            />
            <Text
              font="callout"
              fontWeight="semibold"
              foregroundStyle={textColor.primary}
              lineLimit={1}
              frame={{ maxWidth: "infinity", alignment: "trailing" }}
            >
              {formatTemp(temp.max, "")}°
            </Text>
          </HStack>
        )
      })}
    </VStack>
  )
}

// 顶部提醒卡：字号缩小，避免与天气概括抢视线
export function AlertsSection({ result }: { result: WeatherResult }) {
  const alerts = result.alert?.content ?? []
  const minutely = result.minutely?.description
  if (alerts.length === 0 && !minutely) return null

  return (
    <VStack alignment="leading" spacing={8} {...weatherCardProps}>
      <Text font="headline" fontWeight="semibold" foregroundStyle={textColor.primary}>
        提醒
      </Text>
      {minutely ? (
        <Text font={14} foregroundStyle={textColor.secondary}>
          {minutely}
        </Text>
      ) : null}
      {alerts.map((item, index) => (
        <VStack key={`${item.title ?? "alert"}-${index}`} alignment="leading" spacing={3}>
          <GlassBadge style="warning">
            <Text font={11} fontWeight="medium">
              {item.title ?? "天气预警"}
            </Text>
          </GlassBadge>
          {item.description ? (
            <Text font="caption" foregroundStyle={textColor.secondary}>
              {item.description}
            </Text>
          ) : null}
        </VStack>
      ))}
    </VStack>
  )
}
