// ============================================================================
// 哪吒 (Nezha) Monitor v1 adapter.
// Top half: PURE transforms (no I/O) — raw Nezha JSON -> canonical app model.
// Bottom half: the NezhaBackend object — network calls + the live transport,
//   implementing the `Backend` port from class/backend.ts.
// S: Single Purpose — everything Nezha-specific lives here.
// U: Unidirectional — Nezha shapes in, canonical shapes out. Never the reverse.
// R: Replaceable — registered via class/backend.ts; the UI never sees a Nezha type.
// ============================================================================
import { fetch } from "scripting";
import type {
  NodeBasicInfo,
  LiveRecord,
  LiveData,
  NezhaServer,
  NezhaState,
  NezhaHost,
  NezhaEnvelope,
  NezhaMetricsData,
  NezhaMetricPoint,
  NezhaServiceInfo,
  NezhaServerGroupItem,
  NezhaStreamData,
  LoadRecord,
  LoadType,
  PingData,
  PingRecord,
  PingTask,
  ClientDetail,
  AuthConfig,
  NezhaPeriod,
  ServiceOverview,
  NodeEditPatch,
  AlertRule,
  AlertRuleCond,
  NotificationChannel,
  CronTask,
  ManagedUser,
  ApiToken,
  SiteSettings,
} from "./types";
import {
  Backend,
  LoginResult,
  LiveHandlers,
  LiveSession,
  NEZHA_CAPS,
} from "./backend";

// PURE transforms live in ./nezha_transforms (no I/O, unit-tested there).
// Re-exported so existing internal references and tests resolve unchanged.
import {
  ONLINE_WINDOW_MS,
  nodeUuid,
  isServerOnline,
  serverToNode,
  stateToRecord,
  buildLiveData,
  metricsForLoadType,
  metricsToLoadRecords,
  serviceInfosToPingData,
  hoursToPeriod,
} from "./nezha_transforms";
export {
  ONLINE_WINDOW_MS,
  nodeUuid,
  isServerOnline,
  serverToNode,
  stateToRecord,
  buildLiveData,
  metricsForLoadType,
  metricsToLoadRecords,
  serviceInfosToPingData,
  hoursToPeriod,
} from "./nezha_transforms";

// ============================================================================
// NezhaBackend — network layer implementing the `Backend` port. Everything
// below performs I/O against `{baseUrl}/api/v1` and funnels raw JSON through
// the pure transforms above.
// ============================================================================

function apiBase(baseUrl: string): string {
  return `${baseUrl}/api/v1`;
}

/** "token" mode → PAT; "password" → cached JWT. Both ride Authorization. */
function authHeaders(auth?: AuthConfig): Record<string, string> {
  if (!auth || auth.mode === "none") return {};
  if (auth.mode === "token" && auth.apiKey) {
    return { Authorization: `Bearer ${auth.apiKey.trim()}` };
  }
  if (auth.mode === "password" && auth.sessionToken) {
    return { Authorization: `Bearer ${auth.sessionToken}` };
  }
  return {};
}

function headersFor(auth?: AuthConfig, extra?: Record<string, string>): Record<string, string> {
  return { Accept: "application/json", ...authHeaders(auth), ...(extra || {}) };
}

/** GET + unwrap the `{ success, data }` envelope. Distinguishes 401/403. */
async function getJson<T>(
  baseUrl: string,
  path: string,
  auth?: AuthConfig,
  timeout = 15000,
): Promise<T> {
  const res = await fetch(`${apiBase(baseUrl)}${path}`, {
    method: "GET",
    headers: headersFor(auth),
    timeout,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`未授权：请检查登录凭证 (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`请求失败 (HTTP ${res.status})`);
  const body = (await res.json()) as NezhaEnvelope<T>;
  if (!body || body.success === false) {
    throw new Error(body?.error || "返回数据格式不正确");
  }
  return (body.data ?? ([] as unknown as T)) as T;
}

/**
 * Generic write helper for Nezha admin endpoints. Sends JSON, parses the
 * standard `{success,error,data}` envelope, and surfaces auth / error states.
 * Returns the response `data` (may be undefined for empty 200s).
 */
async function writeJson<T = any>(
  baseUrl: string,
  path: string,
  method: "POST" | "PATCH" | "DELETE" | "PUT",
  body?: any,
  auth?: AuthConfig,
  timeout = 15000,
): Promise<T | undefined> {
  const res = await fetch(`${apiBase(baseUrl)}${path}`, {
    method,
    headers: headersFor(auth, body !== undefined ? { "Content-Type": "application/json" } : undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    timeout,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`当前凭证没有管理员权限 (HTTP ${res.status})`);
  }
  let env: NezhaEnvelope<T> | null = null;
  try {
    env = (await res.json()) as NezhaEnvelope<T>;
  } catch {
    /* some endpoints return empty body on success */
  }
  if (!res.ok || env?.success === false) {
    throw new Error(env?.error || `请求失败 (HTTP ${res.status})`);
  }
  return env?.data;
}

async function fetchServerGroups(
  baseUrl: string,
  auth?: AuthConfig,
): Promise<{ [serverId: number]: string }> {
  const out: { [serverId: number]: string } = {};
  try {
    const groups = await getJson<NezhaServerGroupItem[]>(baseUrl, "/server-group", auth, 10000);
    for (const g of groups || []) {
      const name = g?.group?.name || "";
      for (const sid of g?.servers || []) out[sid] = name;
    }
  } catch {
    /* best-effort */
  }
  return out;
}

/** Adapt a raw Nezha server list into the sorted canonical node list. */
function nodesFromServers(
  servers: NezhaServer[],
  groups: { [serverId: number]: string } = {},
): NodeBasicInfo[] {
  return servers
    .map((s) => serverToNode(s, groups[s.id]))
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return (a.name || "").localeCompare(b.name || "");
    });
}

async function login(
  baseUrl: string,
  username: string,
  password: string,
  twoFactor?: string,
): Promise<LoginResult> {
  if (!baseUrl) return { ok: false, error: "未配置哪吒地址" };
  try {
    const body: Record<string, string> = { username, password };
    if (twoFactor) body["code"] = twoFactor;
    const res = await fetch(`${apiBase(baseUrl)}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      timeout: 15000,
    });
    let parsed: any = null;
    try {
      parsed = await res.json();
    } catch {
      /* body may be empty */
    }
    if (!res.ok || parsed?.success === false) {
      const msg = parsed?.error || parsed?.message || `登录失败 (HTTP ${res.status})`;
      const needs2FA = /2fa|two[- ]?factor|otp|totp|verification/i.test(String(msg));
      return { ok: false, error: msg, needs2FA };
    }
    const token = parsed?.data?.token || parsed?.token;
    if (!token) return { ok: false, error: "登录成功但未返回会话凭证" };
    return { ok: true, sessionToken: token };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function fetchNodes(baseUrl: string, auth?: AuthConfig): Promise<NodeBasicInfo[]> {
  if (!baseUrl) throw new Error("未配置哪吒地址");
  const [servers, groups] = await Promise.all([
    getJson<NezhaServer[]>(baseUrl, "/server", auth),
    fetchServerGroups(baseUrl, auth),
  ]);
  return nodesFromServers(servers || [], groups);
}

async function fetchVersion(baseUrl: string, auth?: AuthConfig): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase(baseUrl)}/setting`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 8000,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as any;
    const d = body?.data ?? body;
    return d?.config?.site_name || d?.site_name || d?.version || "已连接";
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
    const path = auth?.mode === "token" ? "/server" : "/profile";
    const res = await fetch(`${apiBase(baseUrl)}${path}`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 10000,
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "凭证无效或已过期" };
    if (!res.ok) return { ok: false, error: `验证失败 (HTTP ${res.status})` };
    const body = (await res.json()) as any;
    const d = body?.data ?? body;
    const u = d?.username || d?.nickname || (Array.isArray(d) ? `${d.length} 台服务器` : undefined);
    return { ok: true, username: u };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function fetchLiveSnapshot(
  baseUrl: string,
  auth?: AuthConfig,
): Promise<{ servers: NezhaServer[]; live: LiveData }> {
  const servers = await getJson<NezhaServer[]>(baseUrl, "/server", auth, 12000);
  const list = servers || [];
  let anchor = 0;
  for (const s of list) {
    const t = Date.parse(s.last_active || "");
    if (!isNaN(t) && t > anchor) anchor = t;
  }
  const now = anchor > 0 ? anchor : Date.now();
  return { servers: list, live: buildLiveData(list, now) };
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
    const period = hoursToPeriod(hours);
    const infos = await getJson<NezhaServiceInfo[]>(
      baseUrl,
      `/server/${encodeURIComponent(uuid)}/service?period=${period}`,
      auth,
    );
    return serviceInfosToPingData(infos || []);
  } catch {
    return empty;
  }
}

async function fetchPingTasks(_baseUrl: string, _auth?: AuthConfig): Promise<PingTask[]> {
  return [];
}

async function fetchLoadRecords(
  baseUrl: string,
  uuid: string,
  loadType: LoadType,
  hours: number,
  auth?: AuthConfig,
  totals?: { mem?: number; disk?: number },
): Promise<LoadRecord[]> {
  if (!baseUrl || !uuid) return [];
  try {
    const period = hoursToPeriod(hours);
    const metrics = metricsForLoadType(loadType);
    const series: { [metric: string]: NezhaMetricPoint[] } = {};
    await Promise.all(
      metrics.map(async (metric) => {
        try {
          const data = await getJson<NezhaMetricsData>(
            baseUrl,
            `/server/${encodeURIComponent(uuid)}/metrics?metric=${metric}&period=${period}`,
            auth,
          );
          series[metric] = Array.isArray(data?.data_points) ? data.data_points : [];
        } catch {
          series[metric] = [];
        }
      }),
    );
    const total =
      loadType === "ram" ? totals?.mem || 0 : loadType === "disk" ? totals?.disk || 0 : 0;
    return metricsToLoadRecords(loadType, series, total);
  } catch {
    return [];
  }
}

async function fetchClientDetail(
  baseUrl: string,
  uuid: string,
  auth?: AuthConfig,
): Promise<ClientDetail | null> {
  if (!baseUrl || !uuid) return null;
  if (!auth || auth.mode === "none") return null;
  try {
    const servers = await getJson<NezhaServer[]>(baseUrl, "/server", auth, 12000);
    const srv = (servers || []).find((s) => nodeUuid(s) === uuid);
    if (!srv) return null;
    const ipv4 = srv.geoip?.ip?.ipv4_addr || "";
    const ipv6 = srv.geoip?.ip?.ipv6_addr || "";
    if (!ipv4 && !ipv6) return null;
    return {
      uuid,
      name: srv.name,
      ipv4: ipv4 || undefined,
      ipv6: ipv6 || undefined,
      region: srv.country_code || srv.geoip?.country_code,
      remark: srv.public_note || srv.note,
    };
  } catch {
    return null;
  }
}

async function deleteNode(baseUrl: string, uuid: string, auth?: AuthConfig): Promise<void> {
  if (!baseUrl || !uuid) throw new Error("缺少节点标识");
  const id = Number(uuid);
  if (!isFinite(id)) throw new Error("无效的节点 ID");
  const res = await fetch(`${apiBase(baseUrl)}/batch-delete/server`, {
    method: "POST",
    headers: headersFor(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify([id]),
    timeout: 15000,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* may be empty */
  }
  if (!res.ok || body?.success === false) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("当前凭证没有管理员权限 (HTTP " + res.status + ")");
    }
    throw new Error(body?.error || body?.message || `请求失败 (HTTP ${res.status})`);
  }
}

/**
 * Edit a server via `PATCH /api/v1/server/{id}`. Nezha's ServerForm carries
 * name / display_index / public_note (and hide_for_guest). It has no per-node
 * tags / price / expiry, and group membership is managed via server-group, so
 * those patch fields are ignored here. Requires an admin credential.
 */
async function editNode(
  baseUrl: string,
  uuid: string,
  patch: NodeEditPatch,
  auth?: AuthConfig,
): Promise<void> {
  if (!baseUrl || !uuid) throw new Error("缺少节点标识");
  const id = Number(uuid);
  if (!isFinite(id)) throw new Error("无效的节点 ID");
  const body: Record<string, any> = {};
  if (patch.name != null) body.name = patch.name;
  if (patch.note != null) body.public_note = patch.note;
  if (patch.weight != null) body.display_index = patch.weight;
  const res = await fetch(`${apiBase(baseUrl)}/server/${id}`, {
    method: "PATCH",
    headers: headersFor(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    timeout: 15000,
  });
  let rb: any = null;
  try {
    rb = await res.json();
  } catch {
    /* may be empty */
  }
  if (!res.ok || rb?.success === false) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("当前凭证没有管理员权限 (HTTP " + res.status + ")");
    }
    throw new Error(rb?.error || rb?.message || `请求失败 (HTTP ${res.status})`);
  }
}

function buildInstallCommands(
  baseUrl: string,
  secret: string,
): { label: string; command: string }[] {
  const u = baseUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const tls = /^https:/i.test(baseUrl) ? "true" : "false";
  const tok = secret || "<CLIENT_SECRET>";
  return [
    {
      label: "一键脚本 (Linux)",
      command:
        `curl -L https://raw.githubusercontent.com/nezhahq/scripts/main/agent/install.sh ` +
        `-o nezha-agent.sh && chmod +x nezha-agent.sh && ` +
        `env NZ_SERVER=${u} NZ_TLS=${tls} NZ_CLIENT_SECRET=${tok} ./nezha-agent.sh`,
    },
    {
      label: "环境变量直接运行",
      command: `NZ_SERVER=${u} NZ_TLS=${tls} NZ_CLIENT_SECRET=${tok} ./nezha-agent`,
    },
  ];
}

/**
 * Live transport. guest + password (JWT) → WebSocket `/api/v1/ws/server`
 * (server PUSHES frames; JWT via `?token=`). PAT (token) → HTTP poll `/server`
 * (PATs are header-only, can't ride `?token=`). Both deliver raw servers +
 * canonical LiveData so the node list can be derived in guest mode.
 */
// 断线后重连的退避间隔（毫秒）
const RECONNECT_MS = 2500;

class NezhaLiveClient implements LiveSession {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private polling = false;
  // 下一次允许发起重连的时间戳；0 表示立即可连
  private nextConnectAt = 0;

  constructor(
    private baseUrl: string,
    private handlers: LiveHandlers,
    private intervalMs: number,
    private getAuth?: () => AuthConfig | undefined,
  ) {}

  private currentAuth(): AuthConfig | undefined {
    return this.getAuth ? this.getAuth() : undefined;
  }

  private useHttp(): boolean {
    const a = this.currentAuth();
    return !!a && a.mode === "token";
  }

  private wsUrl(): string {
    const u = this.baseUrl.replace(/^http/i, "ws");
    let url = `${u}/api/v1/ws/server`;
    const a = this.currentAuth();
    if (a?.mode === "password" && a.sessionToken) {
      url += `?token=${encodeURIComponent(a.sessionToken)}`;
    }
    return url;
  }

  start(): void {
    this.closed = false;
    this.nextConnectAt = 0;
    if (this.useHttp()) {
      this.startHttpPolling();
    } else {
      this.connect();
      // 重连定时器必须在这里创建：Scripting 运行时里在 WS 回调中注册的定时器
      // 永远不触发，写在 onclose/onerror 里的重连会静默失效。
      this.timer = setInterval(() => this.reconnectTick(), RECONNECT_MS);
    }
  }

  // 断线重连，由 start() 里创建的定时器驱动
  private reconnectTick(): void {
    if (this.closed || this.ws) return;
    if (Date.now() >= this.nextConnectAt) this.connect();
  }

  private startHttpPolling(): void {
    this.handlers.onStatus("connected");
    this.pollHttp();
    this.timer = setInterval(() => this.pollHttp(), this.intervalMs);
  }

  private async pollHttp(): Promise<void> {
    if (this.closed || this.polling) return;
    this.polling = true;
    try {
      const { servers, live } = await fetchLiveSnapshot(this.baseUrl, this.currentAuth());
      this.handlers.onStatus("connected");
      this.handlers.onData(servers, live);
    } catch {
      this.handlers.onStatus("error");
    } finally {
      this.polling = false;
    }
  }

  private connect(): void {
    if (this.closed || this.ws) return;
    try {
      const ws = new WebSocket(this.wsUrl());
      this.ws = ws;

      ws.onopen = () => {
        this.handlers.onStatus("connected");
      };

      ws.onmessage = (message: string | Data) => {
        const text = typeof message === "string" ? message : message.toRawString() ?? "";
        if (!text) return;
        try {
          const frame = JSON.parse(text) as NezhaStreamData;
          const servers = Array.isArray(frame?.servers) ? frame.servers : [];
          let now = typeof frame?.now === "number" && frame.now > 0 ? frame.now : 0;
          if (now === 0) {
            for (const s of servers) {
              const t = Date.parse(s.last_active || "");
              if (!isNaN(t) && t > now) now = t;
            }
          }
          if (now === 0) now = Date.now();
          this.handlers.onData(servers, buildLiveData(servers, now));
        } catch {
          /* ignore malformed frames */
        }
      };

      ws.onerror = () => this.dropSocket("error");
      ws.onclose = () => this.dropSocket("disconnected");
    } catch {
      this.failConnect();
    }
  }

  // 连接根本没建起来（构造失败，没有 socket 可清理）：报错并安排重连
  private failConnect(): void {
    this.nextConnectAt = Date.now() + RECONNECT_MS;
    if (!this.closed) this.handlers.onStatus("error");
  }

  // 标记断开并安排下一次重连。这里不创建定时器（WS 回调里的定时器不会触发），
  // 只更新时间戳，实际重连交给 reconnectTick()
  private dropSocket(status: "disconnected" | "error"): void {
    if (!this.ws) return; // onerror / onclose 会成对触发，只处理第一次
    this.ws = null;
    this.nextConnectAt = Date.now() + RECONNECT_MS;
    if (!this.closed) this.handlers.onStatus(status);
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

/**
 * Fetch the global service-monitor overview from `GET /service`. The response
 * is a map keyed by service id; each item carries current up/down counts plus
 * a `delay` array (recent average latencies). Uptime is derived from the
 * up/(up+down) ratio. Returns an empty list on any failure.
 */
async function fetchServiceOverview(
  baseUrl: string,
  auth?: AuthConfig,
): Promise<ServiceOverview[]> {
  if (!baseUrl) return [];
  try {
    const data = await getJson<any>(baseUrl, "/service", auth, 12000);
    // data may be { services: {id: item}, cycle_transfer_stats } or a bare map.
    const services = data?.services ?? data ?? {};
    const out: ServiceOverview[] = [];
    for (const key of Object.keys(services)) {
      const it = services[key];
      if (!it || typeof it !== "object") continue;
      const up = Number(it.current_up ?? it.currentUp ?? 0) || 0;
      const down = Number(it.current_down ?? it.currentDown ?? 0) || 0;
      const total = up + down;
      const delays = Array.isArray(it.delay)
        ? it.delay.filter((v: any) => typeof v === "number")
        : [];
      const recent = delays.filter((v: number) => v > 0);
      const currentDelay = recent.length > 0 ? recent[recent.length - 1] : 0;
      const dailyUp = Array.isArray(it.up)
        ? it.up.map((v: any) => Number(v) || 0)
        : [];
      const dailyDown = Array.isArray(it.down)
        ? it.down.map((v: any) => Number(v) || 0)
        : [];
      out.push({
        id: Number(it.service_id ?? it.monitor_id ?? key) || 0,
        name: it.service_name || it.monitor_name || `服务 ${key}`,
        uptime: total > 0 ? (up / total) * 100 : 0,
        currentDelay,
        up: down === 0 || up >= down,
        delays,
        dailyUp,
        dailyDown,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ===========================================================================
// Admin: alert rules  (GET/POST /alert-rule, PATCH /alert-rule/:id,
//        POST /batch-delete/alert-rule)  — contract confirmed from source.
// ===========================================================================

/** Map a raw Nezha alert rule to canonical form. */
export function toAlertRule(raw: any): AlertRule {
  const conds: AlertRuleCond[] = Array.isArray(raw?.rules)
    ? raw.rules.map((r: any) => ({
        type: String(r?.type ?? ""),
        max: typeof r?.max === "number" ? r.max : undefined,
        min: typeof r?.min === "number" ? r.min : undefined,
        duration: typeof r?.duration === "number" ? r.duration : undefined,
        cover: typeof r?.cover === "number" ? r.cover : undefined,
        ignore: r?.ignore && typeof r.ignore === "object" ? r.ignore : undefined,
      }))
    : [];
  return {
    id: Number(raw?.id) || 0,
    name: raw?.name || "",
    enabled: !!raw?.enable,
    rules: conds,
    notificationGroupId: Number(raw?.notification_group_id) || 0,
    triggerMode: Number(raw?.trigger_mode) || 0,
  };
}

/** Canonical alert rule → Nezha request body (model.AlertRule fields). */
export function fromAlertRule(rule: AlertRule): any {
  return {
    name: rule.name,
    rules: rule.rules.map((c) => ({
      type: c.type,
      ...(c.max != null ? { max: c.max } : {}),
      ...(c.min != null ? { min: c.min } : {}),
      ...(c.duration != null ? { duration: c.duration } : {}),
      ...(c.cover != null ? { cover: c.cover } : {}),
      ...(c.ignore ? { ignore: c.ignore } : {}),
    })),
    notification_group_id: rule.notificationGroupId,
    enable: rule.enabled,
    trigger_mode: rule.triggerMode,
    fail_trigger_tasks: [],
    recover_trigger_tasks: [],
  };
}

async function listAlertRules(baseUrl: string, auth?: AuthConfig): Promise<AlertRule[]> {
  const data = await getJson<any[]>(baseUrl, "/alert-rule", auth, 12000);
  return (Array.isArray(data) ? data : []).map(toAlertRule);
}

async function saveAlertRule(baseUrl: string, rule: AlertRule, auth?: AuthConfig): Promise<void> {
  const body = fromAlertRule(rule);
  if (rule.id > 0) {
    await writeJson(baseUrl, `/alert-rule/${rule.id}`, "PATCH", body, auth);
  } else {
    await writeJson(baseUrl, "/alert-rule", "POST", body, auth);
  }
}

async function deleteAlertRule(baseUrl: string, id: number, auth?: AuthConfig): Promise<void> {
  await writeJson(baseUrl, "/batch-delete/alert-rule", "POST", [id], auth);
}

// ===========================================================================
// Admin: notification channels  (GET/POST /notification, PATCH /notification/:id,
//        POST /batch-delete/notification). NotificationForm fields confirmed.
// ===========================================================================
export function toNotification(raw: any): NotificationChannel {
  return {
    id: Number(raw?.id) || 0,
    name: raw?.name || "",
    url: raw?.url || "",
    requestBody: raw?.request_body || "",
    requestMethod: Number(raw?.request_method) || 0,
    skipCheck: !!raw?.skip_check,
  };
}
async function listNotifications(baseUrl: string, auth?: AuthConfig): Promise<NotificationChannel[]> {
  const data = await getJson<any[]>(baseUrl, "/notification", auth, 12000);
  return (Array.isArray(data) ? data : []).map(toNotification);
}
async function saveNotification(baseUrl: string, ch: NotificationChannel, auth?: AuthConfig): Promise<void> {
  const body = {
    name: ch.name,
    url: ch.url,
    request_method: ch.requestMethod ?? 1,
    request_type: 0,
    request_header: "",
    request_body: ch.requestBody ?? "",
    verify_tls: !ch.skipCheck,
    skip_check: !!ch.skipCheck,
  };
  if (ch.id > 0) await writeJson(baseUrl, `/notification/${ch.id}`, "PATCH", body, auth);
  else await writeJson(baseUrl, "/notification", "POST", body, auth);
}
async function deleteNotification(baseUrl: string, id: number, auth?: AuthConfig): Promise<void> {
  await writeJson(baseUrl, "/batch-delete/notification", "POST", [id], auth);
}

// ===========================================================================
// Admin: cron / scheduled tasks  (GET/POST /cron, PATCH /cron/:id,
//        POST /cron/:id/manual, POST /batch-delete/cron). CronForm confirmed.
//        This also covers Nezha "command execution": create a task_type=1
//        trigger task with a command + target servers, then runCronTask().
// ===========================================================================
export function toCronTask(raw: any): CronTask {
  return {
    id: Number(raw?.id) || 0,
    name: raw?.name || "",
    scheduler: raw?.scheduler || "",
    command: raw?.command || "",
    taskType: Number(raw?.task_type) || 0,
    cover: Number(raw?.cover) || 0,
    servers: Array.isArray(raw?.servers) ? raw.servers.map((s: any) => Number(s) || 0) : [],
    pushSuccessful: !!raw?.push_successful,
    notificationGroupId: Number(raw?.notification_group_id) || 0,
    lastResult: raw?.last_result || raw?.last_execute_at_result || "",
    lastExecutedAt: raw?.last_executed_at || "",
  };
}
async function listCronTasks(baseUrl: string, auth?: AuthConfig): Promise<CronTask[]> {
  const data = await getJson<any[]>(baseUrl, "/cron", auth, 12000);
  return (Array.isArray(data) ? data : []).map(toCronTask);
}
async function saveCronTask(baseUrl: string, task: CronTask, auth?: AuthConfig): Promise<void> {
  const body = {
    task_type: task.taskType ?? 0,
    name: task.name,
    scheduler: task.scheduler || "",
    command: task.command || "",
    servers: task.servers || [],
    cover: task.cover ?? 0,
    push_successful: !!task.pushSuccessful,
    notification_group_id: task.notificationGroupId ?? 0,
  };
  if (task.id > 0) await writeJson(baseUrl, `/cron/${task.id}`, "PATCH", body, auth);
  else await writeJson(baseUrl, "/cron", "POST", body, auth);
}
async function deleteCronTask(baseUrl: string, id: number, auth?: AuthConfig): Promise<void> {
  await writeJson(baseUrl, "/batch-delete/cron", "POST", [id], auth);
}
async function runCronTask(baseUrl: string, id: number, auth?: AuthConfig): Promise<void> {
  await writeJson(baseUrl, `/cron/${id}/manual`, "POST", undefined, auth);
}

// ===========================================================================
// Admin: users  (GET/POST /user, POST /batch-delete/user). UserForm confirmed.
// ===========================================================================
export function toUser(raw: any): ManagedUser {
  return {
    id: Number(raw?.id) || 0,
    username: raw?.username || "",
    role: raw?.role != null ? String(raw.role) : undefined,
  };
}
async function listUsers(baseUrl: string, auth?: AuthConfig): Promise<ManagedUser[]> {
  const data = await getJson<any[]>(baseUrl, "/user", auth, 12000);
  return (Array.isArray(data) ? data : []).map(toUser);
}
async function createUser(baseUrl: string, username: string, password: string, auth?: AuthConfig): Promise<void> {
  // Role 1 = ordinary member (0 = admin). Default to member for safety.
  await writeJson(baseUrl, "/user", "POST", { username, password, role: 1 }, auth);
}
async function deleteUser(baseUrl: string, id: number, auth?: AuthConfig): Promise<void> {
  await writeJson(baseUrl, "/batch-delete/user", "POST", [id], auth);
}

// ===========================================================================
// Admin: API tokens  (GET/POST /api-tokens, DELETE /api-tokens/:id).
//        Create requires a non-empty scopes list; we request admin-all.
// ===========================================================================
export function toApiToken(raw: any): ApiToken {
  return {
    id: Number(raw?.id) || 0,
    token: raw?.token || "",
    note: raw?.name || "",
    createdAt: raw?.created_at || "",
  };
}
async function listApiTokens(baseUrl: string, auth?: AuthConfig): Promise<ApiToken[]> {
  const data = await getJson<any[]>(baseUrl, "/api-tokens", auth, 12000);
  return (Array.isArray(data) ? data : []).map(toApiToken);
}
async function createApiToken(baseUrl: string, note: string, auth?: AuthConfig): Promise<ApiToken> {
  const data = await writeJson<any>(
    baseUrl,
    "/api-tokens",
    "POST",
    { name: note, scopes: ["nezha:*"] },
    auth,
  );
  return toApiToken(data);
}
async function deleteApiToken(baseUrl: string, id: number, auth?: AuthConfig): Promise<void> {
  await writeJson(baseUrl, `/api-tokens/${id}`, "DELETE", undefined, auth);
}

// ===========================================================================
// Admin: site settings (read-only here). `GET /setting` returns a large
// SettingResponse; editing the full Setting form safely is out of scope, so
// we expose it read-only and surface the common fields.
// ===========================================================================
async function fetchSiteSettings(baseUrl: string, auth?: AuthConfig): Promise<SiteSettings> {
  const data = await getJson<any>(baseUrl, "/setting", auth, 12000);
  const conf = data?.config ?? data ?? {};
  return conf as SiteSettings;
}

export const NezhaBackend: Backend = {
  caps: NEZHA_CAPS,
  fetchNodes,
  fetchVersion,
  verifyAuth,
  login,
  fetchPingRecords,
  fetchPingTasks,
  fetchLoadRecords,
  fetchClientDetail,
  deleteNode,
  editNode,
  buildInstallCommands,
  fetchServiceOverview,
  listAlertRules,
  saveAlertRule,
  deleteAlertRule,
  listNotifications,
  saveNotification,
  deleteNotification,
  listCronTasks,
  saveCronTask,
  deleteCronTask,
  runCronTask,
  listUsers,
  createUser,
  deleteUser,
  listApiTokens,
  createApiToken,
  deleteApiToken,
  fetchSiteSettings,
  startLive(baseUrl, handlers, getAuth) {
    const c = new NezhaLiveClient(baseUrl, handlers, 2000, getAuth);
    c.start();
    return c;
  },
  nodesFromLive(servers) {
    return nodesFromServers(servers);
  },
};
