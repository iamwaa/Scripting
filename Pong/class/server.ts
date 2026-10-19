// ============================================================================
// Backend facade. The UI imports everything probe-related from here; this file
// owns NOTHING backend-specific — it dispatches to the Komari / Nezha adapters
// (class/komari.ts, class/nezha.ts) registered in class/backend.ts, and keeps
// the small set of BACKEND-NEUTRAL helpers (map pins, load colour).
// S: Single Purpose — dispatch + neutral view helpers.
// U: Unidirectional — UI -> facade -> backend adapter. Never the reverse.
// P: Ports over Implementation — callers depend on these functions, not fetch.
// R: Replaceable — adding a third backend means a new adapter + registration,
//    with zero changes here.
// ============================================================================
import type {
  NodeBasicInfo,
  LiveData,
  LiveRecord,
  Pin,
  PingData,
  PingTask,
  LoadRecord,
  LoadType,
  Instance,
  AuthConfig,
  ClientDetail,
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
  BackendKind,
} from "./types";
import { regionToCoord, regionToName, regionToCode } from "./geo";
import { loadTint } from "./format";
import {
  Backend,
  LoginResult,
  LiveHandlers,
  LiveSession,
  registerBackend,
  getBackend as getRegistered,
} from "./backend";
import { KomariBackend } from "./komari";
import { NezhaBackend } from "./nezha";

export type { NodeBasicInfo, LiveData, Pin, LoginResult };
export type { Backend, LiveHandlers, LiveSession } from "./backend";

// --- Backend registration ---------------------------------------------------
// Both adapters are registered once at module load. The factory in backend.ts
// then resolves a kind -> Backend at runtime.
registerBackend(KomariBackend);
registerBackend(NezhaBackend);

/** Resolve the Backend for a kind (defaults to Komari for legacy instances). */
export function getBackend(kind?: BackendKind): Backend {
  return getRegistered(kind || "komari");
}

/** All registered backends, for selection UIs (settings picker). */
export const ALL_BACKENDS: Backend[] = [KomariBackend, NezhaBackend];

/** Resolve the Backend for a whole instance. */
export function backendFor(inst?: Instance | null): Backend {
  return getBackend(inst?.kind);
}

// ----------------------------------------------------------------------------
// Thin dispatch wrappers. Callers pass an Instance (carrying kind + auth) and
// the facade routes to the right adapter. This keeps existing call sites that
// used free functions almost unchanged — they just pass the instance now.
// ----------------------------------------------------------------------------

export function fetchNodes(inst: Instance): Promise<NodeBasicInfo[]> {
  return backendFor(inst).fetchNodes(inst.baseUrl, inst.auth);
}

export function fetchVersion(inst: Instance): Promise<string | null> {
  return backendFor(inst).fetchVersion(inst.baseUrl, inst.auth);
}

export function verifyAuth(
  kind: BackendKind,
  baseUrl: string,
  auth?: AuthConfig,
): Promise<{ ok: boolean; username?: string; error?: string }> {
  return getBackend(kind).verifyAuth(baseUrl, auth);
}

export function login(
  kind: BackendKind,
  baseUrl: string,
  username: string,
  password: string,
  twoFactor?: string,
): Promise<LoginResult> {
  return getBackend(kind).login(baseUrl, username, password, twoFactor);
}

export function fetchPingRecords(inst: Instance, uuid: string, hours: number): Promise<PingData> {
  return backendFor(inst).fetchPingRecords(inst.baseUrl, uuid, hours, inst.auth);
}

export function fetchPingTasks(inst: Instance): Promise<PingTask[]> {
  return backendFor(inst).fetchPingTasks(inst.baseUrl, inst.auth);
}

export function fetchLoadRecords(
  inst: Instance,
  uuid: string,
  loadType: LoadType,
  hours: number,
  totals?: { mem?: number; disk?: number },
): Promise<LoadRecord[]> {
  return backendFor(inst).fetchLoadRecords(inst.baseUrl, uuid, loadType, hours, inst.auth, totals);
}

export function fetchClientDetail(inst: Instance, uuid: string): Promise<ClientDetail | null> {
  return backendFor(inst).fetchClientDetail(inst.baseUrl, uuid, inst.auth);
}

/** Fetch the global service overview (Nezha). Empty list if unsupported. */
export function fetchServiceOverview(inst: Instance): Promise<ServiceOverview[]> {
  const b = backendFor(inst);
  if (!b.fetchServiceOverview) return Promise.resolve([]);
  return b.fetchServiceOverview(inst.baseUrl, inst.auth);
}

/** Edit a node's metadata (admin). Throws if the backend can't edit. */
export function editNode(inst: Instance, uuid: string, patch: NodeEditPatch): Promise<void> {
  const b = backendFor(inst);
  if (!b.editNode) return Promise.reject(new Error("该探针不支持编辑节点"));
  return b.editNode(inst.baseUrl, uuid, patch, inst.auth);
}

// ===========================================================================
// Admin / management facades. Each backend method is optional (presence gated
// by caps in the UI). `adminCall` removes the repetitive presence-check +
// argument-threading boilerplate: it picks the method off the active backend,
// rejects with a clear message when absent, and always passes baseUrl first +
// auth last (the shared shape of every admin method).
// ===========================================================================

const UNSUPPORTED = "当前探针不支持此功能";

/**
 * Invoke an optional admin method on the active backend. `mid` is the method
 * name; `args` are the middle arguments (baseUrl is prepended, auth appended).
 * Rejects with UNSUPPORTED when the backend doesn't implement the method.
 */
function adminCall<R>(inst: Instance, mid: keyof Backend, ...args: any[]): Promise<R> {
  const b = backendFor(inst);
  const fn = b[mid] as undefined | ((...a: any[]) => Promise<R>);
  if (typeof fn !== "function") return Promise.reject(new Error(UNSUPPORTED));
  return fn.call(b, inst.baseUrl, ...args, inst.auth);
}

export const listAlertRules = (inst: Instance) =>
  adminCall<AlertRule[]>(inst, "listAlertRules");
export const saveAlertRule = (inst: Instance, rule: AlertRule) =>
  adminCall<void>(inst, "saveAlertRule", rule);
export const deleteAlertRule = (inst: Instance, id: number) =>
  adminCall<void>(inst, "deleteAlertRule", id);

export const listNotifications = (inst: Instance) =>
  adminCall<NotificationChannel[]>(inst, "listNotifications");
export const saveNotification = (inst: Instance, ch: NotificationChannel) =>
  adminCall<void>(inst, "saveNotification", ch);
export const deleteNotification = (inst: Instance, id: number) =>
  adminCall<void>(inst, "deleteNotification", id);

export const listCronTasks = (inst: Instance) =>
  adminCall<CronTask[]>(inst, "listCronTasks");
export const saveCronTask = (inst: Instance, task: CronTask) =>
  adminCall<void>(inst, "saveCronTask", task);
export const deleteCronTask = (inst: Instance, id: number) =>
  adminCall<void>(inst, "deleteCronTask", id);
export const runCronTask = (inst: Instance, id: number) =>
  adminCall<void>(inst, "runCronTask", id);

export const execCommand = (inst: Instance, command: string, uuids: string[]) =>
  adminCall<CommandExecResult>(inst, "execCommand", command, uuids);

/** Exec result polling tolerates an absent method (returns empty, no reject). */
export function fetchExecResult(
  inst: Instance,
  taskId: string,
): Promise<{ uuid: string; ok: boolean; output: string }[]> {
  const b = backendFor(inst);
  if (!b.fetchExecResult) return Promise.resolve([]);
  return b.fetchExecResult(inst.baseUrl, taskId, inst.auth);
}

export const listUsers = (inst: Instance) =>
  adminCall<ManagedUser[]>(inst, "listUsers");
export const createUser = (inst: Instance, username: string, password: string) =>
  adminCall<void>(inst, "createUser", username, password);
export const deleteUser = (inst: Instance, id: number) =>
  adminCall<void>(inst, "deleteUser", id);

export const listApiTokens = (inst: Instance) =>
  adminCall<ApiToken[]>(inst, "listApiTokens");
export const createApiToken = (inst: Instance, note: string) =>
  adminCall<ApiToken>(inst, "createApiToken", note);
export const deleteApiToken = (inst: Instance, id: number) =>
  adminCall<void>(inst, "deleteApiToken", id);

export const listSessions = (inst: Instance) =>
  adminCall<LoginSession[]>(inst, "listSessions");
export const revokeSession = (inst: Instance, id: string) =>
  adminCall<void>(inst, "revokeSession", id);

export const fetchSiteSettings = (inst: Instance) =>
  adminCall<SiteSettings>(inst, "fetchSiteSettings");
export const patchSiteSettings = (inst: Instance, patch: SiteSettings) =>
  adminCall<void>(inst, "patchSiteSettings", patch);

/** Create a node (Komari only). Returns uuid+token; throws if unsupported. */
export function createNode(
  inst: Instance,
  name: string,
): Promise<{ uuid: string; token: string }> {
  const b = backendFor(inst);
  if (!b.createNode) throw new Error(`${b.caps.label} 不支持新建节点`);
  return b.createNode(inst.baseUrl, name, inst.auth);
}

/** Fetch an existing node's agent token (Komari only). */
export function getNodeToken(inst: Instance, uuid: string): Promise<string> {
  const b = backendFor(inst);
  if (!b.getNodeToken) throw new Error(`${b.caps.label} 不支持获取节点 Token`);
  return b.getNodeToken(inst.baseUrl, uuid, inst.auth);
}

export function deleteNode(inst: Instance, uuid: string): Promise<void> {
  return backendFor(inst).deleteNode(inst.baseUrl, uuid, inst.auth);
}

/**
 * Build the agent install commands. Komari takes a per-node token; Nezha takes
 * the global Client Secret — both arrive here as `secretOrToken`.
 */
export function buildInstallCommands(
  inst: Instance,
  secretOrToken: string,
): { label: string; command: string }[] {
  return backendFor(inst).buildInstallCommands(inst.baseUrl, secretOrToken);
}

// ----------------------------------------------------------------------------
// LiveClient — backend-neutral wrapper around a backend's live transport. The
// Monitor context constructs one of these; it delegates to the adapter's
// startLive (Komari WS+poll / Nezha WS+poll) but exposes a single start/stop.
// ----------------------------------------------------------------------------
export class LiveClient {
  private session: LiveSession | null = null;

  constructor(
    private inst: Instance,
    private handlers: LiveHandlers,
    private getAuth?: () => AuthConfig | undefined,
    /** Supplies current node UUIDs — needed by backends that HTTP-poll per node
     *  in authenticated mode (Komari). Ignored by backends that don't (Nezha). */
    private getUuids?: () => string[],
  ) {}

  start(): void {
    if (this.session) return;
    this.session = backendFor(this.inst).startLive(
      this.inst.baseUrl,
      this.handlers,
      this.getAuth || (() => this.inst.auth),
      this.getUuids,
    );
  }

  stop(): void {
    this.session?.stop();
    this.session = null;
  }
}

// ----------------------------------------------------------------------------
// Backend-neutral view helpers (no I/O). Used by the map + list to colour
// markers from the canonical live records, regardless of which probe produced
// them.
// ----------------------------------------------------------------------------

export function buildPins(
  nodes: NodeBasicInfo[],
  online: Set<string>,
  records: { [uuid: string]: LiveRecord } = {},
): Pin[] {
  type Group = {
    code: string;
    coordinate: { latitude: number; longitude: number };
    name: string;
    nodes: NodeBasicInfo[];
  };
  const byCode: Record<string, Group> = {};

  for (const n of nodes) {
    const code = regionToCode(n.region);
    const coord = regionToCoord(n.region);
    if (!code || !coord) continue;
    if (!byCode[code]) {
      byCode[code] = {
        code,
        coordinate: coord,
        name: regionToName(n.region),
        nodes: [],
      };
    }
    byCode[code].nodes.push(n);
  }

  const pins: Pin[] = [];
  for (const code of Object.keys(byCode)) {
    const g = byCode[code];
    const onlineNodes = g.nodes.filter((n) => online.has(n.uuid));
    const anyOnline = onlineNodes.length > 0;

    // Worst load across this country's online nodes drives the marker colour.
    let worst = -1;
    for (const n of onlineNodes) {
      worst = Math.max(worst, loadRatio(records[n.uuid]));
    }
    const tint = !anyOnline
      ? "systemGray"
      : worst < 0
        ? "systemGreen"
        : loadTint(worst);

    pins.push({
      id: code,
      title: `${g.name} (${g.nodes.length})`,
      subtitle: `${g.nodes.length} 个节点 · 在线 ${onlineNodes.length}`,
      coordinate: g.coordinate,
      tint,
      online: anyOnline,
      uuids: g.nodes.map((n) => n.uuid),
    });
  }
  return pins;
}

/** Heavier of CPU / memory usage as a 0..1 ratio; -1 when no record. */
export function loadRatio(rec?: LiveRecord): number {
  if (!rec) return -1;
  const cpu = isFinite(rec.cpu?.usage) ? rec.cpu.usage / 100 : 0;
  const memTotal = rec.ram?.total || 0;
  const mem = memTotal > 0 ? rec.ram.used / memTotal : 0;
  return Math.max(cpu, mem);
}

/**
 * Map a node's online state + live record to a marker colour.
 * Offline → grey. Online → tinted by the heavier of CPU / memory load.
 */
export function healthTint(online: boolean, rec?: LiveRecord): string {
  if (!online) return "systemGray";
  const r = loadRatio(rec);
  if (r < 0) return "systemGreen";
  return loadTint(r);
}
