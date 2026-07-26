import { fetch, FormData } from "scripting";

export const WHOS_BASE = "https://whos.tv";
export const WHOS_COOKIE_KEY = "whos-tv-cookie-v1";
const UPLOAD_URL = `${WHOS_BASE}/upload-search`;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90_000;

export type WhosMatch = {
  id: string;
  code: string;
  title: string;
  cover?: string;
  score?: string;
  time?: string;
  videoUrl: string;
  frameUrl?: string;
};

export type WhosSearchResult = {
  resultUrl: string;
  matches: WhosMatch[];
};

function absoluteUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${WHOS_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function loadWhosCookie() {
  return (Storage.get<string>(WHOS_COOKIE_KEY) ?? "").trim();
}

export function saveWhosCookie(cookie: string) {
  const value = cookie.trim();
  if (value) Storage.set(WHOS_COOKIE_KEY, value);
  else Storage.remove(WHOS_COOKIE_KEY);
}

function isWhosDomain(domain: string) {
  const host = domain.replace(/^\./, "").toLowerCase();
  return host === "whos.tv" || host.endsWith(".whos.tv");
}

/** 将 WebView Cookie 列表拼成请求头字符串 */
export function cookiesToHeader(cookies: Array<{ name: string; value: string; domain?: string }>) {
  return cookies
    .filter((item) => item.name && item.value != null && (!item.domain || isWhosDomain(item.domain)))
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
}

async function seedWhosCookies(webView: WebViewController, cookieHeader: string) {
  const raw = cookieHeader.trim();
  if (!raw) return;
  for (const part of raw.split(";")) {
    const text = part.trim();
    if (!text) continue;
    const eq = text.indexOf("=");
    if (eq <= 0) continue;
    const name = text.slice(0, eq).trim();
    const value = text.slice(eq + 1).trim();
    if (!name) continue;
    await webView.setCookie({
      name,
      value,
      domain: "whos.tv",
      path: "/",
      isSecure: true,
      isHTTPOnly: false,
      isSessionOnly: false,
    });
  }
}

/** 打开 whos.tv 登录页，关闭后自动读取并保存 Cookie */
export async function loginWhosAndCaptureCookie(existingCookie = loadWhosCookie()) {
  const webView = new WebViewController();
  try {
    await seedWhosCookies(webView, existingCookie);
    await webView.loadURL(WHOS_BASE);
    await webView.present({
      fullscreen: false,
      navigationTitle: "登录 whos.tv",
    });
    const cookies = await webView.getCookies(WHOS_BASE);
    const header = cookiesToHeader(cookies);
    if (header) saveWhosCookie(header);
    return header;
  } finally {
    webView.dispose();
  }
}

function buildHeaders(cookie: string, extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Origin: WHOS_BASE,
    Referer: `${WHOS_BASE}/`,
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "X-Requested-With": "XMLHttpRequest",
    ...extra,
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function decodeHtml(input: string) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(input: string) {
  return decodeHtml(input.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** 解密 data-cover-src 编码的封面地址 */
export function decodeWhosCover(encoded: string) {
  const text = encoded.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (text.length < 4 || text.length % 2 !== 0) return "";
  try {
    const key = Number.parseInt(text.slice(-2), 16);
    if (!Number.isFinite(key)) return "";
    const body = text.slice(0, -2);
    let out = "";
    for (let i = 0; i < body.length; i += 2) {
      const byte = Number.parseInt(body.slice(i, i + 2), 16);
      if (!Number.isFinite(byte)) return "";
      out += String.fromCharCode(byte ^ key);
    }
    return out.startsWith("http") ? out : "";
  } catch {
    return "";
  }
}

function normalizeCode(raw: string) {
  return stripHtml(raw)
    .replace(/\s+/g, "")
    .replace(/^#/, "")
    .toUpperCase();
}

function extractRedirectTarget(payload: string) {
  const text = payload.trim();
  if (!text) return "";
  try {
    const json = JSON.parse(text);
    if (typeof json === "string") return json.trim();
    if (json && typeof json === "object") {
      const data = (json as any).data ?? json;
      const candidate =
        data?.url ?? data?.redirect ?? data?.result_url ?? data?.href ?? (json as any).url ?? "";
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  } catch {
    // 非 JSON，按纯文本 URL 处理
  }
  const quoted = text.match(/^"(.+)"$/)?.[1];
  return (quoted ?? text).trim();
}

function isWaitPage(html: string, url: string) {
  return /id=["']search-wait["']/i.test(html) || /\/wait/i.test(url) || /search-wait/i.test(url);
}

function extractQueueApiUrl(html: string) {
  const fromAttr =
    html.match(/id=["']search-wait["'][^>]*data-reload-url=["']([^"']+)["']/i)?.[1] ??
    html.match(/data-reload-url=["']([^"']+)["']/i)?.[1] ??
    html.match(/data-status-url=["']([^"']+)["']/i)?.[1] ??
    "";
  return fromAttr ? absoluteUrl(fromAttr) : "";
}

async function fetchText(url: string, cookie: string) {
  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(cookie, { Accept: "text/html,application/json,text/plain,*/*" }),
    timeout: 60,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`请求失败：HTTP ${res.status}`);
  return { text, finalUrl: res.url || url };
}

async function resolveSearchUrl(initialUrl: string, cookie: string) {
  let currentUrl = absoluteUrl(initialUrl);
  const started = Date.now();

  while (Date.now() - started < POLL_TIMEOUT_MS) {
    if (/login=1/i.test(currentUrl) || /[?&]login=1(?:&|$)/i.test(currentUrl)) {
      throw new Error("需要登录 whos.tv。请先在网站登录，再把 Cookie 粘贴到本页设置中。");
    }

    const page = await fetchText(currentUrl, cookie);
    currentUrl = page.finalUrl || currentUrl;

    if (!isWaitPage(page.text, currentUrl)) {
      return { url: currentUrl, html: page.text };
    }

    const queueApi = extractQueueApiUrl(page.text);
    if (!queueApi) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const status = await fetchText(queueApi, cookie);
    const target = extractRedirectTarget(status.text);
    if (!target) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (/^\d+$/.test(target)) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    currentUrl = absoluteUrl(target);
  }

  throw new Error("识别超时，请稍后重试或到 whos.tv 网页确认结果。");
}

function pickAttr(block: string, name: string) {
  return (
    block.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1] ??
    block.match(new RegExp(`data-${name}=["']([^"']+)["']`, "i"))?.[1] ??
    ""
  );
}

function extractCodeFromText(text: string) {
  const cleaned = stripHtml(text);
  const match =
    cleaned.match(/\b([A-Z]{2,10}(?:-[A-Z0-9]+){1,4}(?:-UNCENSORED(?:-LEAK)?)?)\b/i) ??
    cleaned.match(/\b(FC2-PPV-\d+)\b/i) ??
    cleaned.match(/\b([A-Z]{1,6}\d{2,5})\b/i);
  return match ? normalizeCode(match[1]) : "";
}

function pushMatch(list: WhosMatch[], item: Omit<WhosMatch, "id"> & { id?: string }) {
  const code = normalizeCode(item.code || extractCodeFromText(item.title));
  if (!code && !item.title) return;
  const videoUrl = item.videoUrl || (code ? `${WHOS_BASE}/videos/${code.toLowerCase()}` : "");
  if (!videoUrl) return;
  const key = `${code}|${videoUrl}|${item.frameUrl ?? ""}`;
  if (list.some((x) => `${x.code}|${x.videoUrl}|${x.frameUrl ?? ""}` === key)) return;
  list.push({
    id: item.id || key,
    code: code || "未知番号",
    title: item.title || code || "匹配结果",
    cover: item.cover,
    score: item.score,
    time: item.time,
    videoUrl: absoluteUrl(videoUrl),
    frameUrl: item.frameUrl ? absoluteUrl(item.frameUrl) : undefined,
  });
}

function parseScoreNear(block: string) {
  const score =
    block.match(/(?:相似|匹配|score|similarity)[^0-9%]{0,12}(\d{1,3}(?:\.\d+)?\s*%?)/i)?.[1] ??
    block.match(/(\d{1,3}(?:\.\d+)?\s*%)/)?.[1] ??
    "";
  return score.trim();
}

function parseTimeNear(block: string) {
  return (
    block.match(/(\d{1,2}:\d{2}:\d{2})/)?.[1] ??
    block.match(/(\d{1,2}:\d{2})/)?.[1] ??
    ""
  );
}

/** 解析以图搜片结果页 */
export function parseWhosResultHtml(html: string): WhosMatch[] {
  const matches: WhosMatch[] = [];

  // 结果页视频卡片（result-image.js 中的 class）
  const cards = [
    ...html.matchAll(
      /<div[^>]*class=["'][^"']*result-image-video-card[^"']*["'][^>]*>[\s\S]*?(?=<div[^>]*class=["'][^"']*result-image-video-card|<\/main>|<\/section>|$)/gi,
    ),
  ];
  for (const [block, index] of cards.map((m, i) => [m[0], i] as const)) {
    const code =
      normalizeCode(pickAttr(block, "video-code") || pickAttr(block, "data-video-code")) ||
      extractCodeFromText(block);
    const title =
      stripHtml(pickAttr(block, "video-title") || pickAttr(block, "data-video-title")) ||
      stripHtml(block.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] ?? "") ||
      code;
    const coverEnc =
      pickAttr(block, "video-cover") ||
      pickAttr(block, "data-video-cover") ||
      block.match(/data-cover-src=["']([^"']+)["']/i)?.[1] ||
      "";
    const cover = decodeWhosCover(coverEnc) || (/^https?:\/\//i.test(coverEnc) ? coverEnc : "");
    const href = block.match(/href=["'](\/videos\/[^"']+)["']/i)?.[1] ?? "";
    const frameHref = block.match(/href=["'](\/frames\/[^"']+)["']/i)?.[1] ?? "";
    pushMatch(matches, {
      id: `card-${index}-${code}`,
      code,
      title,
      cover,
      score: parseScoreNear(block),
      time: parseTimeNear(block),
      videoUrl: href,
      frameUrl: frameHref || undefined,
    });
  }

  // 帧链接：URE-129 · 2:02:55
  for (const match of html.matchAll(
    /href=["'](\/frames\/[^"']+)["'][^>]*>[\s\S]*?([A-Z0-9][A-Z0-9\-_.]{2,40})\s*[·•|]\s*(\d{1,2}:\d{2}(?::\d{2})?)/gi,
  )) {
    const code = normalizeCode(match[2] ?? "");
    pushMatch(matches, {
      id: `frame-${match[1]}`,
      code,
      title: `${code} · ${match[3]}`,
      time: match[3],
      videoUrl: code ? `/videos/${code.toLowerCase()}` : "",
      frameUrl: match[1],
    });
  }

  // 通用视频卡片
  for (const match of html.matchAll(/href=["'](\/videos\/([^"']+))["'][\s\S]{0,1200}?<\/a>/gi)) {
    const slug = decodeURIComponent(match[2] ?? "");
    const block = match[0];
    const code =
      normalizeCode(slug.replace(/-uncensored-leak$/i, "").replace(/-/g, "-")) ||
      extractCodeFromText(block) ||
      normalizeCode(slug);
    const title =
      stripHtml(block.match(/alt=["']([^"']+)["']/i)?.[1] ?? "") ||
      stripHtml(block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "") ||
      code;
    const coverEnc = block.match(/data-cover-src=["']([^"']+)["']/i)?.[1] ?? "";
    pushMatch(matches, {
      id: `video-${slug}`,
      code,
      title,
      cover: decodeWhosCover(coverEnc),
      score: parseScoreNear(block),
      videoUrl: match[1] ?? "",
    });
  }

  return matches;
}

export async function compressImageForWhos(image: UIImage) {
  let quality = 0.92;
  let data = image.toJPEGData(quality);
  if (!data) throw new Error("无法读取图片数据");

  // 过大时逐步降质，贴近网站 5MB 限制
  while (data.size > MAX_IMAGE_BYTES && quality > 0.4) {
    quality -= 0.12;
    const next = image.toJPEGData(quality);
    if (!next) break;
    data = next;
  }

  if (data.size > MAX_IMAGE_BYTES) {
    const scale = Math.sqrt(MAX_IMAGE_BYTES / Math.max(1, data.size));
    const width = Math.max(320, Math.floor(image.width * scale));
    const height = Math.max(320, Math.floor(image.height * scale));
    const resized = image.preparingThumbnail({ width, height }) ?? image;
    data = resized.toJPEGData(0.82) ?? data;
  }

  return data;
}

export async function searchWhosByImage(image: UIImage, cookie = loadWhosCookie()): Promise<WhosSearchResult> {
  const imageData = await compressImageForWhos(image);
  const form = new FormData();
  form.append("file", imageData, "image/jpeg", `whos-search-${Date.now()}.jpg`);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: buildHeaders(cookie),
    body: form,
    timeout: 90,
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`上传失败：HTTP ${res.status}${raw ? `，${raw.slice(0, 120)}` : ""}`);

  const target = extractRedirectTarget(raw);
  if (!target) throw new Error("上传成功但未返回结果地址");
  if (/login=1/i.test(target)) {
    throw new Error("需要登录 whos.tv。请先在网站登录，再把 Cookie 粘贴到本页设置中。");
  }

  const resolved = await resolveSearchUrl(target, cookie);
  return {
    resultUrl: resolved.url,
    matches: parseWhosResultHtml(resolved.html),
  };
}

export async function searchWhosByKeyword(keyword: string, cookie = loadWhosCookie()): Promise<WhosMatch[]> {
  const q = keyword.trim();
  if (!q) return [];
  const url = `${WHOS_BASE}/result?search=${encodeURIComponent(q)}`;
  const page = await fetchText(url, cookie);
  return parseWhosResultHtml(page.text);
}
