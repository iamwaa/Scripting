---
name: python-session-module-cache
description: Agent shell 连续 Python 执行可能保留 sys.modules，修改被导入模块后须显式重载才能验证新实现。
metadata:
  type: reference
---

## 现象 → 触发 → 规避

同一 Agent shell 会话里连续执行 `python3`，被导入的本地模块可能仍是上次版本：文件已通过 file_tool 改好，下一次测试却运行旧函数，甚至警告仍显示修改前的源码行。2026-09-13 实测 `wm_unmix.decode` 改为 `with open(...)` 后，重复运行测试仍报旧 `open(...).read()` 的 ResourceWarning；显式 reload 后同一测试全部通过且警告消失。

规避：修改被 import 的 Python 文件后，测试入口按依赖顺序重载，不以“新启动 python3”当作干净进程保证。

```python
import importlib
import lower_module
importlib.reload(lower_module)
import higher_module
importlib.reload(higher_module)
```

如果文件是入口脚本可用 `runpy.run_path(path, run_name="__main__")` 重跑入口，但入口再次 import 的依赖仍需上述 reload。仅 `importlib.invalidate_caches()` 刷新的是查找缓存，不能代替重载已在 `sys.modules` 中的对象。此经验针对 Scripting Agent 的本机嵌入式 Python 会话，不代表桌面 CPython 独立进程的通常行为。
