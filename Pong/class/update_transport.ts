// ============================================================================
// 服务器更新的传输层 — 两条通道 + 主机/账号归一化 + 退出码解析。
// - ssh：SSHClient（私钥 / 密码）
// - cli：系统 ssh 命令（无密钥网关 + 可选 sudo）
// S: 只管「怎么把一条命令送到远端并拿回结果」，不认识 sg-update 的任何子命令。
// ============================================================================
import type { UpdateConfig } from "./types";

export type UpdateResult = {
  ok: boolean;
  /** 远端退出码（连接层失败时为 null） */
  code: number | null;
  output: string;
  error?: string;
};

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

/**
 * 拆分主机串。复制 SSH 连接信息时常把整行（甚至 `Hostname` 标签、`user@`）粘进「主机」框，
 * 拼出来的 ssh 目标就变成 `Hostname ibssh_x@user@host`，服务端直接回 Permission denied (publickey)。
 * 这里把 `ssh://` 前缀、`Hostname`/`主机` 标签、空白与 `user@` 都拆出去。
 */
export function normalizeHost(raw: string): { host: string; user?: string } {
  let s = String(raw || "").trim().replace(/^ssh:\/\//i, "");
  // 标签后必须跟冒号或空白才算标签；否则 `hostinger.com` 这类域名会被误删前缀
  s = s.replace(/^(hostname|host|主机)\s*(?:[:：]\s*|\s+)/i, "").trim();
  // 整行粘贴时可能带上空格分隔的多段，只取第一段
  s = s.split(/\s+/)[0] || "";
  const at = s.lastIndexOf("@");
  if (at > 0 && at < s.length - 1) {
    return { host: s.slice(at + 1).trim(), user: s.slice(0, at).trim() };
  }
  return { host: s };
}

/**
 * 归一化账号：去空白、去掉 `user`/`用户名` 这类标签。
 * 若账号里被粘进了 `user@host`，把 host 一并带回，供调用方补齐主机。
 */
export function normalizeUser(raw: string): { user: string; host?: string } {
  let s = String(raw || "").trim();
  // 标签后必须跟冒号或空白才算标签；否则 `user@host` 里的 user 会被误删
  s = s.replace(/^(username|user|账号|用户名)\s*(?:[:：]\s*|\s+)/i, "").trim();
  s = s.split(/\s+/)[0] || "";
  const at = s.lastIndexOf("@");
  if (at > 0 && at < s.length - 1) {
    return { user: s.slice(0, at).trim(), host: s.slice(at + 1).trim() };
  }
  return { user: s };
}

/** 解析出最终的「账号 + 主机」：粘贴进主机串的用户名优先 */
export function resolveTarget(cfg: UpdateConfig): { host: string; user: string; port: number } {
  const fromHost = normalizeHost(cfg.host);
  const fromUser = normalizeUser(cfg.user || "");
  return {
    host: fromHost.host || fromUser.host || "",
    user: fromHost.user || fromUser.user || "root",
    port: Number(cfg.port) || 22,
  };
}

async function connect(cfg: UpdateConfig): Promise<SSHClient> {
  const { host, user, port } = resolveTarget(cfg);
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
  return await SSHClient.connect({ host, port, authenticationMethod: auth });
}

// ---------- cli 通道（无密钥网关 + 可选 sudo） --------------------------
//
// 有些托管容器只给一个「无密钥」SSH 网关：服务端用 none 认证，用户名对了就放行，
// 任何公钥/密码都会被拒。SSHClient 只接受 password/密钥，无法表达 none，
// 所以这条通道改用系统自带的 ssh 命令（BatchMode 下客户端会自动走 none）。
//
// 远端命令一律 base64 后经 stdin 交给 bash：
// - 避免在 iOS 侧拼多层引号（实测 ios_system 会把嵌套引号吃掉）；
// - 内容里带中文/单引号/管道也不受影响。

/** 系统 ssh 的公共参数：无交互、不写 known_hosts、不报 host key 警告 */
function sshArgs(cfg: UpdateConfig): string {
  const { host, user, port } = resolveTarget(cfg);
  return (
    `-T -o BatchMode=yes -o StrictHostKeyChecking=no ` +
    `-o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=15 ` +
    `-p ${port} ${user}@${host}`
  );
}

/** 通过系统 ssh 执行一段远端脚本，返回合并后的输出与退出码 */
async function runViaCli(
  cfg: UpdateConfig,
  script: string,
  timeoutSec: number,
): Promise<UpdateResult> {
  const payload = Data.fromString(script)?.toBase64String() ?? "";
  if (!payload) return { ok: false, code: null, output: "", error: "无法编码远端命令" };
  // 提权：非 root 账号跑 /root/bin/sg-update 必须 sudo -n（需服务端免密 sudo）
  const shell = cfg.sudo ? "sudo -n bash" : "bash";
  const remote = `echo ${payload} | base64 -d | ${shell}`;
  const command = `ssh ${sshArgs(cfg)} '${remote}'`;

  const res = await Shell.run(command, { timeout: timeoutSec });
  const text = res.output ?? "";
  if (res.timedOut) {
    return { ok: false, code: null, output: text.trim(), error: `命令超时（${timeoutSec}s）` };
  }
  // ssh 自身的连接层失败（退出码 255）不会有 __EXIT__ 哨兵
  if (res.exitCode === 255 && !text.includes("__EXIT__")) {
    const msg = text.trim().split("\n").filter(Boolean).slice(-2).join(" ");
    const { host, user, port } = resolveTarget(cfg);
    // 无密钥网关只校验用户名：认证被拒基本就是账号写错，顺带把实际目标回显出来
    const hint = /Permission denied/i.test(text)
      ? `（实际连接目标 ${user}@${host}:${port}；无密钥网关只校验用户名，请核对「账号」是否与主机给的登录名一致）`
      : "";
    return { ok: false, code: null, output: text.trim(), error: `${msg || "SSH 连接失败"}${hint}` };
  }
  return parseResult(text);
}

/** 执行一条远程命令（带超时与退出码哨兵） */
export async function runRemote(
  cfg: UpdateConfig,
  command: string,
  timeoutSec = 90,
): Promise<UpdateResult> {
  const wrapped = `timeout ${timeoutSec} bash -c ${shellQuote(command)}; echo "__EXIT__$?"`;

  if (cfg.transport === "cli") {
    // 本地也要留一点余量，避免 Shell.run 先超时、拿不到哨兵输出
    return await runViaCli(cfg, wrapped, timeoutSec + 20);
  }

  let client: SSHClient | null = null;
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

/** 从带 `__EXIT__<code>` 哨兵的输出里拆出退出码与正文 */
function parseResult(text: string): UpdateResult {
  const raw = typeof text === "string" ? text : String(text ?? "");
  const idx = raw.lastIndexOf("__EXIT__");
  if (idx < 0) return { ok: false, code: null, output: raw.trim(), error: "未收到退出码（连接可能中断）" };
  const code = Number(raw.slice(idx + 8).trim().split(/\s/)[0]);
  const output = raw.slice(0, idx).trim();
  return { ok: code === 0, code: Number.isFinite(code) ? code : null, output };
}
