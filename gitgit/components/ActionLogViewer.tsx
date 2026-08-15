/**
 * components/ActionLogViewer.tsx - Actions 日志富文本查看器
 *
 * 布局：上方步骤筛选器，下方显示选中步骤的日志内容。
 * 无日志的步骤不显示。点击步骤切换查看对应日志段落。
 *
 * 每行只渲染「行号 + 内容」：时间戳前缀与 ##[xxx] 标记在解析阶段剥离，
 * 不显示级别标识符，级别信息通过行号与内容的颜色表达。
 *
 * 日志行按级别着色（行号与内容同色），级别判定统一由 utils/actionsLog 的
 * detectLogLevel 提供，与步骤徒的错误/警告计数同源：
 * - error → 红色，warning → 橙色，success → 绿色
 * - 其余 → 次要标签色（行号更淡）
 *
 * 使用 List 渲染以获得虚拟化性能，支持超长日志。
 */

import {
  Button,
  HStack,
  Image,
  List,
  Menu,
  Section,
  Spacer,
  Text,
  VStack,
  useMemo,
  useState,
  type ShapeStyle,
} from "scripting"
import type { ActionStep } from "../types/github"
import {
  COLOR_GREEN,
  COLOR_ORANGE,
  COLOR_RED,
  COLOR_LABEL,
  COLOR_SECONDARY_LABEL,
  COLOR_TERTIARY_LABEL,
  COLOR_ACCENT
} from "../constants/colors"
import { toastContent } from "./Toast"
import { useToast } from "../hooks/useToast"
import {
  parseStepSegments,
  getSegmentRawLines,
  parseLogLine,
  buildStepOptions,
  detectLogLevel,
  type LogLevel,
  type LogSegment,
  type StepOption,
} from "../utils/actionsLog"

interface LogLine {
  /** 纯内容（已去除时间戳和 ##[xxx] 标记） */
  content: string
  level: LogLevel
  /** 行号（1-based，从选定段落内起始计数） */
  lineNumber: number
}

const LEVEL_COLOR: Record<LogLevel, ShapeStyle> = {
  error: COLOR_RED,
  warning: COLOR_ORANGE,
  success: COLOR_GREEN,
  info: COLOR_SECONDARY_LABEL,
}

/** 将原始日志行解析为带级别和行号的数组（时间戳与标记已剥离） */
function parseLogLines(rawLines: string[]): LogLine[] {
  const lines: LogLine[] = []
  for (const raw of rawLines) {
    const parsed = parseLogLine(raw)
    if (parsed.content.length === 0) continue
    // 行号按剥离后保留的行重新连续编号，避免出现跳号
    lines.push({
      content: parsed.content,
      level: detectLogLevel(raw, parsed.content),
      lineNumber: lines.length + 1,
    })
  }
  return lines
}

type LevelFilter = "all" | LogLevel

export function ActionLogViewer({
  logText,
  jobName,
  steps,
  initialStepNumber,
}: {
  logText: string
  jobName: string
  steps?: ActionStep[]
  initialStepNumber?: number
}) {
  const [filter, setFilter] = useState<LevelFilter>("all")
  // null = 全部日志；数字 = 对应步骤
  const [selectedStep, setSelectedStep] = useState<number | null>(
    initialStepNumber ?? null
  )
  const { toastState, showToast, handleToastChanged, toastPresented } = useToast()

  // 解析日志分段
  const segments: LogSegment[] | null = useMemo(
    () => (steps && steps.length > 0 ? parseStepSegments(logText, steps) : null),
    [logText, steps]
  )

  // 构建步骤选项
  const allStepOptions: StepOption[] | null = useMemo(() => {
    if (!steps || steps.length === 0) return null
    if (segments) {
      return buildStepOptions(segments, steps, logText)
    }
    return buildStepOptions([], steps, logText)
  }, [segments, steps, logText])

  // 过滤：无日志的步骤不显示
  const stepOptions: StepOption[] | null = useMemo(() => {
    if (!allStepOptions) return null
    const filtered = allStepOptions.filter((opt) => opt.lineCount > 0)
    return filtered.length > 1 ? filtered : allStepOptions
  }, [allStepOptions])

  // 当前显示的原始日志行（含时间戳前缀）
  const displayRawLines = useMemo(() => {
    if (segments && selectedStep !== null) {
      return getSegmentRawLines(segments, selectedStep)
    }
    if (segments) {
      return getSegmentRawLines(segments, null)
    }
    return logText.split("\n")
  }, [logText, segments, selectedStep])

  const allLines = useMemo(() => parseLogLines(displayRawLines), [displayRawLines])

  const counts = useMemo(() => {
    const c: Record<LogLevel, number> = { error: 0, warning: 0, success: 0, info: 0 }
    for (const line of allLines) c[line.level]++
    return c
  }, [allLines])

  const visibleLines = filter === "all" ? allLines : allLines.filter((l) => l.level === filter)

  const filterLabel = filter === "all" ? "全部" : filter === "error" ? "错误" : filter === "warning" ? "警告" : filter === "success" ? "成功" : "信息"

  // 当前选中步骤的标签
  const currentStepLabel = useMemo(() => {
    if (selectedStep === null) return "全部日志"
    const opt = stepOptions?.find((o) => o.stepNumber === selectedStep)
    return opt?.label || "步骤"
  }, [selectedStep, stepOptions])

  return (
    <List
      navigationTitle={jobName}
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      toast={
        toastState
          ? {
              isPresented: toastPresented,
              onChanged: handleToastChanged,
              content: toastContent(toastState.message, toastState.type),
              duration: toastState.duration,
              position: "top",
            }
          : undefined
      }
      toolbar={{
        topBarTrailing: (
          <Menu title={filterLabel} systemImage="line.3.horizontal.decrease.circle">
            <Button
              title={`全部（${allLines.length}）`}
              systemImage={filter === "all" ? "checkmark" : "list.bullet"}
              action={() => setFilter("all")}
            />
            {counts.error > 0 ? (
              <Button
                title={`错误（${counts.error}）`}
                systemImage={filter === "error" ? "checkmark" : "xmark.octagon.fill"}
                action={() => setFilter("error")}
              />
            ) : null}
            {counts.warning > 0 ? (
              <Button
                title={`警告（${counts.warning}）`}
                systemImage={filter === "warning" ? "checkmark" : "exclamationmark.triangle.fill"}
                action={() => setFilter("warning")}
              />
            ) : null}
            {counts.success > 0 ? (
              <Button
                title={`成功（${counts.success}）`}
                systemImage={filter === "success" ? "checkmark" : "checkmark.circle.fill"}
                action={() => setFilter("success")}
              />
            ) : null}
            {counts.info > 0 ? (
              <Button
                title={`信息（${counts.info}）`}
                systemImage={filter === "info" ? "checkmark" : "circle.fill"}
                action={() => setFilter("info")}
              />
            ) : null}
          </Menu>
        ),
      }}
    >
      {/* 上方：步骤筛选器 */}
      {stepOptions && stepOptions.length > 1 ? (
        <Section header={<Text>步骤</Text>}>
          {stepOptions.map((opt) => {
            const isSelected = selectedStep === opt.stepNumber
            return (
              <Button
                key={`step-${opt.stepNumber ?? "all"}`}
                action={() => setSelectedStep(opt.stepNumber)}
                buttonStyle="plain"
              >
                <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
                  <Image
                    systemName={opt.icon}
                    font={14}
                    foregroundStyle={opt.color as ShapeStyle}
                  />
                  <Text
                    font={13}
                    foregroundStyle={isSelected ? COLOR_ACCENT : COLOR_LABEL}
                    lineLimit={1}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                  >
                    {opt.label}
                  </Text>
                  {/* 错误/警告徽标 */}
                  {opt.errors > 0 ? (
                    <HStack alignment="center" spacing={2}>
                      <Image systemName="xmark.octagon.fill" font={10} foregroundStyle={COLOR_RED} />
                      <Text font={11} foregroundStyle={COLOR_RED}>{opt.errors}</Text>
                    </HStack>
                  ) : null}
                  {opt.warnings > 0 ? (
                    <HStack alignment="center" spacing={2}>
                      <Image systemName="exclamationmark.triangle.fill" font={10} foregroundStyle={COLOR_ORANGE} />
                      <Text font={11} foregroundStyle={COLOR_ORANGE}>{opt.warnings}</Text>
                    </HStack>
                  ) : null}
                  {/* 耗时 */}
                  {opt.duration ? (
                    <Text font={11} foregroundStyle={COLOR_TERTIARY_LABEL}>{opt.duration}</Text>
                  ) : null}
                  {isSelected ? (
                    <Image systemName="checkmark" font={12} foregroundStyle={COLOR_ACCENT} />
                  ) : null}
                </HStack>
              </Button>
            )
          })}
        </Section>
      ) : null}

      {/* 下方：日志内容 */}
      <Section
        header={
          <HStack alignment="center">
            <VStack alignment="leading" spacing={2}>
              <Text>{currentStepLabel}</Text>
              <Text font={11} foregroundStyle={COLOR_TERTIARY_LABEL}>
                {visibleLines.length} / {allLines.length} 行
              </Text>
            </VStack>
            <Spacer />
            <Button
              buttonStyle="plain"
              action={() => {
                Pasteboard.setString(visibleLines.map((l) => l.content).join("\n"))
                showToast("已复制日志", "success")
              }}
            >
              <HStack alignment="center" spacing={4}>
                <Image systemName="doc.on.doc" font={11} foregroundStyle={COLOR_ACCENT} />
                <Text font={11} foregroundStyle={COLOR_ACCENT}>复制</Text>
              </HStack>
            </Button>
          </HStack>
        }
        footer={
          counts.error > 0 ? (
            <Text foregroundStyle={COLOR_RED}>⚠ 包含 {counts.error} 行错误</Text>
          ) : counts.warning > 0 ? (
            <Text foregroundStyle={COLOR_ORANGE}>包含 {counts.warning} 行警告</Text>
          ) : undefined
        }
      >
        {visibleLines.length === 0 ? (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>没有匹配的日志行</Text>
        ) : (
          <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
            {visibleLines.map((line) => (
              <HStack key={line.lineNumber} alignment="top" spacing={6} frame={{ maxWidth: "infinity" }}>
                {/* 行号：与内容同级别着色，info 行保持最淡 */}
                <Text
                  font={10}
                  foregroundStyle={line.level === "info" ? COLOR_TERTIARY_LABEL : LEVEL_COLOR[line.level]}
                  frame={{ width: 28, alignment: "trailing" }}
                >
                  {line.lineNumber}
                </Text>
                {/* 内容 */}
                <Text
                  font={11}
                  foregroundStyle={line.level === "info" ? COLOR_TERTIARY_LABEL : LEVEL_COLOR[line.level]}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  {line.content || " "}
                </Text>
              </HStack>
            ))}
          </VStack>
        )}
      </Section>
    </List>
  )
}

export default ActionLogViewer
