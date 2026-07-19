/**
 * 按时段变化的液态玻璃页面背景
 * 用法：作为 List / ZStack 底层，配合 scrollContentBackground="hidden"
 * 注意：pageBackground 在模块导入时按当前小时固化（含随机方向/锚点），非整点自动刷新
 */

import {
  Rectangle,
  type Color,
  type DynamicShapeStyle,
  type KeywordPoint,
} from "scripting"

type HourGradient = {
  light: Color[][]
  dark: Color[][]
}

const gradientPairs: [KeywordPoint, KeywordPoint][] = [
  ["topLeading", "bottomTrailing"],
  ["bottomTrailing", "topLeading"],
  ["topTrailing", "bottomLeading"],
  ["bottomLeading", "topTrailing"],
]

// 精简版 6 组时段色（每 4 小时一档；可按业务扩展为 24 小时）
const hourlyGradients: HourGradient[] = [
  {
    // 深夜 0-3
    light: [["#e8edf0", "#dde7e2", "#efe2d2"], ["#e6ecef", "#dbe4dd", "#f0e5d8"]],
    dark: [["#070914", "#11162a", "#20162d"], ["#080b16", "#151b30", "#24172b"]],
  },
  {
    // 清晨 4-7
    light: [["#e6eef1", "#d9e7e2", "#f0e2cf"], ["#ecdfc9", "#dce9e6", "#e6e2d4"]],
    dark: [["#0b101c", "#17243c", "#2c1f32"], ["#111321", "#21324a", "#382b3c"]],
  },
  {
    // 上午 8-11
    light: [["#eaf2f3", "#d8e9e5", "#f2dfc8"], ["#e9efef", "#dce6e5", "#eee4d8"]],
    dark: [["#151b2c", "#263b52", "#423044"], ["#10131f", "#18213a", "#2a1d2d"]],
  },
  {
    // 午后 12-15
    light: [["#ecefeb", "#dce6e3", "#eee6d8"], ["#e8eeed", "#dbe6e2", "#f0e5d6"]],
    dark: [["#101722", "#192c3a", "#302832"], ["#111724", "#1a2b40", "#2e2634"]],
  },
  {
    // 傍晚 16-19
    light: [["#efe3d3", "#dce2e8", "#e8ddd4"], ["#ecdcca", "#e0d9d2", "#d7e0e8"]],
    dark: [["#171624", "#292843", "#3b2735"], ["#171321", "#33213a", "#4a2b30"]],
  },
  {
    // 夜晚 20-23
    light: [["#e7d8d2", "#d9dde2", "#d7e5e8"], ["#e7edf0", "#dce3e0", "#ece2d8"]],
    dark: [["#14111c", "#271f3d", "#23324a"], ["#090b14", "#111a2f", "#1d1730"]],
  },
]

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)]

const warmLightAnchors: Color[] = ["#e7d8c8", "#ded7ca", "#d8dfd6", "#d6e1df"]

const tuneLightColor = (color: Color): Color => {
  const hex = String(color).replace("#", "")
  if (hex.length !== 6) return color
  const channels = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
  const adjusted = channels.map(channel => {
    const softenedWhite = Math.min(channel, 246)
    const fromWhite = 255 - softenedWhite
    const value = 255 - fromWhite * 1.72 - 8
    return Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0")
  })
  return `#${adjusted.join("")}` as Color
}

const createBackground = (date = new Date()): DynamicShapeStyle => {
  const hourBucket = Math.floor(date.getHours() / 4) % hourlyGradients.length
  const variants = hourlyGradients[hourBucket]
  const lightColors = [...variants.light[0].map(tuneLightColor), pick(warmLightAnchors)]
  const darkColors = pick(variants.dark)
  const [startPoint, endPoint] = pick(gradientPairs)

  return {
    light: { colors: lightColors, startPoint, endPoint },
    dark: { colors: darkColors, startPoint, endPoint },
  }
}

export const pageBackground = createBackground()

export function PageBackground() {
  return (
    <Rectangle
      fill={pageBackground}
      ignoresSafeArea={true}
      allowsHitTesting={false}
    />
  )
}
