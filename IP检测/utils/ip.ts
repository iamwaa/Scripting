// 分析本地网络特征；IPPure 风险分数不参与本地加减分。
import { Device } from "scripting";
import { IPInfo } from "../types/ip";
import { isIPv4 } from "./ipAddress";

const RISK_KEYWORDS = {
  dataCenter: ["数据中心", "Amazon", "Google", "Tencent", "Alibaba", "Cloudflare", "IDC", "DMIT", "Vultr", "DigitalOcean", "Linode", "OVH"],
  homeBroadband: ["电信", "移动", "联通", "宽带", "Comcast", "Verizon", "ChinaNet", "家庭", "住宅"],
  highRiskCountries: ["俄罗斯", "印度", "乌克兰"],
  vpnKeywords: ["VPN", "Proxy", "Tunnel", "虚拟", "加速器", "节点"]
};

// 用户态隧道接口前缀；不含 ipsec——iOS 的 464XLAT、IMS、私密中继同样叫 ipsec，计入会常年误报
const TUNNEL_PREFIXES = ["utun", "tun", "tap", "ppp", "wg"];

// 系统保留、并非用户代理的 IPv4：464XLAT 的 192.0.0.0/29、链路本地 169.254/16
function isSystemReservedIPv4(ip: string): boolean {
  if (ip.startsWith("169.254.")) return true;
  const parts = ip.split(".").map(Number);
  return parts[0] === 192 && parts[1] === 0 && parts[2] === 0 && parts[3] <= 7;
}

// 代理软件 Fake-IP 常用段 198.18.0.0/15，命中即为强信号
function isFakeIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  return parts[0] === 198 && (parts[1] === 18 || parts[1] === 19);
}

/**
 * 读取本地隧道接口特征：只认用户态 VPN/代理创建且带有效 IPv4 的接口
 */
function getLocalNetworkInfo(): { hasTunnel: boolean; hasFakeIPTunnel: boolean } {
  try {
    let hasTunnel = false;
    let hasFakeIPTunnel = false;

    for (const [name, addresses] of Object.entries(Device.networkInterfaces())) {
      const lowerName = name.toLowerCase();
      if (!TUNNEL_PREFIXES.some(prefix => lowerName.startsWith(prefix))) continue;

      for (const addr of addresses) {
        if (addr.isInternal || addr.family !== "IPv4") continue;
        if (!isIPv4(addr.address) || isSystemReservedIPv4(addr.address)) continue;
        hasTunnel = true;
        if (isFakeIPv4(addr.address)) hasFakeIPTunnel = true;
      }
    }

    return { hasTunnel, hasFakeIPTunnel };
  } catch {
    return { hasTunnel: false, hasFakeIPTunnel: false };
  }
}

/**
 * 分析ISP类型
 */
function analyzeISP(isp: string, org: string): { 
  isDataCenter: boolean; 
  isHomeBroadband: boolean; 
  isVPNService: boolean;
  confidence: number;
} {
  const ispLower = isp.toLowerCase();
  const orgLower = org.toLowerCase();
  const combined = `${ispLower} ${orgLower}`;
  
  // 检测数据中心
  const isDataCenter = RISK_KEYWORDS.dataCenter.some(kw => 
    combined.includes(kw.toLowerCase())
  );
  
  // 检测家宽
  const isHomeBroadband = RISK_KEYWORDS.homeBroadband.some(kw => 
    combined.includes(kw.toLowerCase())
  );
  
  // 检测VPN服务商
  const isVPNService = RISK_KEYWORDS.vpnKeywords.some(kw => 
    combined.includes(kw.toLowerCase())
  );
  
  // 计算置信度
  let confidence = 50;
  if (isDataCenter) confidence += 30;
  if (isVPNService) confidence += 20;
  if (isHomeBroadband) confidence -= 20;
  
  return { isDataCenter, isHomeBroadband, isVPNService, confidence: Math.max(0, Math.min(100, confidence)) };
}

/**
 * 检测IP是否为海外（与中国大陆对比）
 */
function isOverseasIP(ipInfo: IPInfo): boolean {
  // 检查国家代码
  if (ipInfo.countryCode) {
    return ipInfo.countryCode !== "CN";
  }
  // 兼容 IPPure 返回英文国家名称。
  if (ipInfo.country && !ipInfo.country.includes("中国") && ipInfo.country.toLowerCase() !== "china") {
    return true;
  }
  return false;
}

/** 连接状态文案 */
export type ConnectionStatus = "直连" | "分流" | "全局代理" | "代理" | "未知";

/**
 * 判断当前出网方式：出口对比为主证据，本地隧道接口仅在拿不到对比出口时兜底
 */
export function detectConnectionStatus(
  ipInfo: IPInfo,
  chinaIP: string | null
): {
  status: ConnectionStatus;
  isTunneled: boolean;
  confidence: number;
  method: string;
} {
  const { hasTunnel, hasFakeIPTunnel } = getLocalNetworkInfo();
  const intlIP = ipInfo.query;
  const methods: string[] = [];
  if (hasTunnel) methods.push(hasFakeIPTunnel ? "Fake-IP隧道" : "隧道接口");
  const join = (extra: string) => [...methods, extra].join("+");

  // 1. 出口对比：国内站点与查询接口出口不同即为分流；只比同为 IPv4 的地址，避免双栈误判
  if (chinaIP && isIPv4(chinaIP) && isIPv4(intlIP)) {
    if (chinaIP !== intlIP) {
      return { status: "分流", isTunneled: true, confidence: 95, method: join("出口分流") };
    }
    // 出口一致：落在海外说明全部流量走代理，落在国内视为未改变出口
    return isOverseasIP(ipInfo)
      ? { status: "全局代理", isTunneled: true, confidence: 90, method: join("出口一致+海外IP") }
      : { status: "直连", isTunneled: false, confidence: 85, method: join("出口一致+国内IP") };
  }

  // 2. 拿不到对比出口时降级：隧道接口或海外 IP 任一成立都按代理处理，但分不出分流/全局
  const overseas = isOverseasIP(ipInfo);
  if (hasTunnel || overseas) {
    return {
      status: "代理",
      isTunneled: true,
      confidence: hasTunnel && overseas ? 75 : 60,
      method: join(overseas ? "海外IP" : "无出口对比"),
    };
  }

  return { status: "直连", isTunneled: false, confidence: 55, method: "无隧道接口" };
}

export function calculateRiskValue(ipInfo: IPInfo, chinaIP: string | null = null) {
  let riskValue = 0;
  
  // 连接状态（出口对比优先）
  const connection = detectConnectionStatus(ipInfo, chinaIP);
  
  // ISP分析
  const ispAnalysis = analyzeISP(ipInfo.isp, ipInfo.org);
  
  // 风险计算
  if (connection.isTunneled) {
    riskValue += connection.confidence * 0.5;
  }
  
  if (ispAnalysis.isDataCenter) {
    riskValue += 20;
  }
  
  if (ispAnalysis.isHomeBroadband) {
    riskValue -= 15;
  }
  
  if (RISK_KEYWORDS.highRiskCountries.some(kw => ipInfo.country.includes(kw))) {
    riskValue += 25;
  }
  
  riskValue = Math.max(0, Math.min(100, riskValue));
  
  // IPPure 直接采用其权威判定；ip-api 降级时只能给关键词估算，原生与否无法判定。
  const isIPPure = ipInfo.source === "ippure";
  return {
    riskValue: isIPPure ? (ipInfo.fraudScore ?? null) : Math.round(riskValue),
    riskSource: isIPPure ? "IPPure" : "本地估算",
    isHomeBroadband: isIPPure
      ? (ipInfo.isResidential === true ? "家宽" : ipInfo.isResidential === false ? "机房" : "未知")
      : (ispAnalysis.isHomeBroadband ? "家宽" : "非家宽"),
    isNative: isIPPure
      ? (ipInfo.isBroadcast === false ? "原生" : ipInfo.isBroadcast === true ? "广播" : "未知")
      : "未知",
    vpnStatus: connection.status,
    vpnConfidence: connection.confidence,
    vpnMethod: connection.method
  };
}