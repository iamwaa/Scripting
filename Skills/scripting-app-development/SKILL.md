---
name: scripting-app-development
description: 使用 Scripting App 的 TypeScript/TSX 与 `scripting` 包设计、创建、修改、诊断和审查 iOS 脚本项目。用于开发 index.tsx 普通 UI、widget.tsx 小组件、intent.tsx 分享与快捷指令、app_intents.tsx 交互意图、Live Activity、控制中心控件、富通知，以及集成网络、存储、文件、设备能力等官方 API；当用户提到 Scripting App、Scripting 项目、scripting 包、TSX 小组件、灵动岛或相关入口文件时使用。
---

# 开发 Scripting 项目

## 执行流程

1. 检查现有项目文件、用户目标、目标 iOS 版本和运行入口。不要把 Scripting 当作浏览器 React、React Native 或 Node.js 项目。
2. 阅读 [project-development.md](references/project-development.md)，根据入口和能力选择适用约束。
3. 在写代码前读取最新的 [官方 llms.txt](https://scriptingapp.github.io/zh/llms.txt)，在返回内容中搜索功能关键词或 API 名，找到对应官方页面。
4. 对任何不确定的组件、属性、方法、返回类型、iOS 版本或 PRO 限制，读取对应官方页面后再实现。不要凭 SwiftUI、React 或 Web API 的相似性猜测 Scripting API。
5. 先确定最小文件结构和数据流，再实现 TypeScript/TSX。优先复用项目已有模块、类型和风格。
6. 按目标运行环境执行生命周期、权限、序列化和资源清理检查。
7. 完成后说明改动文件、依赖的 Scripting 能力，以及必须在 Scripting App 或真实 iOS 表面上进行的验证。

## 定位官方文档

每次执行任务时重新读取 `https://scriptingapp.github.io/zh/llms.txt`，不要依赖记忆中的索引或本地旧副本。优先选择索引中非 `Changelog/` 的规范页面。只有在确认版本新增、迁移或兼容性时才读取 Changelog 页面。

把索引中的相对路径拼接到 `https://scriptingapp.github.io`。路径含空格时进行 URL 编码。读取具体页面后再确认组件属性、方法签名、返回类型、版本和限制。

在 `llms.txt` 返回内容中使用类似以下关键词定位页面：

- `Widget`、`小组件`
- `Storage`、`FileManager`、`fetch`
- `Location`、`Photos`、`Health`、`Notification`
- `NavigationStack`、`List`、`TextField`

若官方索引或目标页面暂时无法联网读取，继续使用 [project-development.md](references/project-development.md) 中的稳定开发模式，但不要猜测未确认的 API；在结果中明确说明哪些签名尚未通过最新线上文档验证。

## 选择入口

- 普通交互页面：使用 `index.tsx`，通过 `Navigation.present(...)` 呈现，关闭后调用 `Script.exit()`。
- 主屏幕小组件：使用 `widget.tsx`，准备完全部数据后调用 `Widget.present(...)`。把它视为最后一步。
- 分享面板或快捷指令：使用 `intent.tsx`，读取 `Intent.*Parameter`，用 `Script.exit(Intent.*(...))` 返回结果。
- 互动小组件或 Live Activity：在 `app_intents.tsx` 注册 AppIntent，再从视图绑定 intent。
- 控制中心按钮：使用 `control_widget_button.tsx`，只呈现 `ControlWidgetButton`。
- 控制中心开关：使用 `control_widget_toggle.tsx`，只呈现 `ControlWidgetToggle`。
- Live Activity UI：使用单独的 `live_activity.tsx` 注册 builder；只传 JSON 可序列化状态。
- 富通知：使用 `notification.tsx` 并调用 `Notification.present(...)`。
- 其他入口如键盘、Assistant Tool、Spotlight：先查对应官方页面和 `Script.env`，再决定文件名与生命周期。

## 编码约束

- 只从 `scripting` 包导入已由官方文档确认的组件、Hooks、类型和 API。
- 使用函数组件和 TSX；为 props、状态、外部数据和 AppIntent 参数声明清晰类型。
- 将 API 调用、持久化和数据转换从大型视图组件中拆出，但避免为小脚本建立过重架构。
- 对网络响应检查 `response.ok`；设置合理 `timeout`，需要取消时使用 `AbortController`。
- 只把轻量、可序列化数据放入 `Storage`；二进制用 `Storage.setData/getData`，大文件用 `FileManager`。
- 需要 Widget 或 Live Activity 访问的文件放入 `FileManager.appGroupDocumentsDirectory`，不要假定它们可访问普通 Documents 或 iCloud 目录。
- 敏感能力先评估 `Script.requestAccess(...)`；在无法显示授权 UI 的扩展环境中不要依赖首次弹框。
- 用 `try/catch/finally` 管理网络、文件、订阅、计时器、后台保活和系统资源。
- 不要在 Widget 中依赖 `useState`、`useEffect` 等 Hooks；Widget 没有持续组件生命周期。
- 不要在 `Widget.present(...)`、`ControlWidget.present(...)` 或扩展的最终呈现调用之后安排必要逻辑。

## 验证清单

- 核对入口文件和 `Script.env` 是否匹配目标表面。
- 核对每个 import、组件属性、方法签名和返回类型是否来自当前官方文档。
- 核对 `Navigation.present`、`Script.exit`、`Widget.present` 等生命周期调用顺序。
- 核对 Widget、Live Activity、Intent 和 Storage 的数据是否可 JSON 序列化。
- 核对设备权限、按脚本权限、PRO 限制和最低 iOS 版本。
- 核对定时器、listener、流、后台任务和文件句柄的释放。
- 核对错误、空数据、拒绝授权、离线、超时和非 2xx 响应路径。
- 对 UI 同时检查小屏、深色模式、动态字体；对 Widget 在真实主屏幕验证各 family。

不要声称能在本地 Node.js 中完整运行 Scripting 宿主 API。可执行静态检查或纯 TypeScript 逻辑测试，但原生 UI、扩展、权限和设备能力必须在 Scripting App/iOS 中验证。
