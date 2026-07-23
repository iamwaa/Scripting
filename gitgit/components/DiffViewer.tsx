/**
 * components/DiffViewer.tsx - 行级 diff 渲染组件
 *
 * +/- 行着色，适配暗黑模式。
 * 用 HStack 展示行号 + 内容，等宽字体显示代码。
 */

import { VStack, HStack, Text, useColorScheme } from "scripting"
import type { DiffLine, FileDiff } from "../services/diffService"
import type { Color, ShapeStyle } from "scripting"

/** 新增/删除/折叠行的颜色（按明暗模式区分，低饱和保证可读） */
interface DiffColors {
  addBg: ShapeStyle
  delBg: ShapeStyle
  skipBg: ShapeStyle
  skipFg: Color
  addFg: Color
  delFg: Color
  gutter: ShapeStyle
  lineNoFg: Color
  codeFg: Color
}

function useDiffColors(): DiffColors {
  const scheme = useColorScheme()
  const isDark = scheme === "dark"
  return {
    addBg: (isDark ? "rgba(40, 80, 45, 0.45)" : "rgba(200, 245, 200, 1)") as ShapeStyle,
    delBg: (isDark ? "rgba(90, 45, 45, 0.45)" : "rgba(255, 220, 220, 1)") as ShapeStyle,
    // 折叠条：与代码行区分的浅灰带，明暗都有可见对比
    skipBg: (isDark
      ? "rgba(120, 130, 150, 0.28)"
      : "rgba(120, 130, 150, 0.14)") as ShapeStyle,
    skipFg: (isDark ? "#a8b0c0" : "#5c6570") as Color,
    addFg: (isDark ? "#7ee787" : "#1a7f37") as Color,
    delFg: (isDark ? "#ffa198" : "#cf222e") as Color,
    gutter: (isDark ? "rgba(120,120,120,0.25)" : "rgba(180,180,180,0.25)") as ShapeStyle,
    lineNoFg: "secondaryLabel" as Color,
    codeFg: "label" as Color,
  }
}

/** 折叠未改动区：整行居中文案，明显区别于普通上下文 */
function DiffSkipLineView({ colors }: { colors: DiffColors }) {
  return (
    <HStack
      spacing={6}
      alignment="center"
      background={colors.skipBg}
      frame={{ maxWidth: Infinity, minHeight: 28, alignment: "center" }}
      padding={{ leading: 10, trailing: 10, top: 6, bottom: 6 }}
    >
      <Text font="caption2" foregroundStyle={colors.skipFg}>
        ⋯
      </Text>
      <Text
        font="caption"
        foregroundStyle={colors.skipFg}
        frame={{ maxWidth: Infinity, alignment: "center" }}
      >
        省略未改动的行
      </Text>
      <Text font="caption2" foregroundStyle={colors.skipFg}>
        ⋯
      </Text>
    </HStack>
  )
}

/** 渲染单行 diff */
function DiffLineView({
  line,
  colors,
}: {
  line: DiffLine
  colors: DiffColors
}) {
  if (line.type === "skip") {
    return <DiffSkipLineView colors={colors} />
  }

  const isAdd = line.type === "add"
  const isDel = line.type === "del"
  const sign = isAdd ? "+" : isDel ? "-" : " "
  const bg = isAdd ? colors.addBg : isDel ? colors.delBg : undefined
  const fg = isAdd ? colors.addFg : isDel ? colors.delFg : colors.codeFg

  return (
    <HStack
      spacing={0}
      alignment="top"
      background={bg}
      frame={{ maxWidth: Infinity, alignment: "leading" }}
    >
      {/* 旧行号 gutter */}
      <Text
        font="caption2"
        foregroundStyle={colors.lineNoFg}
        frame={{ width: 28, alignment: "trailing" }}
        padding={{ leading: 2, trailing: 2, top: 2, bottom: 2 }}
      >
        {line.oldLineNo ? String(line.oldLineNo) : " "}
      </Text>
      {/* 新行号 gutter */}
      <Text
        font="caption2"
        foregroundStyle={colors.lineNoFg}
        frame={{ width: 28, alignment: "trailing" }}
        padding={{ leading: 2, trailing: 4, top: 2, bottom: 2 }}
      >
        {line.newLineNo ? String(line.newLineNo) : " "}
      </Text>
      {/* +/- 标记 */}
      <Text
        font="caption"
        foregroundStyle={fg}
        frame={{ width: 14, alignment: "center" }}
        padding={{ top: 2, bottom: 2 }}
      >
        {sign}
      </Text>
      {/* 行内容（等宽，允许换行避免顶栏/行被挤乱） */}
      <Text
        font={{ name: "Menlo", size: 11 }}
        foregroundStyle={fg}
        frame={{ maxWidth: Infinity, alignment: "leading" }}
        padding={{ trailing: 6, top: 2, bottom: 2 }}
      >
        {line.content || " "}
      </Text>
    </HStack>
  )
}

/** 渲染整个文件的 diff */
export function DiffViewer({ diff }: { diff: FileDiff }) {
  const colors = useDiffColors()

  if (diff.binary) {
    return (
      <Text font="callout" foregroundStyle={colors.lineNoFg}>
        二进制文件，无法显示行级差异
      </Text>
    )
  }

  if (diff.lines.length === 0) {
    return (
      <Text font="callout" foregroundStyle={colors.lineNoFg}>
        无差异
      </Text>
    )
  }

  // 外层不再套 ScrollView，由 DiffPage 的 List 负责滚动，避免顶部留白
  return (
    <VStack spacing={0} alignment="leading" frame={{ maxWidth: Infinity }}>
      {diff.lines.map((line, idx) => (
        <DiffLineView key={idx} line={line} colors={colors} />
      ))}
    </VStack>
  )
}
