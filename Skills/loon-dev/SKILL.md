---
name: loon-dev
description: Loon iOS 网络工具开发参考 — URL Scheme、脚本 API、配置规则与插件开发指南。
---

# 用途

当用户需要以下任何内容时，使用此 skill：
- 编写 Loon 脚本（http-request / http-response / cron / network-changed / generic）
- 开发 Loon 插件（含 Argument 交互式参数）
- 通过 URL Scheme 或统一链接控制 Loon
- 查询 Loon 脚本 API（$httpClient、$persistentStore、$config 等）
- 了解 Loon 配置格式（节点、策略、规则、复写）
- 生成 Loon 订阅配置或配置文件

# Loon URL Scheme & 统一链接

Loon 支持通过自定义 URL Scheme 和 HTTPS 统一链接进行外部调用。

## URL Scheme

| 功能 | Scheme |
|---|---|
| 开启 VPN | `loon://on` |
| 关闭 VPN | `loon://off` |
| 编辑配置文件 | `loon://editconfig` |
| 切换全局直连 | `loon://flowmodel=direct` |
| 切换分流模式 | `loon://flowmodel=filter` |
| 切换全局代理 | `loon://flowmodel=proxy` |
| 设置代理为 TUN Only | `loon://proxymode=tun` |
| 设置代理为 HTTP + TUN | `loon://proxymode=mix` |
| 安装远端配置文件 | `loon://import?sub=encode(url)` |
| 导入订阅节点 | `loon://import?nodelist=encode(url)` |
| 导入订阅规则 | `loon://import?rules=encode(url)` |
| 导入插件 | `loon://import?plugin=encode(url)` |
| 导入图标集 | `loon://import?iconset=encode(url)` |
| 导入 geoip 数据库 | `loon://import?geoip=encode(url)` |
| 导入解析器 | `loon://import?parser=encode(url)` |
| 更新所有订阅 | `loon://update?sub=all` |

## 统一链接（Web 跳转）

通过 `https://www.nsloon.com/openloon/` 前缀替代 `loon://`：

```
https://www.nsloon.com/openloon/on
https://www.nsloon.com/openloon/off
https://www.nsloon.com/openloon/flowmodel=direct
https://www.nsloon.com/openloon/flowmodel=filter
https://www.nsloon.com/openloon/flowmodel=proxy
...
```

# Loon 脚本开发

## 脚本类型

Loon 支持以下五种脚本类型：

| 类型 | 触发时机 | 用途示例 |
|---|---|---|
| `http-request` | HTTP 请求发起时 | 修改请求 URL/Header/Body、拦截请求、返回假响应 |
| `http-response` | HTTP 请求得到响应后 | 修改响应体/Header、替换内容 |
| `cron` | 按 cron 表达式定时触发 | 定时签到、更新订阅、推送通知 |
| `network-changed` | 网络环境变化时 | 自动切换策略组、流量模式 |
| `generic` | 在 App 内部手动触发 | 查询节点信息、获取地理位置 |

---

### http-request

在 HTTP 请求发起时调用。`requires-body=true` 表示截取请求体。

**语法：**
```
http-request ^https?:\/\/(www.)?(example)\.com script-path=localscript.js,tag=requestScript,enable=true,requires-body=true
```

**脚本中可用的变量：**

| 变量 | 说明 |
|---|---|
| `$request.url` | String，请求 URL |
| `$request.method` | String，请求方法（GET / POST 等） |
| `$request.headers` | Object，请求头 |
| `$request.body` | String 或 Uint8Array（requires-body=true 时才有值） |
| `$response` | undefined（请求尚未得到响应） |

**$done() 参数说明：**

| 参数 | 效果 |
|---|---|
| `$done()` | 放弃该请求，直接断开连接 |
| `$done({})` | 请求继续，不做任何修改 |
| `$done({url: "https://new.example.com/"})` | 替换请求 URL（重定向） |
| `$done({headers: {...}})` | 替换请求头 |
| `$done({response: {status: 200, headers: {...}, body: "..."}})` | 直接返回假响应（拦截请求） |

**示例：拦截广告请求并返回空响应**
```javascript
// 广告拦截脚本
var url = $request.url;
if (url.indexOf("ad") !== -1) {
  $done({response: {status: 200, headers: {}, body: ""}});
} else {
  $done({}); // 放行
}
```

**示例：修改请求头（添加 User-Agent）**
```javascript
// 修改请求头
let headers = $request.headers;
headers["User-Agent"] = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
$done({headers: headers});
```

---

### http-response

在 HTTP 请求得到响应后调用。`requires-body=true` 表示截取响应体。

**语法：**
```
http-response ^https?:\/\/(www.)?(example)\.com script-path=https://example.com/loon.js,timeout=10,requires-body=true,tag=responseScript,enable=true
```

**脚本中可用的变量：**

| 变量 | 说明 |
|---|---|
| `$request.url` | String，请求 URL |
| `$request.method` | String，请求方法 |
| `$request.headers` | Object，请求头 |
| `$request.body` | String 或 Uint8Array（请求有 body 时才有值） |
| `$response.status` | Number，响应状态码 |
| `$response.headers` | Object，响应头 |
| `$response.body` | String 或 Uint8Array（requires-body=true 时才有值） |

**$done() 参数说明：**

| 参数 | 效果 |
|---|---|
| `$done()` | 放弃该请求，断开连接 |
| `$done({})` | 继续，不做任何修改 |
| `$done({response: {status: 200, headers: {...}, body: "..."}})` | 替换响应内容 |

**示例：替换响应体（去广告）**
```javascript
// 响应体去广告脚本
var body = $response.body;
if (body) {
  body = body.replace(/<div class="ad">.*?<\/div>/g, "");
  $done({response: {body: body}});
} else {
  $done({});
}
```

**示例：修改 JSON 响应**
```javascript
// 修改 JSON 接口返回
var body = JSON.parse($response.body);
body.data.vip = true;
body.data.vip_expire = "2099-12-31";
$done({response: {body: JSON.stringify(body)}});
```

---

### cron

根据设定的 cron 表达式定时触发。支持标准 5 位（分 时 日 月 周）和 6 位（秒 分 时 日 月 周）格式。

**语法：**
```
cron "0 8 * * *" script-path=cron.js,tag=responseScript,enable=true
```

**cron 表达式格式：**
```
位置:  分  时  日  月  周
示例:  0  8  *  *  *  每天早上 8 点
示例:  */30 *  *  *  *  每 30 分钟
6位:   秒  分  时  日  月  周
```

**示例：定时签到脚本**
```javascript
// 每天 8:00 执行签到
$httpClient.get({url: "https://api.example.com/checkin", headers: {"Cookie": "..."}},
  function(err, resp, data) {
    if (err) {
      $notification.post("签到失败", "", err);
    } else {
      $notification.post("签到成功", "", data);
    }
    $done();
  }
);
```

---

### network-changed

当网络环境发生变化（WiFi 切换、蜂窝数据切换等）时调用。配置中若有多个此类型脚本，**只会执行第一个**。

**语法：**
```
network-changed script-path=netChanged.js, tag=changeModel, enable=true
```

**示例：根据 WiFi 自动切换策略组**
```javascript
// 网络变化时自动切换模式
var config = JSON.parse($config.getConfig());
if (config.ssid === "公司WiFi") {
  $config.setRunningModel(0); // 全局直连
} else if (config.ssid === "家庭WiFi") {
  $config.setRunningModel(1); // 分流模式
}
$done();
```

---

### generic

以节点、策略组、规则等配置为参数的脚本，需要在 App 内部页面**手动触发**，不会自动执行。

**语法：**
```
generic script-path=generic_example.js, tag=GeoLocation, timeout=10, img-url=location.fill.viewfinder.system
```

**额外可用变量：**

| 变量 | 说明 |
|---|---|
| `$environment.params.node` | 节点名称（build 410+，推荐使用 nodeInfo） |
| `$environment.params.nodeInfo` | 节点简洁信息 |

**示例：显示当前节点信息**
```javascript
// 在 App 内手动触发查看当前节点
var node = $environment.params.node;
var info = $environment.params.nodeInfo;
$notification.post("当前节点", node, JSON.stringify(info));
$done();
```

---

## 通用脚本工具

| API | 说明 |
|---|---|
| `console.log(msg)` | 打印日志 |
| `setTimeout(function, ms)` | 延迟执行（与浏览器用法一致） |
| `setInterval(function, ms)` | 定时循环执行（与浏览器用法一致） |

# Loon 脚本 API 参考

## 基本信息

| 对象 | 属性 | 说明 |
|---|---|---|
| `$loon` | `deviceName` | 设备名称 |
|  | `systemVersion` | iOS 系统版本 |
|  | `appVersion` | Loon 版本 |
|  | `buildVersion` | Build 号 |
| `$script` | `name` | 脚本名称 |
|  | `startTime` | 脚本执行时间 |

## 配置操作 ($config)

| 方法 | 返回/说明 |
|---|---|
| `$config.getConfig()` | 返回当前配置 JSON 字符串 |
| `$config.setPolicy(group, name)` | 设置策略组 `group` 选择策略 `name` |
| `$config.getSubPolicies(name, callback)` | 获取策略组所有子策略（回调传入子策略数组） |
| `$config.getSelectedPolicy(name)` | 返回策略组当前选择的子策略 |
| `$config.setRunningModel(model)` | 设置运行模式，`0`=全局直连, `1`=分流, `2`=全局代理 |

### getConfig() 返回示例

```json
{
  "running_model": 1,
  "all_buildin_nodes": ["DIRECT", "REJECT"],
  "global_proxy": "节点选择",
  "all_policy_groups": ["节点选择", "HK", "JP"],
  "ssid": "loon-wifi-5g",
  "final": "节点选择",
  "policy_select": {
    "节点选择": "JP",
    "HK": "香港节点A",
    "JP": "日本节点A",
    "DIRECT": "DIRECT"
  }
}
```

## 本地存储 ($persistentStore)

| 方法 | 说明 |
|---|---|
| `$persistentStore.write(value, key?)` | key 不传时以当前脚本名称 hash 为键；成功返回 `true` |
| `$persistentStore.read(key?)` | 读取指定 key 的值 |
| `$persistentStore.remove()` | 清除脚本 API 保存的所有本地数据 |

## 通知 ($notification)

```javascript
// 发起本地通知
$notification.post(title, subtitle, content, attach)

// attach 为字符串时，表示点击通知跳转的 URL
$notification.post("title", "subtitle", "content", "loon://switch")

// attach 为对象时，同时支持附件和点击跳转
var attach = {
    "openUrl": "loon://switch",
    "mediaUrl": "https://example.com/img"
}
$notification.post("title", "subtitle", "content", attach)
```

## 网络请求 ($httpClient)

支持：`get / post / head / delete / put / options / patch`

```javascript
$httpClient.get(params, function(error, response, data) {
    // error: 失败原因（String），成功为 null
    // response: { status, headers }
    // data: 响应 body（String）
})
```

### params 请求参数

| 字段 | 类型 | 说明 |
|---|---|---|
| `url` | string | 请求 URL |
| `headers` | object | 请求头 |
| `body` | any | POST 请求体（String / JSON / 二进制） |
| `body-base64` | boolean | 将 body 作为 base64 解码为二进制（build 612+） |
| `timeout` | number | 超时时间（ms），默认 5000 |
| `binary-mode` | boolean | 返回二进制格式，默认 false |
| `auto-redirect` | boolean | 是否自动处理重定向，默认 true（build 660+） |
| `auto-cookie` | boolean | 是否自动存储并使用 cookie，默认 true（build 662+） |
| `node` | string | 指定节点或策略组发送请求（节点名称 / 策略组名称 / Loon 节点描述） |

## 其他 API

| API | 说明 |
|---|---|
| `$done()` | 脚本执行结束，释放资源。在 http-request/http-response 中用法不同（参见上面各类型说明） |
| `$environment.params.node` | Generic 脚本中，表示节点名称（build 410+，推荐使用 `nodeInfo`） |
| `$environment.params.nodeInfo` | 节点简洁信息 |

# 插件开发 (Plugin)

插件是规则、复写、脚本的集合，相当于一个子配置，常常用来代表一个扩展功能。

## 插件文件结构

```ini
#!name=插件名称              （必需）
#!desc=插件功能描述            （必需）
#!author=作者                （可选）
#!homepage=https://xxx.com   （可选）
#!icon=https://xxx.com/icon  （可选，插件图标链接）
#!system=iOS                 （可选，支持的系统，留空表示全部支持）
#!system_version=15.0        （可选，最低系统版本）
#!loon_version=3.2.1(733)    （可选，最低 Loon 版本）
#!tag=工具                   （可选，分类标签）
#!type=normal                （可选，插件类型：normal / parser）
#!date=2024-01-01            （可选，更新日期）

[General]
# 通用配置（可选）

[Proxy]
# 节点定义（可选）

[Proxy Group]
# 策略组（可选）

[Rule]
# 规则（可选）
DOMAIN-SUFFIX, example.com, PROXY

[Rewrite]
# 复写规则（可选）
^https?://example.com/ad url reject

[Script]
# 脚本（可选）
http-response ^https?://example.com/api script-path=my-script.js, requires-body=true, tag=myScript
```

## 注释参数 (#!)

| 参数 | 说明 |
|---|---|
| `#!name` | **插件名字**，必填 |
| `#!desc` | 插件功能描述，必填 |
| `#!author` | 插件作者 |
| `#!homepage` | 插件主页 |
| `#!icon` | 插件图标图片链接 |
| `#!system` | 支持的系统（iOS / tvOS / macOS），不填表示全部 |
| `#!system_version` | 最低系统版本，如 `15.0` |
| `#!loon_version` | 最低 Loon 版本，格式 `3.2.1(733)`（大版本+Build） |
| `#!tag` | 分类标签 |
| `#!type` | 插件类型：`normal`（普通）/ `parser`（资源解析器）。parser 类型会显示在订阅节点/规则/配置页面 |

## [Argument] 交互式参数（build 733+）

插件可以声明参数，用户在安装插件时可以通过 UI 交互配置。

### 参数类型

| 类型 | 说明 |
|---|---|
| `input` | 文本输入框，后面的参数值为默认内容（用双引号包裹） |
| `select` | 下拉选择，每个可选值用双引号包裹，默认选择第一个 |
| `switch` | 开关切换，后面第一个参数值为默认值，不设置默认 `false` |

### 声明格式

```ini
[Argument]
# input 类型：默认值为 "默认值"
input_arg = input("默认值")

# select 类型：可选值 "A", "B", "C"，默认选择第一个
select_arg = select("A", "B", "C")

# switch 类型：默认开启
switch_arg = switch(true)
```

### 参数使用说明

1. **传入脚本**：在脚本配置中用 `argument` 参数传入，如 `argument=[{arg1},{arg2},{arg3}]`。
2. **脚本中获取**：通过变量 `$argument.arg1` 获取参数值。
3. **cron 自定义**：cron 类型脚本可引用参数自定义执行时间，如 `cron {arg1} script-path=...`，如果 cron 格式异常，脚本将无法执行。
4. **控制开关**：通过引用参数控制脚本启停，如 `enable={arg1}`，**arg1 类型必须为 switch**，否则视为 `true`。

### 完整示例

```ini
#!name=示例交互式插件
#!desc=演示 Argument 参数用法
#!author=Loon
#!loon_version=3.2.1(733)

[Argument]
# 用户输入关键词
keyword = input("默认关键词")
# 选择模式
mode = select("严格模式", "宽松模式")
# 开关
enabled = switch(true)

[Script]
http-request ^https?://api.example.com/search script-path=search.js, enable={enabled}, argument=[{keyword},{mode}]

cron {cron_time} script-path=auto_task.js, argument=[{enabled}], tag=定时任务

[Rewrite]
^https?://example.com/ad url reject
```

### 脚本中获取参数

```javascript
// search.js - 使用插件参数
var keyword = $argument.keyword;
var mode = $argument.mode;

$httpClient.get({
  url: "https://api.example.com/search?q=" + encodeURIComponent(keyword),
  headers: {"X-Mode": mode}
}, function(err, resp, data) {
  $notification.post("搜索结果", keyword, data);
  $done();
});
```

## 插件中规则的策略

插件内的规则指向的策略只能是以下三种：

| 策略 | 说明 |
|---|---|
| `DIRECT` | 直连 |
| `REJECT` / `REJECT-IMG` / `REJECT-DICT` / `REJECT-ARRY` / `REJECT-DROP` | 阻断（不同变体适用不同场景） |
| `PROXY` | 代表用户在安装插件时手动选择的策略组。如果用户未指定 PROXY，则使用 App 全局中第一个节点 |

> 当规则不指定策略时，会默认使用 `DIRECT`。

### 示例

```ini
[Rule]
# 指定 PROXY，用户安装时可选使用哪个策略组
DOMAIN-SUFFIX, netflix.com, PROXY
# 指定 REJECT，拦截广告
DOMAIN-SUFFIX, ad.example.com, REJECT
# 不指定策略，默认 DIRECT
DOMAIN-SUFFIX, apple.com
```

## 插件配置模块

插件可以包含以下 Loon 配置模块：

- `[General]` — 通用设置
- `[Proxy]` — 节点定义
- `[Proxy Group]` — 策略组
- `[Rule]` — 规则
- `[Rewrite]` — 复写规则
- `[Script]` — 脚本
- `[Host]` — Host 映射
- `[MITM]` — HTTPS 中间人劫持设置
- `[Argument]` — 交互式参数（build 733+）

# Loon 配置文件核心结构

```ini
[General]
log-level = notify

[Proxy]
# 节点定义
DIRECT = direct
REJECT = reject
shadowsocks = ss, 1.2.3.4, 443, encrypt-method=aes-128-gcm, password=12345

[Proxy Group]
# 策略组
Auto = url-test, shadowsocks, DIRECT, url=http://www.gstatic.com/generate_204, interval=600, tolerance=100

[Rule]
# 规则
DOMAIN-SUFFIX, google.com, Auto
DOMAIN-SUFFIX, apple.com.cn, DIRECT
GEOIP, CN, DIRECT
FINAL, Auto

[Rewrite]
# 复写
^https?://example.com/ad/v1 url reject
^https?://api.example.com/ path script-response-body local.js

[Script]
# 脚本
cron "0 8 * * *" script-path=news.js
tag=my-script, pattern=^https?://example, requires-body=true, script-path=my.js
```

# 快速参考：节点/策略类型

| 类型 | 说明 |
|---|---|
| `direct` | 直连 |
| `reject` | 阻断 |
| `ss` | Shadowsocks |
| `ssr` | ShadowsocksR |
| `vmess` | VMess |
| `vless` | VLESS |
| `trojan` | Trojan |
| `http` | HTTP 代理 |
| `socks5` | SOCKS5 |
| `url-test` | URL 测试策略组 |
| `fallback` | 故障转移策略组 |
| `load-balance` | 负载均衡策略组 |
| `select` | 手动选择策略组 |
| `ssid` | 根据 WiFi 自动切换策略组 |

# 注意事项

1. **脚本执行完成后务必调用 `$done()`**，否则可能导致资源泄漏。
2. **HTTP 请求中指定 `node` 参数**时，可以传节点名称、策略组名称或完整的 Loon 节点描述。
3. **配置文件的 `[Rule]` 匹配顺序**：从上到下优先匹配，匹配到即执行对应策略。
4. **`$config.getConfig()` 返回的是 JSON 字符串**，需 `JSON.parse()` 后使用。
5. **http-request 脚本中 `$response` 为 undefined**（请求尚未发出），不要尝试读取。
6. **http-response 脚本必须设置 `requires-body=true`** 才能读取和修改响应体。
7. **插件 Argument 的 switch 类型只能用在 `enable` 参数上**，用于控制脚本启停。
8. **插件规则的策略只能是 `DIRECT`、`REJECT` 系列或 `PROXY`**，不能引用自定义策略组名称。
9. **network-changed 类型**若有多个，只会执行配置文件中的第一个。
10. **Loon 插件社区仓库**：https://github.com/Peng-YM/Loon-Gallery