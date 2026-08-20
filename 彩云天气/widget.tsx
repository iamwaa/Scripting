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
  Capsule,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  Widget,
  ZStack,
  type Color,
  type DynamicShapeStyle,
  type WidgetFamily,
} from "scripting"
import { fetchWeather, peekCachedWeather } from "./api/weather"
import { skyconLabel, skyconSymbol } from "./constants"
import { fallbackMaterial, surfaceFill } from "./components/tokens"
import { loadLastPlace } from "./services/favoritesService"
import { loadApiToken } from "./services/settingsService"
import type { Place, SkyconCode, WeatherResult } from "./types"
import {
  formatAqi,
  formatHour,
  formatPercent,
  formatPrecipProbability,
  formatTemp,
  formatWeekday,
} from "./utils/format"
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
    day: { light: ["#2f78b7", "#6498bd"], dark: ["#0a1830", "#274864"] },
    night: { light: ["#4e5f8b", "#7a7183"], dark: ["#04060d", "#1a1834"] },
  },
  cloudy: {
    day: { light: ["#60778f", "#8998a5"], dark: ["#111824", "#2a3648"] },
    night: { light: ["#536477", "#747887"], dark: ["#0b0f16", "#202937"] },
  },
  rain: {
    day: { light: ["#3f5f78", "#718696"], dark: ["#09121b", "#1c2f40"] },
    night: { light: ["#3f5f78", "#718696"], dark: ["#09121b", "#1c2f40"] },
  },
  snow: {
    day: { light: ["#627b91", "#8fa5b5"], dark: ["#121925", "#2b3748"] },
    night: { light: ["#627b91", "#8fa5b5"], dark: ["#121925", "#2b3748"] },
  },
  haze: {
    day: { light: ["#746b58", "#998b70"], dark: ["#19160f", "#342e22"] },
    night: { light: ["#746b58", "#998b70"], dark: ["#19160f", "#342e22"] },
  },
  fog: {
    day: { light: ["#64747e", "#909ca2"], dark: ["#13171c", "#293035"] },
    night: { light: ["#64747e", "#909ca2"], dark: ["#13171c", "#293035"] },
  },
}

// 时段渐变：无天气数据时的回退底色（黄昏/夜/白天）
const neutralGradient: GradientSpec = (() => {
  const hour = new Date().getHours()
  const night = hour < 6 || hour >= 19
  return night
    ? { light: ["#4e5f8b", "#7a7183"], dark: ["#04060d", "#1a1834"] }
    : { light: ["#2f78b7", "#6498bd"], dark: ["#0a1830", "#274864"] }
})()

function gradientFor(skycon?: SkyconCode | null): DynamicShapeStyle {
  const spec = skycon
    ? (isNightSkycon(skycon) ? palettes[weatherKindOf(skycon)].night : palettes[weatherKindOf(skycon)].day)
    : neutralGradient
  return {
    light: { colors: spec.light, startPoint: "topLeading", endPoint: "bottomTrailing" },
    dark: { colors: spec.dark, startPoint: "topLeading", endPoint: "bottomTrailing" },
  }
}

function glassPanelProps(cornerRadius = 18) {
  return {
    ...surfaceFill({
      material: fallbackMaterial.card,
      shape: { type: "rect" as const, cornerRadius, style: "continuous" as const },
      interactive: false,
    }),
  }
}

// ── 视图数据模型（present 前同步/异步备好） ──

type WidgetModel =
  | { state: "no-token" }
  | { state: "no-place" }
  | { state: "no-data"; place: Place }
  | { state: "ok"; place: Place; weather: WeatherResult }

// ── 占位态 ──

function MainPlaceholder({ symbol, title, hint }: { symbol: string; title: string; hint: string }) {
  return (
    <VStack
      spacing={8}
      padding={16}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      widgetBackground={gradientFor(null)}
      {...glassPanelProps(20)}
    >
      <Image systemName={symbol} font={26} foregroundStyle="white" />
      <Text font={15} fontWeight="semibold" foregroundStyle="white">
        {title}
      </Text>
      <Text font={12} foregroundStyle="rgba(255,255,255,0.72)" multilineTextAlignment="center" lineLimit={2}>
        {hint}
      </Text>
    </VStack>
  )
}

function AccessoryPlaceholder({
  family,
  symbol,
  title,
  compactTitle,
}: {
  family: WidgetFamily
  symbol: string
  title: string
  compactTitle: string
}) {
  if (family === "accessoryCircular") {
    return (
      <VStack spacing={2} padding={2}>
        <Image systemName={symbol} font={16} />
        <Text font={9} fontWeight="semibold" lineLimit={1}>
          {compactTitle}
        </Text>
      </VStack>
    )
  }

  return (
    <HStack alignment="center" spacing={6} padding={{ horizontal: 2, vertical: 1 }}>
      <Image systemName={symbol} font={16} />
      <Text font={12} fontWeight="semibold" lineLimit={1}>
        {title}
      </Text>
    </HStack>
  )
}

function PlaceholderForFamily({
  family,
  symbol,
  title,
  compactTitle,
  hint,
}: {
  family: WidgetFamily
  symbol: string
  title: string
  compactTitle: string
  hint: string
}) {
  const isAccessory =
    family === "accessoryRectangular" || family === "accessoryInline" || family === "accessoryCircular"
  return isAccessory ? (
    <AccessoryPlaceholder family={family} symbol={symbol} title={title} compactTitle={compactTitle} />
  ) : (
    <MainPlaceholder symbol={symbol} title={title} hint={hint} />
  )
}

// ── 逐小时列（中/大尺寸右侧或底部） ──

function shouldShowPrecipProbability(value?: number): boolean {
  if (value == null || !Number.isFinite(value) || value < 0) return false
  return value <= 1 ? value >= 0.2 : value >= 20
}

function HourlyRow({ weather, count }: { weather: WeatherResult; count: number }) {
  const temps = weather.hourly?.temperature ?? []
  const skycons = weather.hourly?.skycon ?? []
  const precipitation = weather.hourly?.precipitation ?? []
  const items = temps.slice(0, count)
  return (
    <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
      {items.map((point, i) => {
        const probability = precipitation.find(item => item.datetime === point.datetime)?.probability
        const showProbability = shouldShowPrecipProbability(probability)
        return (
          <VStack key={point.datetime} spacing={3} frame={{ maxWidth: "infinity" }}>
            <Text font={11} foregroundStyle="rgba(255,255,255,0.68)">
              {i === 0 ? "现在" : formatHour(point.datetime)}
            </Text>
            <Image
              systemName={skyconSymbol(skycons[i]?.value)}
              font={17}
              symbolRenderingMode="multicolor"
            />
            <Text
              font={9}
              fontWeight="semibold"
              foregroundStyle={showProbability ? "#79D3F2" : "rgba(255,255,255,0)"}
            >
              {showProbability ? formatPrecipProbability(probability) : "0%"}
            </Text>
            <Text font={12} fontWeight="medium" foregroundStyle="white">
              {formatTemp(point.value)}
            </Text>
          </VStack>
        )
      })}
    </HStack>
  )
}

// ── 逐日行（大尺寸） ──

function DailyTempRangeBar({
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
  const trackWidth = 82
  const hasValidRange = Number.isFinite(min) && Number.isFinite(max)
  const low = hasValidRange ? Math.min(min, max) : rangeMin
  const high = hasValidRange ? Math.max(min, max) : rangeMax
  const span = Math.max(1, rangeMax - rangeMin)
  const rawWidth = Math.round(trackWidth * ((high - low) / span))
  const barWidth = Math.min(trackWidth, Math.max(7, rawWidth))
  const rawOffset = Math.round(trackWidth * ((low - rangeMin) / span))
  const offset = Math.min(trackWidth - barWidth, Math.max(0, rawOffset))

  return (
    <ZStack alignment="leading" frame={{ width: trackWidth, height: 6 }}>
      <Capsule fill="rgba(255,255,255,0.18)" frame={{ width: trackWidth, height: 6 }} />
      <Capsule
        fill={{ colors: ["#67B7E8", "#F2A23D"], startPoint: "leading", endPoint: "trailing" }}
        frame={{ width: barWidth, height: 6 }}
        offset={{ x: offset, y: 0 }}
      />
    </ZStack>
  )
}

function DailyRows({ weather, count }: { weather: WeatherResult; count: number }) {
  const daily = weather.daily
  const temps = daily?.temperature ?? []
  const skycons = daily?.skycon ?? []
  const rows = temps.slice(0, count)
  const values = rows.flatMap(day => [day.min, day.max]).filter(Number.isFinite)
  const rangeMin = values.length > 0 ? Math.min(...values) : 0
  const rangeMax = values.length > 0 ? Math.max(...values) : rangeMin
  return (
    <VStack spacing={6} frame={{ maxWidth: "infinity" }}>
      {rows.map((day, i) => (
        <HStack key={day.date} alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
          <Text font={13} foregroundStyle="white" frame={{ width: 44, alignment: "leading" }}>
            {formatWeekday(day.date, i)}
          </Text>
          <Image
            systemName={skyconSymbol(skycons[i]?.value)}
            font={17}
            symbolRenderingMode="multicolor"
          />
          <Spacer />
          <Text font={13} foregroundStyle="rgba(255,255,255,0.68)" frame={{ width: 32, alignment: "trailing" }}>
            {formatTemp(day.min)}
          </Text>
          <DailyTempRangeBar min={day.min} max={day.max} rangeMin={rangeMin} rangeMax={rangeMax} />
          <Text font={13} fontWeight="medium" foregroundStyle="white" frame={{ width: 42, alignment: "trailing" }}>
            {formatTemp(day.max)}
          </Text>
        </HStack>
      ))}
    </VStack>
  )
}

// ── 各尺寸布局 ──

function SmallView({ place, weather }: { place: Place; weather: WeatherResult }) {
  const realtime = weather.realtime
  const summary = weatherSummary(weather)
  return (
    <VStack
      alignment="leading"
      spacing={6}
      padding={15}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}
      widgetBackground={gradientFor(realtime.skycon)}
      {...glassPanelProps(20)}
    >
      <HStack spacing={5} frame={{ maxWidth: "infinity" }}>
        <Text font={12} fontWeight="semibold" foregroundStyle="rgba(255,255,255,0.74)" lineLimit={1}>
          {placeDisplayName(place)}
        </Text>
        <Spacer />
        <AqiBadge weather={weather} />
      </HStack>
      <HStack alignment="center" spacing={6} frame={{ maxWidth: "infinity" }}>
        <Text
          font={32}
          fontWeight="regular"
          foregroundStyle="white"
          lineLimit={1}
          frame={{ width: 70, alignment: "leading" }}
        >
          {formatTemp(realtime.temperature)}
        </Text>
        <Spacer />
        <VStack alignment="center" spacing={1} frame={{ width: 46 }}>
          <Image systemName={skyconSymbol(realtime.skycon)} font={31} symbolRenderingMode="multicolor" />
          <Text font={9} fontWeight="semibold" foregroundStyle="white" lineLimit={1}>
            {skyconLabel(realtime.skycon)}
          </Text>
        </VStack>
      </HStack>
      <HStack spacing={10}>
        <Text font={10} foregroundStyle="rgba(255,255,255,0.68)">
          体感 {formatTemp(realtime.apparent_temperature)}
        </Text>
        <Text font={10} foregroundStyle="rgba(255,255,255,0.68)">
          湿度 {formatPercent(realtime.humidity)}
        </Text>
      </HStack>
      <Text
        font={10}
        fontWeight="semibold"
        foregroundStyle="white"
        lineLimit={{ max: 2, reservesSpace: true }}
        multilineTextAlignment="leading"
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        {summary}
      </Text>
      <Text
        font={9}
        foregroundStyle="rgba(255,255,255,0.5)"
        frame={{ maxWidth: "infinity", alignment: "center" }}
      >
        更新 {formatUpdateTime()}
      </Text>
    </VStack>
  )
}

function formatUpdateTime(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function weatherSummary(weather: WeatherResult): string {
  return (
    weather.minutely?.description ??
    weather.forecast_keypoint ??
    weather.hourly?.description ??
    skyconLabel(weather.realtime.skycon)
  )
}

function aqiBadgeFill(aqi: number): DynamicShapeStyle {
  if (!Number.isFinite(aqi) || aqi < 0) {
    return { light: "rgba(255,255,255,0.16)", dark: "rgba(255,255,255,0.12)" }
  }
  if (aqi <= 50) return { light: "#237A3B", dark: "#1D6332" }
  if (aqi <= 100) return { light: "#806600", dark: "#685300" }
  if (aqi <= 150) return { light: "#A84D00", dark: "#843D00" }
  if (aqi <= 200) return { light: "#A9251A", dark: "#861D15" }
  if (aqi <= 300) return { light: "#713A8B", dark: "#5B2F70" }
  return { light: "#681C32", dark: "#501627" }
}

function AqiBadge({ weather }: { weather: WeatherResult }) {
  const aqi = weather.realtime.air_quality?.aqi?.chn
  const description = weather.realtime.air_quality?.description?.chn
  if (aqi == null) return null

  return (
    <HStack
      spacing={4}
      padding={{ horizontal: 7, vertical: 3 }}
      background={{ style: aqiBadgeFill(aqi), shape: "capsule" }}
    >
      <Text font={11} fontWeight="semibold" foregroundStyle="white">
        {formatAqi(aqi)}
      </Text>
      {description ? (
        <Text font={10} foregroundStyle="rgba(255,255,255,0.72)">
          {description}
        </Text>
      ) : null}
    </HStack>
  )
}

function CompactDailyRows({ weather }: { weather: WeatherResult }) {
  const temps = weather.daily?.temperature ?? []
  const skycons = weather.daily?.skycon ?? []
  return (
    <VStack
      spacing={0}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      layoutPriority={1}
    >
      {temps.slice(0, 5).map((day, i) => (
        <VStack key={day.date} spacing={0} frame={{ maxWidth: "infinity" }} layoutPriority={1}>
          <HStack alignment="center" spacing={4} frame={{ maxWidth: "infinity" }}>
            <Text font={11} fontWeight="semibold" foregroundStyle="white" frame={{ width: 26, alignment: "leading" }}>
              {formatWeekday(day.date, i)}
            </Text>
            <Image
              systemName={skyconSymbol(skycons[i]?.value)}
              font={17}
              symbolRenderingMode="multicolor"
              frame={{ width: 20 }}
            />
            <Spacer />
            <Text font={11} fontWeight="semibold" foregroundStyle="white" frame={{ width: 28, alignment: "trailing" }}>
              {formatTemp(day.max)}
            </Text>
            <Text font={11} foregroundStyle="rgba(255,255,255,0.62)" frame={{ width: 28, alignment: "trailing" }}>
              {formatTemp(day.min)}
            </Text>
          </HStack>
          {i < 4 ? <Spacer /> : null}
        </VStack>
      ))}
    </VStack>
  )
}

function MediumView({ place, weather }: { place: Place; weather: WeatherResult }) {
  const realtime = weather.realtime
  const summary = weatherSummary(weather)

  return (
    <VStack
      alignment="leading"
      spacing={4}
      padding={{ horizontal: 20, vertical: 24 }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}
      widgetBackground={gradientFor(realtime.skycon)}
      {...glassPanelProps(20)}
    >
      <HStack
        alignment="top"
        spacing={12}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        layoutPriority={1}
      >
        <VStack
          alignment="leading"
          spacing={3}
          frame={{ width: 162, maxHeight: "infinity", alignment: "leading" }}
        >
          <HStack spacing={7} frame={{ maxWidth: "infinity" }}>
            <Text font={12} fontWeight="semibold" foregroundStyle="rgba(255,255,255,0.72)" lineLimit={1}>
              {placeDisplayName(place)}
            </Text>
            <Spacer />
            <AqiBadge weather={weather} />
          </HStack>
          <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
            <Text font={34} fontWeight="regular" foregroundStyle="white" lineLimit={1}>
              {formatTemp(realtime.temperature)}
            </Text>
            <Spacer />
            <VStack alignment="center" spacing={1}>
              <Image
                systemName={skyconSymbol(realtime.skycon)}
                font={30}
                symbolRenderingMode="multicolor"
              />
              <Text font={10} fontWeight="semibold" foregroundStyle="white" lineLimit={1}>
                {skyconLabel(realtime.skycon)}
              </Text>
            </VStack>
          </HStack>
          <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
            <Text font={10} foregroundStyle="rgba(255,255,255,0.66)">
              体感 {formatTemp(realtime.apparent_temperature)}
            </Text>
            <Text font={10} foregroundStyle="rgba(255,255,255,0.66)">
              湿度 {formatPercent(realtime.humidity)}
            </Text>
            <Spacer />
          </HStack>
          <Text
            font={11}
            fontWeight="semibold"
            foregroundStyle="white"
            lineLimit={1}
            padding={{ top: 6 }}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            {summary}
          </Text>
        </VStack>
        <CompactDailyRows weather={weather} />
      </HStack>
      <Text
        font={9}
        foregroundStyle="rgba(255,255,255,0.5)"
        frame={{ maxWidth: "infinity", alignment: "center" }}
      >
        更新 {formatUpdateTime()}
      </Text>
    </VStack>
  )
}

function LargeView({ place, weather }: { place: Place; weather: WeatherResult }) {
  const realtime = weather.realtime
  const summary = weatherSummary(weather)
  return (
    <VStack
      alignment="leading"
      spacing={6}
      padding={18}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}
      widgetBackground={gradientFor(realtime.skycon)}
      {...glassPanelProps(20)}
    >
      <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
        <Text font={15} fontWeight="semibold" foregroundStyle="rgba(255,255,255,0.78)" lineLimit={1}>
          {placeDisplayName(place)}
        </Text>
        <Spacer />
        <AqiBadge weather={weather} />
      </HStack>
      <HStack alignment="center" spacing={14} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font={46} fontWeight="regular" foregroundStyle="white" lineLimit={1}>
          {formatTemp(realtime.temperature)}
        </Text>
        <VStack alignment="leading" spacing={3}>
          <Text font={16} fontWeight="semibold" foregroundStyle="white" lineLimit={1}>
            {skyconLabel(realtime.skycon)}
          </Text>
          <HStack spacing={10}>
            <Text font={11} foregroundStyle="rgba(255,255,255,0.66)">
              体感 {formatTemp(realtime.apparent_temperature)}
            </Text>
            <Text font={11} foregroundStyle="rgba(255,255,255,0.66)">
              湿度 {formatPercent(realtime.humidity)}
            </Text>
          </HStack>
        </VStack>
        <Spacer />
        <Image systemName={skyconSymbol(realtime.skycon)} font={48} symbolRenderingMode="multicolor" />
      </HStack>
      <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
        <Text font={12} fontWeight="semibold" foregroundStyle="white" lineLimit={1}>
          {summary}
        </Text>
        <Spacer />
      </HStack>
      <Capsule fill="rgba(255,255,255,0.25)" frame={{ maxWidth: "infinity", height: 0.5 }} />
      <HourlyRow weather={weather} count={6} />
      <Capsule fill="rgba(255,255,255,0.25)" frame={{ maxWidth: "infinity", height: 0.5 }} />
      <Text font={11} fontWeight="semibold" foregroundStyle="rgba(255,255,255,0.68)">
        未来天气
      </Text>
      <DailyRows weather={weather} count={4} />
      <Text
        font={9}
        foregroundStyle="rgba(255,255,255,0.5)"
        frame={{ maxWidth: "infinity", alignment: "center" }}
      >
        更新 {formatUpdateTime()}
      </Text>
    </VStack>
  )
}

function compactAccessorySummary(description?: string): string | undefined {
  if (!description) return undefined
  const match = description.match(/^您(.+?)正在下(.+?)哦$/)
  return match ? `${match[1]}有${match[2]}` : description
}

function AccessoryRectangularView({ weather }: { weather: WeatherResult }) {
  const realtime = weather.realtime
  const detail = compactAccessorySummary(weatherSummary(weather)) ?? skyconLabel(realtime.skycon)
  return (
    <VStack alignment="leading" spacing={2} padding={{ horizontal: 2, vertical: 1 }}>
      <HStack alignment="center" spacing={7} frame={{ maxWidth: "infinity" }}>
        <Text font={20} fontWeight="semibold" lineLimit={1}>
          {formatTemp(realtime.temperature)}
        </Text>
        <Spacer />
        <Image systemName={skyconSymbol(realtime.skycon)} font={19} />
      </HStack>
      <Text font={10} lineLimit={1}>
        {detail}
      </Text>
    </VStack>
  )
}

function AccessoryInlineView({ weather }: { weather: WeatherResult }) {
  const realtime = weather.realtime
  return (
    <HStack spacing={3}>
      <Image systemName={skyconSymbol(realtime.skycon)} />
      <Text fontWeight="semibold">
        {formatTemp(realtime.temperature)} {skyconLabel(realtime.skycon)}
      </Text>
    </HStack>
  )
}

function AccessoryCircularView({ weather }: { weather: WeatherResult }) {
  const realtime = weather.realtime
  return (
    <VStack spacing={1} padding={2}>
      <Image systemName={skyconSymbol(realtime.skycon)} font={17} />
      <Text font={14} fontWeight="semibold">
        {formatTemp(realtime.temperature, "°")}
      </Text>
    </VStack>
  )
}

// ── 根视图：按 family 分发 + 占位态 ──

function WidgetView({ model, family }: { model: WidgetModel; family: WidgetFamily }) {
  if (model.state === "no-token") {
    return (
      <PlaceholderForFamily
        family={family}
        symbol="key.slash"
        title="未配置 Token"
        compactTitle="未配置"
        hint="打开彩云天气，在设置中填写 API Token"
      />
    )
  }
  if (model.state === "no-place") {
    return (
      <PlaceholderForFamily
        family={family}
        symbol="location.slash"
        title="暂无地点"
        compactTitle="无地点"
        hint="打开彩云天气，定位或选择一个地点"
      />
    )
  }
  if (model.state === "no-data") {
    return (
      <PlaceholderForFamily
        family={family}
        symbol="cloud.slash"
        title="暂无天气数据"
        compactTitle="无数据"
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
      return <AccessoryRectangularView weather={weather} />
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
