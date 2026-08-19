// xcili.net 磁力搜索与详情解析

import { fetch } from "scripting";

import { XCILI_BASE } from "../constants";
import type { XciliDetailInfo, XciliSearchItem } from "../types";
import { stripHtml, stripMarks } from "../utils/html";
import { extractPureMagnetLink } from "../utils/magnet";

function absoluteXciliUrl(href: string) {
  if (/^https?:\/\//i.test(href)) return href;
  return `${XCILI_BASE}${href.startsWith("/") ? href : `/${href}`}`;
}

// 搜索结果行：result-title 内含详情链接与标题，result-meta 内两个 div 分别是体积与日期
const SEARCH_ROW_PATTERN = /<tr>\s*<td[^>]*class=["'][^"']*result-title[^"']*["'][^>]*>\s*<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class=["'][^"']*result-meta[^"']*["'][^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;

function parseXciliSearchResults(html: string): XciliSearchItem[] {
  const rows = [...html.matchAll(SEARCH_ROW_PATTERN)];
  return rows.map((match, index) => {
    const meta = match[3] ?? "";
    const size = stripHtml(meta.match(/<div[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const date = stripHtml(meta.match(/<div[^>]*class=["'][^"']*result-date[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const detailUrl = absoluteXciliUrl(match[1] ?? "");
    return {
      id: `${index}-${detailUrl}`,
      // 标题里的关键词用 <mark> 高亮，先去标签再清理，避免词被拆开
      title: stripHtml(stripMarks(match[2] ?? "")) || "未命名资源",
      date,
      size: size || "未知",
      detailUrl,
    };
  });
}

export async function searchXcili(keyword: string): Promise<XciliSearchItem[]> {
  const q = keyword.trim();
  if (!q) return [];
  const res = await fetch(`${XCILI_BASE}/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`搜索失败：HTTP ${res.status}`);
  return parseXciliSearchResults(await res.text());
}

function parseXciliDetail(html: string): XciliDetailInfo {
  const title = stripHtml(stripMarks(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "资源详情")) || "资源详情";
  const magnet = extractPureMagnetLink(html);
  const fileSection = html.split(/<h4[^>]*>\s*相关资源\s*:/i)[0] ?? html;
  const files = [...fileSection.matchAll(/<tr>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi)]
    .map((match) => ({ name: stripHtml(match[1] ?? ""), size: stripHtml(match[2] ?? "") }))
    .filter((file) => file.name && file.size);
  return { title, magnet, files };
}

export async function fetchXciliDetail(detailUrl: string): Promise<XciliDetailInfo> {
  const res = await fetch(detailUrl);
  if (!res.ok) throw new Error(`获取详情失败：HTTP ${res.status}`);
  return parseXciliDetail(await res.text());
}

export async function fetchXciliMagnet(detailUrl: string) {
  const detail = await fetchXciliDetail(detailUrl);
  if (!detail.magnet) throw new Error("详情页未找到磁力链接");
  return detail.magnet;
}
