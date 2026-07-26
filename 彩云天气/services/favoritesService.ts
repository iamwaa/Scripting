import { STORAGE_KEYS } from "../constants"
import type { Place } from "../types"
import { withDisplayName } from "../utils/place"

function normalize(place: Place): Place {
  const next: Place = {
    id: place.id,
    name: place.name,
    subtitle: place.subtitle,
    longitude: place.longitude,
    latitude: place.latitude,
    // 收藏条目本身不再带 isCurrent 标记
    isCurrent: false,
  }
  const displayName = place.displayName?.trim()
  if (displayName) next.displayName = displayName
  return next
}

export function loadFavorites(): Place[] {
  const raw = Storage.get<Place[]>(STORAGE_KEYS.favorites)
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      item =>
        item &&
        typeof item.longitude === "number" &&
        typeof item.latitude === "number" &&
        typeof item.name === "string"
    )
    .map(normalize)
}

export function saveFavorites(list: Place[]): void {
  Storage.set(
    STORAGE_KEYS.favorites,
    list.map(normalize)
  )
}

export function isFavorite(list: Place[], place: Place): boolean {
  return list.some(item => item.id === place.id)
}

// 从收藏列表取已保存的显示名等元数据
export function findFavorite(list: Place[], place: Place): Place | undefined {
  return list.find(item => item.id === place.id)
}

// 合并收藏中的自定义显示名；当前位置不使用显示名
export function mergeFavoriteMeta(list: Place[], place: Place): Place {
  if (place.isCurrent) {
    const { displayName: _drop, ...rest } = place
    return rest
  }
  const saved = findFavorite(list, place)
  if (!saved?.displayName) return place
  return withDisplayName(place, saved.displayName)
}

// 当前位置也可收藏（按坐标 id 去重）
export function addFavorite(list: Place[], place: Place): Place[] {
  if (isFavorite(list, place)) return list
  const next = [normalize(place), ...list]
  saveFavorites(next)
  return next
}

export function removeFavorite(list: Place[], place: Place): Place[] {
  const next = list.filter(item => item.id !== place.id)
  saveFavorites(next)
  return next
}

export function toggleFavorite(list: Place[], place: Place): Place[] {
  return isFavorite(list, place) ? removeFavorite(list, place) : addFavorite(list, place)
}

// 更新收藏地点的显示名；不在收藏中时返回原列表
export function updateFavoriteDisplayName(
  list: Place[],
  place: Place,
  displayName?: string | null
): Place[] {
  let changed = false
  const next = list.map(item => {
    if (item.id !== place.id) return item
    changed = true
    return normalize(withDisplayName(item, displayName))
  })
  if (!changed) return list
  saveFavorites(next)
  return next
}

export function loadLastPlace(): Place | null {
  const raw = Storage.get<Place>(STORAGE_KEYS.lastPlace)
  if (!raw || typeof raw.longitude !== "number" || typeof raw.latitude !== "number") {
    return null
  }
  return raw
}

export function saveLastPlace(place: Place): void {
  Storage.set(STORAGE_KEYS.lastPlace, place)
}
