---
name: python-urllib-unverified-context-trap
description: 本机 Python 里只换 ssl._create_default_https_context 无效，必须同时把 urllib.request._opener 置 None 才真能关掉证书校验
metadata:
  type: reference
---

**现象**：想给本机 Python 关掉 TLS 校验（绕 MITM 代理，见 [[loon-mitm-breaks-python-tls]]），写了教科书式的
`ssl._create_default_https_context = ssl._create_unverified_context`，**依然报 CERTIFICATE_VERIFY_FAILED**，看起来像补丁失效。

**原因（实测定位）**：本机 Python 3.13 在解释器启动阶段就已经构建好了 urllib 的全局 opener —— `urllib.request._opener` 导入后**不是 None**，它内部固化了校验版 context。
`https_open` 走的是 `self._context`，所以后续再改 `ssl._create_default_https_context` 对已建好的 opener 没有作用（新 `HTTPSHandler()` 实例才用新默认值，实测其 `_context.verify_mode == 0`）。

**规避写法（可直接照抄，两步都要）**：

```python
import runpy, ssl, sys, urllib.request

ssl._create_default_https_context = ssl._create_unverified_context
urllib.request._opener = None          # 关键：逼 urlopen 用新默认值重建 opener

if __name__ == "__main__":
    sys.argv = ["bili_quiz.py"] + sys.argv[1:]
    runpy.run_path("/绝对/路径/目标脚本.py", run_name="__main__")
```

这样写就能**不修改目标脚本**地改掉它的 urllib 行为，argv 原样透传，用法与直接调用目标脚本一致。本机实例：agent 工作区 `tmp/tests/bili_noverify.py`（bili-hardcore 专用包装器）。

**自检**：改完先跑一次 `python3 -c 'import ssl,http.client,urllib.request as u; ssl._create_default_https_context=ssl._create_unverified_context; u._opener=None; print(u.HTTPSHandler()._context.verify_mode)'`，打印 `0` 才说明生效。
顺带排除干扰项：`urlopen(url, context=ssl._create_unverified_context())` 这种显式传 context 的写法一直是好的（实测 TLS 通过、只是被服务端以业务码拒绝），说明问题只在"默认 context"这条链上。
