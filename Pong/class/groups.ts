// ============================================================================
// Custom node-group persistence. S: Single Purpose — store/CRUD the user's
// local groups ({name, uuids}). E: Storage-backed, no hardcoding. Groups are
// device-local and keyed independently from instances (uuids are unique).
// ============================================================================
import { Script } from "scripting";
import type { CustomGroup } from "./filter";

const KEY = `${Script.name}.groups`;

// In-memory cache of the parsed group list. loadGroups is called once per row
// per render (N+1 times each live frame) — without caching that's N+1 sync
// Storage reads + JSON.parse every 2s. The cache holds the parsed array and is
// invalidated whenever a mutation persists. `null` = not yet loaded.
let cache: CustomGroup[] | null = null;

function gid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Load all custom groups (empty array when none / on parse error). Cached. */
export function loadGroups(): CustomGroup[] {
  if (cache) return cache;
  try {
    const raw = Storage.get<string>(KEY);
    if (!raw) {
      cache = [];
      return cache;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      cache = [];
      return cache;
    }
    cache = parsed
      .filter((g) => g && typeof g.id === "string" && typeof g.name === "string")
      .map((g) => ({
        id: g.id,
        name: g.name,
        uuids: Array.isArray(g.uuids) ? g.uuids.filter((u: any) => typeof u === "string") : [],
      }));
    return cache;
  } catch {
    cache = [];
    return cache;
  }
}

function persist(groups: CustomGroup[]): void {
  cache = groups; // keep cache coherent with what we just wrote
  Storage.set(KEY, JSON.stringify(groups));
}

/** Create a new empty group; returns it. */
export function createGroup(name: string): CustomGroup {
  const groups = loadGroups();
  const g: CustomGroup = { id: gid(), name: name.trim() || "未命名分组", uuids: [] };
  groups.push(g);
  persist(groups);
  return g;
}

/** Rename a group. No-op if not found. */
export function renameGroup(id: string, name: string): void {
  const groups = loadGroups();
  const g = groups.find((x) => x.id === id);
  if (!g) return;
  g.name = name.trim() || g.name;
  persist(groups);
}

/** Delete a group entirely. */
export function deleteGroup(id: string): void {
  persist(loadGroups().filter((g) => g.id !== id));
}

/** Add or remove a node from a group (toggle). Returns updated membership. */
export function toggleMember(groupId: string, uuid: string): boolean {
  const groups = loadGroups();
  const g = groups.find((x) => x.id === groupId);
  if (!g) return false;
  const has = g.uuids.includes(uuid);
  g.uuids = has ? g.uuids.filter((u) => u !== uuid) : [...g.uuids, uuid];
  persist(groups);
  return !has;
}

/** Set the exact membership of a group. */
export function setMembers(groupId: string, uuids: string[]): void {
  const groups = loadGroups();
  const g = groups.find((x) => x.id === groupId);
  if (!g) return;
  g.uuids = uuids.slice();
  persist(groups);
}

/**
 * Move a group up (dir = -1) or down (dir = +1) in the ordered list.
 * No-op when the move would fall outside the bounds.
 */
export function moveGroup(id: string, dir: -1 | 1): void {
  const groups = loadGroups();
  const i = groups.findIndex((g) => g.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= groups.length) return;
  const tmp = groups[i];
  groups[i] = groups[j];
  groups[j] = tmp;
  persist(groups);
}
