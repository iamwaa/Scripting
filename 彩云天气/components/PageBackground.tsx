/**
 * 按时段变化的液态玻璃页面背景
 * 用法：作为 List / ZStack 底层，配合 scrollContentBackground="hidden"
 * 可选：通过 config 传入固定的浅色/深色渐变；未传时使用时段背景
 * 注意：默认 pageBackground 在模块导入时按当前小时固化（含随机方向/锚点），非整点自动刷新
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

export type PageBackgroundConfig = {
  lightColors: Color[]
  darkColors: Color[]
  startPoint: KeywordPoint
  endPoint: KeywordPoint
}

const gradientPairs: [KeywordPoint, KeywordPoint][] = [
  ["topLeading", "bottomTrailing"],
  ["bottomTrailing", "topLeading"],
  ["topTrailing", "bottomLeading"],
  ["bottomLeading", "topTrailing"],
]

// 精简版 6 组时段色（每 4 小时一档）；统一为天蓝色调，浅色晴空蓝、深色深蓝夜空
const hourlyGradients: HourGradient[] = [
  {
    // 深夜 0-3
    light: [["#a7c2df", "#bdd5ec", "#d6e7f5"], ["#a2bedd", "#b8d1ea", "#d2e4f3"]],
    dark: [["#050b18", "#0c1a30", "#132743"], ["#060d1a", "#0e1d34", "#152a47"]],
  },
  {
    // 清晨 4-7
    light: [["#9dc0e6", "#bad4ef", "#dbecf8"], ["#98bce4", "#b5d0ed", "#d6e8f6"]],
    dark: [["#081222", "#12263f", "#1d3a58"], ["#0a1424", "#142842", "#203d5b"]],
  },
  {
    // 上午 8-11
    light: [["#8fbde9", "#addbf3", "#d3ecf8"], ["#8ab9e7", "#a8d4f0", "#cfe9f7"]],
    dark: [["#0d1c30", "#1a3350", "#284a68"], ["#0e1d32", "#1c3654", "#2b4d6b"]],
  },
  {
    // 午后 12-15
    light: [["#84b8ea", "#a6d0f0", "#cfe8f7"], ["#80b4e8", "#a2cdee", "#cce6f6"]],
    dark: [["#0a1a2e", "#16304c", "#234563"], ["#0b1b30", "#18334f", "#264866"]],
  },
  {
    // 傍晚 16-19
    light: [["#8ab6e0", "#b0cdec", "#d6e6f4"], ["#86b2dd", "#acc9ea", "#d2e3f2"]],
    dark: [["#0c1826", "#182f48", "#254660"], ["#0d192a", "#1a324c", "#284a64"]],
  },
  {
    // 夜晚 20-23
    light: [["#9cbcdd", "#bcd0e6", "#d8e6f2"], ["#97b8da", "#b7cce3", "#d4e3f0"]],
    dark: [["#070f1c", "#0f2038", "#193050"], ["#080f1e", "#10223a", "#1b3352"]],
  },
]

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)]

const createBackground = (date = new Date()): DynamicShapeStyle => {
  const hourBucket = Math.floor(date.getHours() / 4) % hourlyGradients.length
  const variants = hourlyGradients[hourBucket]
  const lightColors = pick(variants.light)
  const darkColors = pick(variants.dark)
  const [startPoint, endPoint] = pick(gradientPairs)

  return {
    light: { colors: lightColors, startPoint, endPoint },
    dark: { colors: darkColors, startPoint, endPoint },
  }
}

export const pageBackground = createBackground()

const backgroundFromConfig = (
  config: PageBackgroundConfig
): DynamicShapeStyle => ({
  light: {
    colors: config.lightColors,
    startPoint: config.startPoint,
    endPoint: config.endPoint,
  },
  dark: {
    colors: config.darkColors,
    startPoint: config.startPoint,
    endPoint: config.endPoint,
  },
})

export function PageBackground(
  { config }: { config?: PageBackgroundConfig } = {}
) {
  return (
    <Rectangle
      fill={config ? backgroundFromConfig(config) : pageBackground}
      ignoresSafeArea={true}
      allowsHitTesting={false}
    />
  )
}
