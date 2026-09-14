import { Path } from "scripting";
import type { DynamicImageSource, MapCoordinate } from "scripting";
import type { IPInfo } from "../types/ip";

const CACHE_VERSION = 1;
const CACHE_DIR_NAME = "ip_detection_maps_v1";
const CACHE_META_NAME = "index.json";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_PAIRS = 6;
const MAP_TIMEOUT_MS = 4000;
const MAP_SPAN = 0.22;

type CacheIndex = Record<string, { lightSize: number; darkSize: number; createdAt: number }>;

function getMapCacheKey(ipInfo: IPInfo, size: { width: number; height: number }): string | undefined {
  const coordinate = getIPMapCoordinate(ipInfo);
  if (!coordinate) return undefined;
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    return undefined;
  }
  // 缓存只描述地图区域，同坐标、同来源可跨出口 IP 复用。
  return [
    ipInfo.source,
    String(coordinate.latitude),
    String(coordinate.longitude),
    String(size.width),
    String(size.height),
    `standard|flat|v${CACHE_VERSION}`,
  ].join("|");
}

export function getIPMapCoordinate(ipInfo: IPInfo): MapCoordinate | undefined {
  const latitude = ipInfo?.latitude;
  const longitude = ipInfo?.longitude;
  if (typeof latitude !== "number" || typeof longitude !== "number") return undefined;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return { latitude, longitude };
}

function cacheDir(): string {
  return Path.join(FileManager.appGroupDocumentsDirectory, CACHE_DIR_NAME);
}

function metaPath(): string {
  return Path.join(cacheDir(), CACHE_META_NAME);
}

function entryPaths(key: string): { lightPath: string; darkPath: string } {
  const source = Data.fromRawString(`${CACHE_VERSION}:${key}`);
  const name = source ? Crypto.sha256(source).toHexString().slice(0, 32) : encodeURIComponent(key);
  return {
    lightPath: Path.join(cacheDir(), "light", `${name}.png`),
    darkPath: Path.join(cacheDir(), "dark", `${name}.png`),
  };
}

function ensureCacheDirs(): void {
  const dir = cacheDir();
  if (!FileManager.existsSync(dir)) FileManager.createDirectorySync(dir, true);
  for (const theme of ["light", "dark"]) {
    const path = Path.join(dir, theme);
    if (!FileManager.existsSync(path)) FileManager.createDirectorySync(path);
  }
}

function readIndex(): CacheIndex {
  try {
    if (!FileManager.existsSync(metaPath())) return {};
    const parsed: unknown = JSON.parse(FileManager.readAsStringSync(metaPath()));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: CacheIndex = {};
    for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object") continue;
      const value = raw as Record<string, unknown>;
      if (typeof value.lightSize !== "number" || !Number.isFinite(value.lightSize) || value.lightSize <= 0
        || typeof value.darkSize !== "number" || !Number.isFinite(value.darkSize) || value.darkSize <= 0
        || typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt) || value.createdAt <= 0) {
        continue;
      }
      result[key] = {
        lightSize: value.lightSize,
        darkSize: value.darkSize,
        createdAt: value.createdAt,
      };
    }
    return result;
  } catch {
    return {};
  }
}

function writeIndex(index: CacheIndex): void {
  FileManager.writeAsStringSync(metaPath(), JSON.stringify(index, null, 2));
}

function fileSizeMatches(path: string, size: number): boolean {
  try {
    return FileManager.statSync(path).size === size;
  } catch {
    return false;
  }
}

function entryIsValid(key: string, entry: CacheIndex[string]): boolean {
  const paths = entryPaths(key);
  return fileSizeMatches(paths.lightPath, entry.lightSize) && fileSizeMatches(paths.darkPath, entry.darkSize);
}

function entryIsFresh(key: string, entry: CacheIndex[string], now: number): boolean {
  return entryIsValid(key, entry) && now >= entry.createdAt && now - entry.createdAt <= CACHE_TTL_MS;
}

function readImages(key: string): DynamicImageSource<UIImage> | undefined {
  try {
    const paths = entryPaths(key);
    const light = UIImage.fromFile(paths.lightPath);
    const dark = UIImage.fromFile(paths.darkPath);
    return light && dark ? { light, dark } : undefined;
  } catch {
    return undefined;
  }
}

function deleteFilesSafely(key: string): void {
  try {
    const paths = entryPaths(key);
    for (const path of [paths.lightPath, paths.darkPath]) {
      if (FileManager.existsSync(path)) FileManager.removeSync(path);
    }
  } catch {
    // 删除失败不应影响当前地图展示。
  }
}

function pruneCache(index: CacheIndex, currentKey: string): void {
  // 对全部旧条目计数，过期条目也占空间；始终保留当前图。
  const entries = Object.entries(index)
    .filter(([key]) => key !== currentKey)
    .sort((a, b) => a[1].createdAt - b[1].createdAt);

  while (entries.length > MAX_CACHE_PAIRS - 1) {
    const [key] = entries.shift()!;
    deleteFilesSafely(key);
    delete index[key];
  }

  // 索引损坏或中断写入可能留下孤立图片，只清理本服务目录中的 PNG。
  const keep = new Set(Object.keys(index).flatMap((key) => {
    const paths = entryPaths(key);
    return [paths.lightPath, paths.darkPath];
  }));
  for (const theme of ["light", "dark"]) {
    const dir = Path.join(cacheDir(), theme);
    for (const item of FileManager.readDirectorySync(dir)) {
      const name = item.split("/").pop() || "";
      const path = Path.join(dir, name);
      if (/^[a-f0-9]{32}\.png$/.test(name) && !keep.has(path)) {
        try {
          FileManager.removeSync(path);
        } catch {
          // 清理失败不影响新图。
        }
      }
    }
  }
}

function persistImages(key: string, light: UIImage, dark: UIImage): void {
  try {
    const lightData = light.toPNGData();
    const darkData = dark.toPNGData();
    if (!lightData || !darkData) return;

    const paths = entryPaths(key);
    ensureCacheDirs();
    FileManager.writeAsDataSync(paths.lightPath, lightData);
    FileManager.writeAsDataSync(paths.darkPath, darkData);

    const index = readIndex();
    index[key] = {
      lightSize: lightData.size,
      darkSize: darkData.size,
      createdAt: Date.now(),
    };
    pruneCache(index, key);
    writeIndex(index);
  } catch (error) {
    console.warn("[IP检测] 地图缓存写入失败", error);
  }
}

// 超时仅限制等待，MapSnapshotter 无原生取消；成功返回之前不会落盘。
async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 等待超时`)), MAP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function takeSnapshot(appearance: "light" | "dark", coordinate: MapCoordinate, size: { width: number; height: number }): Promise<UIImage | null> {
  const options: MapSnapshotter.Options = {
    size,
    appearance,
    mapStyle: {
      style: "standard",
      elevation: "flat",
      pointsOfInterest: "excludingAll",
    },
    region: {
      center: coordinate,
      span: { latitudeDelta: MAP_SPAN, longitudeDelta: MAP_SPAN },
    },
    annotations: [{
      coordinate,
      tintColor: "systemBlue",
      glyph: "network",
    }],
  };
  const snapshot = await MapSnapshotter.take(options);
  return snapshot.image;
}

export async function getIPMapImages(
  ipInfo: IPInfo,
  size: { width: number; height: number },
): Promise<DynamicImageSource<UIImage> | undefined> {
  const coordinate = getIPMapCoordinate(ipInfo);
  const key = coordinate ? getMapCacheKey(ipInfo, size) : undefined;
  if (!coordinate || !key) return undefined;

  const now = Date.now();
  const index = readIndex();
  const entry = index[key];
  const storedImages = entry && entryIsValid(key, entry) ? readImages(key) : undefined;
  if (entry && entryIsFresh(key, entry, now) && storedImages) return storedImages;

  try {
    const [light, dark] = await Promise.all([
      withTimeout(takeSnapshot("light", coordinate, size), "亮色地图快照"),
      withTimeout(takeSnapshot("dark", coordinate, size), "暗色地图快照"),
    ]);
    if (!light || !dark) return storedImages;

    // 持久化失败也不能丢当前已生成地图。
    persistImages(key, light, dark);
    return { light, dark };
  } catch (error) {
    console.warn("[IP检测] 地图快照生成失败", error);
    // 生成失败时，同键过期缓存仍可降级；不跨 key 回退。
    return storedImages;
  }
}
