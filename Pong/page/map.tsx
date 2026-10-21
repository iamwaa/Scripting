// ============================================================================
// Map page — renders probe nodes as geographic markers.
// S: Single Purpose — map presentation; data comes from the Monitor context.
// ============================================================================
import {
  Button,
  Label,
  Map,
  MapScaleView,
  Marker,
  ProgressView,
  useEffect,
  useObservable,
  useRef,
  useContext,
} from "scripting";
import type { Pin } from "../class/types";
import { MapSelectionContext } from "../context/MapSelection";
import { useMonitor } from "../context/Monitor";

// 单点视野的最小经纬跨度
const MIN_SPAN = 10.0;
// 把所有标点框进屏幕时留出的余量倍数
const FIT_PADDING = 2.0;

/** 把经度折算回 -180..180。 */
function wrapLongitude(lon: number): number {
  let v = lon;
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
}

/**
 * 计算能把所有标点都框进屏幕的相机位置。
 * 单点用固定近距离视野；多点按包围盒取中心并按跨度缩放，跨 180° 经线时
 * 先把负经度平移到同一连续区间，避免视野被拉成绕地球一圈。
 */
export function cameraForPins(pins: Pin[]): MapCameraPosition {
  let minLat = 90;
  let maxLat = -90;
  for (const p of pins) {
    const lat = p.coordinate.latitude;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  let lons = pins.map((p) => p.coordinate.longitude);
  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);
  if (maxLon - minLon > 180) {
    // 标点分布在日期变更线两侧：整体平移正区间后重新取包围盒
    lons = lons.map((v) => (v < 0 ? v + 360 : v));
    minLon = Math.min(...lons);
    maxLon = Math.max(...lons);
  }

  const center = {
    latitude: Math.max(-85, Math.min(85, (minLat + maxLat) / 2)),
    longitude: wrapLongitude((minLon + maxLon) / 2),
  };
  const latSpan = maxLat - minLat;
  const lonSpan = maxLon - minLon;

  // span 本身就是角度（MapKit 自己处理投影），不要按纬度做 cos 换算。
  // 经度上限取 180：再大的 region span 会跨过对面半球，MapKit 会把它折算回小范围，
  // 反而出现标点被挤到屏幕外的情况。
  const latDelta = Math.min(170, Math.max(latSpan * FIT_PADDING, MIN_SPAN));
  const lonDelta = Math.min(180, Math.max(lonSpan * FIT_PADDING, MIN_SPAN));

  return MapCameraPosition.region({
    center,
    span: { latitudeDelta: latDelta, longitudeDelta: lonDelta },
  });
}

export function View() {
  const selection = useContext(MapSelectionContext);
  const monitor = useMonitor();
  const cameraPosition = useObservable<MapCameraPosition>(
    MapCameraPosition.camera({
      centerCoordinate: { latitude: 20, longitude: 30 },
      distance: 42000000,
    }),
  );
  // 已经定位过的探针实例：只在换实例后重新定位，避免刷新时把用户拖走
  const fittedInst = useRef<string | null>(null);

  // 拿到标点后把视野移到节点所在区域（每个实例只做一次）
  useEffect(() => {
    const list = monitor.pins.value;
    if (list.length === 0) return; // 节点还没加载出来，保持默认世界视角
    const instId = monitor.instance.value?.id ?? "";
    if (fittedInst.current === instId) return;
    fittedInst.current = instId;
    cameraPosition.setValue(cameraForPins(list));
  }, [monitor.instance.value, monitor.pins.value]);

  // When no instance is configured, show a minimal neutral map — no loading spinner.
  const empty = monitor.instance.value == null;

  return (
    <Map
      cameraPosition={cameraPosition}
      selection={selection}
      mapStyle={{ style: "imagery", elevation: "realistic" }}
      controls={<MapScaleView />}
      toolbar={{
        topBarTrailing: empty ? undefined : [<RefreshButton />],
      }}
    >
      {monitor.pins.value.map((pin) => (
        <Marker
          tag={pin.id}
          title={pin.title}
          coordinate={pin.coordinate}
          tint={pin.tint}
        />
      ))}
    </Map>
  );
}

function RefreshButton() {
  const monitor = useMonitor();
  const isLoading = useObservable(false);
  return (
    <Button
      action={async () => {
        isLoading.setValue(true);
        await monitor.reload();
        isLoading.setValue(false);
      }}
    >
      {isLoading.value || monitor.status.value === "loading" ? (
        <ProgressView />
      ) : (
        <Label title={"刷新"} systemImage={"arrow.clockwise"} />
      )}
    </Button>
  );
}
