---
name: qr-on-ios-runtime-and-python
description: Scripting 的 QRCode 模块在当前构建里是 undefined（文档超前）；生成/校验二维码改用本机 Python 的 segno + 在线解码接口
metadata:
  type: reference
---

**现象**：`import { QRCode } from "scripting"` 后 `QRCode` **整个是 undefined**（报 `TypeError: undefined is not an object (evaluating 'scripting_1.QRCode')`），文档里写的 `parse` / `parseImage` / `generate` / `scan` 四个方法一个都用不了。
`scripting_reference` 的 `QRCode` 文档内容完整（含示例），属于**文档超前于 App 构建**，与 `FileManager.addFileBookmark` 那批同一类坑（先 `typeof` 探测再决定路线，别照文档直接写）。

**本机可用的替代路线（实测）**：

- **生成**：Python 侧已装 `segno`（1.6.6，纯 Python、无需 PIL）——
  `segno.make(text, error="m").save(path, scale=8, border=2)` 直接落 PNG。
  另有 ffmpeg 可做放大/二值化（见 [[loon-mitm-breaks-python-tls]] 同目录的其它 ffmpeg 条目）。
- **在线生成**（segno 不可用时的回退）：`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=<urlencoded>` 实测返回真 PNG（magic `89504e47`）。
  ⚠️ `https://api.cl2wm.cn/api/qrcode/code?text=...` **已失效**：返回 clewm.net 的 HTML 网页而不是图片，别再让用户打开。
- **解析/校验**：本机 Python 没有 numpy / cv2 / pyzbar（无本地解码器）。实测 `https://api.qrserver.com/v1/read-qr-code/` 可用 multipart 上传：
  ```bash
  curl -s -F "file=@qr.png" "https://api.qrserver.com/v1/read-qr-code/"
  # → [{"type":"qrcode","symbol":[{"seq":0,"data":"<原文>","error":null}]}]
  ```

**可照抄的交叉验证法**（判断"生成的二维码到底能不能扫出正确内容"）：本地 segno 生成 → 上传 `read-qr-code` → 比对返回的 `data` 与原始文本是否逐字相同。
实测用 141 字符的 URL（version 8 / ECC M）通过。**只拿测试文本验证，线上二维码里若含登录 auth_code 等凭据，绝对不要上传给第三方。**

**影响面**：任何想在这台设备上"生成二维码给用户扫"的脚本（典型：B 站 TV 扫码登录，见 `bili-hardcore` 技能的 `qrcode` 子命令）。
