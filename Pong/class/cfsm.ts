// ============================================================================
// CF-Server-Monitor (Cloudflare Workers 面板) adapter.
// Top half: network layer implementing the `Backend` port from class/backend.ts.
// Bottom half: the live transport (WS `/api/ws` + REST 兜底轮询).
// Pure shape handling lives in class/cfsm_transforms.ts (no I/O, unit-tested).
// S: Single Purpose — 所有 CF-Server-Monitor 专属的 I/O 与形状处理都在这里。
// U: Unidirectional — 面板 JSON 进，规范模型出；永不反向泄漏类型。
// R: Replaceable — 只通过 class/backend.ts 注册，UI 看不到面板类型。
// ============================================================================
import { fetch } from "scripting";
import type {
  CfsmConfig,
  CfsmHistoryRow,
  CfsmServer,
  CfsmServersResponse,
  CfsmWsFrame,
  AuthConfig,
  ClientDetail,
  LiveData,
  LiveRecord,
  LoadRecord,
  LoadType,
  NodeBasicInfo,
  NodeEditPatch,
  PingData,
  PingTask,
  SiteSettings,
} from "./types";
import {
  Backend,
  LoginResult,
  CreatedNode,
  LiveHandlers,
  LiveSession,
  CFSM_CAPS,
} from "./backend";
import {
  cfsmBuildLive,
  cfsmHistoryToLoadRecords,
  cfsmHistoryToPingData,
  cfsmServerToNode,
  cfsmServerToRecord,
  daysToBillingCycle,
  mergeSample,
  num,
  snapHours,
  tagsToPanel,
} from "./cfsm_transforms";

// ----------------------------------------------------------------------------
// Auth helpers.
// - "none"     公开站点，直接读 /api/*。
// - "token"    粘贴管理端签发的 JWT（7 天有效），作为 Bearer 头 + WS ?token=。
// - "password" 账号密码 -> /admin/api action=login 换 JWT。
// ----------------------------------------------------------------------------

/** 私有站点所需的 JWT（Bearer 与 WS 查询参数共用同一个值）。 */
function jwtOf(auth?: AuthConfig): string {
  if (!auth || auth.mode === "none") return "";
  if (auth.mode === "token") return (auth.apiKey || "").trim();
  return (auth.sessionToken || "").trim();
}

/**
 * JWT 形如 `header.payload.signature`：三段 base64url，用 `.` 分隔。
 * 面板的 `jwt_secret`（32 字节随机密钥，base64url 后 43 字符）常被误当成
 * 令牌填进来，它没有点号，拿去当 Bearer 一定 401。
 */
export function looksLikeJwt(value: string): boolean {
  const parts = String(value || "").trim().split(".");
  if (parts.length !== 3) return false;
  return parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p));
}

/** 401 时附带凭证形状提示，避免用户对着「未授权」猜。 */
function tokenHint(auth?: AuthConfig): string {
  const jwt = jwtOf(auth);
  if (!jwt) return "";
  if (looksLikeJwt(jwt)) return "（JWT 已过期或签名密钥已变，请重新登录）";
  return "（当前填的不是 JWT：JWT 由 3 段 base64url 用 . 分隔、通常以 eyJ 开头；无点号的 32 字节随机串是签名密钥或 API_SECRET，不能当令牌用）";
}

function headersFor(auth?: AuthConfig, extra?: Record<string, string>): Record<string, string> {
  const jwt = jwtOf(auth);
  return {
    Accept: "application/json",
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    ...(extra || {}),
  };
}

/** 面板的错误形态很杂（{error}/{message}/纯文本），统一成可读文案。 */
function httpError(status: number, body: any, auth?: AuthConfig): Error {
  if (status === 401) return new Error(`未授权：请检查登录凭证 (HTTP 401)${tokenHint(auth)}`);
  if (status === 403) {
    return new Error("访问被拒绝 (HTTP 403)：面板可能开启了 Turnstile 人机验证，或被 Cloudflare 拦截");
  }
  if (status === 409) return new Error("面板数据库需要升级：请先在面板执行数据库迁移");
  const msg = body?.error || body?.message;
  if (typeof msg === "string" && msg) return new Error(`${msg} (HTTP ${status})`);
  return new Error(`请求失败 (HTTP ${status})`);
}

async function readBody(res: any): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** GET + JSON 解析，带超时与统一错误。 */
async function getJson<T>(
  baseUrl: string,
  path: string,
  auth?: AuthConfig,
  timeout = 15000,
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: headersFor(auth),
    timeout,
  });
  const body = await readBody(res);
  if (!res.ok) throw httpError(res.status, body, auth);
  return body as T;
}

/**
 * POST /admin/api：唯一的管理入口，用 `action` 路由。
 * 面板在部分失败场景会以 200 返回 `{success:false,error}`，两种都要判。
 */
async function adminCall<T = any>(
  baseUrl: string,
  payload: Record<string, any>,
  auth?: AuthConfig,
  timeout = 20000,
): Promise<T> {
  const res = await fetch(`${baseUrl}/admin/api`, {
    method: "POST",
    headers: headersFor(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
    timeout,
  });
  const body = await readBody(res);
  if (!res.ok) throw httpError(res.status, body, auth);
  if (body && body.success === false) {
    throw new Error(body.error || body.message || "管理操作失败");
  }
  return body as T;
}

/** 站点配置（/api/config 公开可读）。缓存 5 分钟，用于版本、运营商名称。 */
const configCache: { [baseUrl: string]: { at: number; cfg: CfsmConfig } } = {};

async function getConfig(baseUrl: string, auth?: AuthConfig): Promise<CfsmConfig> {
  const hit = configCache[baseUrl];
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.cfg;
  const cfg = await getJson<CfsmConfig>(baseUrl, "/api/config", auth, 10000);
  configCache[baseUrl] = { at: Date.now(), cfg: cfg || {} };
  return cfg || {};
}

// ----------------------------------------------------------------------------
// Network calls (module-private; exposed through the Backend object below).
// ----------------------------------------------------------------------------

async function login(
  baseUrl: string,
  username: string,
  password: string,
): Promise<LoginResult> {
  if (!baseUrl) return { ok: false, error: "未配置 CF-Server-Monitor 地址" };
  try {
    const body = await adminCall<{ token?: string }>(
      baseUrl,
      { action: "login", username, password },
      undefined,
    );
    const token = body?.token;
    if (!token) return { ok: false, error: "登录成功但未返回 JWT" };
    return { ok: true, sessionToken: token };
  } catch (e: any) {
    const msg = e?.message || String(e);
    return { ok: false, error: msg };
  }
}

async function fetchNodes(baseUrl: string, auth?: AuthConfig): Promise<NodeBasicInfo[]> {
  if (!baseUrl) throw new Error("未配置 CF-Server-Monitor 地址");
  const data = await getJson<CfsmServersResponse>(baseUrl, "/api/servers", auth);
  const list = Array.isArray(data?.servers) ? data.servers : [];
  return list
    .map((s) => cfsmServerToNode(s))
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return (a.name || "").localeCompare(b.name || "");
    });
}

async function fetchVersion(baseUrl: string, auth?: AuthConfig): Promise<string | null> {
  try {
    const cfg = await getConfig(baseUrl, auth);
    return cfg.version || cfg.site_title || "已连接";
  } catch {
    return null;
  }
}

async function verifyAuth(
  baseUrl: string,
  auth?: AuthConfig,
): Promise<{ ok: boolean; username?: string; error?: string }> {
  if (!baseUrl) return { ok: false, error: "未配置地址" };
  try {
    if (!auth || auth.mode === "none") {
      const cfg = await getJson<CfsmConfig>(baseUrl, "/api/config", undefined, 10000);
      return { ok: true, username: cfg?.site_title };
    }
    const jwt = jwtOf(auth);
    if (!jwt) return { ok: false, error: "请填写 JWT" };
    // 先校验形状：把签名密钥/API_SECRET 当令牌用只会换来一个 401。
    if (!looksLikeJwt(jwt)) {
      return {
        ok: false,
        error:
          "这不是 JWT（应为 3 段 base64url、用 . 分隔）。请用面板账号密码登录自动获取，" +
          "或在浏览器里 POST /admin/api {action:\"login\"} 取返回的 token",
      };
    }
    // 管理端唯一入口：能列出服务器即代表 JWT 有效。
    const body = await adminCall<{ servers?: CfsmServer[] }>(baseUrl, { action: "list" }, auth);
    const count = Array.isArray(body?.servers) ? body.servers.length : 0;
    return { ok: true, username: `${count} 台服务器` };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function fetchServersRaw(baseUrl: string, auth?: AuthConfig): Promise<CfsmServer[]> {
  const data = await getJson<CfsmServersResponse>(baseUrl, "/api/servers", auth, 12000);
  return Array.isArray(data?.servers) ? data.servers : [];
}

async function fetchHistory(
  baseUrl: string,
  uuid: string,
  hours: number,
  auth?: AuthConfig,
): Promise<CfsmHistoryRow[]> {
  const h = snapHours(hours);
  const data = await getJson<CfsmHistoryRow[]>(
    baseUrl,
    `/api/history/all?id=${encodeURIComponent(uuid)}&hours=${h}`,
    auth,
    20000,
  );
  return Array.isArray(data) ? data : [];
}

async function fetchLoadRecords(
  baseUrl: string,
  uuid: string,
  loadType: LoadType,
  hours: number,
  auth?: AuthConfig,
): Promise<LoadRecord[]> {
  if (!baseUrl || !uuid) return [];
  if (loadType === "temp") return []; // 面板不上报温度
  try {
    const rows = await fetchHistory(baseUrl, uuid, hours, auth);
    return cfsmHistoryToLoadRecords(rows, loadType);
  } catch {
    return [];
  }
}

async function fetchPingRecords(
  baseUrl: string,
  uuid: string,
  hours: number,
  auth?: AuthConfig,
): Promise<PingData> {
  const empty: PingData = { count: 0, records: [], tasks: [] };
  if (!baseUrl || !uuid) return empty;
  try {
    const [rows, cfg] = await Promise.all([
      fetchHistory(baseUrl, uuid, hours, auth),
      getConfig(baseUrl, auth).catch(() => ({}) as CfsmConfig),
    ]);
    return cfsmHistoryToPingData(rows, {
      ct: cfg.custom_ct_name,
      cu: cfg.custom_cu_name,
      cm: cfg.custom_cm_name,
      bd: cfg.custom_bd_name,
      node_1: cfg.node_1_name,
      node_2: cfg.node_2_name,
      node_3: cfg.node_3_name,
      node_4: cfg.node_4_name,
    });
  } catch {
    return empty;
  }
}

/** 面板没有独立的任务表：三网/自定义节点的任务在 fetchPingRecords 里合成。 */
async function fetchPingTasks(_baseUrl: string, _auth?: AuthConfig): Promise<PingTask[]> {
  return [];
}

/**
 * 公共接口只暴露 ip_v4/ip_v6 的「是否可达」标志（"0"/"1"），不返回真实地址，
 * 管理端同样不返回，所以这里无法提供真实 IP。
 */
async function fetchClientDetail(
  _baseUrl: string,
  _uuid: string,
  _auth?: AuthConfig,
): Promise<ClientDetail | null> {
  return null;
}

async function deleteNode(baseUrl: string, uuid: string, auth?: AuthConfig): Promise<void> {
  if (!baseUrl || !uuid) throw new Error("缺少节点标识");
  await adminCall(baseUrl, { action: "delete", id: uuid }, auth);
}

/**
 * 新建服务器：`action=add` 只返回 UUID，安装命令还需要 Worker 的 API_SECRET，
 * 所以紧接着用 `get_settings` 取一次。返回值编码成 `<id>|<secret>`，由
 * buildInstallCommands 拆开——端口签名只有一个字符串可传。
 */
async function createNode(
  baseUrl: string,
  name: string,
  auth?: AuthConfig,
): Promise<CreatedNode> {
  const created = await adminCall<{ id?: string }>(baseUrl, { action: "add", name }, auth);
  const id = created?.id || "";
  if (!id) throw new Error("面板未返回新服务器 ID");
  const secret = await readApiSecret(baseUrl, auth);
  return { uuid: id, token: `${id}|${secret}` };
}

/** 读取 Worker 环境变量 API_SECRET（探针上报用的全局密钥）。 */
async function readApiSecret(baseUrl: string, auth?: AuthConfig): Promise<string> {
  try {
    const body = await adminCall<{ api_secret?: string }>(
      baseUrl,
      { action: "get_settings" },
      auth,
    );
    return String(body?.api_secret || "");
  } catch {
    return "";
  }
}

async function getNodeToken(baseUrl: string, uuid: string, auth?: AuthConfig): Promise<string> {
  const secret = await readApiSecret(baseUrl, auth);
  return `${uuid}|${secret}`;
}

/**
 * 编辑服务器。面板的 `edit` 按整行覆盖，且要求 reset_day / collect_interval /
 * report_interval 必传（number），因此必须先读 `/api/server` 拿当前完整记录，
 * 再把 patch 合并进去整体提交，否则未涉及的探针参数会被清成默认值。
 * 排序（sort_order）只能通过 `save_order` 整表重写，此处不支持，weight 被忽略。
 */
async function editNode(
  baseUrl: string,
  uuid: string,
  patch: NodeEditPatch,
  auth?: AuthConfig,
): Promise<void> {
  if (!baseUrl || !uuid) throw new Error("缺少节点标识");
  if (!auth || auth.mode === "none") throw new Error("编辑节点需要管理员凭证");
  const cur = await getJson<CfsmServer>(
    baseUrl,
    `/api/server?id=${encodeURIComponent(uuid)}`,
    auth,
    12000,
  );
  const name = patch.name != null ? patch.name : cur?.name || "";
  if (!name.trim()) throw new Error("节点名称不能为空");

  const payload: Record<string, any> = {
    action: "edit",
    id: uuid,
    name: name.trim(),
    server_group: patch.group != null ? patch.group : cur?.server_group || "Default",
    region: cur?.region || "",
    tags: patch.tags != null ? tagsToPanel(patch.tags) : cur?.tags || "",
    note: patch.note != null ? patch.note : cur?.note || "",
    price: patch.price != null ? Number(patch.price).toFixed(2) : cur?.price || "",
    billing_cycle:
      patch.billing_cycle != null
        ? daysToBillingCycle(patch.billing_cycle)
        : cur?.billing_cycle || "month",
    auto_renewal: cur?.auto_renewal || "0",
    currency: cur?.currency || "¥",
    expire_date: patch.expired_at != null ? patch.expired_at : cur?.expire_date || "",
    traffic_limit: cur?.traffic_limit || "",
    traffic_calc_type: cur?.traffic_calc_type || "total",
    interface: cur?.interface || "",
    // 三个必传的探针参数：一律用面板当前值，缺省取面板默认值。
    reset_day: num(cur?.reset_day),
    collect_interval: num(cur?.collect_interval),
    report_interval: num(cur?.report_interval) || 60,
    wss_report_interval: num(cur?.wss_report_interval) || 2,
    connection_mode: cur?.connection_mode || "auto",
    ping_mode: cur?.ping_mode || "tcp",
    auto_update: cur?.auto_update || "0",
    // 服务器级测速节点 / 流量校正 / 通知开关：整行覆盖时必须原样回传，
    // 否则会被清空（面板不区分「未提供」与「清空」）。
    custom_ct: cur?.custom_ct || "",
    custom_cu: cur?.custom_cu || "",
    custom_cm: cur?.custom_cm || "",
    custom_bd: cur?.custom_bd || "",
    node_1: cur?.node_1 || "",
    node_2: cur?.node_2 || "",
    node_3: cur?.node_3 || "",
    node_4: cur?.node_4 || "",
    rx_correction: null,
    tx_correction: null,
    offline_notify_disabled: cur?.offline_notify_disabled || "0",
    is_hidden: cur?.is_hidden || "0",
  };
  await adminCall(baseUrl, payload, auth);
}

/** 安装命令：面板的 agent 安装脚本需要服务器 UUID + Worker 的 API_SECRET。 */
function buildInstallCommands(
  baseUrl: string,
  tokenOrSecret: string,
): { label: string; command: string }[] {
  const raw = String(tokenOrSecret || "");
  const sep = raw.indexOf("|");
  const id = sep >= 0 ? raw.slice(0, sep) : "";
  const secret = sep >= 0 ? raw.slice(sep + 1) : raw;
  const worker = `${baseUrl.replace(/\/+$/, "")}/update`;
  const idArg = id || "<服务器 UUID>";
  const secretArg = secret || "<API_SECRET>";
  return [
    {
      label: "一键安装 (Go 探针)",
      command:
        `curl -fsSL 'https://raw.githubusercontent.com/huilang-me/cfsm-agent/main/install.sh' | ` +
        `sh -s -- install -id=${idArg} -secret='${secretArg}' -url=${worker} -auto_update=0`,
    },
    {
      label: "查看运行状态",
      command: `systemctl status cf-probe --no-pager -l && journalctl -u cf-probe -n 50 --no-pager`,
    },
  ];
}

/**
 * 站点设置：`action=get_settings` 返回 settings + api_secret（只读展示）。
 * 面板会一并返回 Cloudflare Token / Turnstile Secret 等敏感字段，这里直接剔除，
 * 避免它们在设备上明文展示。
 */
async function fetchSiteSettings(baseUrl: string, auth?: AuthConfig): Promise<SiteSettings> {
  const body = await adminCall<{ settings?: SiteSettings }>(
    baseUrl,
    { action: "get_settings" },
    auth,
  );
  const src = (body?.settings || {}) as SiteSettings;
  const out: SiteSettings = {};
  for (const key of Object.keys(src)) {
    if (/token|secret|password|webhook/i.test(key)) continue;
    out[key] = src[key];
  }
  return out;
}

// ----------------------------------------------------------------------------
// Live transport.
//
// 两条通道并行：
//  1. WebSocket `/api/ws?subscribe=all`（私有站点带 ?token=<jwt>）。连上后必须
//     主动发 `{type:"subscribe",scope:"all",ids:[...]}`，否则面板默认不推任何
//     服务器；`ids` 来自 `/api/servers`。
//  2. REST `/api/servers` 定期对账（30s）。batchUpdate 只带变化字段，且 WS 在
//     Durable Object 未绑定时会 503；对账保证这种情况下仍能刷新，也能感知新增/
//     删除的服务器。
// 定时器只在 start() 里创建：Scripting 运行时里在 WS 回调内注册的定时器不会触发。
// ----------------------------------------------------------------------------

const TICK_MS = 2000;
/** 没有 WS 时的重连退避。 */
const RECONNECT_MS = 5000;
/** REST 对账周期。 */
const SYNC_MS = 30000;
/** 心跳（每 15 个 tick ≈ 30s）。 */
const HEARTBEAT_TICKS = 15;

class CfsmLiveClient implements LiveSession {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private ticks = 0;
  /** 下一次允许建连的时间戳；0 表示立即可连。 */
  private nextConnectAt = 0;
  /** 最近一次收到帧的时间（仅用于诊断）。 */
  private connected = false;
  private lastSyncAt = 0;
  private syncing = false;
  /** 已向面板声明的订阅 id 集合（变化时才重发 subscribe）。 */
  private subscribedIds = "";
  /** serverId -> 累计后的实时记录。 */
  private records: { [uuid: string]: LiveRecord } = {};

  /** 最近一次上报给上层的状态，用来去重。 */
  private lastStatus = "";

  constructor(
    private baseUrl: string,
    private handlers: LiveHandlers,
    private getAuth?: () => AuthConfig | undefined,
  ) {}

  /** 只在状态真正变化时通知上层，避免每帧都刷一次。 */
  private setStatus(s: "connected" | "disconnected" | "error"): void {
    if (this.lastStatus === s) return;
    this.lastStatus = s;
    this.handlers.onStatus(s);
  }

  private currentAuth(): AuthConfig | undefined {
    return this.getAuth ? this.getAuth() : undefined;
  }

  private wsUrl(): string {
    const u = this.baseUrl.replace(/^http/i, "ws").replace(/\/+$/, "");
    const jwt = jwtOf(this.currentAuth());
    const q = `subscribe=all${jwt ? `&token=${encodeURIComponent(jwt)}` : ""}`;
    return `${u}/api/ws?${q}`;
  }

  start(): void {
    if (this.timer) return;
    this.closed = false;
    this.nextConnectAt = 0;
    this.connect();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    void this.sync();
  }

  private tick(): void {
    if (this.closed) return;
    this.ticks++;
    if (!this.ws && Date.now() >= this.nextConnectAt) this.connect();
    if (this.ws && this.ticks % HEARTBEAT_TICKS === 0) this.send('{"type":"ping"}');
    if (Date.now() - this.lastSyncAt >= SYNC_MS) void this.sync();
  }

  /** 拉一次 /api/servers：刷新记录、对齐订阅范围，并把快照推给上层。 */
  private async sync(): Promise<void> {
    if (this.closed || this.syncing) return;
    this.syncing = true;
    this.lastSyncAt = Date.now();
    try {
      const servers = await fetchServersRaw(this.baseUrl, this.currentAuth());
      const now = Date.now();
      for (const s of servers) {
        if (!s?.id) continue;
        this.records[String(s.id)] = cfsmServerToRecord(s, now);
      }
      this.emit(now);
      this.setStatus("connected");
      this.subscribe(servers.map((s) => String(s.id)));
    } catch {
      // 只有一条通道都还没通的时候才报错，避免偶发 401 把状态翻红。
      if (!this.connected) this.setStatus("error");
    } finally {
      this.syncing = false;
    }
  }

  /** 向面板声明订阅列表；id 集合未变则不重复发送。 */
  private subscribe(ids: string[]): void {
    const list = ids.filter(Boolean).slice(0, 500).sort();
    // 还没有 id 时不发（空列表无事可订阅，也可能被当成非法范围）。
    if (list.length === 0) return;
    const key = list.join(",");
    if (this.ws && key === this.subscribedIds) return;
    this.subscribedIds = key;
    this.send(JSON.stringify({ type: "subscribe", scope: "all", ids: list }));
  }

  private emit(nowMs: number): void {
    this.handlers.onData([], cfsmBuildLive(this.records, nowMs));
  }

  private send(text: string): void {
    try {
      this.ws?.send(text);
    } catch {
      /* socket 未就绪 */
    }
  }

  private connect(): void {
    if (this.closed || this.ws) return;
    try {
      const ws = new WebSocket(this.wsUrl());
      this.ws = ws;

      ws.onopen = () => {
        // 新连接上订阅状态是空的：清掉旧签名，让已知 id 重新声明一次。
        this.subscribedIds = "";
        this.subscribe(Object.keys(this.records));
      };

      ws.onmessage = (message: string | Data) => {
        const text = typeof message === "string" ? message : message.toRawString() ?? "";
        if (!text) return;
        try {
          const frame = JSON.parse(text) as CfsmWsFrame;
          this.connected = true;
          this.setStatus("connected");
          if (frame?.type === "batchUpdate") {
            const updates = Array.isArray(frame.updates) ? frame.updates : [];
            const now = Date.now();
            for (const u of updates) {
              const id = String(u?.serverId || "");
              if (!id) continue;
              let rec = this.records[id];
              for (const sample of u.samples || []) {
                rec = mergeSample(rec, sample?.data || {}, sample?.ts || now, now);
              }
              if (rec) this.records[id] = rec;
            }
            this.emit(now);
          } else if (frame?.type === "hello") {
            // 握手确认：把已知 id 立刻订阅，避免等下一次对账。
            this.subscribedIds = "";
            this.subscribe(Object.keys(this.records));
          }
        } catch {
          /* 忽略畸形帧 */
        }
      };

      ws.onerror = () => this.dropSocket("error");
      ws.onclose = () => this.dropSocket("disconnected");
    } catch {
      this.nextConnectAt = Date.now() + RECONNECT_MS;
      this.setStatus("error");
    }
  }

  // 只记时间戳，不在回调里建定时器（WS 回调创建的定时器不会触发）。
  private dropSocket(status: "disconnected" | "error"): void {
    if (!this.ws) return; // onerror / onclose 会成对触发，只处理第一次
    this.ws = null;
    this.connected = false;
    this.subscribedIds = "";
    this.nextConnectAt = Date.now() + RECONNECT_MS;
    if (!this.closed) this.setStatus(status);
  }

  stop(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.nextConnectAt = 0;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, "client stop");
    } catch {
      /* noop */
    }
  }
}

// ----------------------------------------------------------------------------
// Backend object — exported and registered in class/server.ts.
// ----------------------------------------------------------------------------

export const CfsmBackend: Backend = {
  caps: CFSM_CAPS,
  fetchNodes,
  fetchVersion,
  verifyAuth,
  validateToken(token: string): string | null {
    if (looksLikeJwt(token)) return null;
    return (
      "这不是 JWT（应为 3 段 base64url、用 . 分隔，通常以 eyJ 开头）。" +
      "面板里的 API_SECRET / jwt_secret 是密钥不是令牌，不能当 Bearer 用。"
    );
  },
  login,
  fetchPingRecords,
  fetchPingTasks,
  fetchLoadRecords,
  fetchClientDetail,
  createNode,
  getNodeToken,
  deleteNode,
  editNode,
  buildInstallCommands,
  fetchSiteSettings,
  startLive(baseUrl, handlers, getAuth) {
    const client = new CfsmLiveClient(baseUrl, handlers, getAuth);
    client.start();
    return client;
  },
};
