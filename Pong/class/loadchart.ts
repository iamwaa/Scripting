// ============================================================================
// Pure transforms: node load history -> chart marks + summaries.
// S: Single Purpose — turns canonical LoadRecord[] (adapted from Nezha's
//    /server/{id}/metrics series in class/nezha.ts) into renderable series.
// U: Unidirectional — LoadRecord[] in, plain view models out. No I/O.
// ============================================================================
import type { LoadRecord, LoadType } from "./types";

/** One point on a single-series line chart. label = sample time. */
export type LoadMark = {
  label: Date;
  value: number;
  category: string;
};

/** Definition of a single historical metric chart. */
export type LoadChartSpec = {
  type: LoadType;
  title: string;
  /** Y-axis unit suffix for the current/peak summary, e.g. "%". */
  unit: string;
  /** Whether the series can exceed 100 (false => clamp axis to 0..100). */
  percent: boolean;
};

/** Charted metrics on the node detail page. GPU/温度 are appended dynamically
 *  (see chartsForNode) only when the node actually reports them. */
export const LOAD_CHARTS: LoadChartSpec[] = [
  { type: "cpu", title: "CPU 使用率", unit: "%", percent: true },
  { type: "ram", title: "内存使用率", unit: "%", percent: true },
  { type: "disk", title: "磁盘使用率", unit: "%", percent: true },
  { type: "network", title: "网络速率", unit: "", percent: false },
  { type: "connections", title: "连接数", unit: "", percent: false },
  { type: "process", title: "进程数", unit: "", percent: false },
];

/** Optional charts shown only when the node reports the data. */
export const GPU_CHART: LoadChartSpec = { type: "gpu", title: "GPU 使用率", unit: "%", percent: true };
export const TEMP_CHART: LoadChartSpec = { type: "temp", title: "温度", unit: "°C", percent: false };

/**
 * Build the chart spec list for a node, appending GPU / temperature charts when
 * the latest live record reports them. Keeps the picker free of dead metrics
 * for nodes (most VPS) that have neither.
 */
export function chartsForNode(opts: { hasGpu?: boolean; hasTemp?: boolean }): LoadChartSpec[] {
  const list = LOAD_CHARTS.slice();
  if (opts.hasGpu) list.push(GPU_CHART);
  if (opts.hasTemp) list.push(TEMP_CHART);
  return list;
}

function toDate(iso: string): Date | null {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Convert load records into one or more line series depending on the metric.
 * - cpu/ram/disk -> single % series
 * - network -> two series (上行/下行 bytes/s)
 * - connections -> two series (TCP/UDP)
 * - process -> single count series
 * Records are sorted chronologically; invalid timestamps are dropped.
 */
export function buildLoadMarks(type: LoadType, records: LoadRecord[]): LoadMark[] {
  const sorted = records
    .map((r) => ({ r, d: toDate(r.time) }))
    .filter((x): x is { r: LoadRecord; d: Date } => x.d != null)
    .sort((a, b) => a.d.getTime() - b.d.getTime());

  const marks: LoadMark[] = [];
  for (const { r, d } of sorted) {
    switch (type) {
      case "cpu":
        if (r.cpu != null) marks.push({ label: d, value: clampPct(r.cpu), category: "CPU" });
        break;
      case "ram": {
        const v = r.ram_percent;
        if (v != null) marks.push({ label: d, value: clampPct(v), category: "内存" });
        break;
      }
      case "disk": {
        const v = r.disk_percent;
        if (v != null) marks.push({ label: d, value: clampPct(v), category: "磁盘" });
        break;
      }
      case "network":
        if (r.net_out != null) marks.push({ label: d, value: r.net_out, category: "上行" });
        if (r.net_in != null) marks.push({ label: d, value: r.net_in, category: "下行" });
        break;
      case "connections": {
        if (r.connections_tcp != null) marks.push({ label: d, value: r.connections_tcp, category: "TCP" });
        if (r.connections_udp != null) marks.push({ label: d, value: r.connections_udp, category: "UDP" });
        break;
      }
      case "process":
        if (r.process != null) marks.push({ label: d, value: r.process, category: "进程" });
        break;
      case "gpu":
        if (r.gpu != null) marks.push({ label: d, value: clampPct(r.gpu), category: "GPU" });
        break;
      case "temp":
        if (r.temp != null) marks.push({ label: d, value: r.temp, category: "温度" });
        break;
    }
  }
  return marks;
}

/** Summary stats per category for the chart caption (current / peak). */
export type LoadSummary = {
  category: string;
  last: number;
  max: number;
};

export function buildLoadSummaries(marks: LoadMark[]): LoadSummary[] {
  const byCat: Record<string, LoadMark[]> = {};
  for (const m of marks) (byCat[m.category] ||= []).push(m);
  return Object.keys(byCat).map((category) => {
    const series = byCat[category];
    const last = series[series.length - 1].value;
    const max = series.reduce((mx, m) => Math.max(mx, m.value), -Infinity);
    return { category, last, max };
  });
}

function clampPct(v: number): number {
  if (isNaN(v)) return 0;
  return v < 0 ? 0 : v > 100 ? 100 : v;
}
