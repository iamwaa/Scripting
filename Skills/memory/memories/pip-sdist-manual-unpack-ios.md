---
name: pip-sdist-manual-unpack-ios
description: iOS 上 pip 装纯源码包（sdist）必失败，需手动解包到用户 site-packages
metadata:
  type: feedback
---

**现象**：`pip3 install <包>` 只要依赖链里有 sdist（源码 tar.gz）就报 `ERROR: Error [Errno 45] ios does not support processes.`。加 `--no-build-isolation` 也没用——报错变成 `Preparing metadata (pyproject.toml)` 阶段同样的 `Errno 45`，因为 pip 仍要 fork 子进程跑构建后端。`pip download` 也在此构建里被裁剪（`no such option: -l`）。

**原因**：iOS 沙箱不允许创建进程，pip 的构建隔离和元数据生成都要 fork。

**规避（实测可行）**：纯 Python 的包（无 C 扩展）直接手动解包到**用户级** site-packages。

- 用户级路径（可写）：`/private/var/mobile/Containers/Shared/AppGroup/<appgroup-id>/Documents/python/lib/python3.13/site-packages`，它在 `sys.path` 中**优先于** App bundle 内的 site-packages。
- App bundle 内的 `/private/var/containers/Bundle/Application/<uuid>/Scripting.app/python/lib/python3.13/site-packages` **不可写**，往那里解包报 `PermissionError: [Errno 1] Operation not permitted`。
- 下载走 `pypi.org/pypi/<pkg>/<ver>/json` 拿文件 URL，再用 `zipfile`（wheel）/ `tarfile`（sdist）解包；sdist 要剥掉顶层 `<pkg>-<ver>/` 前缀。
- 主包用 `pip3 install --no-deps --no-build-isolation <name>` 装（wheel 齐全时正常），其纯 Python 依赖手动补。这一步漏掉 `--no-deps` 会被 sdist 卡住。

Telegram 场景实测组合：`telethon` 的 `pyaes`（仅 sdist）、`rsa` → `pyasn1` 都需手动解包；`aiohttp` 的 `multidict`/`frozenlist`/`yarl`/`propcache` 等有 iOS wheel，正常装即可。

同类：[[python-session-module-cache]]
