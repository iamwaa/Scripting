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

// 获取当前位置：以 GPS 坐标为基准，地名只取系统逆地理的真实地址，
// 不再搜附近 POI 做名称覆盖，避免显示成隔壁的地标名。
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

  // 直接采用逆地理的真实地名与行政区划副标题
  current.name = pickName(placemark)
  const geoSubtitle = pickSubtitle(placemark)
  if (geoSubtitle) current.subtitle = geoSubtitle

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
