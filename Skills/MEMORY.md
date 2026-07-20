# MEMORY.md

跨工作区长期约定。仅保留未来任务中稳定、可执行的规则；过时内容及时删改。

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
