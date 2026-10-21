// ============================================================================
// Komari backend adapter. Implements the `Backend` port against a Komari
// dashboard's HTTP + WebSocket API. Extracted from the original data layer.
// S: Single Purpose — all Komari-specific network I/O + shape handling.
// U: Unidirectional — network -> typed data -> canonical model -> callers.
// R: Replaceable — registered via class/backend.ts; nothing imports it directly.
// ============================================================================
import { fetch } from "scripting";
import type {
  NodeBasicInfo,
  NodeResponse,
  LiveData,
  LiveRecord,
  PingData,
  PingTask,
  LoadRecord,
  LoadData,
  LoadType,
  NodeEditPatch,
  CommandExecResult,
  LoginSession,
  SiteSettings,
  AuthConfig,
  ClientDetail,
} from "./types";
import {
  Backend,
  LoginResult,
  CreatedNode,
  LiveHandlers,
  LiveSession,
  KOMARI_CAPS,
} from "./backend";

// ----------------------------------------------------------------------------
// Auth helpers. "token" mode → Komari API Key (Bearer); "password" → the
// session_token cookie obtained from /api/login.
// ----------------------------------------------------------------------------

function authHeaders(auth?: AuthConfig): Record<string, string> {
  if (!auth || auth.mode === "none") return {};
  if (auth.mode === "token" && auth.apiKey) {
    return { Authorization: `Bearer ${auth.apiKey.trim()}` };
  }
  if (auth.mode === "password" && auth.sessionToken) {
    return { Cookie: `session_token=${auth.sessionToken}` };
  }
  return {};
}

function headersFor(auth?: AuthConfig, extra?: Record<string, string>): Record<string, string> {
  return { Accept: "application/json", ...authHeaders(auth), ...(extra || {}) };
}

/** Pull `session_token` out of a response's Set-Cookie header, if present. */
function extractSessionToken(res: any): string | null {
  try {
    const raw = res?.headers?.get?.("set-cookie") || res?.headers?.get?.("Set-Cookie") || "";
    if (!raw) return null;
    const m = /session_token=([^;]+)/i.exec(raw);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function adminError(status: number, msg?: string): Error {
  if (status === 401 || status === 403) {
    return new Error("当前凭证没有管理员权限 (HTTP " + status + ")");
  }
  return new Error(msg || `请求失败 (HTTP ${status})`);
}

// ----------------------------------------------------------------------------
// Network calls (module-private; exposed through the Backend object below).
// ----------------------------------------------------------------------------

async function login(
  baseUrl: string,
  username: string,
  password: string,
  twoFactor?: string,
): Promise<LoginResult> {
  if (!baseUrl) return { ok: false, error: "未配置 Komari 地址" };
  try {
    const body: Record<string, string> = { username, password };
    if (twoFactor) body["2fa_code"] = twoFactor;
    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      timeout: 15000,
    });
    const token = extractSessionToken(res);
    let parsed: any = null;
    try {
      parsed = await res.json();
    } catch {
      /* body may be empty on success */
    }
    if (!res.ok) {
      const msg = parsed?.message || parsed?.error || `登录失败 (HTTP ${res.status})`;
      const needs2FA = /2fa|two[- ]?factor|otp/i.test(String(msg));
      return { ok: false, error: msg, needs2FA };
    }
    if (parsed && (parsed.need_2fa || parsed.requires_2fa || parsed?.data?.need_2fa)) {
      return { ok: false, needs2FA: true, error: "需要两步验证码" };
    }
    const sessionToken = token || parsed?.data?.session_token || parsed?.session_token;
    if (!sessionToken) return { ok: false, error: "登录成功但未返回会话凭证" };
    return { ok: true, sessionToken };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function fetchNodes(baseUrl: string, auth?: AuthConfig): Promise<NodeBasicInfo[]> {
  if (!baseUrl) throw new Error("未配置 Komari 地址");
  const res = await fetch(`${baseUrl}/api/nodes`, {
    method: "GET",
    headers: headersFor(auth),
    timeout: 15000,
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("未授权：请检查登录凭证 (HTTP 401)");
    throw new Error(`请求失败 (HTTP ${res.status})`);
  }
  const body = (await res.json()) as NodeResponse;
  if (!body || body.status !== "success" || !Array.isArray(body.data)) {
    throw new Error(body?.message || "返回数据格式不正确");
  }
  // Normalize: ensure numeric `id` exists (Komari keys by uuid) and sort.
  return body.data
    .map((n) => ({ ...n, id: n.id || 0 }))
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return (a.name || "").localeCompare(b.name || "");
    });
}

async function fetchVersion(baseUrl: string, auth?: AuthConfig): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/api/version`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 8000,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { version?: string } } | any;
    return body?.data?.version ?? body?.version ?? null;
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
    const res = await fetch(`${baseUrl}/api/me`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 10000,
    });
    if (res.status === 401) return { ok: false, error: "凭证无效或已过期" };
    if (!res.ok) return { ok: false, error: `验证失败 (HTTP ${res.status})` };
    const body = (await res.json()) as any;
    const u = body?.data?.username || body?.username || body?.data?.uuid;
    return { ok: true, username: u };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Komari's WebSocket / recent records map almost 1:1 onto the canonical
 * LiveRecord, EXCEPT GPU and temperature, which Komari nests under a `gpu`
 * object (`{ average_usage, detailed_info: [{ name, utilization, temperature }] }`).
 * This normalises those into the canonical flat `gpu` / `temp` / `gpus` fields
 * so the detail UI renders them the same way for both backends.
 */
export function enrichRecord(rec: any): LiveRecord {
  if (!rec || typeof rec !== "object") return rec as LiveRecord;
  const g = rec.gpu;
  if (g && typeof g === "object" && !Array.isArray(g)) {
    const detail = Array.isArray(g.detailed_info) ? g.detailed_info : [];
    const avg =
      typeof g.average_usage === "number"
        ? g.average_usage
        : detail.length > 0
          ? detail.reduce((a: number, d: any) => a + (Number(d?.utilization) || 0), 0) / detail.length
          : undefined;
    if (avg != null) rec.gpu = avg;
    if (detail.length > 0) {
      rec.gpus = detail.map((d: any, i: number) => ({
        name: d?.name || `GPU ${i}`,
        usage: typeof d?.utilization === "number" ? d.utilization : undefined,
        temp: typeof d?.temperature === "number" ? d.temperature : undefined,
      }));
      // Live temperature: hottest GPU sensor (Komari has no CPU temp in Report).
      let hi = 0;
      for (const d of detail) {
        const v = Number(d?.temperature) || 0;
        if (v > hi) hi = v;
      }
      if (hi > 0) rec.temp = hi;
    }
  }
  return rec as LiveRecord;
}

/** Normalise a whole LiveData payload's records (GPU/temperature). */
export function enrichLiveData(data: LiveData): LiveData {
  if (!data?.data) return data;
  for (const uuid of Object.keys(data.data)) {
    data.data[uuid] = enrichRecord(data.data[uuid]);
  }
  return data;
}

async function fetchPingRecords(
  baseUrl: string,
  uuid: string,
  hours: number,
  auth?: AuthConfig,
): Promise<PingData> {
  const empty: PingData = { count: 0, records: [], basic_info: [], tasks: [] };
  if (!baseUrl || !uuid) return empty;
  try {
    const res = await fetch(
      `${baseUrl}/api/records/ping?uuid=${encodeURIComponent(uuid)}&hours=${hours}`,
      { method: "GET", headers: headersFor(auth), timeout: 15000 },
    );
    if (!res.ok) return empty;
    const body = (await res.json()) as { status?: string; data?: PingData } | any;
    if (body?.status !== "success" || !body?.data) return empty;
    const data = body.data as PingData;
    return {
      count: data.count ?? (data.records?.length || 0),
      records: Array.isArray(data.records) ? data.records : [],
      basic_info: Array.isArray(data.basic_info) ? data.basic_info : [],
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
    };
  } catch {
    return empty;
  }
}

async function fetchPingTasks(baseUrl: string, auth?: AuthConfig): Promise<PingTask[]> {
  if (!baseUrl) return [];
  try {
    const res = await fetch(`${baseUrl}/api/task/ping`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 10000,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { status?: string; data?: PingTask[] } | any;
    if (body?.status !== "success" || !Array.isArray(body?.data)) return [];
    return body.data as PingTask[];
  } catch {
    return [];
  }
}

async function fetchLoadRecords(
  baseUrl: string,
  uuid: string,
  loadType: LoadType,
  hours: number,
  auth?: AuthConfig,
): Promise<LoadRecord[]> {
  if (!baseUrl || !uuid) return [];
  try {
    const res = await fetch(
      `${baseUrl}/api/records/load?uuid=${encodeURIComponent(uuid)}` +
        `&load_type=${loadType}&hours=${hours}`,
      { method: "GET", headers: headersFor(auth), timeout: 15000 },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { status?: string; data?: LoadData } | any;
    if (body?.status !== "success" || !body?.data) return [];
    const recs = body.data.records;
    return Array.isArray(recs) ? (recs as LoadRecord[]) : [];
  } catch {
    return [];
  }
}

async function createNode(
  baseUrl: string,
  name: string,
  auth?: AuthConfig,
): Promise<CreatedNode> {
  if (!baseUrl) throw new Error("未配置 Komari 地址");
  const res = await fetch(`${baseUrl}/api/admin/client/add`, {
    method: "POST",
    headers: headersFor(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name: (name || "").trim() }),
    timeout: 15000,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || body?.status === "error") {
    throw adminError(res.status, body?.message || body?.error);
  }
  const uuid = body?.uuid ?? body?.data?.uuid;
  const token = body?.token ?? body?.data?.token;
  if (!uuid || !token) throw new Error("创建成功但未返回 uuid / token");
  return { uuid, token };
}

async function fetchClientDetail(
  baseUrl: string,
  uuid: string,
  auth?: AuthConfig,
): Promise<ClientDetail | null> {
  if (!baseUrl || !uuid) return null;
  if (!auth || auth.mode === "none") return null;
  try {
    const res = await fetch(`${baseUrl}/api/admin/client/${encodeURIComponent(uuid)}`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 12000,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as any;
    const d = body?.data ?? body;
    if (!d || typeof d !== "object") return null;
    const ipv4 = typeof d.ipv4 === "string" ? d.ipv4 : "";
    const ipv6 = typeof d.ipv6 === "string" ? d.ipv6 : "";
    return {
      uuid,
      name: d.name,
      ipv4: ipv4 || undefined,
      ipv6: ipv6 || undefined,
      region: d.region,
      remark: d.remark,
    };
  } catch {
    return null;
  }
}

async function getNodeToken(baseUrl: string, uuid: string, auth?: AuthConfig): Promise<string> {
  if (!baseUrl || !uuid) throw new Error("缺少节点标识");
  const res = await fetch(`${baseUrl}/api/admin/client/${encodeURIComponent(uuid)}/token`, {
    method: "GET",
    headers: headersFor(auth),
    timeout: 12000,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || body?.status === "error") {
    throw adminError(res.status, body?.message || body?.error);
  }
  const token = body?.token ?? body?.data?.token;
  if (!token) throw new Error("未返回 token");
  return token;
}

async function deleteNode(baseUrl: string, uuid: string, auth?: AuthConfig): Promise<void> {
  if (!baseUrl || !uuid) throw new Error("缺少节点标识");
  const res = await fetch(`${baseUrl}/api/admin/client/${encodeURIComponent(uuid)}/remove`, {
    method: "POST",
    headers: headersFor(auth, { "Content-Type": "application/json" }),
    body: "{}",
    timeout: 15000,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || body?.status === "error") {
    throw adminError(res.status, body?.message || body?.error);
  }
}

/**
 * Edit a node's metadata via `POST /api/admin/client/:uuid/edit`. Only the
 * provided patch fields are sent. Komari supports the full set (name / group /
 * tags / weight / price / billing_cycle / expired_at / remark). Requires admin.
 */
async function editNode(
  baseUrl: string,
  uuid: string,
  patch: NodeEditPatch,
  auth?: AuthConfig,
): Promise<void> {
  if (!baseUrl || !uuid) throw new Error("缺少节点标识");
  const body: Record<string, any> = { uuid };
  if (patch.name != null) body.name = patch.name;
  if (patch.group != null) body.group = patch.group;
  if (patch.tags != null) body.tags = patch.tags;
  if (patch.weight != null) body.weight = patch.weight;
  if (patch.price != null) body.price = patch.price;
  if (patch.billing_cycle != null) body.billing_cycle = patch.billing_cycle;
  if (patch.expired_at != null) body.expired_at = patch.expired_at;
  if (patch.note != null) body.remark = patch.note;
  const res = await fetch(`${baseUrl}/api/admin/client/${encodeURIComponent(uuid)}/edit`, {
    method: "POST",
    headers: headersFor(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    timeout: 15000,
  });
  let rb: any = null;
  try {
    rb = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || rb?.status === "error") {
    throw adminError(res.status, rb?.message || rb?.error);
  }
}

function buildInstallCommands(
  baseUrl: string,
  token: string,
): { label: string; command: string }[] {
  const u = baseUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const tls = /^https:/i.test(baseUrl) ? "true" : "false";
  const tok = token || "<TOKEN>";
  return [
    {
      label: "一键脚本 (Linux)",
      command:
        `curl -L https://raw.githubusercontent.com/komari-monitor/komari/main/scripts/install.sh ` +
        `-o komari_agent.sh && bash komari_agent.sh ${u} ${tok} ${tls}`,
    },
  ];
}

// ===========================================================================
// Admin: command execution (Komari-specific: event-sourced, task-table-stored)
// ===========================================================================
async function execCommand(
  baseUrl: string,
  command: string,
  uuids: string[],
  auth?: AuthConfig,
): Promise<CommandExecResult> {
  if (!baseUrl) throw new Error("未配置 Komari 地址");
  const res = await fetch(`${baseUrl}/api/admin/task`, {
    method: "POST",
    headers: headersFor(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      client_uuid: uuids,
      command,
      method: "execute",
    }),
    timeout: 15000,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || body?.status === "error") {
    throw adminError(res.status, body?.message || body?.error);
  }
  return {
    taskId: body?.task_id || body?.data?.task_id || "",
    message: `命令已下发至 ${uuids.length} 个节点`,
  };
}

async function fetchExecResult(
  baseUrl: string,
  taskId: string,
  auth?: AuthConfig,
): Promise<{ uuid: string; ok: boolean; output: string }[]> {
  if (!baseUrl || !taskId) return [];
  try {
    const res = await fetch(`${baseUrl}/api/admin/task/result?task_id=${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 12000,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { status?: string; data?: any[] } | any;
    if (body?.status !== "success" || !Array.isArray(body?.data)) return [];
    return body.data.map((r: any) => ({
      uuid: r?.client || r?.uuid || "",
      ok: r?.ok || r?.success || r?.exit_code === 0,
      output: r?.output || r?.result || "",
    }));
  } catch {
    return [];
  }
}

// ===========================================================================
// Admin: sessions (Komari-specific: GET /api/admin/session/get)
// ===========================================================================
async function listSessions(baseUrl: string, auth?: AuthConfig): Promise<LoginSession[]> {
  if (!baseUrl) return [];
  try {
    const res = await fetch(`${baseUrl}/api/admin/session/get`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 10000,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { status?: string; data?: any[] } | any;
    if (body?.status !== "success" || !Array.isArray(body?.data)) return [];
    return body.data.map((s: any) => ({
      id: s?.session_token || s?.id || "",
      username: s?.username || "",
      ip: s?.ip || "",
      createdAt: s?.created_at || s?.createdAt || "",
      lastActive: s?.last_active || s?.latest_online || s?.lastActive || "",
    }));
  } catch {
    return [];
  }
}

async function revokeSession(baseUrl: string, id: string, auth?: AuthConfig): Promise<void> {
  if (!baseUrl || !id) throw new Error("缺少会话标识");
  const res = await fetch(`${baseUrl}/api/admin/session/revoke`, {
    method: "POST",
    headers: headersFor(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify({ session_token: id }),
    timeout: 10000,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || body?.status === "error") {
    throw adminError(res.status, body?.message || body?.error);
  }
}

// ===========================================================================
// Admin: site settings (read/write)
// ===========================================================================
async function fetchSiteSettings(baseUrl: string, auth?: AuthConfig): Promise<SiteSettings> {
  if (!baseUrl) return {};
  try {
    const res = await fetch(`${baseUrl}/api/public`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 10000,
    });
    if (!res.ok) return {};
    const body = (await res.json()) as any;
    return body?.data ?? body ?? {};
  } catch {
    return {};
  }
}

async function patchSiteSettings(baseUrl: string, patch: SiteSettings, auth?: AuthConfig): Promise<void> {
  if (!baseUrl) throw new Error("未配置 Komari 地址");
  const res = await fetch(`${baseUrl}/api/admin/settings`, {
    method: "POST",
    headers: headersFor(auth, { "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
    timeout: 15000,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok || body?.status === "error") {
    throw adminError(res.status, body?.message || body?.error);
  }
}

// ----------------------------------------------------------------------------
// Live transport: ALWAYS uses WebSocket `/api/clients` regardless of auth.
// Komari's WS endpoint does NOT require authentication — it only uses login
// state to decide whether to filter hidden clients from the response.
// Online status is determined by the SERVER via `GetAllOnlineUUIDs()` which
// tracks active agent WebSocket connections + heartbeat presence, NOT by
// client-side freshness heuristics.
// 
// Previously the code fell back to HTTP-polling `/api/recent/:uuid` per node
// when auth was configured, which relied on a 1-minute in-memory cache that
// frequently returned null for live agents, causing them to appear offline.
// That path is removed in favor of the authoritative server-tracked online list.
//
// 心跳与重连只能由一个「在 start() 里创建」的定时器驱动：Scripting 运行时中
// 在 WS 回调（onopen / onmessage / onerror / onclose）里注册的定时器永远不触发，
// 早期写在 onopen 里的心跳和写在 onclose 里的重连都会静默失效——表现就是
// 「连上后只收到一帧，之后一直显示离线」。
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// 私有站点下的实时连接凭证。
// 开启「私有站点」后，Komari 的 PrivateSiteMiddleware 会拦截所有未登录的 /api 请求；
// 而 /api/clients 这个 WebSocket 端点不在白名单里（白名单只有 "/api/clients/" 带尾斜杠），
// 因此游客握手被 401 拒绝。Scripting 的 WebSocket 只能传 URL，无法附加 Cookie/
// Authorization 头，所以只能走查询参数：服务端会用 ?token= 识别 agent 令牌，
// 该身份既通过私有站点拦截，也满足 WS 的来源（Origin）校验。
// 令牌通过管理接口按节点读取，并按 baseUrl 缓存，避免每次重连都多两次请求。
// ----------------------------------------------------------------------------

const liveTokenCache = new Map<string, string>();

/** 取一个可用于 WS 握手的节点令牌；无凭证或非管理员时返回空串（公开站点无需令牌）。 */
async function resolveLiveToken(baseUrl: string, auth?: AuthConfig): Promise<string> {
  if (!baseUrl || !auth || auth.mode === "none") return "";
  const cached = liveTokenCache.get(baseUrl);
  if (cached) return cached;
  try {
    const nodes = await fetchNodes(baseUrl, auth);
    const uuid = nodes[0]?.uuid;
    if (!uuid) return "";
    const res = await fetch(`${baseUrl}/api/admin/client/${encodeURIComponent(uuid)}/token`, {
      method: "GET",
      headers: headersFor(auth),
      timeout: 12000,
    });
    if (!res.ok) return "";
    const body = (await res.json()) as any;
    const token = body?.token ?? body?.data?.token;
    if (typeof token === "string" && token) {
      liveTokenCache.set(baseUrl, token);
      return token;
    }
    return "";
  } catch {
    return "";
  }
}

/** 丢弃缓存的令牌（令牌被重置 / 节点被删 / 服务端判定无效时调用）。 */
function clearLiveToken(baseUrl: string): void {
  liveTokenCache.delete(baseUrl);
}

// 断线后重连的退避间隔（毫秒）
const RECONNECT_MS = 2500;

// 已连接但接连收不到帧的容忍时长，超过则强制重连（毫秒）
const STALL_MS = 12000;

class KomariLiveClient implements LiveSession {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  // 下一次允许发起重连的时间戳；0 表示立即可连
  private nextConnectAt = 0;
  // 最近一次收到帧的时间戳（0 表示本次连接还没收到过）
  private lastFrameAt = 0;
  // 是否已经收到过有效帧；只在这之后才向外报 connected，避免 401 握手闪一下「已连接」
  private connected = false;
  // 私有站点所需的 WS 令牌与解析状态
  private wsToken = "";
  private tokenReady = false;
  private tokenResolving = false;
  // 连续失败次数；达到阈值时作废缓存令牌并重新解析
  private failures = 0;
  // 本次连接是否已经收到过帧（用来区分「握手失败」和「正常断线」）
  private hadFrame = false;

  private intervalMs: number;

  constructor(
    private baseUrl: string,
    private handlers: LiveHandlers,
    intervalMs: number,
    private getAuth?: () => AuthConfig | undefined,
  ) {
    this.intervalMs = intervalMs || 2000;
  }

  private wsUrl(): string {
    const u = this.baseUrl.replace(/^http/i, "ws");
    // 私有站点下必须带令牌，否则握手被服务端 401 拒绝
    const q = this.wsToken ? `?token=${encodeURIComponent(this.wsToken)}` : "";
    return `${u}/api/clients${q}`;
  }

  start(): void {
    if (this.timer) return; // 已在运行，避免重复建定时器/重复连线
    this.closed = false;
    this.nextConnectAt = 0;
    // 先解析令牌再建连：私有站点下无票直接连会白白失败一轮
    void this.prepare();
    // 定时器必须在这里创建（不能在 WS 回调里）：它同时承担心跳与重连。
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  // 解析 WS 令牌；无论成败都会置 tokenReady，后续由 tick() 负责建连
  private async prepare(): Promise<void> {
    if (this.tokenResolving) return;
    this.tokenResolving = true;
    try {
      this.wsToken = await resolveLiveToken(this.baseUrl, this.getAuth?.());
    } catch {
      this.wsToken = "";
    } finally {
      this.tokenResolving = false;
      this.tokenReady = true;
      // 拿到新令牌后重新计数，否则上一次的失败会立刻把新令牌也作废
      this.failures = 0;
    }
    if (!this.closed && !this.ws && Date.now() >= this.nextConnectAt) this.connect();
  }

  // 心跳/重连都由这个定时器驱动：已连接就发 get，断开则按退避重连
  private tick(): void {
    if (this.closed) return;
    if (this.ws) {
      // 连接还在但长时间收不到帧（对端静默失效）→ 主动断开重连
      if (this.lastFrameAt > 0 && Date.now() - this.lastFrameAt > STALL_MS) {
        this.dropSocket("disconnected");
        return;
      }
      this.poll();
    } else if (!this.tokenReady) {
      void this.prepare();
    } else if (Date.now() >= this.nextConnectAt) {
      this.connect();
    }
  }

  private connect(): void {
    if (this.closed || this.ws) return;
    try {
      const ws = new WebSocket(this.wsUrl());
      this.ws = ws;
      this.connected = false;
      this.hadFrame = false;

      ws.onopen = () => {
        this.lastFrameAt = Date.now();
        this.poll();
      };

      ws.onmessage = (message: string | Data) => {
        const text = typeof message === "string" ? message : message.toRawString() ?? "";
        if (!text) return;
        try {
          const parsed = JSON.parse(text) as { status: string; data: LiveData };
          if (parsed?.status === "success" && parsed.data) {
            this.lastFrameAt = Date.now();
            this.failures = 0;
            this.hadFrame = true;
            // 收到首个有效帧才算真连上（否则 401 握手也会先触发 onopen）
            if (!this.connected) {
              this.connected = true;
              this.handlers.onStatus("connected");
            }
            // The server's `data.online` is the authoritative list of UUIDs
            // with active agent connections. The app trusts it directly.
            this.handlers.onData([], enrichLiveData(parsed.data));
          }
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
    this.noteFailure();
    this.nextConnectAt = Date.now() + RECONNECT_MS;
    if (!this.closed) this.handlers.onStatus("error");
  }

  /**
   * 记一次失败；连续失败达到 2 次且本地持有令牌时，作废缓存并重新解析。
   * 私有站点下令牌会被重置（节点重建 / token 轮换），旧令牌会持续被拒。
   */
  private noteFailure(): void {
    this.failures += 1;
    if (this.failures >= 2 && this.wsToken) {
      clearLiveToken(this.baseUrl);
      this.wsToken = "";
      this.tokenReady = false;
    }
  }

  private poll(): void {
    try {
      this.ws?.send("get");
    } catch {
      /* socket not ready */
    }
  }

  // 标记断开并安排下一次重连。这里不创建定时器（WS 回调里创建的定时器不会触发），
  // 只更新时间戳，实际重连交给 tick()
  private dropSocket(status: "disconnected" | "error"): void {
    if (!this.ws) return; // onerror / onclose 会成对触发，只处理第一次
    this.ws = null;
    this.lastFrameAt = 0;
    this.connected = false;
    // 还没收到过任何帧就断开 → 视为握手/认证失败，累加失败计数；
    // 正常跑过一阵再断线不算失败，避免把好令牌误判成无效。
    if (!this.hadFrame) this.noteFailure();
    this.hadFrame = false;
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

// ----------------------------------------------------------------------------
// Backend object — exported and registered in class/backend.ts -> server.ts.
// ----------------------------------------------------------------------------

export const KomariBackend: Backend = {
  caps: KOMARI_CAPS,

  fetchNodes,
  fetchVersion,
  verifyAuth,
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

  // Admin: command execution
  execCommand,
  fetchExecResult,

  // Admin: sessions
  listSessions,
  revokeSession,

  // Admin: settings
  fetchSiteSettings,
  patchSiteSettings,

  // Live transport: always WS based (Komari's `/api/clients` is open).
  // `startLive` 按端口约定返回「已经在跑」的会话（同 nezha），因此这里必须
  // 主动 start：否则上层 LiveClient 只拿到一个没连线的空壳，实时数据永远不来，
  // 节点会一直显示离线。
  // `getAuth` 用于解析私有站点下的 WS 凭证（见 resolveLiveToken）。
  startLive(baseUrl, handlers, getAuth, _getUuids) {
    const client = new KomariLiveClient(baseUrl, handlers, 2000, getAuth);
    client.start();
    return client;
  },
};
