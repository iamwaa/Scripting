# Pong — 探针面板

参照 [vPings](https://apps.apple.com/us/app/vpings/id6479573031) 实现的 Scripting (iOS) 应用：在 3D 世界地图上展示探针节点的实时状态、负载指标与地理分布。支持三种探针后端：**Komari**、**哪吒（Nezha）** 与 **[CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor)**（Cloudflare Workers 面板）。

## 功能

- **地图视图**：按节点 GeoIP 地区在 3D 卫星地图上打点，在线绿色、离线灰色，同地区节点自动散开避免重叠；拿到节点后自动把视野定位/缩放到节点所在区域（每个探针实例只定位一次，不打断用户拖拽）。
- **实时数据**：按后端选择 WebSocket / 轮询；Komari 的 `/api/clients` 每 2 秒发 `get`，CF-SM 的 `/api/ws` 使用显式订阅与增量合并。私站认证见下文各后端契约。
- **节点列表**：所有节点按在线优先排序，行内显示 CPU / 内存环形仪表与上下行速率。
- **节点详情**：实时负载仪表（CPU/内存/磁盘/交换）、网络速率、连接数、进程数、运行时间，以及硬件与计费信息。
- **多探针管理**：在设置里添加/编辑/删除/切换多个面板地址，可选三种探针类型，支持「测试连接」（读取版本信息）。

## 快速开始与部署

### 先分清三层

| 层 | 作用 | 是否必须 |
|---|---|---|
| 探针面板 + Agent | 面板保存节点与历史，Agent 在 VPS 上采集并上报 | 必须；可使用已有面板 |
| Pong（本项目） | iPhone 上查看地图、实时指标、历史与管理面板 | 必须 |
| `sg-update` 更新助手 | SSH 管理同一 VPS 的 Magpie 网关和 cf-probe 更新 | 可选，不影响监控功能 |

**选择哪吒/Komari/CF-SM，不代表自动支持升级它们的 Agent。** 监控适配器与更新助手是两条独立链路。当前更新助手仅针对 **Magpie + cf-probe** 的现有部署，不是通用 Linux 软件管理器，也不会自动安装面板、Magpie 或探针。

### 1. 部署探针面板

- **Komari**：按 [Komari 官方仓库](https://github.com/komari-monitor/komari) 部署面板，登录管理端创建节点，使用该面板生成的 Agent 安装命令。
- **哪吒（Nezha）**：按 [哪吒官方仓库](https://github.com/nezhahq/nezha) 的当前版本文档部署 Dashboard，再使用 Dashboard 生成的 Agent 安装命令。面板与 Agent 版本要匹配，不混用不同大版本的命令。
- **CF-Server-Monitor**：按 [面板仓库](https://github.com/huilang-me/CF-Server-Monitor) 部署 Cloudflare Worker、D1 与 Durable Object；检查绑定和数据库初始化，设置管理登录后在面板里创建服务器，取得 ID、上报 Secret 与 Worker URL。Pong 不代建 Cloudflare 资源。

面板建议使用可信 HTTPS；反向代理必须支持 WebSocket Upgrade。不要将面板管理口、Magpie 管理口无认证暴露公网。

### 2. 在各 VPS 安装 Agent

优先复制**自己的面板生成的命令**，不要复用别人的 ID / Secret。Pong 的添加节点页也会按选中的后端生成对应安装命令，但仍需在目标服务器执行。

CF-SM 的 root + systemd Linux 首次安装示例（将占位符换成自己的值；安装脚本来自官方仓库，先下载审阅再执行）：

```bash
curl -fL --max-time 60 \
  https://raw.githubusercontent.com/huilang-me/cfsm-agent/main/install.sh \
  -o /root/cf-probe-install.sh
# 审阅下载脚本后执行；不要把真实 Secret 提交到仓库或共享终端记录
sh /root/cf-probe-install.sh install \
  -id=SERVER_ID -secret=YOUR_REPORT_SECRET -url=https://worker.example.com \
  -auto_update=0
cf-probe version
systemctl status cf-probe --no-pager
journalctl -u cf-probe -n 50 --no-pager
```

`-auto_update=0` 用于将更新统一交给 `sg-update`；若选 Agent 自带自动更新，则不要再让另一套更新器同时升级它。最新版安装参数以 [cfsm-agent 文档](https://github.com/huilang-me/cfsm-agent) 为准。

注意：Agent 的上报 Secret、面板管理登录 JWT、Telegram Bot Token、SSH 私钥是不同凭据，不能相互代替。CF-SM 的 43 字符无点密钥不是 JWT；Pong 管理认证要账号密码换得的三段 JWT（通常 `eyJ…` 开头）。

### 3. 导入并配置 Pong

将 `Pong.scripting` 用 Scripting App 导入，或把整个 `Pong/` 放进 Scripting 的脚本目录。运行后进入「设置」：

1. 添加面板名称、地址，选择 `Komari / 哪吒 / CF-Server-Monitor`。
2. 按面板权限选择游客、Token 或账号密码认证；先测试连接，再保存。
3. 检查节点列表、地图、历史和实时状态。公开站点可先用游客验证读链路，管理功能仍需管理凭据。
4. 若要启用更新，按下节在**每台需要管理的 VPS** 安装助手，然后在「节点详情 → 运维 → 服务器更新设置」填写 SSH 信息。

SSH 信息**按节点保存**（实例 ID + 节点 UUID），不是整个面板共用。多个节点指向同一机器时，Telegram 和自动更新策略仍共享服务器上的同一份状态。

## 服务器更新助手安装与配置

### 支持范围与部署前提

随项目提供的源文件位于 [`deploy/`](deploy/)：

- [`sg-update.sh`](deploy/sg-update.sh)：安装到 `/root/bin/sg-update`，不依赖手机常驻运行。
- [`sg-update.service`](deploy/sg-update.service)、[`sg-update.timer`](deploy/sg-update.timer)：systemd 定时检查模板。

这是针对既有部署整理的助手，**默认按 Magpie 和 cf-probe 均已安装设计**。只装单个组件时先调整脚本的检查/升级分支，否则不能把另一个组件的空状态理解为已验证正常；不要直接开启全量自动升级。它不会更新 Komari/哪吒 Agent、CF Worker 面板或 Pong 自身。

要求：Linux + root + systemd，Bash、Python 3、curl、GNU coreutils（`timeout`、`sort -V`、`date -d`、`sha256sum` 等）、util-linux（`flock`、`setsid`）、Docker Engine 和 Compose v2。探针手动二进制更新分支仅支持 amd64 / arm64。

默认部署约定：

| 项目 | 位置 / 约定 |
|---|---|
| Magpie | `/opt/magpie/compose.yaml`，Compose project 为 `magpie` |
| 镜像 | `ghcr.io/yetone/magpie`，Compose 中用 `image: ghcr.io/yetone/magpie@sha256:…` 固定摘要 |
| 本机管理口 | `127.0.0.1:3430`；可选 `/opt/magpie/.env` 中的 `MAGPIE_WEB_KEY` |
| cf-probe | `/usr/local/bin/cf-probe`，系统服务 `cf-probe` |
| 探针配置 | `/etc/config/cf-probe/config.conf` |
| 更新状态 | `/var/lib/sg-update/state.json` |
| Telegram Token | `/var/lib/sg-update/tg_token`，权限 600，不回显到手机 |
| 日志 / 备份 | `/var/log/sg-update.log` / `/root/backups/` |

Magpie 请先按 [上游文档](https://github.com/yetone/magpie-releases) 独立部署，确认容器、持久化目录和访问认证工作正常。助手会替换 Compose 里的镜像摘要，**不是任意 Compose 格式都能直接接入**；tag 形式镜像需要先规范成 digest。升级前自行备份 Magpie 业务数据；脚本的 Compose/二进制备份不等于完整数据备份。

源文件顶部可调整路径；也可设置 `SG_MAGPIE_DIR`、`SG_PROBE_CONFIG`、`SG_GATEWAY`、`SG_ALIASES`。systemd 的 Environment 不会自动传给手机 SSH 会话；需让两条调用链使用相同配置（例如统一修改已安装脚本的默认值）。不设置公网网关且没有 `access.md` 时跳过公网连通性检查；旧兼容逻辑从 `access.md` 提取 `https://…:8443`。公网检查使用 `curl -k`，仅是连通性检查，不验证 TLS 可信度。

### 安装助手与定时器

以下在**已经拿到本项目完整目录的服务器**以 root 执行；先进入包含 `deploy/` 的目录。若从电脑上传，先用 scp/SFTP 传输这三个文件，不要把 iPhone 本地文件路径当成服务器路径。

```bash
# Debian / Ubuntu 示例；Docker Engine + Compose v2 按 Docker 官方说明另行安装
apt-get update
apt-get install -y bash python3 curl coreutils util-linux

# 检查环境；这些命令都应可用
docker compose version
command -v bash python3 curl timeout flock setsid sha256sum
bash -n deploy/sg-update.sh

# 已有版本先备份；不会删除状态、通知凭据或应用数据
install -d -m 0700 /root/bin /var/lib/sg-update /root/backups
if [ -f /root/bin/sg-update ]; then
  cp -a /root/bin/sg-update "/root/backups/sg-update-$(date +%Y%m%d_%H%M%S).sh"
fi
install -m 0700 deploy/sg-update.sh /root/bin/sg-update
install -m 0644 deploy/sg-update.service /etc/systemd/system/sg-update.service
install -m 0644 deploy/sg-update.timer /etc/systemd/system/sg-update.timer

# 首次先关闭策略，手动验证后再开启
/root/bin/sg-update set auto_enabled 0
/root/bin/sg-update set auto_every 24
/root/bin/sg-update set defer_hours 6
/root/bin/sg-update show
/root/bin/sg-update check
# check 的退出码 10 表示发现更新，不是执行失败

systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/sg-update.service /etc/systemd/system/sg-update.timer
systemctl enable --now sg-update.timer
systemctl list-timers sg-update.timer --all
```

更新助手本身：在服务器暂停 timer，确认没有正在进行的升级（`systemctl status sg-update.service`），备份并替换 `/root/bin/sg-update`、两份 unit 文件，运行 `bash -n`、`daemon-reload` 后重启 timer。不要覆盖 `/var/lib/sg-update/`，否则会丢策略和 Telegram 设置。timer 只影响后台，手机仍可手动触发操作。

### 在 Pong 配置 SSH 与通知

- 「节点详情 → 运维 → 服务器更新设置」：填写真实 VPS 主机、端口、账号（当前默认部署用 root）、私钥路径或密码。「测试连接」会执行 `check` 并读取服务器通知设置。
- 私钥路径相对 Scripting 的 Documents，例如 `.ssh/id_ed12345`，也接受绝对路径；读不到或无法解析私钥才回退密码。已解析的私钥若被服务器拒绝，不会再自动尝试密码。
- 「Telegram 通知」：用 `@BotFather` 建 Bot，先对 Bot 发 `/start` 或在目标群里给它发送权限，取得目标 Chat ID（负号必须保留）。填 Bot Token、可选 Bot 用户名和 Chat ID。
- **「发送测试通知」就在同一 Telegram 分组下方**。它先下发当前修改的通知设置，再执行 `notify-test`；这一步会立即更改服务器，即使随后点击「取消」也不会撤销。SSH 配置仍需点击「保存」才能留在手机。
- Token 留空表示不覆盖服务器现有值；Token 不写入手机持久化配置，`show` 只返回是否已配置。Bot 用户名只是展示，不参与 Telegram 认证。
- 保存时先保存在本机，再推送服务器设置；若服务器下发失败会留页提示。本机 SSH 密码属于本地配置，应妥善保护设备和导出备份。
- 节点配置完成后，详情页右上角更新图标进入「服务器更新」主面板：查看版本、检查/升级、策略、日志、Magpie 回滚。主面板不再重复放测试通知按钮。

### 自动更新策略与常用命令

systemd timer 每 **5 分钟唤醒**一次，不代表每 5 分钟联网升级。脚本先检查 `auto_enabled` 和 `auto_every`，未到点直接跳过；频率基准是 `auto_check_at`，手动查看不会重置它。

| 设置 | 取值 | 缺省 |
|---|---|---|
| `auto_enabled` | 0 关闭、1 开启 | 1（安装步骤先显式关闭） |
| `auto_every` | 1 / 3 / 6 / 12 / 24 小时 | 24 |
| `defer_hours` | UI 提供 0 / 2 / 4 / 6 / 8 | 6，服务器本地时间 0–6 点暂缓 |

这三项在主面板「自动更新」同组，修改立即下发。空窗期以**服务器时区**为准，用 `timedatectl` 核对。到点时若落入空窗期，本次记录待升级，但 `auto_check_at` 已刷新，可能要等下一周期才再检查，并非到窗口结束立即升级。

```bash
/root/bin/sg-update set auto_enabled 1  # 验证完环境后再开
/root/bin/sg-update set auto_every 6
/root/bin/sg-update set defer_hours 6
/root/bin/sg-update show
/root/bin/sg-update check              # 只检查，末行单行 JSON；0 正常 / 10 有更新
/root/bin/sg-update upgrade            # 手动查询并升级；不受开关/频率限制，但仍检查空窗期
SG_FORCE=1 /root/bin/sg-update upgrade # 明确需要时忽略空窗期
/root/bin/sg-update log 80
/root/bin/sg-update notify-test        # 0 送达；非零=失败或缺配置，查看文字原因
/root/bin/sg-update rollback           # 仅回滚 Magpie，且须有回滚记录
journalctl -u sg-update.service -n 80 --no-pager
```

`magpie <版本>` / `probe <版本>` 是直接安装指定版本的底层命令，可能降级，不能当作无副作用的查询。指定 `upgrade <magpie版本> <probe版本>` 也不要依赖 `-` 严格排除另一组件：当前实现仍会查询两者，可能升级另一组件。手机单独升级 cf-probe 目前实际调用 `probe v<latest>`，会直接安装、不经过自动策略和通知汇总；操作前确认目标机器正确。

`upgrade` **不包含 danmu-api**；需要时单独执行 `sg-update danmu`（手机端是更新面板里的「只更新 danmu-api」按钮）。

返回码：常见 0 成功、10 有更新（仅普通 `check`）、20 升级失败、30 锁占用；`notify-test` 的缺配置和发送失败当前均向外返回 1（内部通知函数才区分 2 未配置）。不要只看是否有日志就宣称消息送达。

Magpie 升级会备份 Compose（最近 10 份），做容器/HTTP 检查，失败尝试回滚；cf-probe 会备份配置和二进制（合计最近 6 份），优先调用官方安装脚本、失败再尝试 checksum 校验的二进制替换。**cf-probe 没有 UI 一键回滚，也不承诺失败后自动恢复。** 下载来源、上游兼容性、备份内容与空闲磁盘都应由运维确认。当前 Magpie 脚本在低磁盘时可能清理旧 Docker 镜像；共用 Docker 主机需先审阅这一行为。

### 排障与停用

| 现象 | 先检查 |
|---|---|
| 测试连接失败 | SSH 主机/端口/账号、私钥文件、root 登录策略、`/root/bin/sg-update` 权限和依赖 |
| 版本查询空白/旧值 | 服务器是否可访问 GHCR、GitHub API / Releases，是否限流；看日志，不等于已经最新 |
| 自动更新不运行 | timer 是否启用、`show` 中开关/频率、服务器时区、空窗期、`auto_skip` 与 `auto_check_at` |
| Telegram 失败 | Token + Chat ID 是否都配置、Bot 是否已启动/被踢出群、服务器能否访问 `api.telegram.org` |
| 手机上等待超时 | 后台升级可能仍在服务器运行；先查日志/进程，不要连续重复触发 |
| CF-SM 401 | 是否把上报 Secret / jwt_secret 错当 JWT，JWT 是否过期，Turnstile 是否阻止密码登录 |
| CF-SM 有 REST 无实时 | Worker 的 DO 绑定、WS 代理配置与私站 JWT；客户端有 REST 对账兜底 |

停用后台检查：`systemctl disable --now sg-update.timer` 并 `sg-update set auto_enabled 0`。不要贸然杀掉正在升级的 service；停 timer 不会取消已经开始的任务。删除 Pong 节点更新配置只删手机连接信息，不停服务器 timer、不清 Telegram、不卸载服务。

## 后续如何接入新插件 / 新后端

当前没有运行时下载、目录扫描或热加载插件机制；以下是**代码级扩展流程**，不是往配置里填一个 URL 就会生效。

### A. 新增需要更新的软件（例如 new-service）

1. 先在服务器独立部署并验收软件，明确版本来源、安装布局、systemd/Compose 服务名、配置和业务数据目录、CPU 架构。
2. 在 `deploy/sg-update.sh` 增加版本读取、最新版查询、安装、健康检查与回滚函数，纳入锁、日志、备份和通知。下载失败、校验失败、服务不起要返回非零；只检查不能触发安装。
3. 将新组件接入 `cmd_check` 的目标判断与单行 JSON 状态输出，再接入升级调度和命令分发。升级已有助手前保持 `check/show/set/log/notify-test` 的兼容契约，不能只追加一个子命令就以为手机会出现新卡片。
4. 在 `class/update.ts` 扩展 `UpdateState` 和对应 SSH 动作；新设置项同步扩展 `ServerSettings`、`setOption` 白名单及服务器 `set/show`。远端命令参数须验证，不能直接拼用户输入。
5. 在 `page/update.tsx` 增加版本/状态/操作及必要策略，在 `page/update_node.tsx` 放服务器连接/通知相关配置；若需单独凭据，设计明确的服务端秘密存储，不回显密钥。
6. 在测试机验证无更新、更新成功、下载/校验失败、启动失败、回滚、锁占用、timer 与手机同时触发、通知失败；再替换生产助手并重新导入/发布 Pong。

目前客户端固定调用 `/root/bin/sg-update`，`UpdateConfig` 也没有「更新器种类」字段。换成完全不同的更新器需同时改服务层协议和 UI，不属于现成配置能力。不要让新软件误用 Magpie 的镜像替换和回滚实现。

### B. 新增一种探针面板后端

1. 在 `class/types.ts` 的 `BackendKind` 联合类型新增 kind；把上游节点、实时帧、历史/测速数据转换为项目规范模型（字节、B/s、稳定 UUID）。只在需要新鉴权形状时扩展 `AuthConfig`。
2. 在 `class/backend.ts` 定义新 `BackendCaps`，补 `capsFor(kind)`；准确标记支持的管理操作、认证方式和历史窗口，不支持的能力不要假开关。
3. 新建 `class/<kind>.ts` 实现 `Backend` 必需方法；纯单位换算/增量合并可放 `<kind>_transforms.ts`。实时客户端实现 `start/stop`，妥善处理认证、重连、增量字段、定时器和取消。
4. 在 `class/server.ts` 静态 import + `registerBackend(...)`，再加入 `ALL_BACKENDS`。设置页类型 Picker 从该数组生成；不是只改注册表就能省掉 caps/type 的同步。
5. 检查已有 `kind ===` 特例，尤其 `page/settings.tsx` 的认证提示、`page/addnode.tsx` 的字段显隐/排序标签及 `page/detail.tsx` 的无历史提示；尽量抽到 caps，而不是把后端差异散布到所有页面。通用 UI 数据访问继续通过 `class/server.ts` 门面。
6. 验证游客/管理员/私站、REST/WS、断线重连、历史时长和单位、空值/超时、编辑是否整行覆盖；重新发布 Pong。新增监控后端不自动增加该 Agent 的升级能力。

## Komari API 契约

| 用途 | 端点 |
|---|---|
| 静态节点列表 | `GET {baseUrl}/api/nodes` → `{status, data: NodeBasicInfo[]}` |
| 实时数据 | WebSocket `{ws}://{host}/api/clients`，连接后每 2s 发送文本 `get`，回 `{status, data:{online[], data:{[uuid]: LiveRecord}}}` |
| 私有站点实时凭证 | `GET {baseUrl}/api/admin/client/{uuid}/token` → 取 `token` 拼成 `/api/clients?token=…` |
| 版本探测 | `GET {baseUrl}/api/version` |

### 私有站点（KOMARI 设置里的 Private Site）

开启后所有未登录的 `/api` 请求都会被 401 拦截，而 WebSocket 端点 `/api/clients` 不在服务端公开白名单里（白名单只有带尾斜杠的 `/api/clients/`）。Scripting 的 `WebSocket` 只能传 URL、无法附加 Cookie / `Authorization` 头，因此：

- REST（`/api/nodes`、`/api/records/*`、`/api/admin/*`）继续用 Cookie 或 API Key 访问，不受影响。
- 实时通道用管理员接口按节点取一个 agent 令牌，拼成 `.../api/clients?token=<token>`；服务端把它识别为 agent 身份，同时满足私有站点拦截与缺失 Origin 头时的来源校验。令牌按 baseUrl 缓存，连续握手失败两次后作废并重新获取（令牌轮换、节点重建都不会卡死）。
- 该方案需要**管理员**凭证：普通用户拿不到节点令牌，此时实时通道仍会失败，只能靠 REST 与历史曲线。

## CF-Server-Monitor API 契约

面板 = Cloudflare Worker（D1 存历史、Durable Object 推 WS），完整文档见其仓库 `API.md`。

| 用途 | 端点 |
|---|---|
| 站点配置 / 版本 | `GET {baseUrl}/api/config`（公开，含运营商名称、版本） |
| 服务器列表 + 最新指标 | `GET {baseUrl}/api/servers` → `{servers[], stats, regionStats, sysConfig}` |
| 单台详情 / 编辑前置 | `GET {baseUrl}/api/server?id={uuid}` |
| 历史指标 | `GET {baseUrl}/api/history/all?id={uuid}&hours={0.167\|0.5\|1\|6\|12\|24\|48\|96\|168}` → `HistoryRow[]` |
| 实时推送 | WebSocket `{ws}://{host}/api/ws?subscribe=all[&token=<jwt>]` |
| 管理操作 | `POST {baseUrl}/admin/api`，body 里 `action` 路由 |

### 关键差异（与 Komari / 哪吒不同）

- **单位**：`ram_*` / `swap_*` / `disk_*` 是 **MB**，网速是 B/s；适配器统一换算成字节（规范模型用字节）。
- **主键**：服务器用 UUID 字符串，没有数字 id，因此 `NodeBasicInfo.id` 固定为 0。
- **排序**：`sort_order` 越小越靠前，规范模型是权重越大越靠前，映射为负值；编辑接口不支持改排序（只能整表 `save_order`）。
- **WS 订阅**：`subscribe=all` 默认**不推任何服务器**，必须先 `GET /api/servers` 拿到 id，再发 `{type:"subscribe",scope:"all",ids:[…]}`；`batchUpdate` 的 `samples[].data` 只带变化字段，必须按字段合并。
- **私有站点**：`is_public=false` 时 `/api/servers`、`/api/history/all`、`/api/ws` 都要 JWT。登录用 `POST /admin/api {action:"login"}` 换 7 天 JWT；脚本无法过 Turnstile，开启人机验证时只能关闭或粘贴现成 JWT。
- **历史窗口**：只接受白名单时长，未登录 `hours > 24` 直接 401，所以页面上限 1 小时 / 6 小时 / 1 天。
- **不提供**：真实 IP（公共接口只有 `ip_v4`/`ip_6` 可达性标志）、温度历史、告警/通知/定时任务/用户/令牌/会话等管理资源。
- **测速**：三网与自定义节点的时延/丢包直接存在历史行里（`ping_ct`… / `loss_*`），适配器合成 4+4 个固定任务；`null` 视为超时（-1，计入丢包率），`false` 视为未配置。

## 架构（S.U.P.E.R）

```
index.tsx                 入口：Navigation.present(<View/>)
page/
  index.tsx               根布局：MonitorProvider > MapSelectionProvider > ZStack(Map + Sheet)
  map.tsx                 地图 + Marker（消费 Monitor context）
  sheet.tsx               悬浮控件：状态总览 + 选中节点入口
  list.tsx                节点列表（在线优先，行内仪表）
  detail.tsx              单节点详情（实时仪表 + 硬件/计费）
  settings.tsx            探针 CRUD + 测试连接
  update.tsx              检查/升级、自动策略、日志与 Magpie 回滚入口
  update_node.tsx         每节点 SSH + 服务器 Telegram 配置及测试通知
  update_log.tsx          升级日志
context/
  Monitor.tsx             唯一数据源：节点列表 + 实时记录 + 连接状态（单向流）
  MapSelection.tsx        地图选中态绑定
class/                    纯逻辑层（无 UI），类型检查现状见下文
  types.ts                所有数据契约（Port）
  backend.ts              Backend 端口 + 各后端 capability 描述 + 工厂/注册表
  server.ts               门面：按 instance.kind 分发到适配器（UI 只 import 这里）
  komari.ts               Komari 适配器（REST + WS）
  nezha.ts                哪吒适配器（REST + WS/轮询）
  nezha_transforms.ts     哪吒的纯变换（无 I/O，可单测）
  cfsm.ts                 CF-Server-Monitor 适配器（REST + WS + REST 对账）
  cfsm_transforms.ts      CF 面板的纯变换（单位换算、增量合并、历史/测速映射）
  config.ts               探针配置持久化（Storage）
  geo.ts                  region(ISO码/旗帜emoji/中英名) → 经纬度
  coords_data.ts          ISO-3166 国家质心坐标表（自动生成）
  format.ts               纯展示格式化（字节/速率/百分比/计费…）
  update.ts               SSH 更新传输、设置、状态解析（独立于探针后端）
deploy/                   服务器端源码与 systemd 模板
  sg-update.sh            Magpie / cf-probe 更新助手
  sg-update.service       root oneshot 服务（SG_AUTO=1）
  sg-update.timer         每 5 分钟唤醒；实际频率由 state 控制
```

- **S** 单一职责：每个模块只做一件事（网络/配置/地理/格式化/状态/各页面）。
- **U** 单向数据流：`server.ts` → `Monitor` observables → 各视图（只读），视图从不直接碰 fetch/WebSocket。
- **P** 接口先行：所有跨模块数据走 `types.ts` 契约；视图依赖 `useMonitor()` 而非实现。
- **E** 配置分离：面板地址来自用户配置（`Storage`）；服务器更新助手的部署路径/版本源在 `deploy/sg-update.sh` 中集中定义，部署前需核对。
- **R** 可替换：探针实时客户端可改为 SSE/轮询而不影响规范模型；新增后端还需同步 kind、caps、注册与少量既有 UI 特例，详见上文。

## 验证

- 全项目当前有 45 条既有 SDK 类型诊断（主要在旧页面的导入、样式与 detent 写法），不能宣称全量零错误；本次涉及的更新页面及 `class/update.ts` 需单独核查，新增改动不得增加诊断。
- 历史验证记录：公开演示面板 `mock.dashdeep.dpdns.org` 的 REST 节点、历史/测速映射与实时增量曾完成运行验证；不代表当前上游版本或任意生产部署已验收。
- 服务器部署后另行执行 `bash -n`、`systemd-analyze verify`、手动 `show/check/notify-test` 和测试机升级/回滚；本地静态检查不能代替生产实测。

## 导入方式

将 `Pong.scripting` 用 Scripting App 打开导入，或把 `Pong/` 目录整体放进 Scripting 的脚本目录。首次配置见上文「快速开始与部署」；`deploy/` 是需要按需复制到服务器的源码，不会随手机运行自动安装。
