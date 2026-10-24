import { Image } from "scripting"
import type { Shape } from "scripting"

interface HupuAvatarProps {
  url: string
  size?: number
  fallbackSystemName?: string
  // 英雄图等方形素材用 "rounded"；人物头像默认圆形
  shape?: "circle" | "rounded"
}

const ROUNDED_RADIUS = 4

// 头像/队标/英雄图;加载中或缺失时回退到占位图标
export function HupuAvatar({ url, size = 40, fallbackSystemName = "person.fill", shape = "circle" }: HupuAvatarProps) {
  const clipShape: Shape = shape === "rounded" ? { type: "rect", cornerRadius: ROUNDED_RADIUS } : "circle"

  return (
    <Image
      imageUrl={url}
      resizable
      scaleToFit
      frame={{ width: size, height: size }}
      clipShape={clipShape}
      placeholder={
        <Image
          systemName={fallbackSystemName}
          resizable
          scaleToFit
          frame={{ width: size * 0.6, height: size * 0.6 }}
          foregroundStyle="tertiaryLabel"
        />
      }
    />
  )
}
