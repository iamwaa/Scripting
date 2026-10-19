// ============================================================================
// Uptime heatmap matrix builder — turns ServiceOverview[] (with per-day up/down
// counts) into HeatMapChart marks: X = day label, Y = service name, value =
// that day's availability %. Pure functions only (no I/O), so they unit-test
// without stubs. S: Single Purpose — uptime-wall data shaping.
// ============================================================================
import type { ServiceOverview } from "./types";

/** One heatmap cell. `value` is availability % (0..100); `noData` flags gaps. */
export type UptimeCell = {
  /** X label (day), e.g. "D-29" … "D0". Stable, ordered oldest→newest. */
  x: string;
  /** Y label (service name). */
  y: string;
  /** Availability percentage 0..100 (0 when noData). */
  value: number;
  /** Up / down check counts for that day (for the annotation). */
  up: number;
  down: number;
  /** Day offset from today (0 = today, 29 = 29 days ago). */
  dayOffset: number;
  /** True when no checks were recorded that day → render as gray. */
  noData: boolean;
};

/** Number of days the Nezha service arrays cover. */
export const UPTIME_DAYS = 30;

/** Semantic color for a daily availability %, or gray when there's no data. */
export function uptimeCellTint(value: number, noData: boolean): string {
  if (noData) return "systemGray5";
  if (value >= 99.5) return "systemGreen";
  if (value >= 95) return "systemYellow";
  if (value >= 80) return "systemOrange";
  return "systemRed";
}

/** Stable X-axis label for a day offset (0 = today). Oldest→newest order. */
export function dayLabel(dayOffset: number): string {
  return dayOffset === 0 ? "今天" : `D-${dayOffset}`;
}

/** Ordered list of day labels, oldest (left) → today (right). */
export function dayDomain(days: number = UPTIME_DAYS): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayLabel(i));
  return out;
}

/**
 * Build heatmap cells for every service × day. The Nezha up/down arrays are
 * ordered oldest→newest with the LAST element = today. Missing / zero-check
 * days become `noData` (gray) instead of a misleading 0% or 100%.
 *
 * Services with no per-day data at all are skipped (nothing to show on a wall).
 */
export function buildUptimeMatrix(
  services: ServiceOverview[],
  days: number = UPTIME_DAYS,
): UptimeCell[] {
  const cells: UptimeCell[] = [];
  for (const s of services) {
    const up = s.dailyUp || [];
    const down = s.dailyDown || [];
    const len = Math.max(up.length, down.length);
    if (len === 0) continue; // no daily history → omit from the wall
    // Align arrays to the right (newest at the end), then take the last `days`.
    for (let d = days - 1; d >= 0; d--) {
      // d = 0 is today → newest array element (index len-1).
      const idx = len - 1 - d;
      const u = idx >= 0 ? up[idx] || 0 : 0;
      const dn = idx >= 0 ? down[idx] || 0 : 0;
      const total = u + dn;
      const noData = idx < 0 || total === 0;
      cells.push({
        x: dayLabel(d),
        y: s.name,
        value: noData ? 0 : (u / total) * 100,
        up: u,
        down: dn,
        dayOffset: d,
        noData,
      });
    }
  }
  return cells;
}

/** Y-axis service order (alphabetical, stable) for cells present in the matrix. */
export function serviceDomain(cells: UptimeCell[]): string[] {
  const seen: string[] = [];
  for (const c of cells) if (!seen.includes(c.y)) seen.push(c.y);
  return seen.sort((a, b) => a.localeCompare(b));
}

/** Overall availability % across all non-gap cells of a service. */
export function rowUptime(cells: UptimeCell[], service: string): number {
  let u = 0;
  let t = 0;
  for (const c of cells) {
    if (c.y !== service || c.noData) continue;
    u += c.up;
    t += c.up + c.down;
  }
  return t > 0 ? (u / t) * 100 : 0;
}
