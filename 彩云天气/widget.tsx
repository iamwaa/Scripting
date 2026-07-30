/**
 * 首页 Widget — 彩云天气默认小组件 UI
 *
 * 渲染约束（见 Widget Quick Start）：
 * - widget.tsx 只渲染一次，无 hooks 生命周期；数据必须在 Widget.present 前备好
 * - Widget.present 之后的代码不会执行
 * - 约 30MB 内存上限，避免深层级与大图
 *
 * 数据来源：复用 App 的数据层
 * - loadApiToken：未配置 Token → 占位提示
 * - loadLastPlace：App 最近查看/定位的地点；未有 → 占位提示
 * - fetchWeather / peekCachedWeather：优先缓存直出，失败回退缓存
 *
 * 配色：复用 WeatherBackground 的时段/天气渐变思路，随 skycon + 昼夜取色，
 * 明暗成对；文字用语义 label / secondaryLabel，在浅色渐变上呈深色、深色渐变上呈浅色，
 * 自动适配 Light/Dark，无需硬编码白字。
 */
import {
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  Widget,
  type Color,
  type DynamicShapeStyle,
  type WidgetFamily,
} from "scripting"
import { fetchWeather, peekCachedWeather } from "./api/weather"
import { skyconLabel, skyconSymbol } from "./constants"
import { loadLastPlace } from "./services/favoritesService"
import { loadApiToken } from "./services/settingsService"
import type { Place, SkyconCode, WeatherResult } from "./types"
import { formatTemp, formatHour, formatWeekday } from "./utils/format"
import { placeDisplayName } from "./utils/place"

// ── 渐变配色（简化自 WeatherBackground，双色停靠即可） ──

type WeatherKind = "clear" | "cloudy" | "rain" | "snow" | "haze" | "fog"

function weatherKindOf(skycon: SkyconCode): WeatherKind {
  if (skycon.includes("RAIN")) return "rain"
  if (skycon.includes("SNOW")) return "snow"
  if (skycon === "FOG") return "fog"
  if (skycon.includes("HAZE") || skycon === "DUST" || skycon === "SAND") return "haze"
  if (skycon.includes("CLEAR")) return "clear"
  return "cloudy"
}

function isNightSkycon(skycon: SkyconCode): boolean {
  if (skycon.endsWith("_NIGHT")) return true
  if (skycon.endsWith("_DAY")) return false
  const hour = new Date().getHours()
  return hour < 6 || hour >= 19
}

type GradientSpec = { light: Color[]; dark: Color[] }

const palettes: Record<WeatherKind, { day: GradientSpec; night: GradientSpec }> = {
  clear: {
    day: { light: ["#6fb0e8", "#a6cff0"], dark: ["#0a1830", "#274864"] },
    night: { light: ["#8796bf", "#d8cfc0"], dark: ["#04060d", "#1a1834"] },
  },
  cloudy: {
    day: { light: ["#93a9bf", "#dde0db"], dark: ["#111824", "#2a3648"] },
    night: { light: ["#8693a8", "#cdcbc3"], dark: ["#0b0f16", "#202937"] },
  },
  rain: {
    day: { light: ["#6f8aa4", "#c5ced4"], dark: ["#09121b", "#1c2f40"] },
    night: { light: ["#6f8aa4", "#c5ced4"], dark: ["#09121b", "#1c2f40"] },
  },
  snow: {
    day: { light: ["#a9c0d3", "#eef2f5"], dark: ["#121925", "#2b3748"] },
    night: { light: ["#a9c0d3", "#eef2f5"], dark: ["#121925", "#2b3748"] },
  },
  haze: {
    day: { light: ["#b0aa97", "#ddd7c3"], dark: ["#19160f", "#342e22"] },
    night: { light: ["#b0aa97", "#ddd7c3"], dark: ["#19160f", "#342e22"] },
  },
  fog: {
    day: { light: ["#9eaab4", "#d9dfe1"], dark: ["#13171c", "#293035"] },
    night: { light: ["#9eaab4", "#d9dfe1"], dark: ["#13171c", "#293035"] },
  },
}

// 时段渐变：无天气数据时的回退底色（黄昏/夜/白天）
const neutralGradient: GradientSpec = (() => {
  const hour = new Date().getHours()
  const night = hour < 6 || hour >= 19
  return night
    ? { light: ["#8796bf", "#d8cfc0"], dark: ["#04060d", "#1a1834"] }
    : { light: ["#6fb0e8", "#a6cff0"], dark: ["#0a1830", "#274864"] }
})()

function gradientFor(skycon?: SkyconCode | null): DynamicShapeStyle {
  const spec = skycon
    ? (isNightSkycon(skycon) ? palettes[weatherKindOf(skycon)].night : palettes[weatherKindOf(skycon)].day)
    : neutralGradient
  return {
    light: { colors: spec.light, startPoint: "top", endPoint: "bottom" },
    dark: { colors: spec.dark, startPoint: "top", endPoint: "bottom" },
  }
}

// ── 视图数据模型（present 前同步/异步备好） ──

type WidgetModel =
  | { state: "no-token" }
  | { state: "no-place" }
  | { state: "no-data"; place: Place }
  | { state: "ok"; place: Place; weather: WeatherResult }

// ── 占位态 ──

function Placeholder({ symbol, title, hint }: { symbol: string; title: string; hint: string }) {
  return (
    <VStack
      spacing={8}
      padding={16}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      widgetBackground={gradientFor(null)}
    >
      <Image systemName={symbol} font={28} foregroundStyle="label" />
      <Text font={15} fontWeight="semibold" foregroundStyle="label">
        {title}
      </Text>
      <Text font={12} foregroundStyle="secondaryLabel" multilineTextAlignment="center">
        {hint}
      </Text>
    </VStack>
  )
}

// ── 当前天气主块（各尺寸复用） ──

function CurrentBlock({
  place,
  weather,
  compact,
}: {
  place: Place
  weather: WeatherResult
  compact: boolean
}) {
  const realtime = weather.realtime
  const today = weather.daily?.temperature?.[0]
  const name = placeDisplayName(place)
  return (
    <VStack alignment="leading" spacing={compact ? 2 : 4}>
      <Text font={compact ? 13 : 15} fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
        {name}
      </Text>
      <HStack alignment="center" spacing={6}>
        <Image systemName={skyconSymbol(realtime.skycon)} font={compact ? 22 : 28} foregroundStyle="label" />
        <Text font={compact ? 34 : 44} fontWeight="medium" foregroundStyle="label">
          {formatTemp(realtime.temperature)}
        </Text>
      </HStack>
      <Text font={compact ? 12 : 13} foregroundStyle="secondaryLabel" lineLimit={1}>
        {skyconLabel(realtime.skycon)}
        {today ? `  ${formatTemp(today.min)} / ${formatTemp(today.max)}` : ""}
      </Text>
    </VStack>
  )
}

// ── 逐小时列（中/大尺寸右侧或底部） ──

function HourlyRow({ weather, count }: { weather: WeatherResult; count: number }) {
  const temps = weather.hourly?.temperature ?? []
  const skycons = weather.hourly?.skycon ?? []
  const items = temps.slice(0, count)
  return (
    <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
      {items.map((point, i) => (
        <VStack key={point.datetime} spacing={4} frame={{ maxWidth: "infinity" }}>
          <Text font={11} foregroundStyle="secondaryLabel">
            {i === 0 ? "现在" : formatHour(point.datetime)}
          </Text>
          <Image systemName={skyconSymbol(skycons[i]?.value)} font={15} foregroundStyle="label" />
          <Text font={12} fontWeight="medium" foregroundStyle="label">
            {formatTemp(point.value)}
          </Text>
        </VStack>
      ))}
    </HStack>
  )
}

// ── 逐日行（大尺寸） ──

function DailyRows({ weather, count }: { weather: WeatherResult; count: number }) {
  const daily = weather.daily
  const temps = daily?.temperature ?? []
  const skycons = daily?.skycon ?? []
  const rows = temps.slice(0, count)
  return (
    <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
      {rows.map((day, i) => (
        <HStack key={day.date} alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
          <Text font={13} foregroundStyle="label" frame={{ width: 44, alignment: "leading" }}>
            {formatWeekday(day.date, i)}
          </Text>
          <Image systemName={skyconSymbol(skycons[i]?.value)} font={15} foregroundStyle="label" />
          <Spacer />
          <Text font={13} foregroundStyle="secondaryLabel">
            {formatTemp(day.min)}
          </Text>
          <Text font={13} fontWeight="medium" foregroundStyle="label" frame={{ width: 42, alignment: "trailing" }}>
            {formatTemp(day.max)}
          </Text>
        </HStack>
      ))}
    </VStack>
  )
}

// ── 各尺寸布局 ──

function SmallView({ place, weather }: { place: Place; weather: WeatherResult }) {
  return (
    <VStack
      alignment="leading"
      spacing={0}
      padding={14}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}
      widgetBackground={gradientFor(weather.realtime.skycon)}
    >
      <CurrentBlock place={place} weather={weather} compact />
    </VStack>
  )
}

function MediumView({ place, weather }: { place: Place; weather: WeatherResult }) {
  return (
    <VStack
      spacing={10}
      padding={14}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}
      widgetBackground={gradientFor(weather.realtime.skycon)}
    >
      <HStack alignment="top" spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <CurrentBlock place={place} weather={weather} compact />
        <Spacer />
      </HStack>
      <HourlyRow weather={weather} count={5} />
    </VStack>
  )
}

function LargeView({ place, weather }: { place: Place; weather: WeatherResult }) {
  return (
    <VStack
      spacing={12}
      padding={16}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}
      widgetBackground={gradientFor(weather.realtime.skycon)}
    >
      <HStack alignment="top" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <CurrentBlock place={place} weather={weather} compact={false} />
        <Spacer />
      </HStack>
      <HourlyRow weather={weather} count={6} />
      <DailyRows weather={weather} count={5} />
    </VStack>
  )
}

function AccessoryRectangularView({ place, weather }: { place: Place; weather: WeatherResult }) {
  const realtime = weather.realtime
  const today = weather.daily?.temperature?.[0]
  return (
    <VStack alignment="leading" spacing={2}>
      <HStack spacing={4} alignment="center">
        <Image systemName={skyconSymbol(realtime.skycon)} font={14} />
        <Text font={14} fontWeight="semibold" lineLimit={1}>
          {placeDisplayName(place)}
        </Text>
      </HStack>
      <Text font={13}>
        {formatTemp(realtime.temperature)} {skyconLabel(realtime.skycon)}
        {today ? `  ${formatTemp(today.min)}/${formatTemp(today.max)}` : ""}
      </Text>
    </VStack>
  )
}

function AccessoryInlineView({ weather }: { weather: WeatherResult }) {
  const realtime = weather.realtime
  return (
    <Text>
      {skyconLabel(realtime.skycon)} {formatTemp(realtime.temperature)}
    </Text>
  )
}

function AccessoryCircularView({ weather }: { weather: WeatherResult }) {
  const realtime = weather.realtime
  return (
    <VStack spacing={0}>
      <Image systemName={skyconSymbol(realtime.skycon)} font={14} />
      <Text font={13} fontWeight="semibold">
        {formatTemp(realtime.temperature, "°")}
      </Text>
    </VStack>
  )
}

// ── 根视图：按 family 分发 + 占位态 ──

function WidgetView({ model, family }: { model: WidgetModel; family: WidgetFamily }) {
  if (model.state === "no-token") {
    return (
      <Placeholder
        symbol="key.slash"
        title="未配置 Token"
        hint="打开彩云天气，在设置中填写 API Token"
      />
    )
  }
  if (model.state === "no-place") {
    return (
      <Placeholder
        symbol="location.slash"
        title="暂无地点"
        hint="打开彩云天气，定位或选择一个地点"
      />
    )
  }
  if (model.state === "no-data") {
    return (
      <Placeholder
        symbol="cloud.slash"
        title="暂无天气数据"
        hint="打开彩云天气刷新后再试"
      />
    )
  }

  const { place, weather } = model
  switch (family) {
    case "systemSmall":
      return <SmallView place={place} weather={weather} />
    case "systemMedium":
      return <MediumView place={place} weather={weather} />
    case "systemLarge":
    case "systemExtraLarge":
      return <LargeView place={place} weather={weather} />
    case "accessoryRectangular":
      return <AccessoryRectangularView place={place} weather={weather} />
    case "accessoryInline":
      return <AccessoryInlineView weather={weather} />
    case "accessoryCircular":
      return <AccessoryCircularView weather={weather} />
    default:
      return <SmallView place={place} weather={weather} />
  }
}

// ── 数据装配：present 前备好模型 ──

async function buildModel(): Promise<WidgetModel> {
  if (!loadApiToken()) return { state: "no-token" }

  const place = loadLastPlace()
  if (!place) return { state: "no-place" }

  const options = { longitude: place.longitude, latitude: place.latitude }

  // 缓存优先直出，避免刷新时空白
  const cached = peekCachedWeather(options)
  if (cached) return { state: "ok", place, weather: cached.result }

  try {
    const response = await fetchWeather(options)
    return { state: "ok", place, weather: response.result }
  } catch {
    return { state: "no-data", place }
  }
}

async function run() {
  const model = await buildModel()
  // 30 分钟后请求刷新
  Widget.present(<WidgetView model={model} family={Widget.family} />, {
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 30 * 60 * 1000) },
  })
}

run()
