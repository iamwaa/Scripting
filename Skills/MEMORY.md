# MEMORY.md

跨工作区长期约定。仅保留未来任务中稳定、可执行的规则；过时内容及时删改。

## 项目记忆

处理 `scripts/<项目名>/` 下的项目时，项目专属且对未来任务仍有价值的记忆统一写入项目根目录的 `PROJECT_MEMORY.md`。

- 开始项目相关任务时，若 `PROJECT_MEMORY.md` 存在，先读取它，再分析或修改项目。
- 需要沉淀项目架构、关键约束、长期决策、稳定命令、已知陷阱或维护约定时，创建或更新 `PROJECT_MEMORY.md`；优先修订已有内容，避免重复追加。
- 仅记录项目专属、长期有效的信息；一次性进度、临时调试结果、日志、生成物、密钥和Token不得写入。
- 信息失效或被新决策取代时，及时修订或删除旧内容。
- `PROJECT_MEMORY.md` 是项目文档，允许保存在项目根目录；它是“项目目录只存项目所需源码与资产”规则的明确例外。
- 跨项目通用的用户偏好和长期约定仍写入全局记忆，不复制到各项目。

## Scripting 项目编辑流程

修改 `scripts/<项目名>/` 下的项目文件时，按需依次使用：

1. `project-auto-backup`：编辑前备份；备份失败则停止编辑并报告。
2. `karpathy-guidelines`：先明确约束、假设与最窄成功标准，再做局部改动。
3. `project-file-organization`：新建文件、扩展结构或重组项目时遵循目录规范。
4. `project-code-cleanup`：源码修改后、交付前清理并执行最窄有效检查。

只读、仅修改记忆、用户明确不编辑，以及仅处理生成物/vendor/锁文件时，可跳过上述流程。技能或脚本接受结构化参数且格式未明确时，显式传 JSON。

## 代码与结构

- 必要的代码注释使用中文；许可证、生成声明、文档格式和外部项目约定除外。
- 优先根因修复与小范围变更，不顺手改无关问题。
- Scripting 源文件行数指导：`<200` 保持原样，`200+` 注意职责是否过大，`300+` 审查结构，`500+` 倾向拆分，`800+` 原则上必须拆分。
- 应拆分：类型、常量、工具、服务、可复用组件与页面混杂在同一文件。
- 可保留：内聚复杂页、密集声明式 UI、schema/config、生成数据；不拆 300+ 文件时需在结构化思考里说明理由。
- 新建/重组项目，或本次修改的源文件达到 `300+` 行时，可行则运行 `project-file-organization/scripts/check.py`，仅将结果作为审查输入。

## 文件落盘

项目目录只存项目所需源码与资产。以下内容默认放当前 agent 工作区，不得写入 `scripts/<项目名>/`：

- 下载、网页/API 抓取内容：`downloads/` 或 `tmp/downloads/`
- 测试探针、一次性脚本、调试 dump：`tmp/tests/` 或 `scratch/`
- 抓包、导出、日志：`tmp/captures/` 或 `tmp/logs/`
- 外部 bundle、构建产物、压缩包、大体积无关资产：`tmp/reference/`

硬规则：

- 用户未指定下载/测试路径时，默认使用工作区，并在回复中说明实际路径。
- 不在项目中放 `node_modules` 片段、整站镜像、与 `script.json` entry 同名的无关文件（尤其 `index.js`/`index.ts` 旁路假入口）、`*.chunk.js`、`*.min.js` 等构建产物。
- 若项目根出现异常大文件或疑似构建垃圾，先隔离到工作区或删除，并清理对应 AppGroup `.build/<项目名>/` 脏缓存后再编辑。
- 下载内容先在工作区处理，只将必要的小型结果按项目结构合入源码；备份时可排除已知垃圾。

## Scripting UI

修改页面、组件、小部件、Live Activity 或通知时：

- 必须适配 Light/Dark；优先系统语义色，禁止只适合浅色的硬编码配色。自定义颜色必须分别提供 light/dark 值。
- 可见 UI 默认先读取并遵循 `liquid-glass-ui`；用户明确要求普通系统 `List`/设置风格，或场景不适合玻璃时跳过。
- Liquid Glass 仅用于 iOS 26+；更低版本必须使用 `Material` 等回退，不得裸用未做版本保护的 `UIGlass`、`glassEffect`、`GlassEffectContainer`。
- 复用 skill 提供的版本感知 surface props、页面骨架和标准目录，不自行复制双套玻璃分支。
- 交付前核对 Light/Dark 与 iOS 26+/<26；避免不透明白卡、grouped List 灰底残留、圆角混乱和过度厚重材质。
- 字号一律用数字（如 `font={16}`），不要用 `title`、`headline`、`body`、`caption` 等语义字号名。
- 列表行距：独立玻璃卡片行（`listRowBackground: <></>`、每行 self-contained 卡）压缩行距时用**负 `listRowSpacing`** 抵消系统行 padding（详见 `liquid-glass-ui`「行距」）；原生 inset 行仍用正向小间距。这是布局结构属性、与 Liquid Glass/Material 无关。不要因「卡片不重叠」原则字面回避负值——该原则禁的是制造卡片重叠/叠穿导航栏，而非压缩独立卡片行距。

## FormRow（List 表单文本输入）

List / 设置页里的文本输入默认用 **FormRow**（左标签 + 右输入 + 有内容可清空），不要用 `TextField title="..."` 内置行。搜索胶囊、工具栏搜索等非表单布局除外。玻璃登录/表单页的输入见 `liquid-glass-ui` 的 `GlassInput` / `glassControlProps`，与本 FormRow 是两套场景（List 表单 vs 玻璃页），按场景择一。

布局：`HStack` 拉满 → 左 `Text` 固定宽（默认 72）→ 中 `TextField` 或 `SecureField`（用 `label={<Text>{label}</Text>}`，不要再传 `title`）→ 右清空按钮（`xmark.circle.fill` / `tertiaryLabel`，`onChanged("")`）。

落到 `components/FormRow.tsx`（小项目可写在 `components.tsx`）：

```tsx
import { HStack, Text, TextField, SecureField, Button, Image } from "scripting"

export function FormRow({
  label,
  value,
  prompt,
  onChanged,
  secure = false,
  labelWidth = 72,
}: {
  label: string
  value: string
  prompt?: string
  onChanged: (value: string) => void
  secure?: boolean
  labelWidth?: number
}) {
  const field = secure ? (
    <SecureField label={<Text>{label}</Text>} value={value} prompt={prompt} onChanged={onChanged} />
  ) : (
    <TextField label={<Text>{label}</Text>} value={value} prompt={prompt} onChanged={onChanged} />
  )
  return (
    <HStack alignment="center" spacing={12} frame={{ maxWidth: Infinity }}>
      <Text frame={{ width: labelWidth, alignment: "leading" }}>{label}</Text>
      {field}
      {value.length > 0 ? (
        <Button action={() => onChanged("")} buttonStyle="plain">
          <Image systemName="xmark.circle.fill" font={16} foregroundStyle="tertiaryLabel" />
        </Button>
      ) : null}
    </HStack>
  )
}
```

调用：`<FormRow label="姓名" value={name} prompt="可选提示" onChanged={setName} />`；Token 等加 `secure`。标签宜短；过长调 `labelWidth`。

## Scripting 对话框调用提醒

Scripting 页面脚本中的原生对话框，采用运行时注入的全局 `Dialog` 命名空间：`Dialog.alert(...)`、`Dialog.confirm(...)`、`Dialog.prompt(...)`、`Dialog.actionSheet(...)`。不要改写为独立的全局 `alert/confirm/prompt/actionSheet`，也不要从 `"scripting"` 导入 `Dialog`；当前 SDK 类型可能未导出该运行时命名空间。类型检查缺少声明时，可在项目中按实际使用范围添加 `declare const Dialog: ...`（旧项目也可暂用 `any`），但调用仍必须保留 `Dialog.` 前缀。

- `Dialog.alert` / `Dialog.confirm` / `Dialog.prompt` / `Dialog.actionSheet` 一律用**对象参数**形式：`confirm({ message, title?, cancelLabel?, confirmLabel? })`、`alert({ message, title?, buttonLabel? })`、`prompt({ title, message?, defaultValue?, placeholder?, obscureText? })`。**不要**用位置参数 `confirm(message, title)`——第二个参数不会被当成标题，会导致标题空白。
- `Dialog.confirm` 返回 `Promise<boolean>`；只有严格为 `true` 才执行确认操作。
- `Dialog.prompt` 返回输入字符串或 `null`；必须先判断 `result == null` 处理取消，空字符串是否有效由业务自行决定。
- `Dialog.actionSheet` 返回所选 `actions` 的从 `0` 开始索引，取消返回 `null`。必须按数组实际顺序判断，不要凭按钮文案或经验猜测。
- 同时在 `actions` 中提供“取消”项时，设置 `cancelButton: false`，避免系统额外添加取消按钮并导致索引或交互与预期不一致。
- 调用后先保存并明确判断返回值，再执行删除、覆盖、清空、还原、提交等后续操作；取消或未知返回值默认不执行。
- 仅危险操作按钮设置 `destructive: true`，普通确认按钮不要滥用危险样式。
- 封装通用确认函数时，由 helper 自己构造并维护 actions 与索引映射，或显式返回语义化结果。
- 对话框只负责收集用户选择；实际操作、异常处理、Toast 和数据刷新留给调用方。
