import { VStack, HStack, ZStack, Text, Spacer, Circle, Capsule, GeometryReader, VirtualNode, gradient } from "scripting";
import { RISK_BREAKPOINTS, buildRiskGradientStops, locateRisk } from "../utils/riskScale";

interface RiskColorBarProps {
  /** 风险分数 0–100，无数据传 null */
  value: number | null;
  /** 是否显示底部刻度数字，小尺寸组件建议关闭 */
  showScale?: boolean;
  /** 色带高度 */
  barHeight?: number;
  /** 紧凑模式：气泡只显示百分比，不带等级文案 */
  compact?: boolean;
}

// 气泡内边距：宽高 = 文字尺寸 + 4（四周各 2），字号固定 8
const BUBBLE_PADDING = 2;
// 气泡行的容器高度；GeometryReader 必须由定高容器包住
const BUBBLE_ROW_HEIGHT = 15;

// 估算 8 号字的文本宽度；仅用于两端防溢出的夹取，气泡实际宽度仍由文字自适应
function estimateLabelWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 0x2e80) width += 8; // 中日韩字符与字号等宽
    else if (char === "%") width += 7;
    else if (char === " ") width += 2.5;
    else width += 5;
  }
  return width;
}

// IPPure 风格的风险色度条：渐变色带 + 圆点指针 + 数值气泡。
// GeometryReader 会占满父级剩余高度且自身 frame 无效，必须用固定高度的 ZStack 包住。
export function RiskColorBar({ value, showScale = true, barHeight = 7, compact = false }: RiskColorBarProps): VirtualNode {
  const hasValue = typeof value === "number";
  const position = hasValue ? locateRisk(value) : null;
  const label = compact ? `${value}%` : `${value}% ${position?.label ?? ""}`;
  const halfBubble = estimateLabelWidth(label) / 2 + BUBBLE_PADDING;
  const dotSize = barHeight + 5;

  return (
    <VStack spacing={4} alignment="leading" frame={{ maxWidth: "infinity" }}>
      {position ? (
        <ZStack alignment="leading" frame={{ maxWidth: "infinity", height: BUBBLE_ROW_HEIGHT }}>
          <GeometryReader>
            {(proxy) => {
              // position 把气泡中心直接放到分值处，不需要知道实际宽度；两端按估值收拢避免溢出
              const width = proxy.size.width;
              const centerX = Math.min(
                Math.max(width * position.ratio, halfBubble),
                Math.max(width - halfBubble, halfBubble)
              );
              return (
                <Text
                  font={8}
                  bold
                  foregroundStyle="#FFFFFF"
                  lineLimit={1}
                  fixedSize={true}
                  padding={BUBBLE_PADDING}
                  background={position.color}
                  clipShape={{ type: "rect", cornerRadius: 3.5 }}
                  position={{ x: centerX, y: BUBBLE_ROW_HEIGHT / 2 }}
                >
                  {label}
                </Text>
              );
            }}
          </GeometryReader>
        </ZStack>
      ) : null}

      {/* 渐变色带 + 圆点指针，圆点需要垂直居中于色带故一并放进同一 ZStack */}
      <ZStack alignment="leading" frame={{ maxWidth: "infinity", height: dotSize }}>
        <GeometryReader>
          {(proxy) => {
            const width = proxy.size.width;
            const dotLeft = Math.min(Math.max(width * (position?.ratio ?? 0) - dotSize / 2, 0), Math.max(width - dotSize, 0));
            return (
              <ZStack alignment="leading" frame={{ width, height: dotSize }}>
                <Capsule
                  fill={gradient("linear", {
                    stops: buildRiskGradientStops(),
                    startPoint: "leading",
                    endPoint: "trailing",
                  })}
                  frame={{ width, height: barHeight }}
                  opacity={hasValue ? 1 : 0.35}
                />
                {position ? (
                  <Circle
                    fill="#FFFFFF"
                    frame={{ width: dotSize, height: dotSize }}
                    shadow={{ color: "rgba(0,0,0,0.35)", radius: 1.5, y: 0.5 }}
                    overlay={{
                      content: <Circle fill={position.color} frame={{ width: dotSize - 4, height: dotSize - 4 }} />,
                      alignment: "center",
                    }}
                    offset={{ x: dotLeft, y: 0 }}
                  />
                ) : null}
              </ZStack>
            );
          }}
        </GeometryReader>
      </ZStack>

      {showScale ? (
        <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
          {RISK_BREAKPOINTS.map((point, index) => (
            <>
              {index > 0 ? <Spacer /> : null}
              <Text font={7} foregroundStyle="secondaryLabel">{point}</Text>
            </>
          ))}
        </HStack>
      ) : null}
    </VStack>
  );
}
