// ============================================================================
// Config persistence layer.
// S: Single Purpose — read/write the saved instance list and active selection.
// E: Environment-Agnostic — endpoint URLs come from user config, never hardcoded.
// P: a small Port surface (get/save/add/remove/setActive) over Storage.
// ============================================================================
import { Script } from "scripting";
import type { Instance, MonitorConfig, AuthConfig, BackendKind } from "./types";

const KEY = `${Script.name}.config`;

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Normalise a base URL: trim, drop trailing slash, default to https. */
export function normalizeBaseUrl(raw: string): string {
  let u = (raw || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "");
}

/** Load config, applying defaults so callers always get a valid object. */
export function loadConfig(): MonitorConfig {
  const raw = Storage.get<MonitorConfig>(KEY);
  if (raw && Array.isArray(raw.instances)) {
    return {
      // Legacy instances saved before multi-backend support default to Komari.
      instances: raw.instances.map((i) => ({ ...i, kind: i.kind || "komari" })),
      activeId: raw.activeId || (raw.instances[0]?.id ?? ""),
    };
  }
  return { instances: [], activeId: "" };
}

function persist(cfg: MonitorConfig): void {
  Storage.set(KEY, cfg);
}

/** The currently selected instance, or null when none configured. */
export function getActiveInstance(): Instance | null {
  const cfg = loadConfig();
  return cfg.instances.find((i) => i.id === cfg.activeId) ?? cfg.instances[0] ?? null;
}

/** Normalise an auth config: drop empty fields, force "none" when blank. */
export function normalizeAuth(auth?: AuthConfig): AuthConfig | undefined {
  if (!auth || auth.mode === "none") return undefined;
  if (auth.mode === "token") {
    const apiKey = (auth.apiKey || "").trim();
    if (!apiKey) return undefined;
    return { mode: "token", apiKey };
  }
  if (auth.mode === "password") {
    const username = (auth.username || "").trim();
    const password = auth.password || "";
    if (!username || !password) return undefined;
    const out: AuthConfig = { mode: "password", username, password };
    const tf = (auth.twoFactor || "").trim();
    if (tf) out.twoFactor = tf;
    if (auth.sessionToken) out.sessionToken = auth.sessionToken;
    return out;
  }
  return undefined;
}

/** Add or update an instance. When `id` is omitted a new one is created. */
export function upsertInstance(input: {
  id?: string;
  name: string;
  kind: BackendKind;
  baseUrl: string;
  auth?: AuthConfig;
}): Instance {
  const cfg = loadConfig();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const name = input.name.trim() || baseUrl.replace(/^https?:\/\//, "");
  const auth = normalizeAuth(input.auth);
  const kind: BackendKind = input.kind || "komari";

  if (input.id) {
    const idx = cfg.instances.findIndex((i) => i.id === input.id);
    if (idx >= 0) {
      cfg.instances[idx] = { ...cfg.instances[idx], name, kind, baseUrl, auth };
      persist(cfg);
      return cfg.instances[idx];
    }
  }

  const inst: Instance = { id: uid(), name, kind, baseUrl, auth };
  cfg.instances.push(inst);
  if (!cfg.activeId) cfg.activeId = inst.id;
  persist(cfg);
  return inst;
}

/** Persist a freshly obtained session token onto a saved instance. */
export function updateSessionToken(id: string, sessionToken: string): void {
  const cfg = loadConfig();
  const idx = cfg.instances.findIndex((i) => i.id === id);
  if (idx < 0 || !cfg.instances[idx].auth) return;
  cfg.instances[idx] = {
    ...cfg.instances[idx],
    auth: { ...cfg.instances[idx].auth!, sessionToken },
  };
  persist(cfg);
}

/** Remove an instance and re-point activeId if needed. */
export function removeInstance(id: string): void {
  const cfg = loadConfig();
  cfg.instances = cfg.instances.filter((i) => i.id !== id);
  if (cfg.activeId === id) cfg.activeId = cfg.instances[0]?.id ?? "";
  persist(cfg);
}

/** Switch the active instance. */
export function setActiveInstance(id: string): void {
  const cfg = loadConfig();
  if (cfg.instances.some((i) => i.id === id)) {
    cfg.activeId = id;
    persist(cfg);
  }
}
