---
name: github-actions-job-logs
description: GitHub Actions job 日志 API 需要仓库 admin 权限，公开仓库也一样；无权限时用浏览器展开步骤 DOM 抓日志
metadata:
  type: reference
---

**现象**：`api.github.com/repos/<o>/<r>/actions/jobs/<id>/logs` 对非 admin token 一律返回 403 `{"message":"Must have admin rights to Repository."}`，即使仓库公开、job 元数据（steps/conclusion）可读；`check-runs/<id>/annotations` 端点也常被未认证限流挡住。GitHub MCP 工具集（官方版）没有 Actions 日志类工具。

**规避**：用 browser 打开 `https://github.com/<o>/<r>/actions/runs/<run_id>/job/<job_id>`，日志是懒加载的：找到文本恰好等于失败步骤名的 `<a>` 元素（`href` 形如 `#annotation:9:125`）`click()`，等 network idle 后 `document.body.innerText` 就含完整日志（含 error/notice 注解）。用户也可以在 Actions 页面手动下载完整日志 zip，结构为 `<job名>_<步骤号>_<步骤名>.txt`（时间戳前缀、ANSI 色码）加顶层 `<n>_<job>.txt` 汇总，解压用 Python zipfile 落盘（见 [[agent-shell-no-chdir 相关经验，沙箱禁 chdir]]）。

相关：仓库快照/限流经验见全局 MEMORY「拉 GitHub 仓库快照」条目。
