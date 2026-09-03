/**
 * utils/imageDiff.ts - 图片文件识别与预览数据格式化（纯函数）
 *
 * Diff 页对二进制文件按扩展名识别常见图片格式，
 * 供 diffService 生成 base64 预览、WebView 全屏查看器构建 data URL。
 */

/** 可预览的图片扩展名 → MIME 类型 */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  ico: "image/x-icon",
}

/** 根据路径推断图片 MIME；非图片扩展名返回 null */
export function imageMimeFromPath(filepath: string): string | null {
  const idx = filepath.lastIndexOf(".")
  if (idx < 0 || idx === filepath.length - 1) return null
  const ext = filepath.slice(idx + 1).toLowerCase()
  return IMAGE_MIME_BY_EXT[ext] ?? null
}

/** 路径是否为可预览图片 */
export function isImagePath(filepath: string): boolean {
  return imageMimeFromPath(filepath) !== null
}

/** 构建供 WebView <img src> 使用的 data URL */
export function buildImageDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`
}

/** 字节大小格式化（如 "1.2 MB"） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  // 两位内保留一位小数，更大取整
  const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1)
  return `${text} ${units[unit]}`
}
