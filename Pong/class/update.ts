// ============================================================================
// 服务器更新助手 — SSH 调用服务器上的 /root/bin/sg-update，检查/升级
// magpie 与 cf-probe。
// 配置按「节点」保存（同一个探针面板下可以有多台 VPS，每台各自一套连接信息）。
// S: 只做传输与解析，不碰 UI。
// ============================================================================
import { Script } from "scripting";
import type { UpdateConfig } from "./types";

export type { UpdateConfig };

/** sg-update check 输出的状态（字段名与服务器一致） */
export type UpdateState = {
  magpie_version?: string;
  magpie_latest?: string;
  magpie_update_available?: string;
  magpie_target?: string;
  probe_version?: string;
  probe_latest?: string;
  probe_update_available?: string;
  probe_target?: string;
  probe_service?: string;
  container_state?: string;
  gateway?: string;
  usage?: string;
  last_check?: string;
  last_magpie_upgrade?: string;
  last_magpie_from?: string;
  last_probe_upgrade?: string;
  last_probe_from?: string;
  last_rollback?: string;
  last_error?: string;
  deferred?: string;
  defer_hours?: number;
  /** 自动更新开关：1 开 / 0 关 */
  auto_enabled?: string;
  /** 自动更新频率（小时）：1 / 3 / 6 / 12 / 24 */
  auto_every?: number;
  /** 定时器本次跳过原因：disabled / not_due */
  auto_skip?: string;
  tg_chat?: string;
  hostname?: string;
  aliases?: string;
  rollback_version?: string;
};

/** 服务器侧的更新设置（存在服务器上，不跟节点走） */
export type ServerSettings = {
  auto_enabled: number;
  auto_every: number;
  auto_check_at: string;
  defer_hours: number;
  tg_chat: string;
  /** bot 用户名，仅用于回填显示，不是密钥 */
  tg_bot: string;
  /** bot token 是否已配置（不回显 token 本体） */
  tg_token_set: boolean;
  /** token + chat 都齐了才算能用 */
  tg_ready: boolean;
};

export type UpdateResult = {
  ok: boolean;
  /** 远端退出码（连接层失败时为 null） */
  code: number | null;
  output: string;
  error?: string;
};

const SG = "/root/bin/sg-update";

// ---------- 按节点保存的配置 --------------------------------------------------

/** 配置存储键：${Script.name}.update_configs */
const KEY = () => `${Script.name}.update_configs`;
/** 全局默认 SSH 凭据（同一台手机连多台服务器通常共用一把私钥） */
const KC_DEFAULT_KEY = "sg_default_key_path";
const KC_DEFAULT_USER = "sg_default_user";

type UpdateConfigMap = Record<string, UpdateConfig>;

/** 节点的存储键：在实例内唯一即可 */
export function nodeConfigKey(instId: string, nodeUuid: string): string {
  return `${instId}/${nodeUuid}`;
}

function loadAll(): UpdateConfigMap {
  const raw = Storage.get<UpdateConfigMap>(KEY());
  return raw && typeof raw === "object" ? raw : {};
}

/** 取某个节点的更新配置；没有则 undefined */
export function getNodeUpdateConfig(instId: string, nodeUuid: string): UpdateConfig | undefined {
  const cfg = loadAll()[nodeConfigKey(instId, nodeUuid)];
  return cfg && cfg.host?.trim() ? cfg : undefined;
}

/** 写入 / 清除某个节点的更新配置（传 null 删除） */
export function setNodeUpdateConfig(
  instId: string,
  nodeUuid: string,
  cfg: UpdateConfig | null,
): void {
  const all = loadAll();
  const k = nodeConfigKey(instId, nodeUuid);
  if (cfg && cfg.host?.trim()) all[k] = cfg;
  else delete all[k];
  Storage.set(KEY(), all);
}

/** 删除实例时顺带清理它名下所有节点的配置 */
export function clearInstanceUpdateConfigs(instId: string): void {
  const all = loadAll();
  let changed = false;
  for (const k of Object.keys(all)) {
    if (k.startsWith(`${instId}/`)) {
      delete all[k];
      changed = true;
    }
  }
  if (changed) Storage.set(KEY(), all);
}

/** 全局默认私钥路径（新节点预填用） */
export function getDefaultKeyPath(): string {
  return Keychain.get(KC_DEFAULT_KEY) || ".ssh/id_ed12345";
}

export function getDefaultUser(): string {
  return Keychain.get(KC_DEFAULT_USER) || "root";
}

export function setDefaultKeyPath(path: string): void {
  Keychain.set(KC_DEFAULT_KEY, path.trim());
}

export function setDefaultUser(user: string): void {
  Keychain.set(KC_DEFAULT_USER, user.trim());
}

/** 已配置更新的节点键集合（用于列表页标出哪些节点可升级） */
export function configuredNodeKeys(): Set<string> {
  return new Set(Object.keys(loadAll()));
}

// ---------- 连接 --------------------------------------------------------------

/** 该节点的配置是否完整（有主机 + 私钥或密码） */
export function isUpdatable(cfg: UpdateConfig | undefined): boolean {
  return !!cfg && !!cfg.host?.trim() && !!(cfg.password || cfg.keyPath?.trim());
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// 私钥解析：先试 ed25519，再试 RSA（旧版 API 拼写为 ras）
const KEY_PARSERS: ((user: string, data: Data) => SSHAuthenticationMethod | null)[] = [
  (u, d) => SSHAuthenticationMethod.ed25519(u, d),
  (u, d) => (SSHAuthenticationMethod as any).ras?.(u, d) ?? null,
];

async function readKey(keyPath: string): Promise<string | null> {
  const rel = keyPath.trim();
  if (!rel) return null;
  const full = rel.startsWith("/") ? rel : `${FileManager.documentsDirectory}/${rel}`;
  try {
    if (!(await FileManager.exists(full))) return null;
    const key = await FileManager.readAsString(full);
    return key && key.includes("PRIVATE KEY") ? key : null;
  } catch {
    return null;
  }
}

/** 私钥文件是否存在（用于设置页给出「找不到私钥」提示） */
export async function keyFileExists(keyPath: string): Promise<boolean> {
  return (await readKey(keyPath)) !== null;
}

async function connect(cfg: UpdateConfig): Promise<SSHClient> {
  const user = (cfg.user || "root").trim();
  let auth: SSHAuthenticationMethod | null = null;
  const key = await readKey(cfg.keyPath || "");
  if (key) {
    const data = Data.fromString(key);
    if (data) {
      for (const parse of KEY_PARSERS) {
        auth = parse(user, data);
        if (auth) break;
      }
    }
  }
  if (!auth) {
    if (!cfg.password) throw new Error("没有可用的 SSH 私钥或密码，请检查该节点的更新配置");
    auth = SSHAuthenticationMethod.passwordBased(user, cfg.password);
  }
  return await SSHClient.connect({
    host: cfg.host.trim(),
    port: Number(cfg.port) || 22,
    authenticationMethod: auth,
  });
}

/** 执行一条远程命令（带超时与退出码哨兵） */
export async function runRemote(cfg: UpdateConfig, command: string, timeoutSec = 90): Promise<UpdateResult> {
  let client: SSHClient | null = null;
  const wrapped = `timeout ${timeoutSec} bash -c ${shellQuote(command)}; echo "__EXIT__$?"`;
  try {
    client = await connect(cfg);
    const text = await client.executeCommand(wrapped, { includeStderr: true });
    return parseResult(text);
  } catch (e) {
    return { ok: false, code: null, output: "", error: String(e) };
  } finally {
    if (client) await client.close().catch(() => {});
  }
}

/** 轮询型执行：用 setsid 脱离会话跑，避开 iOS 侧的命令超时 */
export async function runLong(
  cfg: UpdateConfig,
  command: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<UpdateResult> {
  const marker = `/tmp/.sg-job-${Date.now()}`;
  const timeoutMs = opts.timeoutMs ?? 8 * 60 * 1000;
  const pollMs = opts.pollMs ?? 3000;

  const detach = `setsid bash -c ${shellQuote(`(${command}) > ${marker}.out 2>&1; echo $? > ${marker}.code`)} >/dev/null 2>&1 </dev/null & sleep 0.5; echo started`;
  const start = await runRemote(cfg, detach, 45);
  if (start.code !== 0) return start;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const poll = await runRemote(
      cfg,
      `if [ -f ${marker}.code ]; then echo DONE=$(cat ${marker}.code); tail -c 4000 ${marker}.out; rm -f ${marker}.out ${marker}.code; else echo RUNNING; fi`,
      45,
    );
    if (poll.code === null) continue; // 网络抖动，继续轮询
    if (poll.code !== 0) return poll;
    if (!poll.output.startsWith("RUNNING")) {
      const m = poll.output.match(/^DONE=(\d+)/);
      const code = m ? Number(m[1]) : -1;
      const body = poll.output.replace(/^DONE=\d+\n?/, "");
      return { ok: code === 0, code, output: body };
    }
  }
  return { ok: false, code: null, output: "", error: "等待超时（任务可能仍在服务器上运行）" };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function parseResult(text: string): UpdateResult {
  const raw = typeof text === "string" ? text : String(text ?? "");
  const idx = raw.lastIndexOf("__EXIT__");
  if (idx < 0) return { ok: false, code: null, output: raw.trim(), error: "未收到退出码（连接可能中断）" };
  const code = Number(raw.slice(idx + 8).trim().split(/\s/)[0]);
  const output = raw.slice(0, idx).trim();
  return { ok: code === 0, code: Number.isFinite(code) ? code : null, output };
}

// ---------- 业务动作 ----------------------------------------------------------

/** 只检查（退出码 10 = 有可用更新，也算成功） */
export async function checkUpdates(cfg: UpdateConfig): Promise<{ state: UpdateState | null; result: UpdateResult }> {
  const result = await runRemote(cfg, `${SG} check`, 120);
  const line = result.output.split("\n").reverse().find((l) => l.trim().startsWith("{"));
  if (!line) return { state: null, result };
  try {
    const state = JSON.parse(line) as UpdateState;
    return { state, result: { ...result, ok: result.code === 0 || result.code === 10 } };
  } catch {
    return { state: null, result };
  }
}

/** 读服务器侧的更新设置（开关/频率/空窗期/Telegram） */
export async function readSettings(cfg: UpdateConfig): Promise<ServerSettings | null> {
  const res = await runRemote(cfg, `${SG} show`, 60);
  const line = res.output.split("\n").reverse().find((l) => l.trim().startsWith("{"));
  if (!line) return null;
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    // 服务器可能把纯数字的 chat id 存成 number（旧版 state_set 的行为），
    // 这里统一成字符串——上游拿去 .trim() 也不会炸。
    const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    return {
      auto_enabled: Number(raw.auto_enabled ?? 1),
      auto_every: Number(raw.auto_every ?? 24) || 24,
      auto_check_at: str(raw.auto_check_at),
      defer_hours: Number(raw.defer_hours ?? 0) || 0,
      tg_chat: str(raw.tg_chat),
      tg_bot: str(raw.tg_bot),
      tg_token_set: !!raw.tg_token_set,
      tg_ready: !!raw.tg_ready,
    };
  } catch {
    return null;
  }
}

/** 升级：目标为空表示升到各自最新 */
export async function upgrade(
  cfg: UpdateConfig,
  targets: { magpie?: string; probe?: string },
): Promise<UpdateResult> {
  const args = ["upgrade"];
  if (targets.magpie || targets.probe) {
    args.push(targets.magpie || "-", targets.probe || "-");
  }
  return await runLong(cfg, `${SG} ${args.join(" ")}`, { timeoutMs: 10 * 60 * 1000 });
}

/** 只升级探针：先查最新版再显式指定 */
export async function upgradeProbeOnly(cfg: UpdateConfig): Promise<UpdateResult> {
  const { state } = await checkUpdates(cfg);
  const latest = state?.probe_latest;
  if (!latest) return { ok: false, code: null, output: "", error: "无法获取 cf-probe 最新版本" };
  return await runLong(cfg, `${SG} probe v${latest}`, { timeoutMs: 6 * 60 * 1000 });
}

export async function rollbackMagpie(cfg: UpdateConfig): Promise<UpdateResult> {
  return await runLong(cfg, `${SG} rollback`, { timeoutMs: 5 * 60 * 1000 });
}

export async function readLog(cfg: UpdateConfig, lines = 60): Promise<UpdateResult> {
  return await runRemote(cfg, `${SG} log ${lines}`, 60);
}

/** 改服务器侧设置项（值用 base64 传，规避引号问题） */
export async function setOption(cfg: UpdateConfig, key: string, value: string): Promise<UpdateResult> {
  // 白名单：避免把任意字符串拼进远端命令
  const allowed = ["auto_enabled", "auto_every", "defer_hours", "tg_chat", "tg_bot", "tg_token"];
  if (!allowed.includes(key)) return { ok: false, code: null, output: "", error: `不支持的设置项 ${key}` };
  // token 是长串 base64 字符，允许更宽的字符集；其他项仍限严格
  const okChars =
    key === "tg_token"
      ? /^[0-9A-Za-z_.:\-]*$/.test(value)
      : /^[0-9A-Za-z_.@:\-]*$/.test(value);
  if (!okChars) {
    return { ok: false, code: null, output: "", error: "设置值包含不支持的字符" };
  }
  const b64 = Data.fromString(value)?.toBase64String() ?? "";
  return await runRemote(cfg, `v=$(printf %s "${b64}" | base64 -d); ${SG} set ${key} "$v"`, 60);
}

/** 测试 Telegram 通知通道 */
export async function sendTestNotification(cfg: UpdateConfig): Promise<UpdateResult> {
  return await runRemote(cfg, `${SG} notify-test`, 60);
}

/** 校验配置能否连上：跑一次 check，拿到状态即通 */
export async function testConnection(cfg: UpdateConfig): Promise<{ ok: boolean; message: string; state?: UpdateState }> {
  const { state, result } = await checkUpdates(cfg);
  if (state) return { ok: true, message: "连接成功", state };
  return { ok: false, message: result.error || result.output.slice(-120) || "连接失败" };
}
