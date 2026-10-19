// ============================================================================
// 哪吒 (Nezha) PURE transforms — raw Nezha JSON -> canonical app model.
// No I/O, no side effects, fully deterministic. Split out of class/nezha.ts so
// this logic can be unit-tested in isolation (S: Single Purpose; R: Replaceable).
// U: Unidirectional — Nezha shapes in, canonical shapes out. Never the reverse.
// ============================================================================
import type {
  NodeBasicInfo,
  LiveRecord,
  LiveData,
  NezhaServer,
  NezhaState,
  NezhaHost,
  NezhaMetricPoint,
  NezhaServiceInfo,
  LoadRecord,
  LoadType,
  PingData,
  PingRecord,
  PingTask,
  NezhaPeriod,
} from "./types";

/**
 * A node is considered ONLINE when its `last_active` is fresh relative to a
 * trusted "now" anchor. Nezha's own frontend treats a server as offline once
 * its agent stops reporting (~10s cadence); we use a slightly more generous
 * window so a node that reports a touch slower isn't flicker-marked offline.
 */
export const ONLINE_WINDOW_MS = 15 * 1000;

/** Canonical uuid for a Nezha server = its numeric id as a string. */
export function nodeUuid(server: { id: number }): string {
  return String(server.id);
}

/** Parse an ISO timestamp to epoch ms, or 0 when invalid/empty. */
function parseTime(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return isNaN(t) ? 0 : t;
}

/**
 * True when a server's `last_active` is within ONLINE_WINDOW_MS of `nowMs`.
 * `nowMs` should be the stream's server-side `now` (ms) so a skewed device
 * clock can't mark everything offline. A missing last_active counts offline.
 */
export function isServerOnline(server: NezhaServer, nowMs: number): boolean {
  const t = parseTime(server.last_active);
  if (t === 0) return false;
  return nowMs - t <= ONLINE_WINDOW_MS;
}

/** Map a Nezha `host` into the canonical static fields. */
function hostToBasic(host?: NezhaHost): {
  cpu_name: string;
  arch: string;
  os: string;
  gpu_name: string;
  virtualization: string;
  cpu_cores: number;
  mem_total: number;
  swap_total: number;
  disk_total: number;
  version: string;
} {
  const h = host || {};
  const cpuList = Array.isArray(h.cpu) ? h.cpu : [];
  const gpuList = Array.isArray(h.gpu) ? h.gpu : [];
  // Try to read a logical-core count out of a string like "... 4 Physical / 8 Logical".
  let cores = 0;
  for (const c of cpuList) {
    const m = /(\d+)\s*(?:virtual|logical|core|cores|cpu)/i.exec(c);
    if (m) cores += parseInt(m[1], 10);
  }
  const os = [h.platform, h.platform_version].filter(Boolean).join(" ");
  return {
    cpu_name: cpuList.join(", "),
    arch: h.arch || "",
    os: os,
    gpu_name: gpuList.join(", "),
    virtualization: h.virtualization || "",
    cpu_cores: cores,
    mem_total: h.mem_total || 0,
    swap_total: h.swap_total || 0,
    disk_total: h.disk_total || 0,
    version: h.version || "",
  };
}

/**
 * Convert a Nezha server into the canonical NodeBasicInfo. `groupName` is the
 * resolved server-group label (server-group is a separate Nezha resource).
 */
export function serverToNode(
  server: NezhaServer,
  groupName?: string,
): NodeBasicInfo {
  const basic = hostToBasic(server.host);
  const region = (server.country_code || server.geoip?.country_code || "").toUpperCase();
  const bootMs = server.host?.boot_time ? server.host.boot_time * 1000 : 0;
  return {
    uuid: nodeUuid(server),
    id: server.id,
    name: server.name || `#${server.id}`,
    cpu_name: basic.cpu_name,
    virtualization: basic.virtualization,
    arch: basic.arch,
    cpu_cores: basic.cpu_cores,
    os: basic.os,
    gpu_name: basic.gpu_name,
    region,
    group: groupName || "",
    tags: "", // Nezha has no per-server tags
    mem_total: basic.mem_total,
    swap_total: basic.swap_total,
    disk_total: basic.disk_total,
    version: basic.version,
    weight: server.display_index || 0,
    price: 0,
    billing_cycle: 0,
    expired_at: "",
    created_at: "",
    updated_at: server.last_active || "",
    note: server.public_note || server.note || "",
  };
}

/** Convert a Nezha `state` (+ host for totals) into a canonical LiveRecord. */
export function stateToRecord(
  state: NezhaState | undefined,
  host: NezhaHost | undefined,
  lastActive?: string,
): LiveRecord {
  const s = state || {};
  const h = host || {};
  return {
    cpu: { usage: s.cpu || 0 },
    ram: { used: s.mem_used || 0, total: h.mem_total || 0 },
    swap: { used: s.swap_used || 0, total: h.swap_total || 0 },
    load: {
      load1: s.load_1 || 0,
      load5: s.load_5 || 0,
      load15: s.load_15 || 0,
    },
    disk: { used: s.disk_used || 0, total: h.disk_total || 0 },
    network: {
      up: s.net_out_speed || 0,
      down: s.net_in_speed || 0,
      totalUp: s.net_out_transfer || 0,
      totalDown: s.net_in_transfer || 0,
    },
    connections: {
      tcp: s.tcp_conn_count || 0,
      udp: s.udp_conn_count || 0,
    },
    uptime: s.uptime || 0,
    process: s.process_count || 0,
    message: "",
    updated_at: lastActive || "",
    ...gpuTempFields(s, h),
  };
}

/** Derive canonical GPU usage + temperature from a Nezha state block. */
function gpuTempFields(
  s: NezhaState,
  h: NezhaHost,
): { gpu?: number; temp?: number; gpus?: { name: string; usage?: number }[] } {
  const out: { gpu?: number; temp?: number; gpus?: { name: string; usage?: number }[] } = {};
  // GPU usage: state.gpu is a per-card percentage array; report the average.
  const g = Array.isArray(s.gpu) ? s.gpu.filter((v) => isFinite(v)) : [];
  if (g.length > 0) {
    out.gpu = g.reduce((a, b) => a + b, 0) / g.length;
    const names = Array.isArray(h.gpu) ? h.gpu : [];
    out.gpus = g.map((usage, i) => ({ name: names[i] || `GPU ${i}`, usage }));
  }
  // Temperature: highest sensor reading in °C.
  const temps = Array.isArray(s.temperatures) ? s.temperatures : [];
  let hi = 0;
  for (const t of temps) {
    const v = typeof t?.Temperature === "number" ? t.Temperature : 0;
    if (v > hi) hi = v;
  }
  if (hi > 0) out.temp = hi;
  return out;
}

/**
 * Build the canonical LiveData snapshot from a list of Nezha servers + a
 * trusted "now" (ms). Online membership is derived from last_active freshness.
 */
export function buildLiveData(servers: NezhaServer[], nowMs: number): LiveData {
  const online: string[] = [];
  const data: { [uuid: string]: LiveRecord } = {};
  for (const srv of servers) {
    const uuid = nodeUuid(srv);
    data[uuid] = stateToRecord(srv.state, srv.host, srv.last_active);
    if (isServerOnline(srv, nowMs)) online.push(uuid);
  }
  return { online, data };
}

// ----------------------------------------------------------------------------
// Metric-history adaptation. Nezha returns ONE series per `metric` call; the
// app's chart model (LoadRecord[]) groups several series by timestamp. These
// helpers bridge that gap. Memory/disk arrive as BYTES, so they need the
// node's total to become a percentage.
// ----------------------------------------------------------------------------

/** Map a canonical LoadType to the Nezha metric name(s) it needs. */
export function metricsForLoadType(type: LoadType): string[] {
  switch (type) {
    case "cpu":
      return ["cpu"];
    case "ram":
      return ["memory"];
    case "disk":
      return ["disk"];
    case "network":
      return ["net_out_speed", "net_in_speed"];
    case "connections":
      return ["tcp_conn", "udp_conn"];
    case "process":
      return ["process_count"];
    case "gpu":
      return ["gpu"];
    case "temp":
      return ["temperature"];
    default:
      return [];
  }
}

/**
 * Merge the metric series this LoadType needs into a canonical LoadRecord[],
 * keyed by timestamp. `series` maps a Nezha metric name → its data_points.
 * `total` is the node's mem_total / disk_total used to turn bytes into %.
 */
export function metricsToLoadRecords(
  type: LoadType,
  series: { [metric: string]: NezhaMetricPoint[] },
  total: number,
): LoadRecord[] {
  // Union of all timestamps across the involved series, ascending.
  const byTs: { [ts: number]: LoadRecord } = {};
  function ensure(ts: number): LoadRecord {
    if (!byTs[ts]) byTs[ts] = { time: new Date(ts).toISOString() };
    return byTs[ts];
  }

  const pct = (v: number) => (total > 0 ? Math.max(0, Math.min(100, (v / total) * 100)) : 0);

  for (const metric of Object.keys(series)) {
    for (const p of series[metric] || []) {
      const rec = ensure(p.ts);
      switch (metric) {
        case "cpu":
          rec.cpu = p.value;
          break;
        case "memory":
          rec.ram_percent = pct(p.value);
          break;
        case "disk":
          rec.disk_percent = pct(p.value);
          break;
        case "net_out_speed":
          rec.net_out = p.value;
          break;
        case "net_in_speed":
          rec.net_in = p.value;
          break;
        case "tcp_conn":
          rec.connections_tcp = p.value;
          break;
        case "udp_conn":
          rec.connections_udp = p.value;
          break;
        case "process_count":
          rec.process = p.value;
          break;
        case "gpu":
          rec.gpu = p.value;
          break;
        case "temperature":
          rec.temp = p.value;
          break;
      }
    }
  }

  return Object.keys(byTs)
    .map((k) => byTs[Number(k)])
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/**
 * Adapt Nezha's per-server service history (`GET /server/{id}/service`) into
 * the canonical PingData the chart consumes. Each service monitor becomes one
 * "task"; its parallel (created_at[], avg_delay[]) arrays become records.
 * avg_delay <= 0 is treated as a loss sample (value -1, kept for the loss %).
 */
export function serviceInfosToPingData(infos: NezhaServiceInfo[]): PingData {
  const records: PingRecord[] = [];
  const tasks: PingTask[] = [];
  for (const info of infos || []) {
    tasks.push({
      id: info.monitor_id,
      name: info.monitor_name || `监控 ${info.monitor_id}`,
      clients: [],
    });
    const times = info.created_at || [];
    const delays = info.avg_delay || [];
    const n = Math.min(times.length, delays.length);
    for (let i = 0; i < n; i++) {
      const delay = delays[i];
      records.push({
        task_id: info.monitor_id,
        time: new Date(times[i]).toISOString(),
        value: delay > 0 ? delay : -1,
      });
    }
  }
  return { count: records.length, records, tasks };
}

/** Clamp a requested hour window to the nearest Nezha period (1d/7d/30d). */
export function hoursToPeriod(hours: number): NezhaPeriod {
  if (hours <= 24) return "1d";
  if (hours <= 24 * 7) return "7d";
  return "30d";
}
