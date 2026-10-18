---
name: loon-mitm-breaks-python-tls
description: 设备开着 Loon（HTTPS 解密）时，Python urllib 访问被解密的域名（如 bilibili）一律报 CERTIFICATE_VERIFY_FAILED 的判别与规避
metadata:
  type: reference
---

**现象**：Python 脚本（urllib）访问 `api.bilibili.com` 等域名报
`<urlopen error [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1032)>`；
而同一台机器上纯本地命令（如 skill 的 `status`）正常，容易误判成脚本 bug 或"登录态失效"。

**触发条件**：设备上开着 Loon（或同类 MITM 代理）并启用了 HTTPS 解密 —— 只要目标域名在解密列表里就会中招。

**判别（一条命令确认，别猜）**：

```bash
openssl s_client -connect api.bilibili.com:443 -servername api.bilibili.com -showcerts
```

看到 `subject=O = Loon, CN = look.bigmelook.com` / `issuer=O = Loon, CN = LOON CA <ts>` 就是被解密了（Loon 只回传叶子证书，不带 CA 链，所以本地信任库无论如何都补不齐）。证书里的时间戳还能看出 Loon 是何时重新起来的。
Python 侧 `ssl.get_default_verify_paths()` 給的 cafile 是 AppGroup 下的 `Documents/cacert.pem`，里面没有这张 CA（可 `grep -l LOON` 复核）。

**规避（按优先级）**：

1. 让用户关掉 Loon / 把该域名移出解密列表 —— 生效但易被"按需重连"拉回来（实测关掉后曾自动恢复）。
2. 拿到 Loon CA 证书并进 Python 信任链。
3. 不改技能文件、加一层包装器关掉校验（本机实测可用，见 [[python-urllib-unverified-context-trap]]，包装器落在 agent 工作区 `tmp/tests/bili_noverify.py`，argv 原样转发）。

**受影响的已知场景**：`bili-hardcore` 技能（见该技能 SKILL.md 的调用方式），以及任何用 Python urllib 直连国内站点的脚本。用 Safari/WebView 或 curl 的路径不受影响。

**推荐修法（2026-10-15 已落地到 bili-hardcore）**：不要在每次调用外面套包装器，直接在脚本内部封一个 `_urlopen(req, timeout)`：先 `urllib.request.urlopen(req, timeout=timeout)`，捕获 `URLError` 后只在 `"CERTIFICATE_VERIFY_FAILED" in str(e)` 时用 `urlopen(req, timeout=timeout, context=ssl._create_unverified_context())` 重试一次并 `print(..., file=sys.stderr)` 告警（只告警一次）。这样调用方、SKILL.md、argv 全不变，无 MITM 时行为完全不变。注意显式传 `context=` 的写法直接可用，不涉及 [[python-urllib-unverified-context-trap]] 那个坑。

**注意**：Loon 恢复后签发的是全新叶子证书（时间戳即当前时刻），不要把它当成"网络抖动"，出现同样的报错先跑上面那条 s_client 复核环境。
