// ============================================================================
// Node search + categorisation — pure transforms, no I/O, no side effects.
// S: Single Purpose — turn (nodes, query, category, custom groups) into the
//    filtered/grouped view model the list UI renders.
// P: Ports over Implementation — UI depends on these shapes, not on storage.
// ============================================================================
import type { NodeBasicInfo } from "./types";
import { regionToName } from "./geo";

/** A user-defined local group: a name + the set of node UUIDs assigned to it. */
export type CustomGroup = {
  id: string;
  name: string;
  uuids: string[];
};

/** Where a category chip comes from — affects how membership is resolved. */
export type CategoryKind = "all" | "online" | "offline" | "group" | "tag" | "region" | "custom";

/** One selectable category chip. `key` identifies it within its kind. */
export type Category = {
  kind: CategoryKind;
  /** Stable id, e.g. "all", "online", "group:生产", "tag:bgp", "region:JP", "custom:<id>". */
  id: string;
  /** Human-readable chip label. */
  label: string;
  /** Member count (after applying nothing else — just this category). */
  count: number;
};

/** Split a node `tags` string (';'-separated) into trimmed, non-empty tags. */
export function parseTags(tags?: string): string[] {
  if (!tags) return [];
  return tags
    .split(";")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Lower-cased haystack of a node's searchable text (name/group/tags/region). */
function haystack(n: NodeBasicInfo): string {
  return [
    n.name || "",
    n.group || "",
    n.tags || "",
    n.region || "",
    regionToName(n.region) || "",
    n.os || "",
  ]
    .join(" ")
    .toLowerCase();
}

/** True when a node matches a free-text query (case-insensitive substring). */
export function matchesQuery(n: NodeBasicInfo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack(n).includes(q);
}

/** True when a node belongs to a category, given live online state + custom groups. */
export function inCategory(
  n: NodeBasicInfo,
  cat: Category,
  online: Set<string>,
  customGroups: CustomGroup[],
): boolean {
  switch (cat.kind) {
    case "all":
      return true;
    case "online":
      return online.has(n.uuid);
    case "offline":
      return !online.has(n.uuid);
    case "group":
      return (n.group || "") === cat.id.slice("group:".length);
    case "tag":
      return parseTags(n.tags).includes(cat.id.slice("tag:".length));
    case "region":
      return (n.region || "") === cat.id.slice("region:".length);
    case "custom": {
      const gid = cat.id.slice("custom:".length);
      const g = customGroups.find((x) => x.id === gid);
      return !!g && g.uuids.includes(n.uuid);
    }
    default:
      return true;
  }
}

/**
 * Build the ordered list of category chips from the current nodes + custom
 * groups. Order: All / Online / Offline, then server groups, then tags, then
 * custom groups, then regions. Empty buckets are skipped (except All).
 */
export function buildCategories(
  nodes: NodeBasicInfo[],
  online: Set<string>,
  customGroups: CustomGroup[],
): Category[] {
  const cats: Category[] = [];
  const onlineCount = nodes.filter((n) => online.has(n.uuid)).length;

  cats.push({ kind: "all", id: "all", label: "全部", count: nodes.length });
  if (onlineCount > 0) {
    cats.push({ kind: "online", id: "online", label: "在线", count: onlineCount });
  }
  if (nodes.length - onlineCount > 0) {
    cats.push({ kind: "offline", id: "offline", label: "离线", count: nodes.length - onlineCount });
  }

  // Server groups (node.group, resolved from Nezha server-group)
  const groupCounts = countBy(nodes, (n) => (n.group || "").trim());
  for (const name of sortedKeys(groupCounts)) {
    if (!name) continue;
    cats.push({ kind: "group", id: `group:${name}`, label: name, count: groupCounts[name] });
  }

  // Tags (node.tags, ';'-split). Nezha has no tags, so this stays empty there.
  const tagCounts: Record<string, number> = {};
  for (const n of nodes) {
    for (const tag of parseTags(n.tags)) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  for (const tag of sortedKeys(tagCounts)) {
    cats.push({ kind: "tag", id: `tag:${tag}`, label: `#${tag}`, count: tagCounts[tag] });
  }

  // Custom local groups
  for (const g of customGroups) {
    const count = nodes.filter((n) => g.uuids.includes(n.uuid)).length;
    cats.push({ kind: "custom", id: `custom:${g.id}`, label: g.name, count });
  }

  // Regions (fallback axis — only when there is more than one region)
  const regionCounts = countBy(nodes, (n) => (n.region || "").trim());
  const regionKeys = sortedKeys(regionCounts).filter((k) => k);
  if (regionKeys.length > 1) {
    for (const code of regionKeys) {
      cats.push({
        kind: "region",
        id: `region:${code}`,
        label: regionToName(code),
        count: regionCounts[code],
      });
    }
  }

  return cats;
}

/**
 * Apply search + category to a node list. Returns the filtered nodes in the
 * SAME order they arrived (caller sorts upstream, e.g. online-first).
 */
export function applyFilter(
  nodes: NodeBasicInfo[],
  query: string,
  cat: Category | null,
  online: Set<string>,
  customGroups: CustomGroup[],
): NodeBasicInfo[] {
  return nodes.filter((n) => {
    if (!matchesQuery(n, query)) return false;
    if (cat && !inCategory(n, cat, online, customGroups)) return false;
    return true;
  });
}

// --- small helpers ----------------------------------------------------------

function countBy(nodes: NodeBasicInfo[], key: (n: NodeBasicInfo) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of nodes) {
    const k = key(n);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function sortedKeys(counts: Record<string, number>): string[] {
  return Object.keys(counts).sort((a, b) => a.localeCompare(b));
}
