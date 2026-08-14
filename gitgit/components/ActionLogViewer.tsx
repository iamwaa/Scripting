/**
 * components/ActionLogViewer.tsx - Actions 日志富文本查看器
 *
 * 将纯文本日志按行解析，根据日志级别着色显示：
 * - error（error:/Error/failed/FAIL/exception）→ 红色
 * - warning（warning:/warn/WARN）→ 橙色
 * - success（success/passed/PASS ✓）→ 绿色
 * - 其余 → 次要标签色
 *
 * 使用 List 渲染以获得虚拟化性能，支持超长日志。
 * 顶部提供级别筛选与行数统计。
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
  useMemo,
  useState,
  type ShapeStyle,
} from "scripting"
import {
  COLOR_GREEN,
  COLOR_ORANGE,
  COLOR_RED,
  COLOR_SECONDARY_LABEL,
  COLOR_TERTIARY_LABEL,
  COLOR_ACCENT
} from "../constants/colors"

type LogLevel = "error" | "warning" | "success" | "info"

interface LogLine {
  text: string
  level: LogLevel
  index: number
}

const LEVEL_COLOR: Record<LogLevel, ShapeStyle> = {
  error: COLOR_RED,
  warning: COLOR_ORANGE,
  success: COLOR_GREEN,
  info: COLOR_SECONDARY_LABEL,
}

const LEVEL_ICON: Record<LogLevel, string> = {
  error: "xmark.octagon.fill",
  warning: "exclamationmark.triangle.fill",
  success: "checkmark.circle.fill",
  info: "circle.fill",
}

/** 判断单行日志的级别 */
function detectLevel(line: string): LogLevel {
  const lower = line.toLowerCase()
  // 错误：包含 error:/error /failed/fail/exception/panic
  if (
    /\berror\b/.test(lower) ||
    lower.includes("failed") ||
    lower.includes("exception") ||
    lower.includes("panic") ||
    lower.startsWith("error:") ||
    lower.includes("##[error]")
  ) {
    return "error"
  }
  // 警告：包含 warning:/warn
  if (
    lower.includes("warning:") ||
    lower.includes("##[warning]") ||
    lower.includes("warn:")
  ) {
    return "warning"
  }
  // 成功：passed/success/✓
  if (
    lower.includes("passed") ||
    lower.includes("success") ||
    line.includes("✓") ||
    lower.includes("ok")
  ) {
    return "success"
  }
  return "info"
}

/** 将纯文本日志解析为带级别的行数组 */
function parseLogLines(raw: string): LogLine[] {
  const lines = raw.split("\n")
  return lines.map((text, index) => ({
    text,
    level: detectLevel(text),
    index,
  }))
}

type LevelFilter = "all" | LogLevel

export function ActionLogViewer({
  logText,
  jobName,
}: {
  logText: string
  jobName: string
}) {
  const [filter, setFilter] = useState<LevelFilter>("all")

  const allLines = useMemo(() => parseLogLines(logText), [logText])

  const counts = useMemo(() => {
    const c: Record<LogLevel, number> = { error: 0, warning: 0, success: 0, info: 0 }
    for (const line of allLines) c[line.level]++
    return c
  }, [allLines])

  const visibleLines = filter === "all" ? allLines : allLines.filter((l) => l.level === filter)

  const filterLabel = filter === "all" ? "全部" : filter === "error" ? "错误" : filter === "warning" ? "警告" : filter === "success" ? "成功" : "信息"

  return (
    <List
      navigationTitle={jobName}
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      toolbar={{
        topBarTrailing: (
          <Menu title={filterLabel} systemImage="line.3.horizontal.decrease.circle">
            <Button
              title={`全部（${allLines.length}）`}
              systemImage={filter === "all" ? "checkmark" : ""}
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
      <Section
        header={
          <HStack alignment="center">
            <Text>日志（{visibleLines.length} / {allLines.length} 行）</Text>
            <Spacer />
            <Button
              buttonStyle="plain"
              action={() => {
                Pasteboard.setString(visibleLines.map((l) => l.text).join("\n"))
              }}
            >
              <HStack alignment="center" spacing={4}>
                <Image
                  systemName="doc.on.doc"
                  font="caption"
                  foregroundStyle={COLOR_ACCENT}
                />
                <Text font="caption" foregroundStyle={COLOR_ACCENT}>复制</Text>
              </HStack>
            </Button>
          </HStack>
        }
        footer={
          counts.error > 0 ? (
            <Text foregroundStyle={COLOR_RED}>
              ⚠ 包含 {counts.error} 行错误
            </Text>
          ) : counts.warning > 0 ? (
            <Text foregroundStyle={COLOR_ORANGE}>
              包含 {counts.warning} 行警告
            </Text>
          ) : undefined
        }
      >
        {visibleLines.length === 0 ? (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>没有匹配的日志行</Text>
        ) : (
          visibleLines.map((line) => (
            <HStack
              key={line.index}
              alignment="top"
              spacing={6}
              frame={{ maxWidth: "infinity" }}
            >
              <Image
                systemName={LEVEL_ICON[line.level]}
                font={10}
                foregroundStyle={LEVEL_COLOR[line.level]}
                frame={{ width: 14 }}
              />
              <Text
                font={11}
                foregroundStyle={line.level === "info" ? COLOR_TERTIARY_LABEL : LEVEL_COLOR[line.level]}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                {line.text || " "}
              </Text>
            </HStack>
          ))
        )}
      </Section>
    </List>
  )
}

export default ActionLogViewer
