// 玻璃样式统一封装：填充、色调、阴影与 glassEffect 组合

import { HStack, Image, RoundedRectangle, Text } from "scripting";

import { BLUE, GLASS_FILL, GLASS_STROKE, GLASS_TINT, INPUT_GLASS_FILL } from "../constants";
import type { GlassVariant } from "../types";

function glassFillFor(variant: GlassVariant = "card") {
  if (variant === "input") return INPUT_GLASS_FILL;
  if (variant === "prominent") return "rgba(10,132,255,0.68)";
  if (variant === "icon") return { light: "rgba(10,132,255,0.10)", dark: "rgba(10,132,255,0.18)" };
  return GLASS_FILL;
}

function glassTintFor(variant: GlassVariant = "card") {
  if (variant === "prominent" || variant === "icon") return "rgba(110,198,255,0.32)";
  return GLASS_TINT;
}

function glassShadowFor(variant: GlassVariant = "card") {
  if (variant === "prominent") return { color: "rgba(10,132,255,0.24)", radius: 12, x: 0, y: 6 };
  if (variant === "input") return { color: "rgba(30,88,160,0.08)", radius: 8, x: 0, y: 4 };
  if (variant === "control") return { color: "rgba(30,88,160,0.10)", radius: 12, x: 0, y: 6 };
  return { color: "rgba(30,88,160,0.10)", radius: 14, x: 0, y: 7 };
}

function glassEffectFor(cornerRadius: number, variant: GlassVariant = "card", interactive = true) {
  const glass = interactive
    ? UIGlass.clear().interactive().tint(glassTintFor(variant))
    : UIGlass.clear().interactive(false).tint(glassTintFor(variant));
  return { glass, shape: { type: "rect", cornerRadius } };
}

export function GlassShape({ cornerRadius = 28, fill = GLASS_FILL }: { cornerRadius?: number; fill?: any }) {
  return <RoundedRectangle cornerRadius={cornerRadius} fill={fill as any} stroke={GLASS_STROKE as any} />;
}

/** 返回可展开到视图上的玻璃表面属性 */
export function glassSurface(cornerRadius = 28, variant: GlassVariant = "card", interactive = true, withShadow = true): any {
  const props: any = {
    background: <GlassShape cornerRadius={cornerRadius} fill={glassFillFor(variant)} />,
    glassEffect: glassEffectFor(cornerRadius, variant, interactive),
  };
  if (withShadow) props.shadow = glassShadowFor(variant) as any;
  return props;
}

/** 无玻璃表面时用于清除已有背景属性 */
export const plainSurface = { background: undefined, glassEffect: undefined, shadow: undefined };

export function GlassButtonContent({
  systemName,
  title,
  prominent = false,
}: {
  systemName: string;
  title: string;
  prominent?: boolean;
}) {
  return (
    <HStack
      spacing={8}
      frame={{ maxWidth: "infinity" }}
      padding={{ vertical: 13, horizontal: 14 }}
      {...glassSurface(18, prominent ? "prominent" : "control")}
    >
      <Image systemName={systemName} frame={{ width: 20, height: 20 }} foregroundStyle={prominent ? "white" : BLUE} />
      <Text font={16} fontWeight="semibold" foregroundStyle={prominent ? "white" : "label"}>
        {title}
      </Text>
    </HStack>
  );
}
