---
name: scripting-runtime-globals-not-exports
description: FileManager / Path / Dialog 是运行时注入的全局对象，从 "scripting" 具名导入得到 undefined
metadata:
  type: reference
---

**现象**：`import { FileManager, Path } from "scripting"` 后调用 `FileManager.documentsDirectory` 抛 `TypeError: undefined is not an object (evaluating 'scripting_1.FileManager.documentsDirectory')`；换成 `FileManager.temporaryDirectory` 同样是 undefined。

**触发条件**：在 intent / 普通脚本里把 `FileManager`、`Path` 当成模块导出导入。它们与 `Dialog` 一样是运行时注入的全局命名空间，SDK 只提供全局类型声明。

**规避**：不要写进 import 列表。直接当全局用（`FileManager.readAsStringSync(...)`），或类型上拿不到全局时用 `(globalThis as any).FileManager`。`Script`、组件（`List` / `Text` 等）仍是 `"scripting"` 的正常导出。

**实测附带结论**（intent 环境）：

- `FileManager` 的 `Object.getOwnPropertyNames()` 返回空数组（原生对象不可枚举），别用枚举来判断某属性是否存在。
- `FileManager.temporaryDirectory` 实测为 `undefined`，文档里写了但构建没有；`FileManager.documentsDirectory` 可用，路径形如
  `/var/mobile/Containers/Data/Application/<UUID>/Documents/`（**末尾带斜杠**，拼路径前先收一下）。
- **`Path` 两头都别扭**：它没有全局类型声明（写 `Path.join(...)` 报 `Cannot find name 'Path'`），但类型层面又能从 `"scripting"` 导入（`export Path`），而运行时那个导入实测不可用。要拼路径就别靠 `Path`，自己写两行：

```ts
function joinLocal(directory: string, name: string): string {
  return `${directory.replace(/\/+$/, "")}/${name}`
}
```

区分：`FileManager` / `Dialog` 是「有全局声明、无模块导出」，`Path` 是「有模块导出声明、无全局声明」——两种写法相反，都是坑。

**排查提示**：这类 undefined 异常在 `run_intent` 里表现为整段超时、拿不到任何返回，很有误导性。想确认是「卡住」还是「早期抛错」，先跑一个只做同步读写的极小探针，把返回值走 `Script.exit(...)` 带出来。

相关：[[project-storage-probe]]
