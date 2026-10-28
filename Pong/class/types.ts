// ============================================================================
// Port / Contract layer — shared type definitions for the canonical data model.
// S: Single Purpose — only types, no logic.
// P: Ports over Implementation — every other module talks through these shapes.
//
// The app's UI is written against this CANONICAL model and supports THREE
// probe backends: Komari, 哪吒 (Nezha) Monitor v1 and CF-Server-Monitor (a
// Cloudflare Workers panel). Each backend has its own adapter
// (class/komari.ts, class/nezha.ts, class/cfsm.ts) that converts its raw JSON
// into these shapes, selected at runtime via class/backend.ts. The views never
// need to know which probe produced the data.
// ============================================================================

/** Which probe software a saved endpoint speaks. */
export type BackendKind = "komari" | "nezha" | "cfsm";

/**
 * Canonical static node information. Komari fills it from `GET /api/nodes`;
 * Nezha derives it from a server's `host` block plus identity fields.
 */
export type NodeBasicInfo = {
  /** Stable string key used across the whole UI. For Nezha = String(server.id). */
  uuid: string;
  /** Numeric server id (Nezha REST paths /server/{id}/...). 0 for Komari. */
  id: number;
  name: string;
  cpu_name: string;
  virtualization: string;
  arch: string;
  cpu_cores: number;
  os: string;
  gpu_name: string;
  /** GeoIP region — an ISO-3166 alpha-2 code (or flag emoji from Komari). */
  region: string;
  /** Server group name (Komari group / Nezha server-group, may be empty). */
  group?: string;
  /** Tags, ';'-separated (Komari only; Nezha has none, always empty). */
  tags?: string;
  mem_total: number;
  swap_total: number;
  disk_total: number;
  version: string;
  /** Sort weight. Komari weight / Nezha display_index (higher shows first). */
  weight: number;
  /** Billing fields — Komari only; Nezha has no billing API (stay 0 / empty). */
  price: number;
  billing_cycle: number;
  expired_at: string;
  created_at: string;
  updated_at: string;
  /** Public note (Nezha public_note; unused by Komari). */
  note?: string;
};

/** Canonical live metrics for a single node (adapted from Nezha `state`). */
export type LiveRecord = {
  cpu: { usage: number };
  ram: { used: number; total: number };
  swap: { used: number; total: number };
  load: { load1: number; load5: number; load15: number };
  disk: { used: number; total: number };
  network: { up: number; down: number; totalUp: number; totalDown: number };
  connections: { tcp: number; udp: number };
  uptime: number;
  process: number;
  message: string;
  updated_at: string;
  /** GPU usage percent (averaged across cards). Undefined when not reported. */
  gpu?: number;
  /** Highest sensor temperature in °C. Undefined when not reported. */
  temp?: number;
  /** Per-GPU detail (name + utilization%). Empty / absent when not reported. */
  gpus?: { name: string; usage?: number; temp?: number }[];
};

/** Canonical live snapshot keyed by node uuid (String(server.id)). */
export type LiveData = {
  online: string[];
  data: { [uuid: string]: LiveRecord };
};

/** Generic Nezha v1 envelope: `{ success, data, error }`. */
export type NezhaEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

/** `GET /api/nodes` envelope (Komari). */
export type NodeResponse = {
  status: "success" | "error";
  data: NodeBasicInfo[];
  message?: string;
};

/**
 * Real server IP addresses. Komari resolves them from the admin endpoint
 * `GET /api/admin/client/:uuid`; Nezha from a server's geoip block.
 */
export type ClientDetail = {
  uuid: string;
  name?: string;
  ipv4?: string;
  ipv6?: string;
  region?: string;
  remark?: string;
};

/** One latency sample. value = round-trip ms (<= 0 means timeout / loss). */
export type PingRecord = {
  task_id: number;
  time: string;
  value: number;
  client?: string;
};

/** Per-task summary returned alongside the ping records (Komari only). */
export type PingBasicInfo = {
  client: string;
  loss: number;
  min: number;
  max: number;
};

/** A latency-monitoring task / monitor for one node. */
export type PingTask = {
  id: number;
  name: string;
  clients: string[];
  default_on?: boolean;
  type?: string;
  interval?: number;
};

/** Canonical latency-history payload consumed by class/ping.ts. */
export type PingData = {
  count: number;
  basic_info?: PingBasicInfo[];
  records: PingRecord[];
  tasks?: PingTask[];
};

/**
 * One historical load sample. Canonical shape consumed by class/loadchart.ts.
 * Komari returns the raw byte fields directly; the Nezha adapter pre-computes
 * the *_percent fields from byte metrics (see class/nezha.ts). Only the fields
 * for the requested load_type are populated; all optional.
 */
export type LoadRecord = {
  client?: string;
  time: string;
  cpu?: number; // %
  ram?: number; // bytes used
  ram_total?: number;
  ram_percent?: number; // %
  swap?: number;
  swap_total?: number;
  swap_percent?: number;
  disk?: number; // bytes used
  disk_total?: number;
  disk_percent?: number; // %
  net_in?: number; // bytes/s down
  net_out?: number; // bytes/s up
  net_total_up?: number;
  net_total_down?: number;
  process?: number;
  connections?: number;
  connections_tcp?: number;
  connections_udp?: number;
  load?: number; // load1
  temp?: number; // °C
  gpu?: number; // % usage
};

/** `GET /api/records/load` payload (Komari). */
export type LoadData = {
  count: number;
  records: LoadRecord[];
};

/** Which historical metric to fetch / chart. */
export type LoadType =
  | "cpu"
  | "ram"
  | "disk"
  | "network"
  | "connections"
  | "process"
  | "gpu"
  | "temp";

/**
 * Authentication mode, shared by both backends:
 *  - "none":     anonymous / guest read (public Komari, guest-enabled Nezha).
 *  - "token":    a bearer key sent as `Authorization: Bearer <key>`.
 *                Komari → API Key; Nezha → Personal Access Token (nzp_...).
 *  - "password": account login (Komari /api/login → session_token cookie;
 *                Nezha /api/v1/login → JWT). The resulting credential is
 *                cached in `sessionToken`.
 */
export type AuthMode = "none" | "token" | "password";

/**
 * Per-instance authentication. All fields optional so "none" needs nothing.
 * NOTE: secrets are persisted in plaintext Storage (device-local, unencrypted).
 */
export type AuthConfig = {
  mode: AuthMode;
  /** Bearer key (Komari API Key / Nezha PAT) for mode "token". */
  apiKey?: string;
  /** Account credentials for the login endpoint (mode "password"). */
  username?: string;
  password?: string;
  /** Optional TOTP code if the account has 2FA enabled. */
  twoFactor?: string;
  /** Cached credential from a successful login (Komari cookie / Nezha JWT). */
  sessionToken?: string;
};

/**
 * 节点级的服务器更新配置：同一探针面板下可能有多台机器，每台各自一套连接信息。
 * 配了之后，该节点的状态页右上角会出现更新入口。
 */
export type UpdateConfig = {
  /** SSH 主机（IP 或域名） */
  host: string;
  /** SSH 端口，默认 22 */
  port?: number;
  /** SSH 账号，默认 root */
  user?: string;
  /** 私钥路径，相对 Documents 目录，如 .ssh/id_ed12345 */
  keyPath?: string;
  /** 没有私钥时用的密码 */
  password?: string;
};

/** A single saved dashboard endpoint (Komari or Nezha). */
export type Instance = {
  id: string;
  name: string;
  /** Which probe software this endpoint runs. Defaults to "komari" if absent. */
  kind: BackendKind;
  /** Base URL, e.g. https://status.example.com (no trailing slash). */
  baseUrl: string;
  /** Optional authentication. Absent / mode "none" = anonymous access. */
  auth?: AuthConfig;
  /** 兼容旧版：早期把更新配置存在实例上，该字段仅用于迁移读取 */
  update?: UpdateConfig;
};

/**
 * Per-backend capability descriptor. The UI reads this (via class/backend.ts)
 * to show only the features a backend actually supports — instead of branching
 * on `kind` everywhere. E: keeps backend differences declarative, not scattered.
 */
export type BackendCaps = {
  kind: BackendKind;
  /** Display name, e.g. "Komari" / "哪吒 Nezha". */
  label: string;
  /** Label for the "token" auth mode (e.g. "API Key" / "Access Token"). */
  tokenLabel: string;
  /** History windows offered in the detail page (hours + label). */
  ranges: { label: string; hours: number }[];
  /** Whether the backend exposes a real IP address card. */
  hasIpCard: boolean;
  /** Whether the backend can create nodes via an admin API (Komari only). */
  canCreateNode: boolean;
  /** Whether the backend can delete nodes via an admin API. */
  canDeleteNode: boolean;
  /** Whether the backend exposes per-node tags (Komari only). */
  hasTags: boolean;
  /** Whether the backend reports billing / expiry info (Komari only). */
  hasBilling: boolean;
  /**
   * Whether the live transport itself carries the full node list (Nezha's WS
   * frame does; Komari's does not). When true, guest mode can populate nodes
   * from live data without a REST node fetch.
   */
  liveProvidesNodes: boolean;
  /** Whether the backend exposes a global service/uptime overview (Nezha). */
  hasServiceOverview: boolean;
  /** Whether the backend supports editing a node's metadata (admin). */
  canEditNode: boolean;
  // ---- Admin / management feature flags (gated per backend capability) ----
  /** Alert rules CRUD (Nezha `/alert-rule`). Komari has no such model. */
  hasAlertRules: boolean;
  /** Notification channels CRUD (Nezha `/notification`). */
  hasNotifications: boolean;
  /** Scheduled tasks / cron CRUD + manual trigger (Nezha `/cron`). */
  hasCronTasks: boolean;
  /** Ad-hoc multi-host command execution (Komari `/task/exec`). */
  hasCommandExec: boolean;
  /** Multi-user management CRUD (Nezha `/user`). */
  hasUserMgmt: boolean;
  /** API token management (Nezha `/api-tokens`). */
  hasApiTokens: boolean;
  /** Login session listing + revocation (Komari `/session`). */
  hasSessionMgmt: boolean;
  /** Site settings read + patch (both). */
  hasSiteSettings: boolean;
};

export type NodeEditPatch = {
  name?: string;
  /** Group name (Komari group / Nezha server-group membership by name). */
  group?: string;
  /** Tags, ';'-separated (Komari only). */
  tags?: string;
  /** Public note / remark. */
  note?: string;
  /** Sort weight (Komari weight / Nezha display_index). */
  weight?: number;
  /** Price per cycle (Komari only). */
  price?: number;
  /** Billing cycle in days (Komari only). */
  billing_cycle?: number;
  /** Expiry date ISO string (Komari only). */
  expired_at?: string;
};

// ===========================================================================
// Admin / management canonical types (backend-agnostic).
// Each backend's adapter maps its raw API shape to/from these.
// ===========================================================================

/** A single alert-rule condition (Nezha `Rule`). */
export type AlertRuleCond = {
  /** Metric type: cpu / memory / swap / disk / net_in_speed / net_out_speed /
   *  net_all_speed / transfer_in / transfer_out / transfer_all / offline /
   *  load1 / load5 / load15 / process_count / tcp_conn / udp_conn, etc. */
  type: string;
  /** Trigger when metric goes above max (for usage %) — optional. */
  max?: number;
  /** Trigger when metric goes below min — optional. */
  min?: number;
  /** Sustained duration in seconds before firing. */
  duration?: number;
  /** Cover mode: 0 = all servers except ignore list, 1 = only listed. */
  cover?: number;
  /** Server-id → ignored map (Nezha `ignore`). */
  ignore?: { [id: string]: boolean };
};

/** Canonical alert rule. */
export type AlertRule = {
  id: number;
  name: string;
  enabled: boolean;
  /** Conditions; AND-combined within a rule. */
  rules: AlertRuleCond[];
  /** Notification group id to fire on trigger (0 = none). */
  notificationGroupId: number;
  /** "always" | "once" — fire each cycle or only on state change. */
  triggerMode: number;
};

/** Canonical notification channel. */
export type NotificationChannel = {
  id: number;
  name: string;
  /** Webhook / API URL. */
  url: string;
  /** Request body template (provider-specific). */
  requestBody?: string;
  /** HTTP method: GET / POST. */
  requestMethod?: number;
  /** Whether TLS verification is skipped. */
  skipCheck?: boolean;
};

/** Canonical scheduled task / cron entry. */
export type CronTask = {
  id: number;
  name: string;
  /** Cron expression (e.g. "0 0 * * *"); empty for trigger-only tasks. */
  scheduler: string;
  /** Shell command to run. */
  command: string;
  /** Task type: 0 = scheduled, 1 = trigger-only. */
  taskType: number;
  /** Cover mode for target servers (0 all-except / 1 only-listed). */
  cover: number;
  /** Target / ignored server ids depending on cover. */
  servers: number[];
  /** Whether to push the result via notification. */
  pushSuccessful?: boolean;
  notificationGroupId?: number;
  /** Last execution result text (read-only). */
  lastResult?: string;
  lastExecutedAt?: string;
};

/** Canonical managed user. */
export type ManagedUser = {
  id: number;
  username: string;
  /** Role / privilege label, backend-specific. */
  role?: string;
};

/** Canonical API token (Nezha). */
export type ApiToken = {
  /** Numeric id used for deletion. */
  id: number;
  /** The token string (only returned once on creation). Empty in list views. */
  token: string;
  note: string;
  /** ISO time. */
  createdAt?: string;
};

/** A login session (Komari). */
export type LoginSession = {
  /** Session identifier / UUID used for revocation. */
  id: string;
  /** User agent / device label. */
  userAgent?: string;
  ip?: string;
  /** ISO time of latest activity. */
  latestOnline?: string;
  /** True if this is the caller's current session. */
  current?: boolean;
};

/** Result of an ad-hoc command execution (Komari `/task/exec`). */
export type CommandExecResult = {
  /** Task id to poll for results, when the backend runs async. */
  taskId?: string;
  /** Immediate per-host result, when available. */
  results?: { uuid: string; ok: boolean; output: string }[];
  message?: string;
};

/** A site-setting key/value pair (free-form; backend defines keys). */
export type SiteSettings = { [key: string]: any };

/** Persisted application configuration. */
export type MonitorConfig = {
  instances: Instance[];
  activeId: string;
};

/** Live connection lifecycle status for the active instance. */
export type ConnStatus = "idle" | "loading" | "connected" | "disconnected" | "error";

/** A geographic marker to be drawn on the map. One marker per country. */
export type Pin = {
  /** Country code (e.g. "JP") used as the marker tag / selection key. */
  id: string;
  /** Country display name, e.g. "韩国". */
  title: string;
  /** Short status line, e.g. "3 个节点 · 在线 2". */
  subtitle: string;
  coordinate: { latitude: number; longitude: number };
  /** Aggregate tint (worst health across this country's online nodes). */
  tint: string;
  /** True when at least one node in this country is online. */
  online: boolean;
  /** UUIDs of every node located in this country. */
  uuids: string[];
};

// ----------------------------------------------------------------------------
// Raw 哪吒 (Nezha) Monitor v1 wire shapes. These mirror the JSON returned by
// the dashboard; class/nezha.ts converts them into the canonical model above.
// Field names follow Nezha's `json:"..."` tags exactly.
// ----------------------------------------------------------------------------

/** Nezha `host` block — static hardware info. */
export type NezhaHost = {
  platform?: string;
  platform_version?: string;
  cpu?: string[];
  mem_total?: number;
  disk_total?: number;
  swap_total?: number;
  arch?: string;
  virtualization?: string;
  boot_time?: number;
  version?: string;
  gpu?: string[];
};

/** Nezha `state` block — live metrics. */
export type NezhaState = {
  cpu?: number; // percent 0..100
  mem_used?: number; // bytes
  swap_used?: number; // bytes
  disk_used?: number; // bytes
  net_in_transfer?: number; // bytes total
  net_out_transfer?: number; // bytes total
  net_in_speed?: number; // bytes/s
  net_out_speed?: number; // bytes/s
  uptime?: number; // seconds
  load_1?: number;
  load_5?: number;
  load_15?: number;
  tcp_conn_count?: number;
  udp_conn_count?: number;
  process_count?: number;
  temperatures?: { Name: string; Temperature: number }[];
  gpu?: number[];
};

/** Nezha `geoip` block. */
export type NezhaGeoIP = {
  ip?: { ipv4_addr?: string; ipv6_addr?: string };
  country_code?: string;
};

/**
 * A Nezha server as returned by `GET /api/v1/server` and pushed (as
 * StreamServer) over `GET /api/v1/ws/server`. Both carry host + state.
 */
export type NezhaServer = {
  id: number;
  name?: string;
  uuid?: string;
  note?: string;
  public_note?: string;
  display_index?: number;
  hide_for_guest?: boolean;
  host?: NezhaHost;
  state?: NezhaState;
  geoip?: NezhaGeoIP;
  country_code?: string; // present on StreamServer
  last_active?: string; // ISO time
};

/** WebSocket frame from `GET /api/v1/ws/server`. */
export type NezhaStreamData = {
  now?: number; // server time, ms
  online?: number; // online USER count (not servers)
  servers?: NezhaServer[];
};

/** One point of a Nezha metric history series. */
export type NezhaMetricPoint = { ts: number; value: number };

/** `GET /api/v1/server/{id}/metrics` data. */
export type NezhaMetricsData = {
  server_id: number;
  server_name?: string;
  metric: string;
  data_points: NezhaMetricPoint[];
};

/** `GET /api/v1/server/{id}/service` item (per-monitor latency history). */
export type NezhaServiceInfo = {
  monitor_id: number;
  server_id: number;
  monitor_name: string;
  server_name?: string;
  display_index?: number;
  created_at: number[]; // parallel to avg_delay (ms timestamps)
  avg_delay: number[]; // ms; <= 0 means down/loss
};

/** `GET /api/v1/server-group` item. */
export type NezhaServerGroupItem = {
  group: { id: number; name: string };
  servers: number[];
};

/** Nezha query period — the only granularities the API accepts. */
export type NezhaPeriod = "1d" | "7d" | "30d";

/**
 * Canonical service-monitor overview item (a latency/uptime "service" tracked
 * by the panel, across all servers). Nezha exposes this via `GET /service`;
 * Komari has no global equivalent, so its overview page is unavailable.
 */
export type ServiceOverview = {
  id: number;
  name: string;
  /** Uptime percentage over the reporting window (0..100). */
  uptime: number;
  /** Most recent average latency in ms (0 when unknown). */
  currentDelay: number;
  /** True when the latest sample indicates the service is up. */
  up: boolean;
  /** Recent latency samples (ms) for a sparkline, oldest→newest. */
  delays: number[];
  /** Per-day "up" check counts (oldest→newest), parallel to dailyDown. */
  dailyUp: number[];
  /** Per-day "down" check counts (oldest→newest), parallel to dailyUp. */
  dailyDown: number[];
};

// ----------------------------------------------------------------------------
// Raw CF-Server-Monitor wire shapes (Cloudflare Workers panel). These mirror
// the JSON documented in its API.md; class/cfsm.ts converts them into the
// canonical model above.
// IMPORTANT UNITS: RAM / swap / disk sizes arrive in MB, network speeds in B/s,
// counters in bytes; the adapter converts MB -> bytes for the canonical model.
// ----------------------------------------------------------------------------

/** One GPU entry. `info` is the utilisation percent in current reports. */
export type CfsmGpuInfo = {
  id?: string;
  name?: string;
  info?: number;
  mem_used?: number;
  mem_total?: number;
  sm_clock?: number;
  power?: number;
};

/**
 * A server item from `GET /api/servers` (metrics merged in) or
 * `GET /api/server?id=`. Numeric metric fields may arrive as strings.
 */
export type CfsmServer = {
  id: string;
  name?: string;
  server_group?: string;
  tags?: string; // 逗号分隔
  note?: string;
  price?: string;
  billing_cycle?: string;
  auto_renewal?: string;
  currency?: string;
  expire_date?: string;
  traffic_limit?: string;
  traffic_calc_type?: string;
  interface?: string;
  reset_day?: number;
  collect_interval?: number;
  report_interval?: number;
  wss_report_interval?: number;
  connection_mode?: string;
  ping_mode?: string;
  auto_update?: string;
  is_hidden?: string;
  offline_notify_disabled?: string;
  sort_order?: number;
  /** 服务器级测速节点 `host[:port]`；空表示用站点设置。 */
  custom_ct?: string;
  custom_cu?: string;
  custom_cm?: string;
  custom_bd?: string;
  node_1?: string;
  node_2?: string;
  node_3?: string;
  node_4?: string;
  /** 待下发给探针的一次性流量修正值。 */
  rx_correction?: number | null;
  tx_correction?: number | null;
  traffic_alert_percent?: number | string;
  // --- latest metrics ---
  cpu?: number | string;
  load_avg?: string;
  net_in_speed?: number | string;
  net_out_speed?: number | string;
  net_rx?: number | string;
  net_tx?: number | string;
  net_rx_monthly?: number | string;
  net_tx_monthly?: number | string;
  processes?: number | string;
  tcp_conn?: number | string;
  udp_conn?: number | string;
  ram_total?: number | string; // MB
  ram_used?: number | string; // MB
  swap_total?: number | string; // MB
  swap_used?: number | string; // MB
  disk_total?: number | string; // MB
  disk_used?: number | string; // MB
  cpu_cores?: number | string;
  cpu_info?: string;
  gpu_info?: CfsmGpuInfo[] | string | null;
  arch?: string;
  os?: string;
  kernel_version?: string;
  region?: string; // ISO-3166 alpha-2，来自 CF 的 cf-ipcountry
  ip_v4?: string; // "0" / "1"（公共接口不暴露真实地址）
  ip_v6?: string;
  agent_version?: string;
  boot_time?: string; // 毫秒时间戳字符串
  last_updated?: number | string; // 最近一次指标时间（毫秒）
  timestamp?: number | string; // 服务器配置记录创建时间（毫秒）
  // --- 三网 + 自定义节点时延/丢包；false = 未配置，null = 本轮超时 ---
  ping_ct?: number | null | false;
  ping_cu?: number | null | false;
  ping_cm?: number | null | false;
  ping_bd?: number | null | false;
  loss_ct?: number | null | false;
  loss_cu?: number | null | false;
  loss_cm?: number | null | false;
  loss_bd?: number | null | false;
  ping_node_1?: number | null | false;
  ping_node_2?: number | null | false;
  ping_node_3?: number | null | false;
  ping_node_4?: number | null | false;
  loss_node_1?: number | null | false;
  loss_node_2?: number | null | false;
  loss_node_3?: number | null | false;
  loss_node_4?: number | null | false;
};

/** `GET /api/servers` response. */
export type CfsmServersResponse = {
  servers?: CfsmServer[];
  stats?: {
    total?: number;
    online?: number;
    offline?: number;
    globalSpeedIn?: number;
    globalSpeedOut?: number;
    globalNetTx?: number;
    globalNetRx?: number;
  };
  regionStats?: { [code: string]: number };
  sysConfig?: { [key: string]: any };
};

/** One row of `GET /api/history/all`. Timestamps are epoch ms. */
export type CfsmHistoryRow = {
  timestamp: number;
  cpu?: number | string;
  ram_total?: number | string; // MB
  ram_used?: number | string; // MB
  swap_total?: number | string; // MB
  swap_used?: number | string; // MB
  disk_total?: number | string; // MB
  disk_used?: number | string; // MB
  processes?: number | string;
  net_in_speed?: number | string;
  net_out_speed?: number | string;
  tcp_conn?: number | string;
  udp_conn?: number | string;
  load_avg?: string;
  region?: string;
  gpu_info?: CfsmGpuInfo[] | string | null;
  ping_ct?: number | null;
  ping_cu?: number | null;
  ping_cm?: number | null;
  ping_bd?: number | null;
  loss_ct?: number | null;
  loss_cu?: number | null;
  loss_cm?: number | null;
  loss_bd?: number | null;
  ping_node_1?: number | null;
  ping_node_2?: number | null;
  ping_node_3?: number | null;
  ping_node_4?: number | null;
  loss_node_1?: number | null;
  loss_node_2?: number | null;
  loss_node_3?: number | null;
  loss_node_4?: number | null;
};

/** `GET /api/config` — the subset Pong reads. */
export type CfsmConfig = {
  version?: string;
  site_title?: string;
  is_public?: boolean;
  turnstile_enabled?: boolean;
  turnstile_login_enabled?: boolean;
  custom_ct_name?: string;
  custom_cu_name?: string;
  custom_cm_name?: string;
  custom_bd_name?: string;
  node_1_name?: string;
  node_2_name?: string;
  node_3_name?: string;
  node_4_name?: string;
};

/** One sample inside a WS `batchUpdate` (`data` carries partial server fields). */
export type CfsmSample = { ts: number; data: Partial<CfsmServer> };

/** Frames pushed by `GET /api/ws`. */
export type CfsmWsFrame = {
  type?: string; // hello / subscribed / batchUpdate / pong
  ts?: number;
  subscribed?: string;
  count?: number;
  updates?: { serverId: string; samples?: CfsmSample[] }[];
};
