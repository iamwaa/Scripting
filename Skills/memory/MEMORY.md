# MEMORY.md

跨工作区长期约定。本文件每轮完整注入，只写技能和官方文档没有覆盖的触发条件、短规则与用户偏好，细节交给对应技能；体积大、只在特定场景用得上的长内容（如组件完整实现）拆到 `memories/`，正文只留一行指针，需要时再读。过时或被新决策取代的内容及时改删。

结构：**工作流程**（任务开始到交付的动作）→ **代码与 UI**（写码时的硬约束）→ **踩坑记录**（跨项目通用的实测经验，随时追加）。

---

# 工作流程

## 项目记忆

项目专属且长期有效的记忆写入 `scripts/<项目名>/PROJECT_MEMORY.md`：

- 开始项目相关任务时，若该文件存在，先读它再分析或修改项目。
- 用它沉淀项目架构、关键约束、长期决策、稳定命令、已知陷阱、维护约定；优先修订已有条目，不重复追加。
- 不写一次性进度、临时调试结果、日志、生成物、密钥和 Token。
- 跨项目通用的用户偏好和长期约定留在本文件，不复制进各项目。
- 它是下文「文件落盘」中「项目目录只存项目所需源码与资产」的明确例外，允许留在项目根目录。

## 编辑流程

修改 `scripts/<项目名>/` 下的项目文件时，按需依次使用技能（各自细节读其 SKILL.md）：

1. `project-auto-backup`：编辑前备份。
2. `karpathy-guidelines`：先明确约束、假设与最窄成功标准，再做局部改动。
3. `project-file-organization`：新建文件、扩展结构、重组项目，或本次修改的源文件达到 `300+` 行时，按其目录规范与单文件行数分档做结构审查（可运行该技能目录下的 `scripts/check.py`，注意不是项目根 `scripts/`；结果仅作审查输入）。
4. `project-code-cleanup`：源码修改后、交付前清理并执行最窄有效检查。

只读、仅修改记忆、用户明确不编辑，以及仅处理生成物/vendor/锁文件时，可跳过上述流程。

## 实测探针

需要用项目真实 Storage 配置或项目模块做实测时，按 [项目内探针](memories/project-storage-probe.md) 用临时 `intent.tsx` + `run_intent`，不要用独立文件 `scripting-ts run`（读不到项目 Storage 域）。

## 文件落盘

项目目录只存项目所需源码与资产。以下内容默认放当前 agent 工作区，不得写入 `scripts/<项目名>/`：

- 下载、网页/API 抓取内容：`downloads/` 或 `tmp/downloads/`
- 测试探针、一次性脚本、调试 dump：`tmp/tests/` 或 `scratch/`
- 抓包、导出、日志：`tmp/captures/` 或 `tmp/logs/`
- 外部 bundle、构建产物、压缩包、大体积无关资产：`tmp/reference/`

硬规则：

- 用户未指定下载/测试路径时，默认使用工作区，并在回复中说明实际路径。
- 项目中不放 `node_modules` 片段、整站镜像、`*.chunk.js`、`*.min.js` 等构建产物，以及与 `script.json` entry 同名的无关文件（尤其 `index.js`/`index.ts` 旁路假入口）。
- 项目根出现异常大文件或疑似构建垃圾时，先隔离到工作区或删除，并清理对应 AppGroup `.build/<项目名>/` 脏缓存，再编辑。
- 下载内容先在工作区处理，只将必要的小型结果按项目结构合入源码；备份时可排除已知垃圾。

---

# 代码与 UI

## 代码偏好

- 必要的代码注释使用中文；许可证、生成声明、文档格式和外部项目约定除外。
- 优先根因修复与小范围变更，不顺手改无关问题。

## UI 通则

修改页面、组件、小部件、Live Activity 或通知时：

- 必须适配 Light/Dark：优先系统语义色，自定义颜色分别提供 light/dark 值，禁止只适合浅色的硬编码配色。
- 字号一律用数字（如 `font={16}`），不用 `title`、`headline`、`body`、`caption` 等语义字号名。
- 创建页面/可见 UI 默认读取并遵循 `create-ios-page`（普通系统风格），不主动使用液态玻璃；仅当用户明确要求 Liquid Glass / 液态玻璃风格时，改为读取 `liquid-glass-ui` 并严格照其版本回退、tokens/目录与交付自检执行，不自行复制双套玻璃分支。
- 列表行距（含独立玻璃卡片行需用负 `listRowSpacing`）按 `liquid-glass-ui`「行距」一节，不凭直觉回避负值。
- List / 设置页的文本输入用 FormRow（实现与用法读 [FormRow](memories/formrow.md)，不凭记忆重写）；玻璃页表单用 `liquid-glass-ui` 的 `GlassInput` / `glassControlProps`，按场景择一。

## Dialog 对话框

`Dialog` 是运行时注入的全局命名空间，调用必须保留 `Dialog.` 前缀，不要写成裸 `alert/confirm/prompt/actionSheet`，也不要从 `"scripting"` 导入；SDK 已自带全局类型声明，不需要再补 `declare const Dialog` 或用 `any`。需要标题、自定义按钮文案等任何额外参数时，必须用**对象**形式：`confirm({ message, title })`；只传一个字符串的 `confirm("文本")` 合法但无法带标题，不存在 `confirm(message, title)` 这种位置参数重载（写了标题不会生效）。完整签名查 `scripting_reference` 的 `Dialog` 文档。

- 在 `actions` 中自带「取消」项时设置 `cancelButton: false`，避免系统额外添加取消按钮导致索引或交互错位。
- 先保存并明确判断返回值（`confirm` 严格为 `true`、`prompt` 判 `null`、`actionSheet` 按数组实际顺序取索引），再执行删除、覆盖、清空、还原、提交等操作；取消或未知返回值默认不执行。
- 仅危险操作按钮设置 `destructive: true`。封装通用确认函数时，由 helper 自己维护 actions 与索引映射，或显式返回语义化结果；对话框只负责收集用户选择，实际操作、异常处理、Toast 和数据刷新留给调用方。

---

# 踩坑记录

## 记录规则

**本节只收通用坑：**换个项目、换个功能同样会撞上的平台级行为——Scripting SDK / 组件渲染与动画、iOS 原生 API 语义、参数形式陷阱、运行时与构建限制、iOS 版本差异。判据：这条经验能否原样用在一个还不存在的新项目上。

**项目功能内的坑写该项目 `PROJECT_MEMORY.md`：**业务逻辑边界、接口/字段/配置怪癖、项目自有数据与状态流程的陷阱、只在这一个项目复现的问题——即使当时排查很痛也不入全局。业务/数据层拿不准时先当项目专属处理，等第二个项目再撞上时提升到本节；已能定位到 SDK / 组件 / 系统 API 层的，直接记本节，不用等第二例。

遇到「文档和技能都没写、试出来才知道」的通用行为坑，定位或规避后立刻写，不等用户提醒：

- 格式：**现象 → 触发条件 → 规避写法**，一条一段，尽量给可直接照抄的正确写法；与官方文档冲突时写明「实测以本条为准」。
- 可复现、未来还会遇到才记；一次性环境故障、自己的笔误、已被新版修复的不记。
- 写入前先扫本节，命中已有条目就修订；被官方修复或被更好写法取代时删除。
- 坑天然属于上文某一节（如「Dialog 对话框」「UI 通则」）时并入该节，不在本节重复。

## 已知坑

- **`trailingSwipeActions` 的数组顺序与看到的左右顺序相反。** 数组第一项贴屏幕右缘（滑动起始侧），所以 `[A, B]` 在屏幕上从左到右显示为 `B A`；leading（右滑）同理镜像。想要视觉上“删除 排除”就得写 `actions: [排除, 删除]`。写完先按目标视觉顺序反向排列，不要按阅读顺序直接填。

- **推入页面所在的列表行被移除后，该页面的返回按钮失效。** NavigationLink 的 destination 由列表行持有，子页面里改数据导致父列表重新过滤、该行消失（如归档后移出当前范围、删除后不存在）时，已推入的页面留在屏幕上但 `Navigation.useDismiss()` 不再生效。规避：子页面的数据变更只改自身状态，缓存一个待通知标记，等页面退出时（自定义返回按钮 + 卸载 `useEffect` 兜底）再通知父列表刷新，不要在页面还在栈上时让父列表移除该行。

- **子页面需要自己隐藏底部标签栏。** TabView 里用 NavigationLink 推入的页面默认仍显示 tab bar。在子页面根视图（如 `<List>`）上加 `tabBarVisibility="hidden"` 即可；同类还有 `navigationBarVisibility` / `bottomBarVisibility`，取值 `"automatic" | "hidden" | "visible"`。

- **左滑/右滑菜单按钮不要用 `role`。** `leadingSwipeActions` / `trailingSwipeActions` 的 `<Button>` 一旦设 `role`（如 `role="destructive"`），触发时滑动行会闪动/跳动重绘。改用 `tint` 表达危险语义（如 `tint="red"`）并保持 `title` + `action`，不设 `role`；官方 Swipe Actions 文档的示例用了 `role="destructive"`，实测以本条为准。危险操作的确认交给 `Dialog`。
