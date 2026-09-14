import { Color } from "scripting";

// 与 IPPure 官网 ColorMap 组件保持一致的风险分段定义。
// 断点、配色、文案均取自其前端实现，改动前请先核对线上版本。
export const RISK_BREAKPOINTS = [0, 15, 25, 40, 50, 70, 100];

export interface RiskSegment {
  start: number;
  end: number;
  color: Color;
  label: string;
}

export const RISK_SEGMENTS: RiskSegment[] = [
  { start: 0, end: 15, color: "#166534", label: "极度纯净" },
  { start: 15, end: 25, color: "#22c55e", label: "纯净" },
  { start: 25, end: 40, color: "#84cc16", label: "中性" },
  { start: 40, end: 50, color: "#eab308", label: "轻度风险" },
  { start: 50, end: 70, color: "#f97316", label: "中度风险" },
  { start: 70, end: 100, color: "#dc2626", label: "极度风险" },
];

export interface RiskScalePosition {
  index: number;
  label: string;
  color: Color;
  /** 指针在整条色度条上的位置，取值 0–1 */
  ratio: number;
}

// 渐变色带的色标：每段在条上等宽，取段中点作为该色的锚点，
// 使相邻颜色在段边界处自然过渡而不出现硬分割。
export function buildRiskGradientStops(): { color: Color; location: number }[] {
  const count = RISK_SEGMENTS.length;
  const stops: { color: Color; location: number }[] = [];

  stops.push({ color: RISK_SEGMENTS[0].color, location: 0 });
  for (let i = 0; i < count; i++) {
    stops.push({ color: RISK_SEGMENTS[i].color, location: (i + 0.5) / count });
  }
  stops.push({ color: RISK_SEGMENTS[count - 1].color, location: 1 });

  return stops;
}
// 每段在色度条上等宽（各占 1/6），段内再按数值比例插值，与官网算法一致。
export function locateRisk(value: number): RiskScalePosition {
  const count = RISK_SEGMENTS.length;
  const clamped = Math.min(100, Math.max(0, value));
  let ratio = 0;

  for (let i = 0; i < count; i++) {
    const segment = RISK_SEGMENTS[i];
    if (segment.end >= clamped) {
      ratio += (clamped - segment.start) / (segment.end - segment.start) / count;
      return { index: i, label: segment.label, color: segment.color, ratio };
    }
    ratio += 1 / count;
  }

  const last = count - 1;
  return { index: last, label: RISK_SEGMENTS[last].label, color: RISK_SEGMENTS[last].color, ratio: 1 };
}
