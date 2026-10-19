// ============================================================================
// Pure formatting helpers. S: Single Purpose — only data → string transforms.
// No side effects, fully deterministic, trivially replaceable. (R)
// ============================================================================

/** Convert a byte count to a human readable string, e.g. 1536 -> "1.50 KB". */
export function formatBytes(bytes: number, fractionDigits = 2): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : fractionDigits)} ${units[i]}`;
}

/** Bytes-per-second -> "x.xx MB/s". */
export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

/** Seconds -> "12d 3h 5m" style uptime. */
export function formatUptime(seconds: number): string {
  if (!seconds || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}天`);
  if (h) parts.push(`${h}时`);
  if (m || parts.length === 0) parts.push(`${m}分`);
  return parts.join(" ");
}

/** Ratio (0..1) -> "42.5%". Guards against NaN / divide-by-zero. */
export function formatPercent(used: number, total: number): string {
  if (!total || total <= 0) return "0%";
  return `${((used / total) * 100).toFixed(1)}%`;
}

/** Ratio used for Gauge values, clamped to [0, 1]. */
export function ratio(used: number, total: number): number {
  if (!total || total <= 0) return 0;
  const r = used / total;
  if (r < 0) return 0;
  if (r > 1) return 1;
  return r;
}

/** CPU usage (already a percent 0..100) -> clamped ratio for a Gauge. */
export function percentToRatio(percent: number): number {
  if (!percent || percent < 0) return 0;
  if (percent > 100) return 1;
  return percent / 100;
}

/** Format an ISO timestamp into a short local time, e.g. "14:05:31". */
export function formatClock(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

/** Format a price + billing cycle into a human label. */
export function formatPrice(price: number, billingCycle: number): string {
  if (!price || price <= 0) return "免费";
  const cycle =
    billingCycle >= 365
      ? "/年"
      : billingCycle >= 30
        ? "/月"
        : billingCycle > 0
          ? `/${billingCycle}天`
          : "";
  return `$${price.toFixed(2)}${cycle}`;
}

/** Days until the given expiry date (ISO); negative means expired. */
export function daysUntil(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

/** Pick a SwiftUI system color based on a usage ratio (0..1). */
export function loadTint(r: number): string {
  if (r >= 0.9) return "systemRed";
  if (r >= 0.7) return "systemOrange";
  if (r >= 0.4) return "systemYellow";
  return "systemGreen";
}
