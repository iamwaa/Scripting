// 磁力链接识别、番号提取与在线播放地址构造

import { decodeHtml } from "./html";

function normalizeInput(input: string) {
  return input.trim().replace(/^\s+|\s+$/g, "");
}

export function extractMagnetLink(input: string) {
  const text = normalizeInput(input);
  if (!text) return "";

  const magnet = text.match(/magnet:\?[^\s\u4e00-\u9fff，。；、！？）)】\]]+/i)?.[0];
  if (magnet) return magnet;

  return text;
}

export function isMagnetLink(input: string) {
  return extractMagnetLink(input).toLowerCase().startsWith("magnet:?");
}

/** 从 HTML 或编码文本中提取纯净的 btih 磁力链接 */
export function extractPureMagnetLink(input: string) {
  const text = decodeHtml(input).trim();
  const candidates = [text];
  try {
    candidates.push(decodeURIComponent(text));
  } catch {
    // 忽略非法百分号编码
  }

  for (const candidate of candidates) {
    const btih = candidate.match(/magnet:\?xt=urn:btih:[0-9A-Za-z]{32,40}/i)?.[0] ?? "";
    if (btih) return btih;
  }
  return "";
}

export function extractFanhao(input: string) {
  const text = decodeHtml(input).trim().toUpperCase();
  if (!text) return "";

  const normalized = text.replace(/[\s_]+/g, "-");
  const patterns = [
    /(?:FC2-PPV-\d{5,8})/i,
    /(?:[A-Z]{2,6}-?\d{2,5}[A-Z]?)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern)?.[0] ?? "";
    if (match) return match.replace(/^(?:FC2-PPV|[A-Z]{2,6})-?/, (prefix) => prefix.replace(/-?$/, "-"));
  }

  return "";
}

export function buildMissavSearchUrl(fanhao: string) {
  return `https://missav123.com/search/${encodeURIComponent(fanhao)}`;
}
