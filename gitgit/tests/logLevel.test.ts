/**
 * 轻量探针：日志行级别判定（detectLogLevel）
 *
 * 用例覆盖三类：
 * - 硬信号：Runner 注解标记（##[error]/##[warning]）与 ANSI 前景色，网页版就靠这两样
 * - 关键字启发：编译器诊断、退出码、TAP
 * - 只是「提到」关键字的行（-Werror、error.log、src/error/x.m、0 errors、unsuccessful）
 *   这些必须保持 info，是本次修正的重点
 * 另外验证 ANSI 序列在展示内容里被完全剥离。
 */
import { Script } from "scripting"
import { detectLogLevel, countSegmentLevels, parseLogLine, type LogLevel } from "../utils/actionsLog"

const ESC = "\x1b"

const cases: Array<[string, LogLevel]> = [
  // Runner 注解标记
  ["2026-08-15T07:00:00.0000000Z ##[error]Process completed with exit code 1.", "error"],
  ["##[warning]Node.js 16 actions are deprecated", "warning"],
  // 退出码
  ["Process completed with exit code 65.", "error"],
  ["Process completed with exit code 0.", "success"],
  // 编译器 / 构建工具
  ["/Users/runner/work/DYYY/Waa.xm:12:9: error: use of undeclared identifier 'foo'", "error"],
  ["1 error generated.", "error"],
  ["** BUILD FAILED **", "error"],
  ["** BUILD SUCCEEDED **", "success"],
  ["error MSB3073: the command exited with code 1", "error"],
  ["Waa.xm:88:5: warning: unused variable 'tmp'", "warning"],
  ["3 warnings generated.", "warning"],
  // 运行时失败
  ["fatal: not a git repository", "error"],
  ["The process '/usr/bin/xcodebuild' failed with exit code 65", "error"],
  ["Traceback (most recent call last):", "error"],
  ["Unhandled exception. System.IO.IOException: disk full", "error"],
  // 测试框架
  ["not ok 3 - parses config", "error"],
  ["ok 1 - loads config", "success"],
  ["All tests passed", "success"],
  ["✓ 12 tests completed", "success"],
  // 仅提及关键字，必须是 info
  ["Run make package SCHEME=rootful FINALPACKAGE=1 -j$(sysctl -n hw.ncpu)", "info"],
  ["clang -Werror -Wall -c Waa.xm", "info"],
  ["Compiling src/error/Handler.m", "info"],
  ["make package 2> error.log", "info"],
  ["0 errors, 0 warnings", "info"],
  ["Note: unsuccessful attempt, retrying", "info"],
  ["Bypassed cache restore", "info"],
  ["Please look at the workflow docs", "info"],
  ["with:\n  token: ***", "info"],
  // Actions 系统行
  ["##[group]Run actions/checkout@v6", "info"],
  ["Download action repository 'actions/upload-artifact@v7' (SHA:043fb46)", "info"],
  ["Complete job name: build", "info"],
  ["GITHUB_TOKEN Permissions", "info"],
  ["Secret source: Actions", "info"],
  ["[command]/usr/bin/git version", "info"],
  ["Cleaning up orphan processes", "info"],
  ["==> Preprocessing Waa.xm", "info"],
  ["Artifact upload complete", "info"],
  // ANSI 颜色（网页版的主要上色依据）
  [`${ESC}[31mCompilation aborted at line 3${ESC}[0m`, "error"],
  [`${ESC}[0;33mSkipping cache restore${ESC}[0m`, "warning"],
  [`${ESC}[32mAll good${ESC}[0m`, "success"],
  [`${ESC}[36;1m==> Preprocessing Waa.xm${ESC}[0m`, "info"],
  // 标记优先于颜色
  [`${ESC}[32m##[error]still an error${ESC}[0m`, "error"],
  ["", "info"],
]

/** ANSI 序列必须在展示前剥离，不能出现在内容里 */
const ansiDisplayCases = [
  [`${ESC}[36;1m==> Linking tweak DYYY${ESC}[0m`, "==> Linking tweak DYYY"],
  [`2026-08-15T07:00:00.0000000Z ${ESC}[31m${ESC}[1merror: build failed${ESC}[0m`, "error: build failed"],
  [`${ESC}[2K${ESC}[1G$ npm ci`, "$ npm ci"],
]

async function main() {
  const failures: string[] = []
  for (const [line, expected] of cases) {
    const actual = detectLogLevel(line)
    if (actual !== expected) {
      failures.push(`期望 ${expected} 实际 ${actual}: ${JSON.stringify(line)}`)
    }
  }

  // 统计与逐行着色必须同源
  const text = ["##[error]boom", "warning: slow", "All tests passed", "plain line"].join("\n")
  const counts = countSegmentLevels(text)
  if (counts.errors !== 1 || counts.warnings !== 1) {
    failures.push(`countSegmentLevels 与 detectLogLevel 不一致: ${JSON.stringify(counts)}`)
  }

  for (const [raw, expected] of ansiDisplayCases) {
    const actual = parseLogLine(raw).content
    if (actual !== expected) {
      failures.push(`ANSI 剥离失败，期望 ${JSON.stringify(expected)} 实际 ${JSON.stringify(actual)}`)
    }
  }

  if (failures.length > 0) {
    console.error(`logLevel.test 失败 ${failures.length} 项：`)
    for (const f of failures) console.error("  - " + f)
    throw new Error("logLevel.test 未通过")
  }
  console.log(`logLevel.test 全部通过（${cases.length} 例）`)
  Script.exit()
}

main()
