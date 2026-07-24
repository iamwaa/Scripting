/**
 * tests/inlineDiff.test.ts - 行内词级 diff 与配对
 */
import { Script } from "scripting"
import {
  computeInlineDiff,
  attachInlineHighlights,
  wrapSegments,
  tokenize,
  type InlineSegment,
} from "../utils/inlineDiff"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

type Line = {
  type: string
  content: string
  segments?: InlineSegment[]
}

function changedRatio(segs: InlineSegment[]): number {
  let same = 0
  let changed = 0
  for (const s of segs) {
    const n = Array.from(s.text).length
    if (s.type === "same") same += n
    else changed += n
  }
  const t = same + changed
  return t === 0 ? 0 : changed / t
}

function main(): void {
  // 完全相同
  {
    const r = computeInlineDiff("abc", "abc")
    assert(r.oldSegments.length === 1 && r.oldSegments[0].type === "same", "相同全文 same")
    assert(r.oldSegments[0].text === "abc", "相同全文内容")
  }

  // 中间替换整词
  {
    const r = computeInlineDiff("foo bar baz", "foo qux baz")
    assert(
      r.oldSegments.map((s) => s.text).join("") === "foo bar baz",
      "旧侧片段拼接还原"
    )
    assert(
      r.newSegments.map((s) => s.text).join("") === "foo qux baz",
      "新侧片段拼接还原"
    )
    assert(
      r.oldSegments.some((s) => s.type === "changed" && s.text.includes("bar")),
      "旧侧 bar 为 changed"
    )
    assert(
      r.newSegments.some((s) => s.type === "changed" && s.text.includes("qux")),
      "新侧 qux 为 changed"
    )
    assert(
      r.oldSegments.some((s) => s.type === "same" && s.text.includes("foo")),
      "公共前缀 same"
    )
  }

  // 纯插入：旧侧可全为 same
  {
    const oldT = "按时段变化的渐变背景(模块导入时固化，非整点刷新)"
    const newT =
      "按时段变化的渐变背景；`PageBackground` 可选接收固定 Light/Dark 渐变配置(默认在模块导入时固化，非整点刷新)"
    const r = computeInlineDiff(oldT, newT)
    assert(
      r.oldSegments.map((s) => s.text).join("") === oldT,
      "中文旧侧拼接还原"
    )
    assert(
      r.newSegments.map((s) => s.text).join("") === newT,
      "中文新侧拼接还原"
    )
    assert(
      r.newSegments.some((s) => s.type === "changed"),
      "中文新侧有插入 changed"
    )
  }

  // 前缀插入
  {
    const r = computeInlineDiff("world", "hello world")
    assert(
      r.newSegments.some((s) => s.type === "changed" && s.text.includes("hello")),
      "插入部分为 changed"
    )
    assert(
      r.oldSegments.map((s) => s.text).join("") === "world",
      "旧侧拼接还原"
    )
  }

  // 长正则：词级不应把几乎整行都标成 changed（对比纯字符会过度）
  {
    const oldT =
      "const AUTH = /unauthorized|not\\s+logged\\s+in|no\\s+access\\s+token|session\\s*(not\\s+found|expired)/i"
    const newT =
      "const AUTH = /unauthorized|not\\s+logged\\s+in|not\\s+authenticated|user\\s+not\\s+authenticated|no\\s+access\\s+token|session\\s*(not\\s+found|expired)/i"
    const r = computeInlineDiff(oldT, newT)
    assert(r.oldSegments.map((s) => s.text).join("") === oldT, "正则旧侧还原")
    assert(r.newSegments.map((s) => s.text).join("") === newT, "正则新侧还原")
    // 新侧插入了短语，changed 应存在但应保留大量 same
    assert(r.newSegments.some((s) => s.type === "changed"), "正则新侧有 changed")
    assert(r.newSegments.some((s) => s.type === "same"), "正则新侧有 same")
    assert(changedRatio(r.newSegments) < 0.7, "正则新侧 changed 占比不应过高")
    assert(changedRatio(r.oldSegments) < 0.5, "正则旧侧 changed 占比应更低")
  }

  // tokenize：标识符与转义成词
  {
    const toks = tokenize("foo\\s+bar")
    assert(toks.includes("foo"), "tokenize 标识符")
    assert(toks.includes("\\s"), "tokenize 转义对")
    assert(toks.includes("+"), "tokenize 单字符")
  }

  // attach：一对 del/add
  {
    const lines = attachInlineHighlights<Line>([
      { type: "context", content: "keep" },
      { type: "del", content: "foo bar" },
      { type: "add", content: "foo baz" },
      { type: "context", content: "end" },
    ])
    assert(lines[1].segments != null, "del 有 segments")
    assert(lines[2].segments != null, "add 有 segments")
    assert(
      lines[1].segments!.some((s) => s.type === "changed" && s.text.includes("bar")),
      "del 标出 bar"
    )
    assert(
      lines[2].segments!.some((s) => s.type === "changed" && s.text.includes("baz")),
      "add 标出 baz"
    )
    assert(lines[0].segments == null, "context 无 segments")
  }

  // attach：仅 add 不配对
  {
    const lines = attachInlineHighlights<Line>([
      { type: "add", content: "only new" },
    ])
    assert(lines[0].segments == null, "未配对 add 无 segments")
  }

  // 多对 del/add 按序配对（需局部改动才会挂 segments）
  {
    const lines = attachInlineHighlights<Line>([
      { type: "del", content: "prefix a1" },
      { type: "del", content: "prefix b1" },
      { type: "add", content: "prefix a2" },
      { type: "add", content: "prefix b2" },
    ])
    assert(lines[0].segments != null && lines[2].segments != null, "第一对配对")
    assert(lines[1].segments != null && lines[3].segments != null, "第二对配对")
    assert(
      lines[0].segments!.map((s) => s.text).join("") === "prefix a1",
      "第一对 del 还原"
    )
    assert(
      lines[2].segments!.map((s) => s.text).join("") === "prefix a2",
      "第一对 add 还原"
    )
  }

  // 软换行：长行拆成多行且拼接还原
  {
    const segs: InlineSegment[] = [
      { text: "hello ", type: "same" },
      { text: "WORLD", type: "changed" },
      { text: " end", type: "same" },
    ]
    const rows = wrapSegments(segs, 8)
    assert(rows.length >= 2, "应拆成多行")
    const joined = rows
      .flat()
      .map((s) => s.text)
      .join("")
    assert(joined === "hello WORLD end", "软换行拼接还原")
    assert(
      rows.some((row) => row.some((s) => s.type === "changed")),
      "换行后仍保留 changed"
    )
  }

  console.log("inlineDiff tests passed")
  Script.exit()
}

main()
