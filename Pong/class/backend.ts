// ============================================================================
// Backend abstraction (PORT). Defines the single interface every probe adapter
// must satisfy, plus per-backend capability descriptors and the factory that
// resolves a BackendKind to its implementation.
// P: Ports over Implementation — the whole app talks to `Backend`, never to a
//    Komari- or Nezha-specific function.
// R: Replaceable Parts — adding a third probe means adding one adapter file and
//    one `register` call; no caller changes.
// E: Environment-Agnostic — every method takes the endpoint baseUrl/auth.
// ============================================================================
import type {
  NodeBasicInfo,
  LiveData,
  PingData,
  PingTask,
  LoadRecord,
  ServiceOverview,
  NodeEditPatch,
  AlertRule,
  NotificationChannel,
  CronTask,
  ManagedUser,
  ApiToken,
  LoginSession,
  CommandExecResult,
  SiteSettings,
  LoadType,
  AuthConfig,
  ClientDetail,
  BackendKind,
  BackendCaps,
  NezhaServer,
} from "./types";

/** Result of an account login attempt. */
export type LoginResult = {
  ok: boolean;
  /** Credential to persist on success (Komari cookie / Nezha JWT). */
  sessionToken?: string;
  /** True when the server says a 2FA code is required. */
  needs2FA?: boolean;
  /** Human-readable error on failure. */
  error?: string;
};

/** A freshly created node (Komari only) + the agent token / install secret. */
export type CreatedNode = { uuid: string; token: string };

/**
 * Handlers the live transport pushes data through. `servers` is the raw Nezha
 * server list when available (so the node list can be derived without a REST
 * call in guest mode); it is an empty array for Komari, whose WS frame carries
 * only live records.
 */
export type LiveHandlers = {
  onData: (servers: NezhaServer[], live: LiveData) => void;
  onStatus: (s: "connected" | "disconnected" | "error") => void;
};

/** A running live connection. `stop()` tears it down idempotently. */
export type LiveSession = { stop: () => void };

/**
 * The contract every probe backend implements. All methods are endpoint-scoped
 * (baseUrl + optional auth) and return the CANONICAL model — callers never see
 * a backend-specific shape.
 */
export type Backend = {
  readonly caps: BackendCaps;

  /** Fetch + adapt the static node list. May require auth (Nezha private). */
  fetchNodes(baseUrl: string, auth?: AuthConfig): Promise<NodeBasicInfo[]>;

  /** Lightweight reachability / version probe for the settings "test" button. */
  fetchVersion(baseUrl: string, auth?: AuthConfig): Promise<string | null>;

  /** Verify a credential actually authenticates. */
  verifyAuth(
    baseUrl: string,
    auth?: AuthConfig,
  ): Promise<{ ok: boolean; username?: string; error?: string }>;

  /** Exchange account credentials for a session credential. */
  login(
    baseUrl: string,
    username: string,
    password: string,
    twoFactor?: string,
  ): Promise<LoginResult>;

  /** Latency (ping) history for one node. `hours` is the requested window. */
  fetchPingRecords(
    baseUrl: string,
    uuid: string,
    hours: number,
    auth?: AuthConfig,
  ): Promise<PingData>;

  /** Configured ping monitors/tasks (best-effort; may be empty). */
  fetchPingTasks(baseUrl: string, auth?: AuthConfig): Promise<PingTask[]>;

  /**
   * Historical load samples for one node. `totals` (mem/disk bytes) lets a
   * backend convert byte metrics to percentages where needed (Nezha).
   */
  fetchLoadRecords(
    baseUrl: string,
    uuid: string,
    loadType: LoadType,
    hours: number,
    auth?: AuthConfig,
    totals?: { mem?: number; disk?: number },
  ): Promise<LoadRecord[]>;

  /** Resolve a node's real IP addresses (null when unavailable / unauthorized). */
  fetchClientDetail(
    baseUrl: string,
    uuid: string,
    auth?: AuthConfig,
  ): Promise<ClientDetail | null>;

  /** Create a node (Komari only). Throws when the backend can't create nodes. */
  createNode?(baseUrl: string, name: string, auth?: AuthConfig): Promise<CreatedNode>;

  /** Fetch an existing node's agent token (Komari only). */
  getNodeToken?(baseUrl: string, uuid: string, auth?: AuthConfig): Promise<string>;

  /** Delete a node (admin). Throws on backends that don't support deletion. */
  deleteNode(baseUrl: string, uuid: string, auth?: AuthConfig): Promise<void>;

  /**
   * Edit a node's editable metadata (admin). Optional — present only when
   * caps.canEditNode is true. `patch` carries only the fields the UI changed.
   */
  editNode?(
    baseUrl: string,
    uuid: string,
    patch: NodeEditPatch,
    auth?: AuthConfig,
  ): Promise<void>;

  /**
   * Fetch the global service-monitor overview (Nezha `/service`). Optional —
   * only present on backends whose caps.hasServiceOverview is true.
   */
  fetchServiceOverview?(baseUrl: string, auth?: AuthConfig): Promise<ServiceOverview[]>;

  // ---- Admin / management (all optional; presence gated by caps) ----
  /** List alert rules. */
  listAlertRules?(baseUrl: string, auth?: AuthConfig): Promise<AlertRule[]>;
  /** Create or update an alert rule (id<=0 => create). */
  saveAlertRule?(baseUrl: string, rule: AlertRule, auth?: AuthConfig): Promise<void>;
  /** Delete an alert rule by id. */
  deleteAlertRule?(baseUrl: string, id: number, auth?: AuthConfig): Promise<void>;

  /** List notification channels. */
  listNotifications?(baseUrl: string, auth?: AuthConfig): Promise<NotificationChannel[]>;
  saveNotification?(baseUrl: string, ch: NotificationChannel, auth?: AuthConfig): Promise<void>;
  deleteNotification?(baseUrl: string, id: number, auth?: AuthConfig): Promise<void>;

  /** List scheduled / cron tasks. */
  listCronTasks?(baseUrl: string, auth?: AuthConfig): Promise<CronTask[]>;
  saveCronTask?(baseUrl: string, task: CronTask, auth?: AuthConfig): Promise<void>;
  deleteCronTask?(baseUrl: string, id: number, auth?: AuthConfig): Promise<void>;
  /** Manually trigger a task now. */
  runCronTask?(baseUrl: string, id: number, auth?: AuthConfig): Promise<void>;

  /** Ad-hoc multi-host command execution (Komari). */
  execCommand?(
    baseUrl: string,
    command: string,
    uuids: string[],
    auth?: AuthConfig,
  ): Promise<CommandExecResult>;
  /** Poll a command task's per-host results (Komari). */
  fetchExecResult?(
    baseUrl: string,
    taskId: string,
    auth?: AuthConfig,
  ): Promise<{ uuid: string; ok: boolean; output: string }[]>;

  /** List managed users. */
  listUsers?(baseUrl: string, auth?: AuthConfig): Promise<ManagedUser[]>;
  createUser?(
    baseUrl: string,
    username: string,
    password: string,
    auth?: AuthConfig,
  ): Promise<void>;
  deleteUser?(baseUrl: string, id: number, auth?: AuthConfig): Promise<void>;

  /** List API tokens. */
  listApiTokens?(baseUrl: string, auth?: AuthConfig): Promise<ApiToken[]>;
  createApiToken?(baseUrl: string, note: string, auth?: AuthConfig): Promise<ApiToken>;
  deleteApiToken?(baseUrl: string, id: number, auth?: AuthConfig): Promise<void>;

  /** List login sessions (Komari). */
  listSessions?(baseUrl: string, auth?: AuthConfig): Promise<LoginSession[]>;
  revokeSession?(baseUrl: string, id: string, auth?: AuthConfig): Promise<void>;

  /** Read / patch site settings. */
  fetchSiteSettings?(baseUrl: string, auth?: AuthConfig): Promise<SiteSettings>;
  patchSiteSettings?(baseUrl: string, patch: SiteSettings, auth?: AuthConfig): Promise<void>;

  /**
   * Build the agent install commands. `tokenOrSecret` is the per-node token
   * (Komari) or the global client secret (Nezha).
   */
  buildInstallCommands(
    baseUrl: string,
    tokenOrSecret: string,
  ): { label: string; command: string }[];

  /** Start the live transport. Returns a session whose stop() ends it. */
  startLive(
    baseUrl: string,
    handlers: LiveHandlers,
    getAuth?: () => AuthConfig | undefined,
    getUuids?: () => string[],
  ): LiveSession;

  /**
   * Derive the canonical node list from raw live `servers` (Nezha only; used in
   * guest mode where the REST node endpoint is unavailable). Absent on backends
   * whose live transport doesn't carry static node info (Komari).
   */
  nodesFromLive?(servers: NezhaServer[]): NodeBasicInfo[];
};

// ----------------------------------------------------------------------------
// Capability descriptors. The UI reads these instead of branching on `kind`.
// ----------------------------------------------------------------------------

/** Komari supports fractional-hour windows and full admin node management. */
export const KOMARI_CAPS: BackendCaps = {
  kind: "komari",
  label: "Komari",
  tokenLabel: "API Key",
  ranges: [
    { label: "1小时", hours: 1 },
    { label: "6小时", hours: 6 },
    { label: "1天", hours: 24 },
    { label: "7天", hours: 168 },
  ],
  hasIpCard: true,
  canCreateNode: true,
  canDeleteNode: true,
  hasTags: true,
  hasBilling: true,
  liveProvidesNodes: false,
  hasServiceOverview: false,
  canEditNode: true,
  // Komari management model: command exec + sessions + settings; no alert
  // rules / multi-notification / cron / multi-user / api-tokens.
  hasAlertRules: false,
  hasNotifications: false,
  hasCronTasks: false,
  hasCommandExec: true,
  hasUserMgmt: false,
  hasApiTokens: false,
  hasSessionMgmt: true,
  hasSiteSettings: true,
};

/** Nezha v1 only offers 1d/7d/30d windows and no per-node create/token API. */
export const NEZHA_CAPS: BackendCaps = {
  kind: "nezha",
  label: "哪吒 Nezha",
  tokenLabel: "Access Token",
  ranges: [
    { label: "1天", hours: 24 },
    { label: "7天", hours: 168 },
    { label: "30天", hours: 720 },
  ],
  hasIpCard: true,
  canCreateNode: false,
  canDeleteNode: true,
  hasTags: false,
  hasBilling: false,
  liveProvidesNodes: true,
  hasServiceOverview: true,
  canEditNode: true,
  // Nezha management model: full alert/notification/cron/user/token/settings.
  // Command exec is expressed through cron tasks (no standalone exec endpoint).
  hasAlertRules: true,
  hasNotifications: true,
  hasCronTasks: true,
  hasCommandExec: false,
  hasUserMgmt: true,
  hasApiTokens: true,
  hasSessionMgmt: false,
  hasSiteSettings: true,
};

/** Look up the capability descriptor for a backend kind. */
export function capsFor(kind: BackendKind): BackendCaps {
  return kind === "nezha" ? NEZHA_CAPS : KOMARI_CAPS;
}

// ----------------------------------------------------------------------------
// Factory. Adapters self-register here to avoid an import cycle (backend.ts is
// imported by the adapters, so it can't import them at module load). server.ts
// performs the registration on startup.
// ----------------------------------------------------------------------------

const registry: { [K in BackendKind]?: Backend } = {};

/** Register a backend implementation (called once per adapter at startup). */
export function registerBackend(backend: Backend): void {
  registry[backend.caps.kind] = backend;
}

/** Resolve the Backend for a kind. Throws if it hasn't been registered. */
export function getBackend(kind: BackendKind): Backend {
  const b = registry[kind];
  if (!b) throw new Error(`未注册的后端类型: ${kind}`);
  return b;
}

/** True once a backend kind has been registered. */
export function hasBackend(kind: BackendKind): boolean {
  return !!registry[kind];
}
