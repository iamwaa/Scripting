# Project File Organization 使用说明

`project-file-organization` 是一个 Scripting 项目文件摆放规范 skill。它定义了标准的目录结构和命名约定，指导 agent 在创建新项目、添加文件或整理项目结构时，把文件放在正确的位置。

## 适用场景

- 创建新项目时，确定目录结构
- 添加新文件时，决定放在哪个目录
- 项目逐渐变大后，从单文件拆分为目录结构
- 整理已有项目的文件布局

## 标准目录结构

```
项目名/
├── index.tsx          # 入口文件（必须）
├── script.json        # 脚本元数据（必须）
├── intent.tsx         # Shortcuts/Share Sheet 意图入口（可选）
├── widget.tsx         # 桌面小组件入口（可选）
│
├── components/        # 可复用 UI 组件
├── pages/             # 页面/屏幕级组件
├── utils/             # 工具函数
├── hooks/             # 自定义 Hooks
├── constants/         # 常量定义
├── types/             # 类型定义
├── api/               # 接口请求/数据获取
├── services/          # 业务逻辑服务
├── contexts/          # React Context 状态管理
├── modules/           # 功能模块（按业务划分）
│
├── assets/            # 静态资源（图片、图标等）
└── polyfill/          # 兼容性补丁
```

## 各目录说明

| 目录 | 放什么 | 示例文件 |
|------|--------|---------|
| `components/` | 可复用 UI 组件，通常不含页面级逻辑 | `Button.tsx`, `Card.tsx`, `SearchBar.tsx` |
| `pages/` | 页面/屏幕级组件，一个文件对应一个完整页面 | `SettingsPage.tsx`, `DetailPage.tsx` |
| `utils/` | 纯工具函数，无副作用，可被任何地方调用 | `format.ts`, `storage.ts`, `validate.ts` |
| `hooks/` | 自定义 React Hooks，封装可复用的状态逻辑 | `useDebounce.ts`, `useStorage.ts` |
| `constants/` | 常量、枚举、配置值 | `colors.ts`, `config.ts`, `defaults.ts` |
| `types/` | TypeScript 类型定义和接口 | `index.ts` 或按功能拆分 |
| `api/` | 接口请求、数据获取相关函数 | `fetchStore.ts`, `endpoints.ts` |
| `services/` | 封装业务逻辑，比 utils 更重、有副作用 | `authService.ts`, `downloadService.ts` |
| `contexts/` | React Context Provider，全局状态管理 | `ThemeContext.tsx`, `AuthContext.tsx` |
| `modules/` | 按功能/业务划分的独立模块，内含自己的组件和逻辑 | `login/`, `search/`, `payment/` |
| `assets/` | 图片、图标、字体等静态资源 | `logo.png`, `icons/` |
| `polyfill/` | 兼容性补丁或全局 polyfill | `fetch.ts`, `array.ts` |

## 命名约定

- **组件文件名**：PascalCase — `MyComponent.tsx`
- **工具/服务文件名**：camelCase — `formatDate.ts`, `authService.ts`
- **目录名**：全小写 — `components/`, `utils/`, `hooks/`
- **入口文件**：统一用 `index.tsx`
- **类型文件**：`types.ts` 或 `types/index.ts`
- **常量文件**：`constants.ts` 或 `constants/index.ts`

## 按项目规模选择

### 小项目（< 10 个文件）

不需要目录，用单文件组织即可：

```
项目名/
├── index.tsx
├── script.json
├── components.tsx    # 所有组件放一个文件
├── utils.ts          # 工具函数
└── pages.tsx         # 页面组件
```

### 中型项目（10-30 个文件）

按职责拆分目录：

```
项目名/
├── index.tsx
├── script.json
├── types.ts
├── constants.ts
├── components/
│   ├── Header.tsx
│   └── Card.tsx
├── pages/
│   ├── HomePage.tsx
│   └── SettingsPage.tsx
└── utils/
    ├── format.ts
    └── storage.ts
```

### 大型项目（30+ 文件）

完整目录结构，可加 `modules/` 按业务拆分。

## 单文件行数规范

文件数量不是唯一标准，**单文件行数**同样重要。即使只有 2 个文件，如果单个文件超过 200 行也应开始关注职责边界；超过 300 行时必须做结构审查，但不代表机械拆分；超过 500 行时通常应拆分；超过 800 行时除少数例外外应拆分。

| 单文件行数 | 建议 |
|-----------|------|
| < 200 行 | 保持现状，无需拆分 |
| 200-300 行 | 开始留意函数/组件是否太胖，可考虑按职责拆分 |
| 300-500 行 | 必须做结构审查：职责混合或边界清晰时拆分；复杂但内聚的页面、声明式 UI、schema/config、数据文件可保留并说明原因 |
| 500-800 行 | 除非有强内聚或行为风险理由，否则基本应拆分 |
| > 800 行 | 几乎肯定要拆分；仅生成式数据/config/极少数强内聚声明文件可例外并说明原因 |

判断是否需要拆分的信号：

- 一个文件同时包含类型定义、工具函数、UI 组件和页面逻辑
- 文件顶部的 import 列表很长（超过 15 行）
- 需要频繁滚动才能找到目标代码
- 新增功能总是改同一个大文件，冲突和回归风险变高
- 某段逻辑可以独立复用、测试或替换

可以暂不拆分的信号：

- 文件虽长，但仍是一个内聚页面或单一工具流程
- 主要是声明式 UI、schema/config、静态数据或生成式数据
- 拆分后只会制造人工跳转，不能减少复杂度
- 当前拆分会带来明显行为风险，应先完成验证再拆

## 检查脚本

提供了一个 Python 检查脚本 `scripts/check.py`，可以扫描项目目录并报告文件摆放情况：

```bash
python3 ".../check.py" '{"project_path":"/path/to/project"}'
```

脚本会检查：
- 是否有必需的入口文件（`index.tsx`、`script.json`）
- 是否有可选入口文件（`intent.tsx`、`widget.tsx`）
- 文件是否放在标准目录中
- 是否有文件使用了非标准命名（如组件文件未用 PascalCase）
- 单文件行数是否触发 200/300/500/800 分档结构审查

## 与其他 Skill 的关系

- **project-auto-backup**：在重新组织项目结构之前，应先使用备份 skill 保存当前项目。
- **project-code-cleanup**：创建或移动文件后，使用清理 skill 确保格式一致、注释规范、无多余代码。
