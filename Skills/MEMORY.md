# MEMORY.md

跨工作区长期约定。保持精简；过时条目及时删改。

## 项目编辑工作流

对 **Scripting 项目文件更改**，按序遵循适用技能：

1. **`project-auto-backup`**（可行时先备份；失败则停止编辑并报告）
2. **`karpathy-guidelines`**（规划/写码前：约束审查、surgical 改动、明确假设、狭窄成功标准）
3. **`project-file-organization`**（新建/加文件/重组时按项目约定落地）
4. **`project-code-cleanup`**（改源码后、最终回复前：保行为、清格式/导入/注释、跑最窄有用检查）

跳过：只读任务、仅改记忆、明确不编辑、生成物/vendor/压缩物/仅锁文件（除非请求清理）。

调用接受结构化参数的技能脚本/工具时：文档显示 JSON 或未指定格式 → **显式传 JSON**。

## 代码约定

- 必要注释**必须中文**（`// 内容注释`）；许可证头、生成通知、文档格式、外部项目约定除外。

## 项目结构与行数

行数指导（Scripting 源文件）：

| 行数 | 动作 |
|------|------|
| <200 | 保持原样 |
| 200+ | 留意职责是否过大 |
| 300+ | 结构审查（非自动拆分） |
| 500+ | 倾向拆分（强内聚或高行为风险可保留） |
| 800+ | 必须拆分（生成式数据/配置或罕见强内聚例外除外） |

- **应拆分**：混杂类型、常量、工具、服务、可复用组件与页面。
- **可保留**：内聚复杂页、密集声明式 UI、schema/config、生成式数据——合在一起更清晰时；不拆 300+ 被改文件时需说明理由。
- 新建/重组项目后，或被改源文件达 300+ 时：可行则跑 `project-file-organization` 的 `scripts/check.py`，结果作审查输入，不作自动重写指令。

## UI：暗黑模式（强制）

编写/修改 Scripting UI（页面、组件、小部件、Live Activity、通知）必须适配 Light/Dark：

- 优先系统语义色：`systemBackground`、`secondarySystemBackground`、`label`、`secondaryLabel`、`separator`、`accentColor`、`systemBlue` 等。
- 禁止仅适合浅色的硬编码 hex / 白底黑字。
- 自定义色：`useColorScheme()` / `colorScheme` 按 `'light' | 'dark'` 分别选；非 UI 可用 `AppEvents.colorScheme`。
- 明暗对比度与可读性均须合格。

## UI：Liquid Glass（默认风格）

创建/改造可见 UI（页面、列表、表单、卡片、Toast、徽章等）**默认**遵循 **`liquid-glass-ui`**：先读 skill，从 snippets 复用；业务页不手写双套玻璃分支。色板与语义色规则见上方「暗黑模式」；配方、字号、图标、徽章色板细节见 skill，不在此展开。

**跳过**：用户明确要普通系统 `List`/设置风格，或场景不适合玻璃。

**硬性约束**

- **版本**：iOS 26+ 才用 `UIGlass` / `glassEffect` / `GlassEffectContainer`；iOS <26 用 `Material` 回退。
- **表面**：只用 `surfaceFill`、`glass*Props`、`plainListChrome`、`primaryButtonSurface` 等版本感知 props。
- **骨架**：`PageBackground` + plain List 隐藏系统底；连续圆角 + 描边/阴影成对；自定义色必供 `{ light, dark }`。
- **落盘**：`constants/liquidGlass.tsx`、`components/PageBackground.tsx`、`components/glass/*`；用 `page-shell` 搭骨架。
- **交付前**：Light/Dark 与 iOS 26+ / <26 核对；无未保护的 `UIGlass` / `glassEffect` 直写。
- **禁止**：不透明白卡片；同屏随意混用圆角；玻璃后保留 grouped List 灰底；只硬编码浅色 hex；过度使用厚重材质。
