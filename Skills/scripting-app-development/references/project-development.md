# Scripting 项目开发参考

本文仅保存从 Scripting 中文官方文档提炼的稳定开发模式，不作为最新 API 清单。实现前始终读取 [官方 llms.txt](https://scriptingapp.github.io/zh/llms.txt) 并打开对应页面确认具体签名、版本和限制。

## 目录

- 运行模型
- 入口文件与终止方式
- 普通 UI 模式
- Widget 模式
- Intent 模式
- AppIntent 与交互扩展
- Live Activity 模式
- 数据、网络与文件
- 权限与兼容性
- 建议项目结构
- 常见错误

## 运行模型

Scripting 使用 TypeScript 和类 React 的 TSX 函数组件描述由 SwiftUI 包装的原生视图。组件和宿主 API 从 `scripting` 包导入。相似语法不代表具有浏览器 DOM、React DOM、React Native 或 Node.js 运行时。

`Script.env` 可区分主要环境：

| env | 典型入口 | 用途 |
| --- | --- | --- |
| `index` | `index.tsx` | 主 App UI 和普通脚本逻辑 |
| `widget` | `widget.tsx` | 主屏幕小组件 |
| `control_widget` | `control_widget_button.tsx` / `control_widget_toggle.tsx` | 控制中心或锁屏控件 |
| `notification` | `notification.tsx` | 富通知 UI |
| `intent` | `intent.tsx` | 分享面板和快捷指令 |
| `app_intents` | `app_intents.tsx` | AppIntent 注册与执行 |
| `assistant_tool` | `assistant_tool.tsx` | 智能助手工具 |
| `keyboard` | `keyboard.tsx` | 自定义键盘 |
| `live_activity` | `live_activity.tsx` | 实时活动 UI |

## 入口文件与终止方式

| 目标 | 必要模式 | 关键限制 |
| --- | --- | --- |
| 普通 UI | `await Navigation.present(...)` 后 `Script.exit()` | 页面关闭后释放脚本资源 |
| 后台普通脚本 | 完成工作后 `Script.exit(result?)` | 显式结束执行 |
| Widget | `Widget.present(<View />)` | 一次性渲染；调用后上下文立即销毁 |
| Intent | `Script.exit(Intent.text/json/file/...(...))` | 返回给分享面板、Shortcuts 或调用脚本 |
| 控制中心 | `ControlWidget.present(...)` | 按钮文件只能呈现按钮，开关文件只能呈现开关 |
| 富通知 | `Notification.present(...)` | 通知安排时需启用 `customUI` |
| Live Activity | 注册 UI builder，再由普通脚本创建实例并 `start/update/end` | 状态必须可 JSON 序列化 |

## 普通 UI 模式

推荐让 `run()` 统一管理呈现和退出：

```tsx
import {
  Navigation,
  NavigationStack,
  Script,
  Text,
  VStack,
} from "scripting"

function App() {
  return (
    <NavigationStack>
      <VStack navigationTitle="示例">
        <Text>Hello, Scripting!</Text>
      </VStack>
    </NavigationStack>
  )
}

async function run() {
  try {
    await Navigation.present({ element: <App /> })
  } finally {
    Script.exit()
  }
}

run()
```

使用 `useState`、`useEffect`、`useReducer`、`useMemo`、`useCallback` 和 context 时遵守 React 式依赖与清理规则。对 timer、listener 和 subscription 在 effect cleanup 或外层 `finally` 中释放。

## Widget 模式

入口为 `widget.tsx`：

```tsx
import { Text, VStack, Widget } from "scripting"

function WidgetView({ title }: { title: string }) {
  return (
    <VStack>
      <Text>{title}</Text>
    </VStack>
  )
}

async function run() {
  const model = await loadWidgetModel()
  Widget.present(<WidgetView title={model.title} />)
}

run()
```

必须遵守：

- 在 `Widget.present` 前完成所有异步数据准备。
- 不在其后放置写入、日志、刷新或清理等必要逻辑。
- 不依赖 Hooks；小组件是一次性渲染，没有持续交互生命周期。
- 控制嵌套视图与图片大小；官方文档指出 iOS Widget 约有 30 MB 内存限制。
- 使用 `Widget.family`、`Widget.displaySize` 和 `Widget.parameter` 适配尺寸和配置。
- 开发阶段可从 `index.tsx` 使用 `Widget.preview(...)`；最终在真实主屏幕验证。
- 开发刷新优先 `Widget.reloadTestWidgets()`；用户小组件使用 `Widget.reloadUserWidgets()` 或 `Widget.reloadAll()`。
- Widget 可访问 App Group 文件，不能假定可访问普通 `documentsDirectory`。

## Intent 模式

`intent.tsx` 可读取：

- `Intent.shortcutParameter`
- `Intent.textsParameter`
- `Intent.urlsParameter`
- `Intent.imagesParameter`
- `Intent.fileURLsParameter`

返回值使用 `Intent.text`、`Intent.attributedText`、`Intent.url`、`Intent.json`、`Intent.file`、`Intent.fileURL`、`Intent.image` 或 `Intent.view` 包装，再传给 `Script.exit(...)`。

```tsx
import { Intent, Script } from "scripting"

async function run() {
  const input = Intent.textsParameter?.[0]?.trim()
  if (!input) {
    Script.exit(Intent.json({ ok: false, error: "缺少文本输入" }))
    return
  }

  const result = await processText(input)
  Script.exit(Intent.json({ ok: true, result }))
}

run()
```

大文件或图像任务优先让用户从 “Run Script in App” 前台模式运行。若展示 UI，等待 `Navigation.present` 完成后再退出。

## AppIntent 与交互扩展

把可复用意图集中注册在 `app_intents.tsx`：

```tsx
import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"

export const RefreshIntent = AppIntentManager.register({
  name: "RefreshIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async (params: { id: string }) => {
    await refreshItem(params.id)
    Widget.reloadAll()
  },
})
```

从 Widget 或 Live Activity 的 `Button` / `Toggle` 绑定工厂创建的 intent。意图名保持唯一且稳定。执行后按目标表面刷新 Widget 或 ControlWidget。

控制中心规则：

- `control_widget_button.tsx` 只把 `ControlWidgetButton` 传给 `ControlWidget.present`。
- `control_widget_toggle.tsx` 只把 `ControlWidgetToggle` 传给 `ControlWidget.present`。
- Toggle 的参数类型必须包含 `value: boolean`。
- 状态改变后调用 `ControlWidget.reloadButtons()` 或 `ControlWidget.reloadToggles()`。

## Live Activity 模式

在 `live_activity.tsx` 中通过 `LiveActivity.register(name, builder)` 注册 UI。builder 覆盖锁屏内容、Dynamic Island compact leading/trailing、minimal 和 expanded 区域。

在普通脚本中创建注册工厂的实例，然后按顺序：

1. 检查 `LiveActivity.areActivitiesEnabled()`。
2. `await activity.start(contentState)` 并确认返回 `true`。
3. 仅在成功启动后调用 `update(...)`。
4. 完成时调用 `end(...)`。
5. 移除 update listener，并停止 `BackgroundKeeper` 等资源。

`contentState`、更新和结束状态必须是 JSON 可序列化对象。Live Activity 需要的图片或文件放在 `FileManager.appGroupDocumentsDirectory`。

## 数据、网络与文件

### Storage

`Storage` 适合字符串、数字、布尔值、JSON 和小型 `Data`：

```ts
import { Storage } from "scripting"

type Settings = { endpoint: string; refreshMinutes: number }

Storage.set("settings", { endpoint: "https://example.com", refreshMinutes: 30 })
const settings = Storage.get<Settings>("settings")
```

默认数据按脚本隔离；`{ shared: true }` 可跨脚本共享。`Storage.clear()` 只清理当前脚本私有域。大型二进制不要放进 Storage。

### FileManager

- 用户在文件 App 中可见：`FileManager.documentsDirectory`。
- Widget / Live Activity 共享：`FileManager.appGroupDocumentsDirectory`。
- 临时文件：`FileManager.temporaryDirectory`。
- iCloud：先检查 `FileManager.isiCloudEnabled`，必要时下载云端文件。
- 性能敏感路径优先异步 API，避免同步文件操作阻塞 UI。
- 路径拼接和具体方法签名先查询 `FileManager` 与 `Path` 官方页面。

### fetch

Scripting 的 `fetch` 接近标准 Fetch，但带原生扩展。HTTP 4xx/5xx 不会自动 reject，必须检查 `response.ok`。

```ts
async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    timeout: 15,
    debugLabel: "Load API data",
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return (await response.json()) as T
}
```

默认不会自动保存或携带 Cookie；需要会话时读取 `response.cookies` 并显式管理。上传文件可使用 `FormData` 和 `Data.fromFile(...)`。超时或主动取消使用 `AbortController`。

## 权限与兼容性

用户开启按脚本权限后，下列能力可能需要单独授权：`calendar`、`reminders`、`alarms`、`contacts`、`location`、`homeKit`、`photos`、`health`、`clipboard`、`fileSystem`。

在可显示 UI 的 `index.tsx` 中，可预先调用：

```ts
const granted = await Script.requestAccess(["calendar", "reminders"])
```

小组件、键盘、通知和分享扩展等不能呈现授权 UI 的环境不会弹框。先让用户从主 App 运行并授权，或设计拒绝授权时的降级路径。

同时检查：

- 对应设备能力的系统权限。
- `Script.hasFullAccess()` 或具体 API 的 PRO 限制。
- 官方页面标注的最低 iOS 版本。
- 真实设备支持情况，例如 Dynamic Island、HealthKit、相机或蓝牙。

## 建议项目结构

按需求选择文件，不要创建空入口：

```text
project/
├── index.tsx
├── widget.tsx
├── intent.tsx
├── app_intents.tsx
├── live_activity.tsx
├── components/
│   ├── EmptyState.tsx
│   └── ItemRow.tsx
├── services/
│   ├── api.ts
│   └── storage.ts
├── model/
│   └── types.ts
└── utils/
    └── format.ts
```

小型项目可保持扁平。跨入口共享的逻辑必须避免在 import 时执行只适用于某个宿主环境的副作用。

## 常见错误

- 使用了 React DOM 属性、HTML 标签、CSS 或 Node 内置模块。
- 凭 SwiftUI 名称猜测 Scripting 组件属性。
- 忘记在普通 UI 关闭后调用 `Script.exit()`。
- 把必要逻辑写在 `Widget.present()` 之后。
- 在 Widget 中使用 Hooks 并期待状态更新。
- 对 4xx/5xx 响应直接调用 `json()` 而不检查状态。
- 把 token 等秘密保存到普通 Storage；敏感凭据应查询并使用 Keychain。
- 让 Widget 或 Live Activity 读取普通 Documents/iCloud 文件。
- 在扩展环境首次调用敏感 API，却没有预先授权或降级处理。
- 忽略 AppIntent 参数和 Live Activity state 的序列化限制。
- 只在应用内预览 Widget，没有在主屏幕和不同 family 测试。
