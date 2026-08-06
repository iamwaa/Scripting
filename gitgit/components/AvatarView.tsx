/**
 * components/AvatarView.tsx - GitHub 用户圆形头像
 *
 * 有头像 URL 时加载网络图片并裁剪为圆形；
 * 无 URL 或图片加载中回退为灰色人像图标。
 */

import { Image } from "scripting"
import { COLOR_GRAY } from "../constants/colors"

export function AvatarView({
  url,
  size = 20,
}: {
  url?: string | null
  size?: number
}) {
  const fallback = (
    <Image
      systemName="person.crop.circle.fill"
      font={size}
      foregroundStyle={COLOR_GRAY}
    />
  )
  if (!url) return fallback
  return (
    <Image
      imageUrl={url}
      resizable={true}
      aspectRatio={{ value: null, contentMode: "fill" }}
      frame={{ width: size, height: size }}
      clipShape="circle"
      placeholder={fallback}
    />
  )
}
