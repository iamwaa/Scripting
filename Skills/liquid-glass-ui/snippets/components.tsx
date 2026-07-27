/**
 * 液态玻璃常用组件片段
 * 可按需拷贝到项目 components/；依赖 snippets/tokens.tsx
 *
 * 版本：iOS 26+ 使用 glassEffect；更低系统自动回退 Material 背景。
 */

import {
  Button,
  Circle,
  HStack,
  Image,
  ProgressView,
  RoundedRectangle,
  SecureField,
  Text,
  TextField,
  VStack,
  useEffect,
  useState,
  type Color,
  type ContentTransition,
  type Font,
  type FontWeight,
  type TextProps,
  type VirtualNode,
} from "scripting"
import {
  badgeTokens,
  glassChipProps,
  glassControlProps,
  glassToastProps,
  primaryButtonSurface,
  radius,
  shadow,
  stroke,
  surfaceFill,
  fallbackMaterial,
  textColor,
  type GlassBadgeStyle,
} from "./tokens"

// ── AnimText：内容切换时带 contentTransition ─────────────────
export function AnimText({
  children,
  anim = "numericText",
  dur = 0.3,
  ...textProps
}: TextProps & {
  children: Extract<TextProps, { children: any }>["children"]
  anim?: ContentTransition
  dur?: number
}) {
  const [show, setShow] = useState(false)
  const context = (children as unknown as string[]).join("").trim()
  useEffect(() => {
    setShow(true)
  }, [])

  return (
    <Text
      {...textProps}
      contentTransition={anim}
      animation={{
        animation: Animation.smooth({ duration: dur }),
        value: show ? context : "",
      }}
    >
      {show ? context : ""}
    </Text>
  )
}

// ── GlassBadge：语义色胶囊徽章（不依赖 Liquid Glass） ────────
export function GlassBadge({
  style = "neutral",
  children,
  showDot = false,
}: {
  style?: GlassBadgeStyle
  children: VirtualNode | VirtualNode[]
  showDot?: boolean
}) {
  const tokens = badgeTokens[style]
  return (
    <HStack
      spacing={6}
      padding={{ horizontal: 10, vertical: 5 }}
      background={{ style: tokens.background, shape: "capsule" }}
      border={{ style: tokens.border, width: 0.5 }}
      clipShape="capsule"
    >
      {showDot && <Circle fill={tokens.tint} frame={{ width: 6, height: 6 }} />}
      {children}
    </HStack>
  )
}

export function AnimTextGlassBadge({
  style = "neutral",
  children,
  showDot = false,
  anim,
  dur,
  font,
  fontWeight,
}: {
  style?: GlassBadgeStyle
  children: Extract<TextProps, { children: any }>["children"]
  showDot?: boolean
  anim?: ContentTransition
  dur?: number
  font?: number | Font | { name: string; size: number }
  fontWeight?: FontWeight
}) {
  const tokens = badgeTokens[style]
  return (
    <GlassBadge style={style} showDot={showDot}>
      <AnimText
        font={font}
        fontWeight={fontWeight}
        anim={anim}
        dur={dur}
        foregroundStyle={tokens.tint}
      >
        {children}
      </AnimText>
    </GlassBadge>
  )
}

// ── GlassTag：行内小标签（自动版本回退） ─────────────────────
export function GlassTag({
  children,
  foregroundStyle = "secondaryLabel",
}: {
  children: string
  foregroundStyle?: Color
}) {
  return (
    <Text
      font={13}
      fontWeight="regular"
      foregroundStyle={foregroundStyle}
      padding={{ horizontal: 8, vertical: 4 }}
      {...glassChipProps}
      truncationMode="tail"
      lineLimit={1}
    >
      {children}
    </Text>
  )
}

// ── GlassInput：玻璃输入框 ───────────────────────────────────
export function GlassInput({
  label,
  prompt,
  value,
  onChanged,
  secure = false,
}: {
  label: string
  prompt: string
  value: string
  onChanged: (value: string) => void
  secure?: boolean
}) {
  return (
    <VStack alignment="leading" spacing={7}>
      <AnimText font={16} foregroundStyle={textColor.secondary}>
        {label}
      </AnimText>
      <HStack spacing={8} {...glassControlProps}>
        {secure ? (
          <SecureField label={<Text>{""}</Text>} prompt={prompt} value={value} onChanged={onChanged} />
        ) : (
          <TextField
            label={<Text>{""}</Text>}
            prompt={prompt}
            value={value}
            onChanged={onChanged}
            textFieldStyle="plain"
          />
        )}
      </HStack>
    </VStack>
  )
}

// ── PrimaryGlassButton：主操作按钮 ───────────────────────────
export function PrimaryGlassButton({
  title,
  action,
}: {
  title: string
  action: () => void
}) {
  return (
    <Button buttonStyle="plain" action={action}>
      <HStack {...primaryButtonSurface}>
        <AnimText
          font={17}
          fontWeight="semibold"
          foregroundStyle={textColor.onPrimary}
          frame={{ maxWidth: "infinity" }}
        >
          {title}
        </AnimText>
      </HStack>
    </Button>
  )
}

// ── GlassToast：玻璃 Toast 内容 ──────────────────────────────
export type ToastType = "loading" | "success" | "error" | "info"

const toastIcon: Record<Exclude<ToastType, "loading">, { name: string; color: Color }> = {
  success: { name: "checkmark.circle.fill", color: "systemGreen" },
  error: { name: "xmark.circle.fill", color: "systemRed" },
  info: { name: "info.circle.fill", color: "systemBlue" },
}

export function GlassToast({ type, message }: { type: ToastType; message: string }) {
  return (
    <VStack {...glassToastProps}>
      {type === "loading" ? (
        <ProgressView progressViewStyle="circular" controlSize="large" />
      ) : (
        <Image
          systemName={toastIcon[type].name}
          font={48}
          foregroundStyle={toastIcon[type].color}
        />
      )}
      <AnimText font={17} foregroundStyle={textColor.primary} multilineTextAlignment="center">
        {message}
      </AnimText>
    </VStack>
  )
}

// ── GlassCard：通用玻璃卡片容器（自动版本回退） ──────────────
export function GlassCard({
  children,
  padding = 16,
  spacing = 8,
}: {
  children: VirtualNode | VirtualNode[]
  padding?: number
  spacing?: number
}) {
  const surface = surfaceFill({
    material: fallbackMaterial.card,
    shape: {
      type: "rect",
      cornerRadius: radius.card,
      style: "continuous",
    },
  })

  return (
    <VStack
      spacing={spacing}
      padding={padding}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      {...surface}
      overlay={
        <RoundedRectangle
          cornerRadius={radius.card}
          stroke={{
            shapeStyle: stroke.outline,
            strokeStyle: { lineWidth: stroke.width.hairline },
          }}
        />
      }
      shadow={shadow.card}
    >
      {children}
    </VStack>
  )
}
