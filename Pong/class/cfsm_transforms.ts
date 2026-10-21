// ============================================================================
// CF-Server-Monitor PURE transforms — raw Worker JSON -> canonical app model.
// No I/O, no side effects, fully deterministic. Split out of class/cfsm.ts so
// the mapping can be unit-tested in isolation (S: Single Purpose; R: Replaceable).
// U: Unidirectional — panel shapes in, canonical shapes out. Never the reverse.
//
// 关键单位差异：面板的 RAM / Swap / 磁盘是 MB，网速是 B/s；规范模型一律用字节。
// 时间：面板用毫秒时间戳（数字）或 "0"/"1" 字符串，规范模型用 ISO 字符串。
// ============================================================================
import type {
  CfsmHistoryRow,
  CfsmServer,
  LiveData,
  LiveRecord,
  LoadRecord,
  LoadType,
  NodeBasicInfo,
  PingData,
  PingRecord,
  PingTask,
} from "./types";

const MB = 1024 * 1024;

/** 面板的在线判定窗口：5 分钟内有上报即在线（与面板 stats 阈值一致）。 */
export const CFSM_ONLINE_WINDOW_MS = 5 * 60 * 1000;

/** 把可能是字符串 / false / null 的数值安全转成 number（无效值按 0）。 */
export function num(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  return 0;
}

/** MB -> 字节。 */
export function mbToBytes(v: unknown): number {
  return num(v) * MB;
}

/** 毫秒时间戳 -> ISO 字符串（无效值返回空串）。 */
export function isoFromMs(ms: unknown): string {
  const n = num(ms);
  return n > 0 ? new Date(n).toISOString() : "";
}

/** 百分比（分母为 0 时返回 0）。 */
function percent(used: number, total: number): number {
  return total > 0 ? (used / total) * 100 : 0;
}

/** "0.10 0.20 0.30" -> {load1,load5,load15}。 */
export function parseLoadAvg(raw?: string): { load1: number; load5: number; load15: number } {
  const parts = String(raw || "")
    .trim()
    .split(/\s+/)
    .map((p) => parseFloat(p));
  return {
    load1: isFinite(parts[0]) ? parts[0] : 0,
    load5: isFinite(parts[1]) ? parts[1] : 0,
    load15: isFinite(parts[2]) ? parts[2] : 0,
  };
}

/** 面板的 gpu_info 可能是数组，也可能是 JSON 字符串（REST 详情 / 历史）。 */
export function parseGpuInfo(
  raw: unknown,
): { gpu?: number; gpus?: { name: string; usage?: number }[] } {
  let list: any[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      /* 非法 JSON 视为无 GPU */
    }
  }
  const cards = list
    .filter((g) => g && typeof g === "object")
    .map((g, i) => ({
      name: String(g.name || `GPU ${i}`),
      usage: typeof g.info === "number" ? g.info : undefined,
    }));
  if (cards.length === 0) return {};
  const valid = cards.map((c) => c.usage).filter((v): v is number => typeof v === "number");
  const out: { gpu?: number; gpus?: { name: string; usage?: number }[] } = { gpus: cards };
  if (valid.length > 0) out.gpu = valid.reduce((a, b) => a + b, 0) / valid.length;
  return out;
}

/** GPU 名称汇总（用于静态硬件卡片）。 */
export function gpuNameOf(raw: unknown): string {
  const names = (parseGpuInfo(raw).gpus || []).map((g) => g.name);
  return names.join(", ");
}

/**
 * 面板 tags 用逗号分隔，规范模型统一用 ';'（Komari 约定）。
 * 两种方向都要能互转，编辑提交时再转回逗号。
 */
export function tagsToCanonical(raw?: string): string {
  return String(raw || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .join(";");
}

/** 规范模型的 ';' 分隔 tags -> 面板的逗号分隔。 */
export function tagsToPanel(raw?: string): string {
  return String(raw || "")
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean)
    .join(",");
}

/** 面板 billing_cycle 枚举 -> 天数（规范模型用天数）。 */
export function billingCycleDays(cycle?: string): number {
  switch (String(cycle || "").toLowerCase()) {
    case "month":
      return 30;
    case "quarter":
      return 90;
    case "half_year":
      return 182;
    case "year":
      return 365;
    case "two_years":
      return 730;
    case "three_years":
      return 1095;
    case "four_years":
      return 1460;
    case "five_years":
      return 1825;
    default:
      return 0;
  }
}

/** 天数 -> 面板 billing_cycle 枚举（取最接近的档位）。 */
export function daysToBillingCycle(days?: number): string {
  const d = num(days);
  if (d >= 1640) return "five_years";
  if (d >= 1270) return "four_years";
  if (d >= 1000) return "three_years";
  if (d >= 600) return "two_years";
  if (d >= 300) return "year";
  if (d >= 150) return "half_year";
  if (d >= 60) return "quarter";
  return "month";
}

// ----------------------------------------------------------------------------
// Server -> canonical node / live record
// ----------------------------------------------------------------------------

/** `Server` -> `NodeBasicInfo`。sort_order 越小越靠前，而规范模型是权重越大越前。 */
export function cfsmServerToNode(s: CfsmServer): NodeBasicInfo {
  const gpuName = gpuNameOf(s.gpu_info);
  return {
    uuid: String(s.id),
    id: 0, // 面板用 UUID 做主键，没有数字 id
    name: s.name || String(s.id).slice(0, 8),
    cpu_name: s.cpu_info || "",
    virtualization: "",
    arch: s.arch || "",
    cpu_cores: num(s.cpu_cores),
    os: s.os || "",
    gpu_name: gpuName,
    region: String(s.region || "").toUpperCase(),
    group: s.server_group || "",
    tags: tagsToCanonical(s.tags),
    mem_total: mbToBytes(s.ram_total),
    swap_total: mbToBytes(s.swap_total),
    disk_total: mbToBytes(s.disk_total),
    version: s.agent_version || "",
    // sort_order 越小越靠前，而规范模型是权重越大越靠前；用 0 - x 避开 -0。
    weight: 0 - num(s.sort_order),
    price: num(s.price),
    billing_cycle: billingCycleDays(s.billing_cycle),
    expired_at: s.expire_date || "",
    created_at: isoFromMs(s.timestamp),
    updated_at: isoFromMs(s.last_updated),
    note: s.note || "",
  };
}

/** 空记录骨架（合并增量样本时用）。 */
function emptyRecord(updatedAt: string): LiveRecord {
  return {
    cpu: { usage: 0 },
    ram: { used: 0, total: 0 },
    swap: { used: 0, total: 0 },
    load: { load1: 0, load5: 0, load15: 0 },
    disk: { used: 0, total: 0 },
    network: { up: 0, down: 0, totalUp: 0, totalDown: 0 },
    connections: { tcp: 0, udp: 0 },
    uptime: 0,
    process: 0,
    message: "",
    updated_at: updatedAt,
  };
}

/** 开机时间（毫秒）-> 已运行秒数。 */
function uptimeSeconds(bootMs: unknown, nowMs: number): number {
  const b = num(bootMs);
  if (b <= 0) return 0;
  const diff = (nowMs - b) / 1000;
  return diff > 0 ? Math.round(diff) : 0;
}

/** `Server` -> `LiveRecord`（用于 /api/servers 快照）。 */
export function cfsmServerToRecord(s: CfsmServer, nowMs: number): LiveRecord {
  const ramUsed = mbToBytes(s.ram_used);
  const ramTotal = mbToBytes(s.ram_total);
  const diskUsed = mbToBytes(s.disk_used);
  const diskTotal = mbToBytes(s.disk_total);
  const rec = emptyRecord(isoFromMs(s.last_updated) || new Date(nowMs).toISOString());
  rec.cpu.usage = num(s.cpu);
  rec.ram = { used: ramUsed, total: ramTotal };
  rec.swap = { used: mbToBytes(s.swap_used), total: mbToBytes(s.swap_total) };
  rec.load = parseLoadAvg(s.load_avg);
  rec.disk = { used: diskUsed, total: diskTotal };
  rec.network = {
    up: num(s.net_out_speed),
    down: num(s.net_in_speed),
    totalUp: num(s.net_tx),
    totalDown: num(s.net_rx),
  };
  rec.connections = { tcp: num(s.tcp_conn), udp: num(s.udp_conn) };
  rec.uptime = uptimeSeconds(s.boot_time, nowMs);
  rec.process = num(s.processes);
  const gpu = parseGpuInfo(s.gpu_info);
  if (gpu.gpu != null) rec.gpu = gpu.gpu;
  if (gpu.gpus) rec.gpus = gpu.gpus;
  return rec;
}

/**
 * 把一条 WS 增量样本合并进已有记录。面板的 batchUpdate 只带变化字段，每个批次
 * 的最后一个样本才带完整状态，所以必须按字段存在性合并，不能整体替换。
 */
export function mergeSample(
  base: LiveRecord | undefined,
  data: Partial<CfsmServer>,
  tsMs: number,
  nowMs: number,
): LiveRecord {
  const at = new Date(num(tsMs) > 0 ? num(tsMs) : nowMs).toISOString();
  const rec = base ? { ...base, cpu: { ...base.cpu }, ram: { ...base.ram }, swap: { ...base.swap }, load: { ...base.load }, disk: { ...base.disk }, network: { ...base.network }, connections: { ...base.connections } } : emptyRecord(at);
  const d = data || {};
  if (d.cpu != null) rec.cpu.usage = num(d.cpu);
  if (d.ram_total != null) rec.ram.total = mbToBytes(d.ram_total);
  if (d.ram_used != null) rec.ram.used = mbToBytes(d.ram_used);
  if (d.swap_total != null) rec.swap.total = mbToBytes(d.swap_total);
  if (d.swap_used != null) rec.swap.used = mbToBytes(d.swap_used);
  if (d.disk_total != null) rec.disk.total = mbToBytes(d.disk_total);
  if (d.disk_used != null) rec.disk.used = mbToBytes(d.disk_used);
  if (d.net_in_speed != null) rec.network.down = num(d.net_in_speed);
  if (d.net_out_speed != null) rec.network.up = num(d.net_out_speed);
  if (d.net_rx != null) rec.network.totalDown = num(d.net_rx);
  if (d.net_tx != null) rec.network.totalUp = num(d.net_tx);
  if (d.tcp_conn != null) rec.connections.tcp = num(d.tcp_conn);
  if (d.udp_conn != null) rec.connections.udp = num(d.udp_conn);
  if (d.processes != null) rec.process = num(d.processes);
  if (d.load_avg != null) rec.load = parseLoadAvg(d.load_avg);
  if (d.boot_time != null) rec.uptime = uptimeSeconds(d.boot_time, nowMs);
  if (d.gpu_info != null) {
    const gpu = parseGpuInfo(d.gpu_info);
    if (gpu.gpu != null) rec.gpu = gpu.gpu;
    if (gpu.gpus) rec.gpus = gpu.gpus;
  }
  rec.updated_at = at;
  return rec;
}

/** 由记录表构建 LiveData：5 分钟内有样本即在线。 */
export function cfsmBuildLive(
  records: { [uuid: string]: LiveRecord },
  nowMs: number,
): LiveData {
  const online: string[] = [];
  for (const uuid of Object.keys(records)) {
    const t = Date.parse(records[uuid]?.updated_at || "");
    if (!isNaN(t) && nowMs - t <= CFSM_ONLINE_WINDOW_MS) online.push(uuid);
  }
  return { online, data: records };
}

// ----------------------------------------------------------------------------
// History rows -> load records / ping data
// ----------------------------------------------------------------------------

/** `/api/history/all` 只接受这些 hours 值；就近取不超过给定值的档位。 */
export function snapHours(hours: number): number {
  const allowed = [0.167, 0.5, 1, 6, 12, 24, 48, 96, 168];
  const h = num(hours);
  if (h <= 0) return 24;
  let best = allowed[0];
  for (const a of allowed) if (a <= h) best = a;
  return best;
}

/** 历史行 -> 规范 LoadRecord（只为请求的指标填值，单位统一成字节）。 */
export function cfsmHistoryToLoadRecords(
  rows: CfsmHistoryRow[],
  loadType: LoadType,
): LoadRecord[] {
  const out: LoadRecord[] = [];
  for (const row of rows || []) {
    const ts = num(row?.timestamp);
    if (ts <= 0) continue;
    const base: LoadRecord = { time: new Date(ts).toISOString() };
    const ramUsed = mbToBytes(row.ram_used);
    const ramTotal = mbToBytes(row.ram_total);
    const diskUsed = mbToBytes(row.disk_used);
    const diskTotal = mbToBytes(row.disk_total);
    switch (loadType) {
      case "cpu":
        base.cpu = num(row.cpu);
        break;
      case "ram":
        base.ram = ramUsed;
        base.ram_total = ramTotal;
        base.ram_percent = percent(ramUsed, ramTotal);
        break;
      case "disk":
        base.disk = diskUsed;
        base.disk_total = diskTotal;
        base.disk_percent = percent(diskUsed, diskTotal);
        break;
      case "network":
        base.net_in = num(row.net_in_speed);
        base.net_out = num(row.net_out_speed);
        break;
      case "connections":
        base.connections_tcp = num(row.tcp_conn);
        base.connections_udp = num(row.udp_conn);
        base.connections = num(row.tcp_conn) + num(row.udp_conn);
        break;
      case "process":
        base.process = num(row.processes);
        break;
      case "gpu": {
        const gpu = parseGpuInfo(row.gpu_info);
        if (gpu.gpu == null) continue;
        base.gpu = gpu.gpu;
        break;
      }
      case "temp":
        // 面板不上报温度历史，直接返回空曲线。
        continue;
    }
    out.push(base);
  }
  return out;
}

/** 三网 + 自定义节点的延迟/丢包列，以及它们在图表里的任务 id。 */
const PING_FIELDS: { key: "ct" | "cu" | "cm" | "bd" | "node_1" | "node_2" | "node_3" | "node_4"; id: number }[] = [
  { key: "ct", id: 1 },
  { key: "cu", id: 2 },
  { key: "cm", id: 3 },
  { key: "bd", id: 4 },
  { key: "node_1", id: 5 },
  { key: "node_2", id: 6 },
  { key: "node_3", id: 7 },
  { key: "node_4", id: 8 },
];

/**
 * 历史行 -> 规范 PingData。面板把三网/自定义节点的时延直接放在历史行里，没有
 * 独立的任务表，因此这里把「运营商」映射成固定的任务 id（1..8）。
 * 约定：`null` = 本轮超时（记 -1，参与丢包率），`false`/缺省 = 未配置（跳过）。
 */
export function cfsmHistoryToPingData(
  rows: CfsmHistoryRow[],
  names?: Partial<Record<"ct" | "cu" | "cm" | "bd" | "node_1" | "node_2" | "node_3" | "node_4", string>>,
): PingData {
  const records: PingRecord[] = [];
  const seen = new Set<number>();
  for (const row of rows || []) {
    const ts = num(row?.timestamp);
    if (ts <= 0) continue;
    const time = new Date(ts).toISOString();
    for (const f of PING_FIELDS) {
      const raw = (row as any)[`ping_${f.key}`];
      if (raw === false || raw === undefined) continue;
      const loss = (row as any)[`loss_${f.key}`];
      // null 表示本轮没取到 RTT（超时），丢包率 100 也算超时。
      const timedOut = raw === null || (typeof loss === "number" && loss >= 100);
      records.push({
        task_id: f.id,
        time,
        value: timedOut ? -1 : num(raw),
        client: nameOfTask(f.key, names),
      });
      seen.add(f.id);
    }
  }
  const tasks: PingTask[] = Array.from(seen)
    .sort((a, b) => a - b)
    .map((id) => {
      const field = PING_FIELDS.find((f) => f.id === id)!;
      return {
        id,
        name: nameOfTask(field.key, names),
        clients: [],
        type: "icmp",
      };
    });
  return { count: records.length, records, tasks };
}

/** 任务显示名：优先用面板自定义的运营商名称，否则回退默认值。 */
function nameOfTask(
  key: "ct" | "cu" | "cm" | "bd" | "node_1" | "node_2" | "node_3" | "node_4",
  names?: Partial<Record<"ct" | "cu" | "cm" | "bd" | "node_1" | "node_2" | "node_3" | "node_4", string>>,
): string {
  const custom = names?.[key];
  if (custom) return custom;
  switch (key) {
    case "ct":
      return "电信";
    case "cu":
      return "联通";
    case "cm":
      return "移动";
    case "bd":
      return "BGP";
    default:
      return `节点 ${key.slice(-1)}`;
  }
}
