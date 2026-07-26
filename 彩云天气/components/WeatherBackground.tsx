/**
 * 随天气现象动态变化的首页背景
 * - 渐变按 skycon 分类（晴/多云/雨/雪/雾霾/雾），晴与多云再按昼夜区分色相
 * - 叠加天气动画层（weatherEffects）：雨丝、雪花、云朵、雾带、阳光晕、星空、暴雨闪电
 * - 无天气数据时回退为时段渐变（复用 PageBackground 的 pageBackground）
 *
 * 布局约束（与 SearchPage / PageBackground 同构）：
 * - 根节点必须是单层 Rectangle + ignoresSafeArea；不要给背景根再包一层效果 ZStack
 * - 雨/云/星等效果放在 Rectangle.overlay 内的 EffectsStage（固定屏幕尺寸 + clipped）
 * - 效果层勿再写 ignoresSafeArea，云朵与雨滴 x 勿明显超屏
 */

import {
  Rectangle,
  type Color,
  type DynamicShapeStyle,
} from "scripting"
import type { SkyconCode } from "../types"
import { pageBackground } from "./PageBackground"
import {
  CloudLayer,
  EffectsStage,
  LightningFlash,
  MistLayer,
  RainLayer,
  SnowLayer,
  StarField,
  SunHalo,
} from "./weatherEffects"

// ── 天气分类 ──────────────────────────────────────────

type WeatherKind = "clear" | "cloudy" | "rain" | "snow" | "haze" | "fog"

// skycon → 背景类别；未识别现象按多云处理
function weatherKindOf(skycon: SkyconCode): WeatherKind {
  if (skycon.includes("RAIN")) return "rain"
  if (skycon.includes("SNOW")) return "snow"
  if (skycon === "FOG") return "fog"
  if (skycon.includes("HAZE") || skycon === "DUST" || skycon === "SAND") return "haze"
  if (skycon.includes("CLEAR")) return "clear"
  return "cloudy"
}

// skycon 自带昼夜后缀；无后缀时按本地小时判断（6-19 点为昼）
function isNightSkycon(skycon: SkyconCode): boolean {
  if (skycon.endsWith("_NIGHT")) return true
  if (skycon.endsWith("_DAY")) return false
  const hour = new Date().getHours()
  return hour < 6 || hour >= 19
}

// 雨/雪强度等级 1-4（小/中/大/暴）
function precipLevel(skycon: SkyconCode): 1 | 2 | 3 | 4 {
  if (skycon.includes("LIGHT")) return 1
  if (skycon.includes("MODERATE")) return 2
  if (skycon.includes("HEAVY")) return 3
  return 4
}

// ── 配色 ──────────────────────────────────────────────

type GradientSpec = { light: Color[]; dark: Color[] }

// 晴/多云按昼夜分色，其余只按明暗模式
const palettes: Record<WeatherKind, { day: GradientSpec; night: GradientSpec }> = {
  clear: {
    day: {
      light: ["#6fb0e8", "#a6cff0", "#ead8b4"],
      dark: ["#0a1830", "#15314f", "#274864"],
    },
    night: {
      light: ["#8796bf", "#a9b4cc", "#d8cfc0"],
      dark: ["#04060d", "#0b1228", "#1a1834"],
    },
  },
  cloudy: {
    day: {
      light: ["#93a9bf", "#b5c3d0", "#dde0db"],
      dark: ["#111824", "#1c283a", "#2a3648"],
    },
    night: {
      light: ["#8693a8", "#a4afbf", "#cdcbc3"],
      dark: ["#0b0f16", "#141b28", "#202937"],
    },
  },
  rain: {
    day: {
      light: ["#6f8aa4", "#97acc0", "#c5ced4"],
      dark: ["#09121b", "#122131", "#1c2f40"],
    },
    night: {
      light: ["#6f8aa4", "#97acc0", "#c5ced4"],
      dark: ["#09121b", "#122131", "#1c2f40"],
    },
  },
  snow: {
    day: {
      light: ["#a9c0d3", "#c9dae6", "#eef2f5"],
      dark: ["#121925", "#1d2838", "#2b3748"],
    },
    night: {
      light: ["#a9c0d3", "#c9dae6", "#eef2f5"],
      dark: ["#121925", "#1d2838", "#2b3748"],
    },
  },
  haze: {
    day: {
      light: ["#b0aa97", "#c4beab", "#ddd7c3"],
      dark: ["#19160f", "#262117", "#342e22"],
    },
    night: {
      light: ["#b0aa97", "#c4beab", "#ddd7c3"],
      dark: ["#19160f", "#262117", "#342e22"],
    },
  },
  fog: {
    day: {
      light: ["#9eaab4", "#bcc4ca", "#d9dfe1"],
      dark: ["#13171c", "#1d2328", "#293035"],
    },
    night: {
      light: ["#9eaab4", "#bcc4ca", "#d9dfe1"],
      dark: ["#13171c", "#1d2328", "#293035"],
    },
  },
}

function backgroundStyle(palette: GradientSpec): DynamicShapeStyle {
  return {
    light: { colors: palette.light, startPoint: "top", endPoint: "bottom" },
    dark: { colors: palette.dark, startPoint: "top", endPoint: "bottom" },
  }
}

// ── 效果装配 ──────────────────────────────────────────

function WeatherEffects({
  kind,
  night,
  level,
  stormRain,
  denseCloud,
  windy,
}: {
  kind: WeatherKind
  night: boolean
  level: 1 | 2 | 3 | 4
  stormRain: boolean
  denseCloud: boolean
  windy: boolean
}) {
  return (
    <EffectsStage>
      {kind === "cloudy" ? <CloudLayer dense={denseCloud} windy={windy} /> : null}
      {kind === "rain" || kind === "snow" ? <CloudLayer dense alpha={0.3} /> : null}
      {kind === "rain" ? <RainLayer level={level} /> : null}
      {kind === "snow" ? <SnowLayer level={level} /> : null}
      {kind === "haze" || kind === "fog" ? <MistLayer kind={kind} /> : null}
      {kind === "clear" ? (night ? <StarField /> : <SunHalo />) : null}
      {stormRain ? (
        <>
          <LightningFlash period={6.5} delay={1.2} />
          <LightningFlash period={11.5} delay={5.5} />
        </>
      ) : null}
    </EffectsStage>
  )
}

// ── 主组件 ────────────────────────────────────────────

export function WeatherBackground({ skycon }: { skycon?: SkyconCode | null }) {
  // 未加载：与 PageBackground / SearchPage 完全相同
  if (!skycon) {
    return (
      <Rectangle fill={pageBackground} ignoresSafeArea={true} allowsHitTesting={false} />
    )
  }

  const kind = weatherKindOf(skycon)
  const night = isNightSkycon(skycon)
  const palette = night ? palettes[kind].night : palettes[kind].day
  const level = precipLevel(skycon)
  const stormRain = kind === "rain" && skycon.includes("STORM")
  const windy = skycon === "WIND"
  const denseCloud =
    skycon === "OVERCAST" ||
    skycon === "CLOUDY" ||
    skycon === "WIND" ||
    kind === "rain" ||
    kind === "snow"

  // 关键：根节点必须是单层 Rectangle + ignoresSafeArea（与未加载态同构）
  // 效果放 overlay 的 EffectsStage——固定屏尺寸 + clipped，粒子按整屏坐标分布
  return (
    <Rectangle
      fill={backgroundStyle(palette)}
      ignoresSafeArea={true}
      allowsHitTesting={false}
      overlay={{
        alignment: "center",
        content: (
          <WeatherEffects
            key={`${kind}-${night}-${level}-${denseCloud}-${stormRain}-${windy}`}
            kind={kind}
            night={night}
            level={level}
            stormRain={stormRain}
            denseCloud={denseCloud}
            windy={windy}
          />
        ),
      }}
    />
  )
}
