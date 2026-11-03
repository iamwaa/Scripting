// ============================================================================
// 服务器更新助手 — 调用服务器上的 /root/bin/sg-update，检查/升级
// magpie 与 cf-probe。
// 配置按「节点」保存（同一个探针面板下可以有多台 VPS，每台各自一套连接信息）。
// 传输层（两条 SSH 通道、归一化、退出码解析）在 class/update_transport.ts。
// S: 只做配置存取 + 业务动作，不碰 UI。
// ============================================================================
import { Script } from "scripting";
import type { UpdateConfig } from "./types";
import {
  runLong,
  runRemote,
  keyFileExists,
  normalizeHost,
  normalizeUser,
  type UpdateResult,
} from "./update_transport";

export type { UpdateConfig, UpdateResult };
export { keyFileExists, normalizeHost, normalizeUser };

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
  usage?: string;
  last_check?: string;
  gateway?: string;
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
  /** danmu-api（弹幕接口）代码版本：本地 HEAD 短 sha */
  danmu_version?: string;
  danmu_latest?: string;
  danmu_update_available?: string;
  danmu_target?: string;
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

const SG = "/root/bin/sg-update";

// ---------- 按节点保存的配置 --------------------------------------------------

/** 配置存储键：${Script.name}.update_configs */
const KEY = () => `${Script.name}.update_configs`;

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

/**
 * 新建节点时的默认私钥路径。
 * 不沿用「上一次保存的值」——那会让所有 VPS 都被预填成同一台机器的私钥，
 * 而实际每台服务器（甚至每个网关）用的密钥可能完全不同。
 * 这里只探测本机真实存在的密钥文件，找不到就留一个常见占位。
 */
export function getDefaultKeyPath(): string {
  return detectKeyPath();
}

/**
 * 自动探测可用的私钥：按 ed25519 → RSA 的常见文件名依次找，找不到才回退占位路径。
 * 硬编码单一文件名会导致默认值指向一个不存在的文件（旧值 `.ssh/id_ed12345` 就是典型）。
 */
function detectKeyPath(): string {
  const candidates = [
    ".ssh/id_ed25519",
    ".ssh/ssh_manager_ed25519",
    ".ssh/id_rsa",
    ".ssh/id_ecdsa",
  ];
  for (const rel of candidates) {
    try {
      if (FileManager.existsSync(`${FileManager.documentsDirectory}/${rel}`)) return rel;
    } catch {
      // 读不到就当不存在，继续试下一个
    }
  }
  return ".ssh/id_ed25519";
}

/** 新建节点时的默认账号。不跟上一台走：不同 VPS 的登录名常常不同。 */
export function getDefaultUser(): string {
  return "root";
}

/** 该节点的配置是否完整（有主机 + 私钥或密码） */
export function isUpdatable(cfg: UpdateConfig | undefined): boolean {
  if (!cfg || !cfg.host?.trim()) return false;
  // cli 通道靠系统 ssh 的无密钥网关（服务端 none 认证），不需要密钥或密码
  if (cfg.transport === "cli") return true;
  return !!(cfg.password || cfg.keyPath?.trim());
}

// ---------- Telegram 通知预设（手机侧共享，真正生效在服务器） -----------------
// 服务器上的 tg_* 是按「机器」存的（每台 VPS 各自一份 state.json），手机侧只留一份
// 预设用来回填表单，避免每台服务器都重新敲一遍 token / chat id。

const KC_TG_TOKEN = "sg_tg_token";
const KEY_TG_PRESET = () => `${Script.name}.tg_preset`;

/** 手机侧保存的 Telegram 预设（token 存 Keychain，其余存 Storage） */
export type TgPreset = { bot: string; chat: string; tokenSet: boolean };

export function getTgPreset(): TgPreset {
  const raw = Storage.get<{ bot?: string; chat?: string }>(KEY_TG_PRESET()) || {};
  return {
    bot: String(raw.bot ?? ""),
    chat: String(raw.chat ?? ""),
    tokenSet: !!Keychain.get(KC_TG_TOKEN),
  };
}

/** 保存预设；token 传空表示不修改已有的 */
export function setTgPreset(preset: { bot: string; chat: string; token?: string }): void {
  Storage.set(KEY_TG_PRESET(), { bot: preset.bot, chat: preset.chat });
  const tok = (preset.token || "").trim();
  if (tok) Keychain.set(KC_TG_TOKEN, tok);
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

/** 升级：目标为空表示升到各自最新（danmu 不参与 upgrade，它走 danmu 子命令） */
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

/** 只升级 danmu-api：服务器侧走 rebuild.sh 拉取构建，耗时可到数分钟 */
export async function upgradeDanmu(cfg: UpdateConfig): Promise<UpdateResult> {
  return await runLong(cfg, `${SG} danmu`, { timeoutMs: 10 * 60 * 1000 });
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

/**
 * 校验配置能否连上。分两层：先确认 SSH 本身能登录（这是用户最常撞的坑），
 * 再看服务器上有没有装 /root/bin/sg-update。两层混在一起时，「没装助手」会被
 * 报成「连接失败」，让人以为是密钥/端口问题。
 */
export async function testConnection(
  cfg: UpdateConfig,
): Promise<{ ok: boolean; message: string; state?: UpdateState; needInstall?: boolean }> {
  // 1) 连通性：能拿到 hostname 就说明认证与网络都通
  const probe = await runRemote(
    cfg,
    `echo "__HOST__$(hostname 2>/dev/null)"; if [ -x ${SG} ]; then echo __SG_YES__; else echo __SG_NO__; fi`,
    45,
  );
  if (probe.code !== 0) {
    return { ok: false, message: probe.error || probe.output.slice(-160) || "连接失败" };
  }
  const hostMatch = probe.output.match(/__HOST__([^\n]*)/);
  const hostName = (hostMatch?.[1] || "").trim();
  const hasSg = probe.output.includes("__SG_YES__");

  if (!hasSg) {
    return {
      ok: false,
      needInstall: true,
      message: `SSH 已连上${hostName ? `（${hostName}）` : ""}，但服务器上没有 ${SG}。请先安装更新助手（deploy/ 下的 sg-update）。`,
    };
  }

  // 2) 助手可用性：跑一次 check 拿版本
  const { state, result } = await checkUpdates(cfg);
  if (state) {
    return { ok: true, message: `连接成功${hostName ? `（${hostName}）` : ""}`, state };
  }
  return {
    ok: false,
    message: result.error || result.output.slice(-160) || "sg-update 执行失败",
  };
}
