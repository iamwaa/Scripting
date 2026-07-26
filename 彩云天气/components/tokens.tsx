/**
 * 液态玻璃 UI 设计 tokens
 * 通用可复用样式常量，可直接拷贝到项目 constants/ 或 components/styles。
 *
 * 注意：
 * - Liquid Glass（UIGlass / glassEffect）仅 iOS 26+；低版本回退为 Material 毛玻璃
 * - 必须适配 Light/Dark，优先语义色与 light/dark 成对色值
 * - Device / UIGlass / Animation 等为 Scripting 全局 API，无需 import
 */

import { RoundedRectangle, type Color, type DynamicShapeStyle, type Material } from "scripting"

// ── 圆角 ──────────────────────────────────────────────
export const radius = {
  /** 列表玻璃行 / 配置分区 */
  card: 20,
  /** 输入框、主按钮、胶囊卡片 */
  control: 18,
  /** Toast */
  toast: 22,
  /** 大图标（约 80pt） */
  appIconLarge: 17,
  /** 中图标（约 60pt） */
  appIconMedium: 16,
  /** 小圆角占位块 */
  placeholder: 4,
} as const

// ── 间距 ──────────────────────────────────────────────
export const spacing = {
  /** 页面级垂直节奏 */
  page: 24,
  /** 页面水平边距 */
  pageX: 24,
  /** 行内主间距 */
  row: 16,
  /** 标签/徽章簇 */
  chip: 6,
  /** 标签内文案间距 */
  tight: 4,
  /** 列表负行距（玻璃卡片重叠视觉） */
  listRow: -15,
} as const

// ── 字号 / 字重 ───────────────────────────────────────
export const typography = {
  /** 页面主标题 title2 bold */
  pageTitle: { font: "title2" as const, fontWeight: "bold" as const },
  /** 空态标题 title semibold */
  sectionTitle: { font: "title" as const, fontWeight: "semibold" as const },
  /** 行标题 body semibold */
  appName: { font: "body" as const, fontWeight: "semibold" as const },
  body: { font: "body" as const, fontWeight: "regular" as const },
  callout: { font: "callout" as const },
  /** 元信息 / 标签（footnote，非系统 caption） */
  caption: { font: "footnote" as const, fontWeight: "regular" as const },
  /** 徽章文案 12 medium */
  meta: { font: 12 as const, fontWeight: "medium" as const },
  /** 分区头 caption */
  sectionHeader: { font: "caption" as const },
}

// ── 阴影 ──────────────────────────────────────────────
export const shadow = {
  /** 玻璃卡片 / 输入框 / 配置分区 */
  card: {
    color: "rgba(72,88,120,0.16)",
    radius: 12,
    y: 5,
  },
  /** 顶部筛选条等更强浮起感 */
  elevated: {
    color: "rgba(72,88,120,0.3)",
    radius: 12,
    y: 5,
  },
  /** Toast */
  toast: {
    color: "rgba(0,0,0,0.18)",
    radius: 18,
    y: 8,
  },
  /** 主操作按钮（蓝色 tint） */
  primaryButton: {
    color: "rgba(0,90,220,0.22)",
    radius: 14,
    y: 6,
  },
} as const

// ── 边框描边 ──────────────────────────────────────────
export const stroke = {
  /** 亮面高光描边（输入框 / 按钮 / Toast） */
  highlight: {
    light: "rgba(255,255,255,0.56)" as Color,
    dark: "rgba(255,255,255,0.30)" as Color,
  },
  /** 稍弱的 Toast 描边 */
  toast: {
    light: "rgba(255,255,255,0.54)" as Color,
    dark: "rgba(255,255,255,0.26)" as Color,
  },
  /** 深色描边（配置分区 / 图标主色卡片） */
  outline: {
    light: "rgba(0,0,0,0.16)" as Color,
    dark: "rgba(255,255,255,0.42)" as Color,
  },
  width: {
    hairline: 0.35,
    thin: 0.5,
  },
} as const

// ── 主色填充 ──────────────────────────────────────────
export const fill = {
  primaryButton: {
    light: "rgba(0,122,255,0.72)",
    dark: "rgba(10,132,255,0.62)",
  } as const,
  /** 渐变分割线 */
  divider: {
    light: {
      colors: [
        "rgba(30,30,30,0.02)",
        "rgba(30,30,30,0.34)",
        "rgba(30,30,30,0.02)",
      ] as Color[],
      startPoint: "leading",
      endPoint: "trailing",
    },
    dark: {
      colors: [
        "rgba(255,255,255,0.04)",
        "rgba(255,255,255,0.42)",
        "rgba(255,255,255,0.04)",
      ] as Color[],
      startPoint: "leading",
      endPoint: "trailing",
    },
  } satisfies DynamicShapeStyle,
}

// ── 语义徽章色板 ──────────────────────────────────────
export type GlassBadgeStyle =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "neutral"
  | "teal"

export type AdaptiveColor =
  | Color
  | {
      light: Color
      dark: Color
    }

export type GlassBadgeTokens = {
  tint: AdaptiveColor
  background: AdaptiveColor
  border: AdaptiveColor
}

export const badgeTokens: Record<GlassBadgeStyle, GlassBadgeTokens> = {
  info: {
    tint: { light: "#0057B8", dark: "systemBlue" },
    background: {
      light: "rgba(0,122,255,0.18)",
      dark: "rgba(0,122,255,0.16)",
    },
    border: {
      light: "rgba(0,122,255,0.34)",
      dark: "rgba(0,122,255,0.32)",
    },
  },
  success: {
    tint: { light: "#1F7A35", dark: "systemGreen" },
    background: {
      light: "rgba(52,199,89,0.18)",
      dark: "rgba(52,199,89,0.16)",
    },
    border: {
      light: "rgba(52,199,89,0.34)",
      dark: "rgba(52,199,89,0.32)",
    },
  },
  warning: {
    tint: { light: "#9A5A00", dark: "systemOrange" },
    background: {
      light: "rgba(255,149,0,0.20)",
      dark: "rgba(255,149,0,0.16)",
    },
    border: {
      light: "rgba(255,149,0,0.36)",
      dark: "rgba(255,149,0,0.32)",
    },
  },
  error: {
    tint: { light: "#B42318", dark: "systemRed" },
    background: {
      light: "rgba(255,59,48,0.18)",
      dark: "rgba(255,59,48,0.16)",
    },
    border: {
      light: "rgba(255,59,48,0.34)",
      dark: "rgba(255,59,48,0.32)",
    },
  },
  neutral: {
    tint: { light: "#4F4F55", dark: "secondaryLabel" },
    background: {
      light: "rgba(142,142,147,0.17)",
      dark: "rgba(142,142,147,0.14)",
    },
    border: {
      light: "rgba(142,142,147,0.32)",
      dark: "rgba(142,142,147,0.28)",
    },
  },
  teal: {
    tint: { light: "#087989", dark: "systemTeal" },
    background: {
      light: "rgba(48,176,199,0.18)",
      dark: "rgba(48,176,199,0.16)",
    },
    border: {
      light: "rgba(48,176,199,0.34)",
      dark: "rgba(48,176,199,0.32)",
    },
  },
}

// ── 版本能力（Liquid Glass = iOS 26+） ────────────────
/** 是否支持液态玻璃 API（UIGlass / glassEffect / GlassEffectContainer） */
export const supportsLiquidGlass = (() => {
  const major = Number.parseInt(String(Device.systemVersion).split(".")[0] ?? "0", 10)
  return Number.isFinite(major) && major >= 26
})()

/**
 * 仅 iOS 26+ 返回交互式 clear 玻璃；低版本返回 undefined，绝不调用 UIGlass。
 */
export const interactiveGlass = () =>
  supportsLiquidGlass ? UIGlass.clear().interactive(true) : undefined

/** iOS 26 以下的 Material 回退（仍保持透明毛玻璃感） */
export const fallbackMaterial = {
  /** 列表行 / 卡片 / 分区 */
  card: "ultraThinMaterial" as Material,
  /** 输入框、较实体的控件 */
  control: "thinMaterial" as Material,
  /** 小标签 / chip / 筛选条 */
  chip: "ultraThinMaterial" as Material,
  /** Toast 稍偏不透明，提高可读性 */
  toast: "regularMaterial" as Material,
  /** 顶部筛选等加强浮起 */
  elevated: "thinMaterial" as Material,
} as const

export const glassShape = {
  card: {
    type: "rect" as const,
    cornerRadius: radius.card,
    style: "continuous" as const,
  },
  control: {
    type: "rect" as const,
    cornerRadius: radius.control,
    style: "continuous" as const,
  },
  toast: {
    type: "rect" as const,
    cornerRadius: radius.toast,
    style: "continuous" as const,
  },
  /** iOS 26+ 系统按钮边框形状；旧系统请用 capsule / continuous rect */
  buttonBorder: "buttonBorder" as const,
  capsule: "capsule" as const,
  circle: "circle" as const,
}

type SurfaceShape =
  | typeof glassShape.card
  | typeof glassShape.control
  | typeof glassShape.toast
  | "buttonBorder"
  | "capsule"

/** 版本感知表面：iOS 26+ 用 glassEffect，否则 background Material */
export function surfaceFill(options: {
  material: Material
  shape: SurfaceShape
  interactive?: boolean
}) {
  if (supportsLiquidGlass) {
    const glass =
      options.interactive === false
        ? UIGlass.clear()
        : UIGlass.clear().interactive(true)
    return {
      glassEffect: {
        glass,
        shape: options.shape,
      },
    }
  }

  // buttonBorder 为 iOS 26 形状；旧系统回退为 capsule
  const shape = options.shape === "buttonBorder" ? ("capsule" as const) : options.shape

  return {
    background: {
      style: options.material,
      shape,
    },
  }
}

// ── 组合 props 片段 ───────────────────────────────────

/** 列表玻璃行默认样式（自动版本回退） */
export const glassRowProps = {
  padding: true as const,
  frame: {
    maxHeight: "infinity" as const,
    maxWidth: "infinity" as const,
    alignment: "leading" as const,
  },
  ...surfaceFill({
    material: fallbackMaterial.card,
    shape: {
      type: "rect" as const,
      cornerRadius: radius.card,
      style: "continuous" as const,
    },
  }),
  shadow: shadow.card,
  listRowBackground: <></>,
  listRowSeparator: "hidden" as const,
}

// 天气大卡片：不要 maxHeight infinity，避免 List 行被无限撑高、叠到导航栏下
export const weatherCardProps = {
  padding: 16 as const,
  frame: {
    maxWidth: "infinity" as const,
    alignment: "leading" as const,
  },
  ...surfaceFill({
    material: fallbackMaterial.card,
    shape: {
      type: "rect" as const,
      cornerRadius: radius.card,
      style: "continuous" as const,
    },
  }),
  shadow: shadow.card,
  listRowBackground: <></>,
  listRowSeparator: "hidden" as const,
}

// 天气页列表：减弱负行距，避免高大卡片严重叠层
export const weatherListChrome = {
  scrollContentBackground: "hidden" as const,
  scrollIndicator: "hidden" as const,
  listStyle: "plain" as const,
  listRowSpacing: -8,
  listRowSeparator: "hidden" as const,
  listRowBackground: <></>,
}

/** 胶囊/输入框玻璃控件 */
export const glassControlProps = {
  padding: { horizontal: 16, vertical: 12 },
  frame: {
    maxWidth: "infinity" as const,
    minHeight: 56,
    alignment: "leading" as const,
  },
  ...surfaceFill({
    material: fallbackMaterial.control,
    shape: glassShape.control,
  }),
  overlay: (
    <RoundedRectangle
      padding={-0.5}
      cornerRadius={radius.control}
      stroke={{
        shapeStyle: stroke.highlight,
        strokeStyle: { lineWidth: stroke.width.thin },
      }}
    />
  ),
  shadow: shadow.card,
} as const

/** 配置分区玻璃容器 */
export const glassSectionProps = {
  frame: { maxWidth: "infinity" as const, alignment: "leading" as const },
  ...surfaceFill({
    material: fallbackMaterial.card,
    shape: glassShape.card,
  }),
  overlay: (
    <RoundedRectangle
      cornerRadius={radius.card}
      stroke={{
        shapeStyle: stroke.outline,
        strokeStyle: { lineWidth: stroke.width.hairline },
      }}
    />
  ),
  shadow: shadow.card,
} as const

/** Toast 玻璃容器 */
export const glassToastProps = {
  spacing: 8,
  padding: 16,
  frame: { minWidth: 200 },
  alignment: "center" as const,
  ...surfaceFill({
    material: fallbackMaterial.toast,
    shape: glassShape.toast,
  }),
  overlay: (
    <RoundedRectangle
      padding={-0.5}
      cornerRadius={radius.toast}
      stroke={{
        shapeStyle: stroke.toast,
        strokeStyle: { lineWidth: stroke.width.thin },
      }}
    />
  ),
  shadow: shadow.toast,
  clipShape: glassShape.toast,
}

/** 紧凑 chip / 标签 / 筛选条 */
export const glassChipProps = {
  ...surfaceFill({
    material: fallbackMaterial.chip,
    shape: "buttonBorder",
  }),
}

/** 顶部筛选条等加强浮起 chrome */
export const glassElevatedBarProps = {
  spacing: 20,
  padding: { horizontal: 15, vertical: 4 },
  ...surfaceFill({
    material: fallbackMaterial.elevated,
    shape: "buttonBorder",
  }),
  shadow: shadow.elevated,
  listRowBackground: <></>,
  listRowSeparator: "hidden" as const,
}

/** 主操作按钮填充 + 描边（不依赖 Liquid Glass） */
export const primaryButtonSurface = {
  frame: { maxWidth: "infinity" as const, minHeight: 56 },
  padding: { vertical: 15 },
  background: {
    style: fill.primaryButton,
    shape: glassShape.control,
  },
  clipShape: glassShape.control,
  overlay: (
    <RoundedRectangle
      padding={-0.5}
      cornerRadius={radius.control}
      stroke={{
        shapeStyle: stroke.highlight,
        strokeStyle: { lineWidth: stroke.width.thin },
      }}
    />
  ),
  shadow: shadow.primaryButton,
} as const

/** 隐藏系统列表底与分割线的常用组合 */
export const plainListChrome = {
  scrollContentBackground: "hidden" as const,
  listStyle: "plain" as const,
  listRowSpacing: spacing.listRow,
  listRowSeparator: "hidden" as const,
  listRowBackground: <></>,
}

/** 语义文字色 */
export const textColor = {
  primary: "label" as const,
  secondary: "secondaryLabel" as const,
  tertiary: "tertiaryLabel" as const,
  accent: "systemBlue" as const,
  danger: "systemRed" as const,
  warning: "systemOrange" as const,
  success: "systemGreen" as const,
  onPrimary: "white" as const,
}
