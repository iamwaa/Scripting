// ============================================================================
// Region -> coordinate resolution.
// S: Single Purpose — turns a node `region` string into a map coordinate.
// E: Environment-Agnostic — pure data lookup, no network, no hardcoded host.
// Coordinate table lives in coords_data.ts (auto-generated from ISO-3166).
// ============================================================================
import { COUNTRY_COORDS } from "./coords_data";

export type Coord = { latitude: number; longitude: number };

/**
 * A flag emoji is two Regional Indicator Symbols (U+1F1E6..U+1F1FF).
 * Each maps back to a letter A..Z, so 🇯🇵 -> "JP".
 */
function flagToCountryCode(input: string): string | null {
  const chars = Array.from(input.trim());
  if (chars.length < 2) return null;
  const cps = chars.slice(0, 2).map((c) => c.codePointAt(0) ?? 0);
  const inRange = cps.every((cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff);
  if (!inRange) return null;
  const letters = cps.map((cp) => String.fromCharCode(cp - 0x1f1e6 + 65));
  return letters.join("");
}

// A few common names / aliases a backend may emit instead of ISO codes.
const NAME_ALIASES: Record<string, string> = {
  CHINA: "CN",
  中国: "CN",
  US: "US",
  USA: "US",
  "UNITED STATES": "US",
  美国: "US",
  JAPAN: "JP",
  日本: "JP",
  KOREA: "KR",
  韩国: "KR",
  SINGAPORE: "SG",
  新加坡: "SG",
  GERMANY: "DE",
  德国: "DE",
  "HONG KONG": "HK",
  香港: "HK",
  TAIWAN: "TW",
  台湾: "TW",
  UK: "GB",
  ENGLAND: "GB",
  英国: "GB",
  RUSSIA: "RU",
  俄罗斯: "RU",
  FRANCE: "FR",
  法国: "FR",
  CANADA: "CA",
  加拿大: "CA",
};

/**
 * Resolve a node region string to a country code. Accepts:
 *  - ISO alpha-2 codes ("JP", "us") — what Nezha's country_code provides
 *  - flag emoji ("🇯🇵")
 *  - a handful of English / Chinese country names
 */
export function regionToCode(region: string): string | null {
  if (!region) return null;
  const trimmed = region.trim();

  const flag = flagToCountryCode(trimmed);
  if (flag && COUNTRY_COORDS[flag]) return flag;

  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && COUNTRY_COORDS[upper]) return upper;

  if (NAME_ALIASES[upper] && COUNTRY_COORDS[NAME_ALIASES[upper]]) {
    return NAME_ALIASES[upper];
  }
  if (NAME_ALIASES[trimmed]) return NAME_ALIASES[trimmed];

  return null;
}

/** Two regional-indicator letters → flag emoji (e.g. "KR" → 🇰🇷). */
export function codeToFlag(code: string | null): string {
  if (!code || code.length !== 2) return "";
  const base = 0x1f1e6;
  const A = "A".charCodeAt(0);
  const cc = code.toUpperCase();
  return (
    String.fromCodePoint(base + (cc.charCodeAt(0) - A)) +
    String.fromCodePoint(base + (cc.charCodeAt(1) - A))
  );
}

/** Coordinate for a region, or null when it cannot be resolved. */
export function regionToCoord(region: string): Coord | null {
  const code = regionToCode(region);
  if (!code) return null;
  const c = COUNTRY_COORDS[code];
  return { latitude: c.lat, longitude: c.lon };
}

/** Chinese display names for common country codes. Falls back to English. */
const CN_NAMES: Record<string, string> = {
  CN: "中国",
  HK: "香港",
  TW: "台湾",
  MO: "澳门",
  JP: "日本",
  KR: "韩国",
  SG: "新加坡",
  US: "美国",
  GB: "英国",
  DE: "德国",
  FR: "法国",
  RU: "俄罗斯",
  CA: "加拿大",
  AU: "澳大利亚",
  NL: "荷兰",
  IN: "印度",
  ID: "印度尼西亚",
  MY: "马来西亚",
  TH: "泰国",
  VN: "越南",
  PH: "菲律宾",
  IT: "意大利",
  ES: "西班牙",
  SE: "瑞典",
  CH: "瑞士",
  PL: "波兰",
  TR: "土耳其",
  BR: "巴西",
  AR: "阿根廷",
  MX: "墨西哥",
  ZA: "南非",
  AE: "阿联酋",
  SA: "沙特阿拉伯",
  FI: "芬兰",
  NO: "挪威",
  DK: "丹麦",
  IE: "爱尔兰",
  AT: "奥地利",
  BE: "比利时",
  UA: "乌克兰",
  KZ: "哈萨克斯坦",
  IL: "以色列",
  NZ: "新西兰",
};

/** Human-friendly country name for a region, falling back to the raw value. */
export function regionToName(region: string): string {
  const code = regionToCode(region);
  if (code && CN_NAMES[code]) return CN_NAMES[code];
  if (code && COUNTRY_COORDS[code]) return COUNTRY_COORDS[code].name;
  return region || "未知地区";
}

/**
 * Deterministically spread several nodes that share one country so their
 * markers don't perfectly overlap. Offsets ~0.4° in a small ring.
 */
export function jitterCoord(base: Coord, index: number, count: number): Coord {
  if (count <= 1) return base;
  const radius = 0.45;
  const angle = (2 * Math.PI * index) / count;
  return {
    latitude: base.latitude + radius * Math.sin(angle),
    longitude: base.longitude + radius * Math.cos(angle),
  };
}
