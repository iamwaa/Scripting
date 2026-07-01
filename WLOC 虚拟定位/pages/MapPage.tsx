// 地图展示组件：纯地图 + 标记 + 图层切换按钮（右下角）。
// 坐标显示和操作按钮已移至 index.tsx App 层；顶部工具栏已统一到 index.tsx。

import {
  useEffect,
  useObservable,
  Map,
  Marker,
  ZStack,
  type MapSelectionValue,
} from "scripting";
import type { AppSettings, Coordinate, ActiveLocation, MapLayerId } from "../types";
import { DEFAULT_SPAN } from "../constants";
import { loadActiveCache, saveActiveCache } from "../utils/storage";
import { queryDevice } from "../api/deviceApi";

// 从 MapCameraPosition 中提取中心坐标
function getCoordFromPosition(pos: MapCameraPosition): Coordinate | null {
  if (pos.region) return { latitude: pos.region.center.latitude, longitude: pos.region.center.longitude };
  if (pos.camera) return { latitude: pos.camera.centerCoordinate.latitude, longitude: pos.camera.centerCoordinate.longitude };
  if (pos.rect) return { latitude: pos.rect.center.latitude, longitude: pos.rect.center.longitude };
  if (pos.item) return { latitude: pos.item.coordinate.latitude, longitude: pos.item.coordinate.longitude };
  return null;
}

interface MapPageProps {
  settings: AppSettings;
  pendingCoord: Observable<Coordinate | null>;
  coordLat: Observable<number>;
  coordLng: Observable<number>;
  layer: Observable<MapLayerId>;
  onCycleLayer: () => void;
  onCoordChange: (lat: number, lng: number) => void;
  onActiveLocChange: (loc: ActiveLocation | null) => void;
  // POI 搜索结果，以 Marker 渲染在地图上
  poiResults: Observable<{ id: string; name: string; coordinate: Coordinate }[]>;
  // 点击 POI Marker 时的回调
  onPoiSelect?: (poi: { id: string; name: string; coordinate: Coordinate }) => void;
}

export function MapPage({
  settings,
  pendingCoord,
  coordLat,
  coordLng,
  layer,
  onCycleLayer,
  onCoordChange,
  onActiveLocChange,
  poiResults,
  onPoiSelect,
}: MapPageProps) {
  const initialActive = loadActiveCache();

  // 相机位置：有缓存坐标则用缓存，否则 automatic
  const cameraPosition = useObservable<MapCameraPosition>(
    initialActive
      ? MapCameraPosition.region({
          center: { latitude: initialActive.latitude, longitude: initialActive.longitude },
          span: { latitudeDelta: DEFAULT_SPAN.latitudeDelta, longitudeDelta: DEFAULT_SPAN.longitudeDelta },
        })
      : MapCameraPosition.automatic(),
  );

  // POI 选点
  const mapSelection = useObservable<MapSelectionValue | null>(null);

  // 移动地图中心
  function moveCameraTo(lat: number, lng: number) {
    cameraPosition.setValue(
      MapCameraPosition.region({
        center: { latitude: lat, longitude: lng },
        span: { latitudeDelta: DEFAULT_SPAN.latitudeDelta, longitudeDelta: DEFAULT_SPAN.longitudeDelta },
      }),
    );
  }

  // 轮询：检测手势平移带来的坐标变化
  useEffect(() => {
    const cached = initialActive;
    let lastLat = cached?.latitude ?? 0;
    let lastLng = cached?.longitude ?? 0;
    let stopped = false;

    function poll() {
      if (stopped) return;
      const pos = cameraPosition.value;
      const c = getCoordFromPosition(pos);
      if (c) {
        // 仅在坐标变化时上报选点坐标
        if (Math.abs(c.latitude - lastLat) > 0.000001 || Math.abs(c.longitude - lastLng) > 0.000001) {
          lastLat = c.latitude;
          lastLng = c.longitude;
          onCoordChange(c.latitude, c.longitude);
        }
      }
      setTimeout(poll, 300);
    }
    poll();
    return () => { stopped = true; };
  }, []);

  // 外部跳转（搜索/收藏/链接解析）— 使用 subscribe 保证可靠监听
  useEffect(() => {
    const cb = (target: Coordinate | null) => {
      if (target) {
        moveCameraTo(target.latitude, target.longitude);
        onCoordChange(target.latitude, target.longitude);
        pendingCoord.setValue(null);
      }
    };
    pendingCoord.subscribe(cb);
    return () => pendingCoord.unsubscribe(cb);
  }, []);

  // POI 点击选点：点击自定义 Marker 或原生 POI 时更新坐标
  useEffect(() => {
    const cb = (sel: MapSelectionValue | null) => {
      if (!sel) return;
      // 处理搜索结果 Marker 点击
      if (sel.type === "marker" && sel.tag?.startsWith("poi-")) {
        const poiId = sel.tag.replace("poi-", "");
        const poi = poiResults.value.find((p) => p.id === poiId);
        if (poi) {
          onPoiSelect?.(poi);
        }
        return;
      }
      // 处理原生地图 POI / feature 点击（国外区域常用）
      if ((sel as any).coordinate) {
        const coord = (sel as any).coordinate;
        moveCameraTo(coord.latitude, coord.longitude);
        onCoordChange(coord.latitude, coord.longitude);
      }
    };
    mapSelection.subscribe(cb);
    return () => mapSelection.unsubscribe(cb);
  }, [poiResults, onPoiSelect]);

  // 启动时：缓存坐标 → 查询设备 → GPS 定位
  useEffect(() => {
    (async () => {
      // 1. 使用缓存坐标
      const cached = initialActive;
      if (cached) {
        onActiveLocChange(cached);
        moveCameraTo(cached.latitude, cached.longitude);
        onCoordChange(cached.latitude, cached.longitude);
      }

      // 2. 查询设备生效坐标
      try {
        const loc = await queryDevice(settings.saveApi);
        onActiveLocChange(loc);
        saveActiveCache(loc);
        if (loc) {
          moveCameraTo(loc.latitude, loc.longitude);
          onCoordChange(loc.latitude, loc.longitude);
          return;
        }
      } catch {}

      // 3. 无保存坐标时尝试 GPS 定位
      if (!cached) {
        try {
          const gps = await Location.requestCurrent({ forceRequest: true });
          if (gps) {
            moveCameraTo(gps.latitude, gps.longitude);
            onCoordChange(gps.latitude, gps.longitude);
          }
        } catch {}
      }
    })();
  }, []);

  const mapStyle = layerToStyle(layer.value);

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 地图（全屏） */}
      <Map
        cameraPosition={cameraPosition}
        selection={mapSelection}
        featureSelectionAccessory="callout"
        annotationTitles="visible"
        mapStyle={mapStyle}
      >
        {/* 坐标就绪后才显示标记，避免初始 (0,0) 位置闪烁 */}
        {(coordLat.value !== 0 || coordLng.value !== 0) && (
          <Marker
            coordinate={{ latitude: coordLat.value, longitude: coordLng.value }}
            tint="systemRed"
            systemImage="mappin.circle.fill"
          />
        )}
        {/* POI 搜索结果以 Marker 渲染 */}
        {poiResults.value.map((poi) => (
          <Marker
            key={poi.id}
            coordinate={poi.coordinate}
            title={poi.name}
            tint="systemBlue"
            systemImage="mappin.circle.fill"
            tag={`poi-${poi.id}`}
          />
        ))}
      </Map>


    </ZStack>
  );
}

function layerToStyle(layer: MapLayerId) {
  switch (layer) {
    case "imagery":
      return { style: "imagery" as const, elevation: "realistic" as const };
    case "hybrid":
      return { style: "hybrid" as const, elevation: "realistic" as const, showsTraffic: true };
    case "standard":
    default:
      return { style: "standard" as const, showsTraffic: true };
  }
}
