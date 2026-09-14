import { fetch } from "scripting";
import { IPInfo, IPProvider } from "../types/ip";
import { IPSettings, loadSettings } from "../services/settings";
import { isIPAddress, isPublicIPv4 } from "../utils/ipAddress";

export const IP_PROVIDERS = {
  ippure: { name: "IPPure", url: "https://my.ippure.com/v1/info" },
  "ip-api": { name: "ip-api", url: "http://ip-api.com/json/?lang=zh-CN" },
} as const;

// 这些端点用于比较出口，不保证在所有代理规则下都是国内直连。
const COMPARISON_IP_APIS = [
  "https://ip.3322.net",
  "https://api.ipify.org?format=json",
  "https://checkip.amazonaws.com",
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// 经纬度可能以字符串（IPPure）或数字（ip-api）返回，越界与非数字一律丢弃
function coordinate(value: unknown, limit: number): number | undefined {
  const raw = typeof value === "string" ? value.trim() : value;
  if (typeof raw !== "number" && (typeof raw !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) return undefined;
  return parsed;
}

export function parseIPInfo(provider: IPProvider, raw: unknown, isFallback = false): IPInfo {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("接口返回的数据格式无效");
  }
  const data = raw as Record<string, unknown>;
  const ip = text(provider === "ippure" ? data.ip : data.query);
  if (!isIPAddress(ip)) throw new Error("接口未返回有效的 IP 地址");

  if (provider === "ippure") {
    const score = data.fraudScore;
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error("IPPure 未返回有效的风险分数");
    }
    const organization = text(data.asOrganization);
    const asn = typeof data.asn === "number" && Number.isInteger(data.asn) && data.asn > 0
      ? `AS${data.asn}`
      : "";
    return {
      query: ip,
      country: text(data.country),
      countryCode: text(data.countryCode).toUpperCase(),
      regionName: text(data.region),
      city: text(data.city),
      isp: organization,
      org: organization,
      as: [asn, organization].filter(Boolean).join(" "),
      status: "success",
      source: provider,
      isFallback,
      latitude: coordinate(data.latitude, 90),
      longitude: coordinate(data.longitude, 180),
      fraudScore: score,
      isResidential: typeof data.isResidential === "boolean" ? data.isResidential : undefined,
      isBroadcast: typeof data.isBroadcast === "boolean" ? data.isBroadcast : undefined,
    };
  }

  if (data.status !== "success") throw new Error("ip-api 查询失败");
  return {
    query: ip,
    country: text(data.country),
    countryCode: text(data.countryCode).toUpperCase(),
    regionName: text(data.regionName),
    city: text(data.city),
    isp: text(data.isp),
    org: text(data.org),
    as: text(data.as),
    status: "success",
    source: provider,
    isFallback,
    latitude: coordinate(data.lat, 90),
    longitude: coordinate(data.lon, 180),
  };
}

export async function fetchIPInfo(settings: IPSettings = loadSettings()): Promise<IPInfo | null> {
  const preferred = settings.preferredProvider;
  const providers: IPProvider[] = [preferred];
  if (settings.fallbackEnabled) providers.push(preferred === "ippure" ? "ip-api" : "ippure");

  // 每次尝试只使用单个响应，绝不把另一出口的风险分数拼到当前 IP 上。
  for (const provider of providers) {
    try {
      const response = await fetch(IP_PROVIDERS[provider].url, {
        timeout: 5,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseIPInfo(provider, await response.json(), provider !== preferred);
    } catch (error) {
      console.error(`[IP检测] ${IP_PROVIDERS[provider].name} 查询失败`, error);
    }
  }
  return null;
}

export async function fetchChinaIP(): Promise<string | null> {
  for (const apiUrl of COMPARISON_IP_APIS) {
    try {
      const response = await fetch(apiUrl, { timeout: 2 });
      if (!response.ok) continue;
      const body = (await response.text()).trim();
      let ip = body;
      try {
        const data = JSON.parse(body);
        ip = text(data?.ip || data?.query || data?.origin);
      } catch {
        // 非 JSON 响应仅接受完整的 IP 文本。
      }
      if (isPublicIPv4(ip)) return ip;
    } catch {
      // 某个比较源不可用时继续尝试下一个。
    }
  }
  return null;
}
