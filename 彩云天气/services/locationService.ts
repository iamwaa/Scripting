import { formatCoords, formatLocationSubtitle, placeId } from "../utils/format"
import type { Place } from "../types"

function pickName(p: LocationPlacemark): string {
  return (
    p.name ||
    p.locality ||
    p.subLocality ||
    p.administrativeArea ||
    p.thoroughfare ||
    "未知地点"
  )
}

function pickSubtitle(p: LocationPlacemark): string | undefined {
  const parts = [p.administrativeArea, p.locality, p.subLocality, p.thoroughfare].filter(
    (item, index, arr): item is string => Boolean(item) && arr.indexOf(item) === index
  )
  const name = pickName(p)
  const filtered = parts.filter(part => part !== name)
  return filtered.length > 0 ? filtered.join(" · ") : p.country
}

// 球面距离（公里），用于搜索结果近到远排序
function distanceKm(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// 定位坐标为核心，POI 名称仅作展示；距离过远的 POI 地名不适合代表当前位置
const POI_MAX_DISTANCE_KM = 0.5

async function tryGetOrigin(): Promise<{ longitude: number; latitude: number } | null> {
  try {
    await Location.setAccuracy("hundredMeters")
    const location = await Location.requestCurrent({ forceRequest: false })
    if (
      location &&
      typeof location.longitude === "number" &&
      typeof location.latitude === "number"
    ) {
      return { longitude: location.longitude, latitude: location.latitude }
    }
  } catch {
    // 无定位时跳过距离排序
  }
  return null
}

// 获取当前位置：先以 GPS 坐标为基准，再逆地理得到地名，
// 最后用 MapKit 搜索附近 POI，仅借用最近的 POI 名称；核心坐标始终不变。
// 返回的是地点名称元数据（不含坐标替换），让外层统一拼入真实定位坐标。
async function reverseSearchNearbyPoi(
  longitude: number,
  latitude: number,
  placemark: LocationPlacemark
): Promise<{ name: string; subtitle?: string } | null> {
  // 从逆地理结果提取关键词；name 通常已是最近的道路/门牌或地标，优先使用
  const keyword =
    placemark.name ||
    placemark.subLocality ||
    placemark.locality ||
    placemark.administrativeArea ||
    ""
  if (!keyword) return null

  try {
    const results = await MapSearch.locate({
      query: keyword,
      region: {
        center: { latitude, longitude },
        span: { latitudeDelta: 0.05, longitudeDelta: 0.05 },
      },
      resultTypes: ["pointOfInterest"],
    })
    if (results.length === 0) return null

    // 取距离最近的 POI，并加阈值过滤
    let best: (typeof results)[0] | null = null
    let bestDist = Infinity
    for (const item of results) {
      const d = distanceKm(
        longitude,
        latitude,
        item.coordinate.longitude,
        item.coordinate.latitude
      )
      if (d < bestDist) {
        best = item
        bestDist = d
      }
    }
    if (!best || bestDist > POI_MAX_DISTANCE_KM) return null

    const poiName = best.name?.trim() || keyword
    return {
      name: poiName,
      subtitle: formatLocationSubtitle(best.formattedAddress, poiName),
    }
  } catch {
    return null
  }
}

export async function getCurrentPlace(forceRequest = false): Promise<Place> {
  await Location.setAccuracy("hundredMeters")
  const location = await Location.requestCurrent({ forceRequest })
  if (!location) {
    throw new Error("无法获取当前位置，请检查定位权限")
  }

  // 真实定位坐标是一切天气请求的基础，绝不能被 POI 坐标覆盖
  const current: Place = {
    id: placeId(location.longitude, location.latitude),
    name: "当前位置",
    subtitle: formatCoords(location.longitude, location.latitude),
    longitude: location.longitude,
    latitude: location.latitude,
    isCurrent: true,
  }

  // 逆地理编码
  let placemark: LocationPlacemark | undefined
  try {
    const marks = await Location.reverseGeocode({
      latitude: location.latitude,
      longitude: location.longitude,
      locale: "zh-CN",
    })
    placemark = marks?.[0]
  } catch {
    // 逆地理失败直接返回坐标占位名
    return current
  }

  if (!placemark) return current

  // 先用逆地理结果填充地名
  current.name = pickName(placemark)
  const geoSubtitle = pickSubtitle(placemark)
  if (geoSubtitle) current.subtitle = geoSubtitle

  // 再尝试用 MapKit 找更近、更具体的 POI 名称；只改展示名，不改坐标
  const poiMeta = await reverseSearchNearbyPoi(
    location.longitude,
    location.latitude,
    placemark
  )
  if (poiMeta) {
    current.name = poiMeta.name
    if (poiMeta.subtitle) current.subtitle = poiMeta.subtitle
  }

  return current
}

// 搜索地点（MapKit 关键词搜索），有定位时以附近为主并按距离排序
export async function searchPlaces(query: string): Promise<Place[]> {
  const keyword = query.trim()
  if (!keyword) return []

  const origin = await tryGetOrigin()
  const results = await MapSearch.locate({
    query: keyword,
    region: origin
      ? {
          center: { latitude: origin.latitude, longitude: origin.longitude },
          span: { latitudeDelta: 5, longitudeDelta: 5 },
        }
      : undefined,
    resultTypes: ["pointOfInterest", "address"],
  })
  if (results.length === 0) return []

  const places: Place[] = []
  const seen = new Set<string>()
  for (const item of results) {
    const { latitude, longitude } = item.coordinate
    const id = placeId(longitude, latitude)
    if (seen.has(id)) continue
    seen.add(id)
    places.push({
      id,
      name: item.name?.trim() || "未知地点",
      subtitle: formatLocationSubtitle(item.formattedAddress, item.name),
      longitude,
      latitude,
      isCurrent: false,
    })
  }

  if (origin) {
    places.sort(
      (a, b) =>
        distanceKm(origin.longitude, origin.latitude, a.longitude, a.latitude) -
        distanceKm(origin.longitude, origin.latitude, b.longitude, b.latitude)
    )
  }

  return places
}
