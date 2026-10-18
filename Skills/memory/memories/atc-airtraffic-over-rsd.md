---
name: atc-airtraffic-over-rsd
description: com.apple.atc（AirTraffic 同步）在 RSD 上的实测线协议：小端帧、{Command,Session,Params} 信封、Grappa token 必需、session 0/1 分工。
metadata:
  type: reference
---

iOS 27.0.1 / iPhone 19,7 实测。`com.apple.atc.shim.remote`（RSD 服务表里那个）走 RSDCheckin
后**设备主动推**消息，不需要我们先握手。

**帧格式：4 字节小端长度 + 二进制 plist。** 注意与其它 shim 服务相反（[[afc-over-rsd-binary-protocol]]
里那些是**大端**），照 plist 解析器默认的大端去读会得到 0xB8000000 这种荒唐长度。

**信封**（host → device）只有三个键，没有 `Type`/`Id`：

```
{ Command: <名字>, Session: <0 或 1>, Params: <字典> }
```

`Session` 的分工是硬性的：`HostInfo` 用 **0**，其余同步消息一律用 **1**。用 0 发
`RequestingSync` 会立刻收到 `SyncFailed {ErrorCode: 12, RequiredVersion: "10.5.0.115"}`。

**开场**：设备依次推 `Capabilities`（含 `GrappaSupportInfo = {version:1, deviceType:0,
protocolVersion:1}`）、`InstalledAssets`、`AssetMetrics`、`SyncAllowed`。

**同步流程**：

1. 等 `SyncAllowed`
2. → `HostInfo` (session 0)，Params 要**多包一层**：`{HostInfo: {...}, LocalCloudSupport: false}`
3. → `RequestingSync` (session 1)：`{Dataclasses: ["Book"], DataclassAnchors: {}, HostInfo: {...}, Grappa: <Data>}`
4. ← `ReadyForSync`
5. → `FinishedSyncingMetadata` (session 1)：`{SyncTypes: {Book: 1}, DataclassAnchors: {}}`
   —— 叫这个名，不叫 `MetadataSyncFinished`
6. ← `AssetManifest`：`Params.AssetManifest.Book[]` 每项含 `AssetID`/`IsDownload`
7. → `FileComplete` (session 1) 每项 `{AssetID, Dataclass: "Book", AssetPath: <目标>}`，
   多个之间隔 ~900ms

**Grappa token 是必需的**，不带 token 同步会被静默忽略（只收到 SyncFailed，然后只剩
15 秒一次的 `Ping`）。HostInfo 里 `Type: "iTunes"`、`Version: "13.7.0.161"`、
`MacOSVersion` 可以随便填（"Linux" 都行）。`Wakeable: false`。

**token 是设备无关的静态 84 字节 blob**，按 `(version=1, deviceType=0, protocolVersion=1)`
预生成，可以硬编码重放。实测 10 个候选里 **#1 可用**：

```
01012ba6a01f2ccf66a02613d5b72e0bc916004058a001a6874d18b5bd7b3395e25d79fa3ffcc67e718106d485c51540b828d1620e9f94f582d3bcc6f97e9088c923095ad8d36ab568fb45df61e286d25354b04c
```

`SyncFailed` 一般是非致命的（前一次会话的残留取消），要继续等 `ReadyForSync`；
但**缺 token 时它就是终态**。每个 `Ping` 必须回 `Pong`（session 1），否则连接会被关。

参考实现：`0xjohnnydev/airlift` 的 `Sources/airtraffic_host.m`，
`shinkuan/AirCard-Linux` 的 `crates/aircard-core/src/services/atc.rs`（这份注释最全）。
