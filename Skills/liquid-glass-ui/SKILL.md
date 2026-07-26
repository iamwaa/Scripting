---
name: liquid-glass-ui
description: 构建液态玻璃风格 Scripting UI 的通用指南 — iOS 26+ Liquid Glass，iOS <26 Material 回退（含 iOS 18），时段渐变背景与语义徽章 tokens。默认用于可见 UI 创建/改造。
metadata:
  display_name: "Liquid Glass UI"
  intent_patterns: "liquid glass, glass ui, frosted glass, glassmorphism, glass card, glass list, glass badge, liquid-glass, 玻璃 UI, 毛玻璃, 液态玻璃, 玻璃拟态, 玻璃卡片, 玻璃列表, iOS 26 玻璃, Material 回退, 默认 UI 风格"
  required_tools: "scripting_reference, file_tool, run_shell_command"
---

# 用途

**默认**用于 Scripting **可见 UI** 的创建与改造（页面、列表、表单、卡片、Toast、徽章等）。先读本 skill，从 snippets 复用；业务页不手写双套玻璃分支。

能力概览：

- **iOS 26+**：可交互 clear 液态玻璃（`UIGlass.clear().interactive(true)` + `glassEffect`）
- **iOS < 26**（含 iOS 18）：系统 `Material` 毛玻璃回退（`ultraThinMaterial` / `thinMaterial` / `regularMaterial`）
- 连续圆角卡片漂浮在时段渐变 `PageBackground` 上
- 语义色徽章与玻璃标签
- 自适应 Light/Dark tokens（禁止仅适配浅色的硬编码白底）
- 柔和蓝灰阴影 + 发丝级高光描边

**跳过条件**（满足其一即不用本 skill）：

- 用户明确要普通系统 `List` / 设置风格
- 场景不适合玻璃（如极简系统设置页、纯工具无界面脚本）

# 版本兼容（强制）

Liquid Glass API（`UIGlass`、`glassEffect`、`GlassEffectContainer`、`buttonStyle: "glass" | "glassProminent"`、`ConcentricRectangle`）**仅 iOS 26+**。

| 系统版本 | 表面实现 | 说明 |
|----------|----------|------|
| **iOS 26+** | `glassEffect` + `UIGlass` | 真正的液态玻璃 |
| **iOS < 26**（含 iOS 18） | `background: { style: Material, shape }` | 系统材质毛玻璃回退 |

### 能力探测

```ts
// snippets/tokens.tsx 已导出
export const supportsLiquidGlass = (() => {
  const major = Number.parseInt(String(Device.systemVersion).split(".")[0] ?? "0", 10)
  return Number.isFinite(major) && major >= 26
})()
```

**硬性规则：**

1. **禁止**在 iOS < 26 调用 `UIGlass.*` 或写入 `glassEffect` / `GlassEffectContainer`。
2. 统一通过 `surfaceFill(...)` / `glass*Props` / `plainListChrome` 等版本感知 props，**不要**在业务页手写双套分支。
3. `buttonBorder` 形状按 iOS 26 处理；旧系统回退为 `capsule`。
4. 主按钮、语义徽章本就不依赖 Liquid Glass，两端共用同一套 `background` + 描边。
5. 页面骨架（`PageBackground` + plain List + 按场景的行距 + 阴影描边）两端一致。

### Material 回退映射

| 表面 | iOS 26+ | iOS < 26 |
|------|---------|----------|
| 列表行 / 卡片 / 分区 | `UIGlass.clear().interactive(true)` | `ultraThinMaterial` |
| 输入框 / 控件 | 同上 | `thinMaterial` |
| chip / 标签 / 筛选条 | `glassEffect` + `buttonBorder` | `ultraThinMaterial` + `capsule` |
| Toast | clear glass | `regularMaterial`（可读性优先） |
| 顶部加强 chrome | clear glass + elevated 阴影 | `thinMaterial` + elevated 阴影 |

# 设计原则

1. **玻璃叠在渐变上，而不是白底上。** 始终隐藏系统 List 底色，并在底层放置渐变 `PageBackground`。
2. **版本感知表面。** iOS 26+ 用 clear 可交互玻璃；更低版本用 `Material`，视觉仍保持透明毛玻璃感。
3. **连续圆角。** 使用 `style: "continuous"` 的 squircle（18–22）。避免直角矩形。
4. **描边 + 阴影成对出现。** 卡片需要细描边 *和* 柔和阴影，才能读出悬浮玻璃感。
5. **语义双色。** 所有自定义颜色提供 `{ light, dark }`。正文优先系统语义色（`label`、`secondaryLabel`）。
6. **动效克制。** 数字/状态变化用 `AnimText` / `contentTransition`；避免喧闹动画。
7. **负行距按场景用。** 矮列表行可用 `listRowSpacing={-15}`（`spacing.listRow` / `plainListChrome`）做轻叠；**高大内容卡**（天气、详情）负行距收到约 `-8`，或 `0` 取消叠卡——**不要**为了叠层硬套 `-15`。

# Tokens（唯一真相源）

搭建时从 skill snippets 复制：

| 文件 | 作用 |
|------|------|
| `snippets/tokens.tsx` | 圆角、间距、阴影、描边、徽章色板、`surfaceFill`、组合 props |
| `snippets/PageBackground.tsx` | 按时段变化的渐变背景；`PageBackground` 可选接收固定 Light/Dark 渐变配置（默认在模块导入时固化，非整点刷新） |
| `snippets/components.tsx` | AnimText、GlassBadge、GlassTag、GlassInput、GlassCard、Toast… |
| `snippets/page-shell.tsx` | 完整页面骨架示例 |

## 关键数值

| Token | 值 | 用途 |
|-------|----|------|
| 卡片圆角 | `20` | 列表玻璃行、配置分区 |
| 控件圆角 | `18` | 输入框、主按钮 |
| Toast 圆角 | `22` | Toast 面板 |
| 大图标圆角 | `17` continuous | 约 80pt 图标 |
| 中图标圆角 | `16` continuous | 约 60pt 图标 |
| 列表行距 | `-15` | 玻璃卡片叠层 |
| 页面水平边距 | `24` | 表单 / 登录页 |
| 页面垂直节奏 | `24` | 表单分区堆叠 |
| 卡片阴影 | `rgba(72,88,120,0.16), r12, y5` | 默认悬浮 |
| 加强阴影 | `rgba(72,88,120,0.3), r12, y5` | 筛选条 |
| Toast 阴影 | `rgba(0,0,0,0.18), r18, y8` | Toast |
| 高光描边 | light `rgba(255,255,255,0.56)` / dark `0.30`，宽 `0.5` | 输入框、按钮 |
| 外轮廓描边 | light `rgba(0,0,0,0.16)` / dark `rgba(255,255,255,0.42)`，宽 `0.35` | 分区、强调卡片 |

## 组合 props（优先展开，勿手写等价物）

| 导出 | 用途 |
|------|------|
| `surfaceFill({ material, shape })` | 版本感知表面（glassEffect 或 Material） |
| `glassRowProps` | 矮列表玻璃行（含 `maxHeight: infinity`，勿用于高大卡） |
| `glassContentCardProps` | 高大内容卡：无 `maxHeight infinity`，避免撑穿导航栏 |
| `glassControlProps` | 输入框等控件 |
| `glassSectionProps` | 设置分区容器 |
| `glassChipProps` | 行内小标签 |
| `glassElevatedBarProps` | 顶部筛选条等加强 chrome |
| `glassToastProps` | Toast 面板 |
| `primaryButtonSurface` | 主操作按钮（不依赖 Liquid Glass） |
| `plainListChrome` | List 隐藏系统底 + 默认负行距（矮行）；高大卡页可覆盖 `listRowSpacing` |
| `textColor` | 语义文字色（primary / secondary / onPrimary…） |
| `badgeTokens` | 语义徽章色板 |
| `supportsLiquidGlass` | 版本能力探测 |

## 玻璃材质（版本感知）

优先复用 `surfaceFill`，不要在页面里直接写死 `glassEffect`：

```ts
import { surfaceFill, fallbackMaterial, glassShape, supportsLiquidGlass } from "./tokens"

// 卡片 / 行（自动选择 glassEffect 或 Material）
const cardSurface = surfaceFill({
  material: fallbackMaterial.card, // ultraThinMaterial
  shape: glassShape.card,          // continuous radius 20
})

// 紧凑 chip / 筛选条
const chipSurface = surfaceFill({
  material: fallbackMaterial.chip,
  shape: "buttonBorder", // iOS <26 自动变成 capsule
})

// 胶囊徽章两端都用 background + border，不用 glassEffect
background: { style: tokens.background, shape: "capsule" }
border: { style: tokens.border, width: 0.5 }
clipShape: "capsule"
```

等价手写（仅作理解，业务代码请用 tokens）：

```ts
// iOS 26+
glassEffect: {
  glass: UIGlass.clear().interactive(true),
  shape: { type: "rect", cornerRadius: 20, style: "continuous" },
}

// iOS < 26
background: {
  style: "ultraThinMaterial",
  shape: { type: "rect", cornerRadius: 20, style: "continuous" },
}
```

## 语义徽章色板

样式：`info | success | warning | error | neutral | teal`

每种样式都有自适应 `tint` / `background` / `border`。完整映射见 `snippets/tokens.tsx`（`badgeTokens`）。

常见语义：

| 样式 | 含义 |
|------|------|
| info | 进行中 / 处理中 |
| success | 已完成 |
| warning | 排队 / 注意 |
| error | 失败 |
| teal | 已暂停 / 次级状态 |
| neutral | 计数、默认标签 |

## 可选背景配置

`PageBackground` 默认使用按时段生成的渐变。需要固定品牌色或页面专属背景时，传入 `PageBackgroundConfig`；背景仍必须同时提供 Light/Dark 色组：

```tsx
import { PageBackground, type PageBackgroundConfig } from "./PageBackground"

const backgroundConfig: PageBackgroundConfig = {
  lightColors: ["#e8edf0", "#dde7e2", "#efe2d2"],
  darkColors: ["#070914", "#11162a", "#20162d"],
  startPoint: "topLeading",
  endPoint: "bottomTrailing",
}

<PageBackground config={backgroundConfig} />
```

不传 `config` 时继续使用默认时段背景。每个页面根层只挂载一个 `PageBackground`，子组件、卡片和列表行不得重复挂载。

# 页面架构

## 标准玻璃列表页

```tsx
import { plainListChrome, glassRowProps } from "./tokens"
import { PageBackground } from "./PageBackground"

<NavigationStack>
  <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <List
      {...plainListChrome}
      navigationTitle="标题"
      toolbar={{ topBarLeading: <CloseButton /> }}
      overlay={isEmpty ? <ContentUnavailableView ... /> : undefined}
    >
      <Section header={...}>
        {/* 使用 glassRowProps 的行 */}
      </Section>
    </List>
  </ZStack>
</NavigationStack>
```

### 硬性要求

- List 使用 `{...plainListChrome}`（`scrollContentBackground="hidden"`、`listStyle="plain"`、清行底/分割线；默认 `listRowSpacing={-15}` 适合**矮行**）
- 高大内容卡页：覆盖 `listRowSpacing={-8}` 或 `0`，行用 `glassContentCardProps`（不要用带 `maxHeight: infinity` 的 `glassRowProps`）
- 关闭按钮：`systemImage="xmark"` + `Navigation.useDismiss()`
- 呈现：`await Navigation.present({ element: <Page /> })`，结束后调用 `Script.exit()`

### List 系统底与玻璃双层底（常见陷阱）

玻璃要叠在 `PageBackground` 上，不要叠在系统 List 灰/白底上。

| 现象 | 原因 | 做法 |
|------|------|------|
| 搜索胶囊外多一层底 | 行有玻璃，List 默认行底未清 | List 用 `plainListChrome`；行上再带 `listRowBackground={<></>}`、`listRowSeparator="hidden"`（`glassRowProps` 已含） |
| 清除/操作行不透明白底 | `Button` 包住整张玻璃卡，按钮自带底 | **外** `HStack {...glassRowProps}`，**内** `Button buttonStyle="plain"` |
| Section 下方条带底 | `Section footer` 系统页脚样式 | 说明文案放玻璃卡片内，少用 `footer` |

```tsx
// 可点玻璃行：卡在外，按钮在内
<HStack {...glassRowProps}>
  <Button action={onClear} buttonStyle="plain">
    <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      {/* 图标 + 文案 */}
    </HStack>
  </Button>
</HStack>
```

## 玻璃行

复用 tokens 中的 `glassRowProps`（矮行；已含版本回退）：

```tsx
// 矮列表行
<VStack alignment="leading" spacing={8} {...glassRowProps}>
  {/* 内容 */}
</VStack>

// 高大内容卡（天气/详情）：去掉 maxHeight infinity
<VStack spacing={14} {...glassContentCardProps}>
  {/* 大块内容 */}
</VStack>

// glassRowProps 内部等价逻辑：
// iOS 26+ → glassEffect + UIGlass.clear().interactive(true)
// iOS <26 → background ultraThinMaterial + continuous radius 20
// 两端都带 shadow.card、隐藏 listRow 分割线
// glassRowProps 另含 maxHeight: infinity —— 仅适合矮行
```

可选：若有主题主色（如图标主色），可用 `background={<AccentBackground color={...} />}` 做轻微着色强调；圆角仍保持 `20`，并保留明暗外轮廓描边。

### 高大卡与负行距（常见陷阱）

| 现象 | 原因 | 做法 |
|------|------|------|
| 大卡叠穿导航栏 | `glassRowProps.maxHeight: infinity` 把 List 行撑高，再叠 `-15` 负行距 | 用 `glassContentCardProps`；List 上 `listRowSpacing={-8}` 或 `0` |
| 空态/chips 写了居中仍偏左 | `{...glassRowProps}` 的 `frame.alignment: "leading"` 后写覆盖了居中 | 展开后再设 `frame={{ maxWidth: "infinity", alignment: "center" }}`，文案可加 `multilineTextAlignment="center"` |

```tsx
// 居中空态：先展开，再覆盖 frame
<VStack
  alignment="center"
  spacing={10}
  {...glassContentCardProps}
  frame={{ maxWidth: "infinity", alignment: "center" }}
>
  <Text multilineTextAlignment="center">暂无内容</Text>
</VStack>
```

**负行距要不要？** 不整条去掉：矮行列表可保留轻叠；高大卡页减弱或取消。以不挡导航、不严重叠穿为准。

## 表单 / 登录风格页

并非所有页面都是 List。登录/表单布局可用：

```tsx
<ZStack>
  <PageBackground />
  <ScrollView>
    <VStack spacing={24} padding={{ horizontal: 24, top: 42, bottom: 32 }}>
      {/* 标题：title2 bold + callout secondaryLabel */}
      {/* GlassInput 字段 */}
      {/* PrimaryGlassButton */}
      {/* OR 分割线 */}
      {/* 历史记录玻璃卡片 */}
    </VStack>
  </ScrollView>
</ZStack>
```

### 输入框配方

- 外层 `HStack` 使用 `glassControlProps`（圆角 18、minHeight 56、高光描边、卡片阴影）
- 上方标签：`font="callout"`、`foregroundStyle="secondaryLabel"`
- `TextField` 使用 `textFieldStyle="plain"`

### 主按钮配方

- 复用 `primaryButtonSurface` / `PrimaryGlassButton`
- 半透明系统蓝填充：light `rgba(0,122,255,0.72)` / dark `rgba(10,132,255,0.62)`
- 连续圆角 18，白色 semibold 文案
- 白色高光描边 + 蓝色 tint 阴影 `rgba(0,90,220,0.22)`

### OR 分割线

两侧渐变淡出的水平线 + 居中 `footnote` `secondaryLabel` 文案（如 `"或"` / `"OR"`）。颜色用 tokens 的 `fill.divider`。

## 设置 / 分组配置

配置页同样使用渐变背景 + plain List，但每个分区主体包在玻璃容器中（圆角 20、外轮廓描边、卡片阴影）。分区内部行用简单 padding + `Divider`，不要再给每行单独上玻璃。

```tsx
<Section header={<Text font="caption" foregroundStyle="secondaryLabel">通用</Text>}>
  <ZStack {...glassSectionProps}>
    <VStack padding={10} spacing={0}>
      {/* 配置项行 */}
    </VStack>
  </ZStack>
</Section>
```

## 紧凑控件（筛选条 / 标签）

工具栏 chip、元信息标签用紧凑表面，而不是完整 20pt 卡片：

```tsx
// 推荐
<HStack {...glassElevatedBarProps}>
  {/* 选择器等 */}
</HStack>

// iOS 26+：buttonBorder glass + elevated 阴影
// iOS <26：thinMaterial + capsule + elevated 阴影
```

`GlassTag` = footnote 文案 + 水平 8 / 垂直 4 padding + `glassChipProps`（自动版本回退）。

## Toast

居中玻璃面板，圆角 22，minWidth 200，大号 SF Symbol 或 `ProgressView`，body 级文案。优先通过宿主视图的 `toast={toastConfig}` 呈现（Scripting toast API），内容可按 `GlassToast` 构建。

# 动效与反馈

| 模式 | 实现 |
|------|------|
| 数字 / 状态文案动画 | `AnimText` + `contentTransition="numericText"` 或 `numericTextCountsUp` |
| 符号状态变化 | `contentTransition="symbolEffect"` / `symbolEffect={{ effect: "bounce", value }}` |
| 页面切换 | `Transition.pushFrom("top" \| "bottom")` + `withAnimation` |
| 空态淡入 | `opacity` + `Animation.easeOut(0.3)` |
| 骨架加载 | `redacted="placeholder"` + 可选斜向 shimmer |
| 危险确认 | `Dialog.actionSheet` 且 `destructive: true` |
| 主操作点击 | 可选 `HapticFeedback.mediumImpact()` |

# 明暗模式规则

- 文字层级只用 `label` / `secondaryLabel` / `tertiaryLabel`（或 `textColor.*`）
- 工具栏图标用语义系统色（`systemBlue`、`systemRed` 等）
- 禁止只做浅色模式的白底黑字卡片
- 自定义填充必须同时提供 light / dark
- 渐变背景：浅色偏暖灰，深色偏深蓝/紫
- 描边策略会翻转：浅色多用柔和黑描边或白高光；深色多用半透明白描边

# 字号层级

| 角色 | Token |
|------|-------|
| 页面主标题 | `title2` + `bold` + `label` |
| 空态标题 | `title` + `semibold` |
| 行标题 | `body` + `semibold` |
| 正文 / 按钮 | `body` |
| 字段标签 | `callout` + `secondaryLabel` |
| 元信息 / 标签 | `footnote` |
| 分区头 | `caption` + `secondaryLabel` |
| 徽章文案 | `12` + `medium` |

`tokens.typography` 映射：`pageTitle` / `sectionTitle`（空态 title）/ `appName`（行标题）/ `body` / `callout` / `meta`（徽章 12）/ `sectionHeader`（caption）。`typography.caption` 实际为 `footnote` 元信息，勿与分区头混淆。

# 图标约定

- 工具栏关闭：`xmark`
- 设置：`gearshape` / `gear`
- 搜索空态：`magnifyingglass`
- 列表空态：按业务选语义 SF Symbol（如下载用 `arrow.down.circle`）
- Toast：`checkmark.circle.fill` / `xmark.circle.fill` / `info.circle.fill`
- 应用/内容图标裁切：连续圆角矩形（16–17），不要默认 `circle`

# 推荐 / 禁止

**推荐**

- 每个全屏玻璃页底层放一个 `PageBackground`；需要固定背景时传入 `PageBackgroundConfig`，不要在子组件重复挂载
- 复用 `supportsLiquidGlass` / `surfaceFill` / `glass*Props` / `plainListChrome`，不要在页面手写双套表面
- 隐藏列表分割线与系统背景
- 表面一定搭配描边 + 阴影
- 徽章保持语义化与双色

**禁止**

- 在 iOS < 26 调用 `UIGlass` / `glassEffect` / `GlassEffectContainer`
- 默认使用不透明纯白卡片
- 同一屏混用随意圆角（如 8 / 12 / 24）
- 在玻璃背后保留系统 grouped List 灰底（未清 `listRowBackground` / 未 `plainListChrome`）
- 高大内容卡仍用 `glassRowProps.maxHeight: infinity` 或整页死用 `listRowSpacing: -15` 叠穿导航栏
- 用 `Button` 包住整张玻璃卡导致双层不透明底；应卡在外、`buttonStyle="plain"` 在内
- 依赖 `Section footer` 做说明却引入系统页脚条带底
- 只硬编码浅色 hex
- 在 clear glass / ultraThinMaterial 已足够时，过度使用厚重材质

# 实施流程

1. 确认目标是 Scripting 项目（含 `index.tsx` / `script.json`）。
2. 按需把 snippets 拷入项目：
   - `constants/liquidGlass.tsx` ← `snippets/tokens.tsx`（含 `supportsLiquidGlass` 与 Material 回退）
   - `components/PageBackground.tsx`
   - `components/glass/*` ← 从 `snippets/components.tsx` 按需拆分
3. 用 `snippets/page-shell.tsx` 的骨架搭页面；表面只使用 `glass*Props` / `surfaceFill` / `plainListChrome`。
4. 检查 Light/Dark；并在 iOS 26+ 与 iOS <26（至少 iOS 18）各做一次视觉核对。
5. 预览：
   ```
   scripting-ts preview_ui <file.tsx>
   scripting-ts project "<脚本名>"
   ```
6. 未知 API 用 `scripting_reference` 查询（`UIGlass`、`Material`、`List`、`glassEffect`、`Navigation` 等）。
7. 确认业务代码中没有未保护的 `UIGlass` / `glassEffect` 直写。

# 可编辑玻璃列表（进阶）

简单页面：plain `List` + `glassRowProps` 即可（本 skill 默认路径）。

需要多选 / 排序 / 滑动删除时：

- 在现有玻璃视觉 tokens 上叠加编辑能力（圆角 20、阴影、行距按矮/高卡场景、`PageBackground` 保持不变）
- 不要为了视觉效果重写整套编辑管线；仅在用户明确需要编辑行为时再引入

# 相关 skills

- **create-ios-page** — 基础 NavigationStack 页面生命周期（`present` + `Script.exit`）
- **project-file-organization** — `components/`、`constants/`、`pages/` 放置约定
- **project-code-cleanup** — 脚手架后的中文注释与 import 清理
- **karpathy-guidelines** — 保持改动精确，避免为单页过度抽象
