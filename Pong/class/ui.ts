// ============================================================================
// UI adaptation helpers. S: Single Purpose — device-aware presentation values.
// Keeps iPad/iPhone branching in one place instead of scattered conditionals.
// ============================================================================
import { Device } from "scripting";

/**
 * Detents for a content sheet. iPhone keeps the draggable medium→large feel;
 * iPad presents a single comfortably-sized form sheet (medium detents render
 * awkwardly small on the larger centered presentation).
 */
export function contentDetents(): string[] {
  return Device.isiPad ? ["large"] : ["medium", "large"];
}

/** Max width for the floating control bar so it doesn't stretch on iPad. */
export function barMaxWidth(): number | undefined {
  return Device.isiPad ? 540 : undefined;
}

/** Latency chart height — a little taller on iPad's roomier sheets. */
export function chartHeight(): number {
  return Device.isiPad ? 260 : 200;
}
