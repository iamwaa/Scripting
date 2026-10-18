---
name: background-http-server-dies-on-appswitch
description: 交互式任务不能靠常驻服务或 interactive 模式——服务会被回收，Python 又是 batch-only
metadata:
  type: feedback
---

**结论：任何「需要用户交互输入」的流程都必须拆成「参数化的 batch 步骤 + 状态落盘」。** 两个独立原因：

**1) `mode: "interactive"` 对 Python 不可用。** 实测报 `This embedded runtime is currently batch-only. Use mode=batch.`。所以 `input()`、以及 telethon 的 `client.start()` 那种交互式登录根本无法在 agent shell 里跑（它会因为读不到 stdin 而直接退出，看起来像静默成功）。

**2) 后台起的常驻 HTTP 服务会被系统回收。** 用 `shell` 的 `background: true` 起 Python `aiohttp` 服务，本机 `curl 127.0.0.1:<port>` 能通；但用户切到 Safari 打开该地址时报「无法打开网页」，此时再 curl 得到 `Connection refused`——App 退到后台时后台 Python 进程被回收，端口随之释放。

**判活陷阱**：`shell read` 仍显示 `state: running`（残留状态，不可信）；判活必须实际探测端口（`curl -m 5`）。`ps` / `netstat` 在此环境不可用（`Command not found`）。

**正确做法**（Telegram 登录实测可行）：把流程切成若干正常结束的 `python3` 进程，跨步状态写 JSON 文件（**用绝对路径**——脚本内 `os.chdir` 后相对路径会落到错误目录，见 [[MEMORY]] chdir 条）：

- `send_code <phone>` → 请求验证码，把 `phone` + `phone_code_hash` 落盘后退出
- `sign_in <code>` → 读盘里的 hash 完成登录
- `password <pw>` → 两步验证（Telethon 的密码分支只走 `GetPasswordRequest` + `CheckPasswordRequest`，不依赖上一步的 `phone_code_hash`，跨进程可用）

工具落地在工作区 `tmp/tests/tg_login.py`（本项目场景为 GitHub/tg-auto-checkin 生成 session）。用完记得删掉含 hash 的状态文件。

同类：[[pip-sdist-manual-unpack-ios]]
