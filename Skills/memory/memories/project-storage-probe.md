---
name: project-storage-probe
description: 需要用项目真实 Storage 配置做实测时，用项目内临时 intent.tsx + run_intent，而不是 scripting-ts run 的独立探针
metadata:
  type: reference
---

**现象**：`scripting-ts run tmp/probe.tsx` 里的 `Storage.get(key)` 永远返回 null，`Storage.keys()` 只列出别的脚本的键；也无法 `import` 目标项目的模块。

**触发条件**：想用项目里已保存的配置（baseURL / apiKey / 用户提示词等）跑真实请求做排查。Storage 按脚本域隔离，独立探针文件不属于该项目域。

**规避写法**：在项目目录里临时建 `intent.tsx`，用相对路径 import 项目模块，跑完删除：

```tsx
// 临时探针（用完删除）
import { Script } from "scripting"
import { loadConfig } from "./utils/storage"

async function main() {
  const config = loadConfig()   // 读得到项目真实配置
  Script.exit({ baseURL: config.baseURL } as any)
}
main().catch(e => Script.exit({ error: String(e) } as any))
```

用 `scripting-ts run_intent "<项目名>"` 执行。要点：

- 必须调 `Script.exit(result)`，否则挂到超时；返回值要 `as any`。
- `run_intent` 有自己的执行时长上限（实测长请求 ~4 分钟被掐断，返回 `Execution timeout`）。耗时操作要边跑边 `FileManager.writeAsString` 落盘分步日志，超时后才能看出卡在哪一步。
- **不能写顶层 `await`**：`intent.tsx` 里直接 `const x = await f()` 报 `ReferenceError: Can't find variable: await`（同文件的同步日志仍会输出，容易误判成别的错）。所有异步逻辑包进 `async function main()` 再调用。
- 需要预览项目内组件时同理：`scripting-ts preview_ui` 只转译 sourceRoot 内的文件，工作区里的探针 import 项目组件会报 `resolved path is outside sourceRoot`。可临时把预览文件放进项目目录（如 `preview_probe.tsx`）跑完即删；不依赖真实 Storage 的固定数据 UI 探针也可将必要源码复制到工作区同一根下、使用相对导入。不要直接 import 带自动执行副作用的 `widget.tsx` / `index.tsx`。
- 探针的 dump 文件写工作区 `tmp/tests/`，不要留在项目目录；`intent.tsx` 用完必须删除，否则会被当成项目的 Shortcuts 入口。
