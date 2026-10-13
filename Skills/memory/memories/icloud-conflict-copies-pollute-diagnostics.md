---
name: icloud-conflict-copies-pollute-diagnostics
description: iCloud 同步冲突副本（文件名带 " 2."）留在项目目录会污染全项目 TypeScript 诊断，报一堆假错误；先隔离再诊断
metadata:
  type: reference
---

**现象 → 触发条件 → 规避写法**

- **现象**：`get_typescript_diagnostics script_name=<项目>` 突然报一串与本次改动无关的错误——典型是「Cannot redeclare block-scoped variable 'Dialog'/'fetch'/'Buffer'」「Property 'xxx' is missing in type ... but required in type ...」，错误路径都指向带 ` 2` 后缀的文件（如 `globals.d 2.ts`、`RepoDetailContent 2.tsx`）。
- **触发条件**：项目在 iCloud 同步的 `scripts/` 目录里，历史上发生过同步冲突，iOS/文件提供程序自动生成了 `文件名 2.扩展名` 的旧版副本留在原地。这些副本会被 TypeScript 当成真实 TS 文件参与整个项目的类型检查（`globals.d 2.ts` 里的 `declare` 与新版 `globals.d.ts` 重复声明、旧组件文件的接口定义与新版 hooks 的类型签名不匹配），于是产生纯属垃圾的错误。
- **规避写法**（实测 gitgit 2026-10-12，136 个冲突副本、9 个假错误）：
  1. 看到全项目诊断报错且路径含空格+数字后缀时，先确认：`find <项目> -name "* 2.*"`。mtime 早于本次会话 = 历史遗留，不是本次产生的。
  2. 不要直接删除——先确认每个副本都有同主文件（`fn.replace(" 2.", ".")` 存在）；有主文件才移走，无主文件的保守保留并报告。
  3. 用 Python `os.walk` + `shutil.move` 移到 agent 工作区（保留相对路径 + 写 `_manifest.txt` 清单，可逆）。移动（不是复制/删除）避免 iCloud 再次同步出新副本。
  4. 再跑全项目诊断，即为真实状态。备份（project-auto-backup）含全部副本 + 本地文件，任何时候可恢复。
  5. 隔离后若用户确认没问题，工作区里的暂存副本可随后删除；不要在项目目录里留 `* 2.*`。