// 展示层格式化：体积、文件类型、封面与预览图高度

import type { WhatsLinkResponse } from "../types";

export function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "未知";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 2)} ${units[index]}`;
}

export function displayFileType(result?: WhatsLinkResponse | null) {
  if (!result) return "-";
  return (result.file_type || result.type || "unknown").toUpperCase();
}

export function getCover(result?: WhatsLinkResponse | null, index = 0) {
  const shots = result?.screenshots ?? [];
  return shots[index]?.screenshot || shots[0]?.screenshot || "";
}

/** 依据图片原始比例估算预览图高度，导出模式固定高度 */
export function getPreviewHeight(width?: number, height?: number, exportMode = false) {
  if (exportMode) return 206;
  if (!width || !height) return 220;
  const estimatedWidth = 340;
  const ratio = height / width;
  return Math.round(Math.min(380, Math.max(150, estimatedWidth * ratio)));
}

export async function loadPreviewHeight(imageUrl?: string, exportMode = false) {
  if (exportMode) return 206;
  if (!imageUrl) return getPreviewHeight(undefined, undefined, exportMode);
  try {
    const image = await UIImage.fromURL(imageUrl);
    return getPreviewHeight(image?.width, image?.height, exportMode);
  } catch {
    return getPreviewHeight(undefined, undefined, exportMode);
  }
}
