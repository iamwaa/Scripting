// ============================================================================
// Pure transforms for latency (ping) history. S: Single Purpose — turn the
// canonical PingData (adapted from Nezha's /server/{id}/service history in
// class/nezha.ts) into chart marks + per-task summaries. No I/O, no side
// effects, fully deterministic. (R: trivially replaceable.)
// ============================================================================
import type { PingData, PingRecord, PingTask } from "./types";

/** One point on the latency chart. label = sample time, category = task name. */
export type PingMark = {
  label: Date;
  value: number;
  category: string;
  /** Owning task id — lets the UI filter marks for hidden lines. */
  taskId: number;
  /** Line colour baked onto the mark so the built-in chart can't reshuffle it. */
  foregroundStyle: string;
};

/** Per-task latency summary shown under the chart. */
export type PingSummary = {
  taskId: number;
  name: string;
  /** Packet-loss ratio 0..1 (NaN-safe). */
  loss: number;
  min: number;
  max: number;
  avg: number;
  /** 50th / 99th percentile latency (ms). */
  p50: number;
  p99: number;
  /** Most recent latency sample (ms), or null if none. */
  last: number | null;
  color: string;
};

// A small, distinct palette reused for each task line / legend swatch.
const PALETTE = [
  "systemBlue",
  "systemGreen",
  "systemOrange",
  "systemPurple",
  "systemRed",
  "systemTeal",
  "systemPink",
  "systemIndigo",
];

/**
 * Map a task id to a stable colour. The colour is anchored to the task id
 * ITSELF (taskId % palette length), NOT to a positional index into the set of
 * tasks that happen to have data. This guarantees a given line keeps the same
 * colour across refreshes and regardless of whether other lines have samples
 * in the selected time window. The `order` arg is accepted for backwards
 * compatibility but ignored.
 */
export function taskColor(taskId: number, _order?: number[]): string {
  const i = Math.trunc(taskId);
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

function nameForTask(taskId: number, tasks: PingTask[]): string {
  const t = tasks.find((x) => x.id === taskId);
  return t?.name || `任务 ${taskId}`;
}

/** Percentile (0..100) of a numeric array using linear interpolation. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  const frac = rank - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

/**
 * Build chart marks from the ping payload. Records whose value is negative
 * (timeout / loss sentinel) are skipped on the line so they don't drag it to
 * zero, but they still count toward the loss ratio in the summary.
 */
export function buildPingMarks(data: PingData): PingMark[] {
  const tasks = data.tasks || [];
  const marks: PingMark[] = [];
  for (const r of data.records || []) {
    if (!isFinite(r.value) || r.value < 0) continue;
    const d = new Date(r.time);
    if (isNaN(d.getTime())) continue;
    marks.push({
      label: d,
      value: r.value,
      category: nameForTask(r.task_id, tasks),
      taskId: r.task_id,
      foregroundStyle: taskColor(r.task_id),
    });
  }
  // Chronological order keeps the line continuous.
  marks.sort((a, b) => a.label.getTime() - b.label.getTime());
  return marks;
}

/** Compute a per-task summary (min / max / avg / loss / last sample). */
export function buildPingSummaries(data: PingData): PingSummary[] {
  const tasks = data.tasks || [];
  const byTask: Record<number, PingRecord[]> = {};
  for (const r of data.records || []) {
    (byTask[r.task_id] ||= []).push(r);
  }

  const taskIds = Object.keys(byTask)
    .map((k) => Number(k))
    .sort((a, b) => a - b);

  return taskIds.map((taskId) => {
    const recs = byTask[taskId]
      .slice()
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const valid = recs.filter((r) => isFinite(r.value) && r.value >= 0);
    const lost = recs.length - valid.length;
    const loss = recs.length > 0 ? lost / recs.length : 0;
    const values = valid.map((r) => r.value);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const avg = values.length
      ? values.reduce((s, v) => s + v, 0) / values.length
      : 0;
    const sortedVals = values.slice().sort((a, b) => a - b);
    const p50 = percentile(sortedVals, 50);
    const p99 = percentile(sortedVals, 99);
    const last = recs.length ? recs[recs.length - 1].value : null;
    return {
      taskId,
      name: nameForTask(taskId, tasks),
      loss,
      min,
      max,
      avg,
      p50,
      p99,
      last: last != null && last >= 0 ? last : null,
      color: taskColor(taskId),
    };
  });
}


/**
 * Map each task NAME to its line colour, matching the summary-row swatch.
 * Feed this to <Chart chartForegroundStyleScale={...}> so the built-in
 * LineCategoryChart colours each line by OUR palette (it otherwise assigns
 * colours by its own category order, which won't match the list swatches).
 */
export function buildPingColorScale(
  summaries: PingSummary[],
): { [name: string]: { color: string } } {
  const scale: { [name: string]: { color: string } } = {};
  for (const s of summaries) {
    scale[s.name] = { color: s.color };
  }
  return scale;
}
