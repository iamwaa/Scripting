import type { Place } from "../types"

// 当前位置始终用原始地名；其余优先自定义显示名
export function placeDisplayName(place: Place): string {
  if (place.isCurrent) return place.name
  const custom = place.displayName?.trim()
  return custom || place.name
}

// 地址副标题：优先 subtitle，否则坐标
export function placeAddress(place: Place): string {
  const subtitle = place.subtitle?.trim()
  if (subtitle) return subtitle
  return `${place.longitude.toFixed(4)}, ${place.latitude.toFixed(4)}`
}

// 写入显示名；空字符串视为清除自定义名
export function withDisplayName(place: Place, displayName?: string | null): Place {
  const trimmed = displayName?.trim()
  if (!trimmed) {
    const { displayName: _drop, ...rest } = place
    return rest
  }
  return { ...place, displayName: trimmed }
}
