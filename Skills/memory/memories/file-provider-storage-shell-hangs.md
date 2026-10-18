---
name: file-provider-storage-shell-hangs
description: GitHub 目录位于 File Provider Storage，shell 命令（ls/cp 等）会挂死超时，改用 file_tool 读写与 copy
metadata:
  type: reference
---

**现象 → 触发条件 → 规避写法**

- 现象：对 `/var/mobile/Containers/Shared/AppGroup/<UUID>/File Provider Storage/GitHub/...` 下的仓库执行 shell 命令（如 `ls -la`）会一直无输出，120 秒后 `cmd_exit_code: 124` + `cmd_timed_out: true`；同一路径用 `file_tool read/search_in_file` 完全正常，秒回。
- 触发条件：凡是工作区 `additional_folders` 里那个 File Provider 挂载的 GitHub 目录（`GitHub/` 下各仓库），shell 侧不可访问（沙箱无该 File Provider 挂载）。工作区自身路径（含 `tmp/`）不受影响，`curl` / `python3` / `grep` 都正常。
- 规避：读写、列举、检索、备份一律走 `file_tool`——列目录用 `read`（传目录），复制文件用 `command: copy`（`path` → `to_path`），别用 `cp`；要在这些仓库里做批量处理，先把文件 `copy` 到工作区 `tmp/` 再交给 shell。
