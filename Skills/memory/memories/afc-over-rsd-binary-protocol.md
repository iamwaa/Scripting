---
name: afc-over-rsd-binary-protocol
description: AFC 服务走 RSD 时不是 plist 帧，而是 CFA6LPAA 40 字节二进制包头；语义细节与实测取值
metadata:
  type: reference
---

**现象**：连上 `com.apple.afc.shim.remote` 后，`RSDCheckin` 正常完成，但发第一条 plist 帧请求（如 `{Request: "GetDeviceInfo"}`）时连接被立刻重置：`RSD_PEER_RESET`，`stage=tcp-read`。同一时刻 `com.apple.springboardservices.shim.remote` 用完全相同的 `PlistServiceClient` 收发正常——所以不是隧道、名额或签到的问题。

**触发条件**：把 AFC 当成其他 `.shim.remote` 服务那样用「4 字节大端长度 + plist」发帧。AFC 有自己的二进制协议，签到之后就不再说 plist 了。

**包头**（照 libimobiledevice `src/afc.h` 的 `AFCPacket`，全小端）：

```
偏移 0   8 字节  magic = "CFA6LPAA"
偏移 8   8 字节  entire_length（包头 + data + payload）
偏移 16  8 字节  this_length（包头 + data）
偏移 24  8 字节  packet_num（从 1 开始）
偏移 32  8 字节  operation
```

**请求可两段**：包头 + data（计入 this_length）先发，payload 紧跟其后只计入 entire_length。`FileOpen` 用单段（mode 与路径都在 data），`FileWrite` 用两段（handle 在 data、内容在 payload）。

**实测关键结论（iOS 27.0.1 / iPhone19,7）**：

- **错误反馈**：`op=0x01` (Status) 的 body 是 **8 字节小端 u64 errno**，0 表示成功。成功也会走 Status（MakeDir 就是），所以不能见 Status 就当错。errno 取值照 libimobiledevice 的 `afc_strerror`：8 = OBJECT_NOT_FOUND，16 = OBJECT_EXISTS，7 = INVALID_ARG，1 = UNKNOWN_ERROR。注意 8 看起来像 `\b` 控制字符，别当字符串解析。
- **`ReadDir`(0x03)** 一次只回一条 Data，内容是 **NUL 分隔的纯名字列表**（不含 `.` / `..`），**不是** libimobiledevice 里那种「名字 + 40 字节 stat」。发第二条读会挂到超时。
- **`GetFileInfo`(0x0a)** 回 NUL 分隔的键值串：`st_size` / `st_blocks` / `st_nlink` / `st_ifmt`（`S_IFDIR` / `S_IFREG`）/ `st_mtime`（从 2001-01-01 起的纳秒）/ `st_birthtime`。
- **`FileOpen`(0x0d)** 的 data 段是 **mode(u64le) 在前、路径+NUL 在后**（libimobiledevice 里两者顺序被注释成旧写法，实测以本条为准）。回包 8 字节 handle。
- **打开模式只认 1 / 2 / 4**（ReadOnly / ReadWrite / WriteOnly）。带上 `Create`(8) / `Truncate`(16) / `Append`(32) 位一律拒绝：有的回 INVALID_ARG，有的直接 RSD_PEER_RESET。**`WriteOnly`(4) 本身就会新建文件并从偏移 0 覆盖**，所以不需要 Create/Truncate。
- **`FileClose` 是 0x14**（0x12 是 `FileTell`，0x13 是 `FileTellResult`）。用错 opcode 会把连接弄挂。
- **`Truncate`(0x07)** 在 RSD shim 上不能用（回 OBJECT_NOT_FOUND）；靠 WriteOnly 覆盖写来达到截断效果。
- `GetDeviceInfo`(0x0b) 回包是 `this=40 / entire=125` 这种形态，内容全在 entire 多出来的那 85 字节里。**读回包必须按 entire_length 读**，只读 this_length 会错位。

**用法**：先用现成的 `PlistServiceClient.open(...)` 完成 `RSDCheckin`，再从 `(client as any).connection` 取底层 `VPNRSDConnection`，之后全程按上面的二进制格式读写。RSD 连接每次最多写 16384 字节，大包要分块顺序写。

相关：[[rsd-service-table-ios27]]
