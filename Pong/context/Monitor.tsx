// ============================================================================
// Monitor context — the single source of truth for live dashboard state.
// S: Single Purpose — owns node list + live records + connection status.
// U: Unidirectional — server.ts -> context observables -> views (read-only).
// P: views consume `useMonitor()`; they never touch fetch / WebSocket directly.
// ============================================================================
import {
  createContext,
  useContext,
  useObservable,
  useEffect,
} from "scripting";
import type { NodeBasicInfo, LiveData, LiveRecord, ConnStatus, Pin, Instance, NezhaServer } from "../class/types";
import { buildPins, LiveClient, getBackend } from "../class/server";
import { buildLoadMarks } from "../class/loadchart";
import { getActiveInstance, updateSessionToken } from "../class/config";

export type MonitorState = {
  instance: Observable<Instance | null>;
  nodes: Observable<NodeBasicInfo[]>;
  /** uuid -> node index, kept in sync with `nodes`. O(1) lookups for rows. */
  nodeIndex: Observable<{ [uuid: string]: NodeBasicInfo }>;
  online: Observable<Set<string>>;
  records: Observable<{ [uuid: string]: LiveRecord }>;
  /** Rolling CPU-load history per node (0..1), newest last. Drives sparklines. */
  history: Observable<{ [uuid: string]: number[] }>;
  pins: Observable<Pin[]>;
  status: Observable<ConnStatus>;
  error: Observable<string>;
  reload: () => Promise<void>;
};

/** Max sparkline samples kept per node. Wider buffer = longer visible trend. */
const HISTORY_MAX = 60;

/** How many hours of CPU history to backfill on open (seeds the sparkline). */
const SEED_HOURS = 24;

const MonitorContext = createContext<MonitorState>();

export function MonitorProvider({ children }: { children: JSX.Element }) {
  const instance = useObservable<Instance | null>(getActiveInstance());
  const nodes = useObservable<NodeBasicInfo[]>([]);
  const nodeIndex = useObservable<{ [uuid: string]: NodeBasicInfo }>({});
  const online = useObservable<Set<string>>(new Set<string>());

  // Single writer for the node list: updates the array AND its uuid index in
  // lockstep so rows can do O(1) lookups instead of O(N) `.find()` per render.
  function setNodes(list: NodeBasicInfo[]) {
    const idx: { [uuid: string]: NodeBasicInfo } = {};
    for (const n of list) idx[n.uuid] = n;
    nodes.setValue(list);
    nodeIndex.setValue(idx);
  }
  const records = useObservable<{ [uuid: string]: LiveRecord }>({});
  const history = useObservable<{ [uuid: string]: number[] }>({});
  const pins = useObservable<Pin[]>([]);
  const status = useObservable<ConnStatus>("idle");
  const error = useObservable<string>("");

  // Recompute pins from explicit inputs (never relies on sync observable reads).
  // Gated by a content signature so the Map only re-renders when a marker
  // actually changes (not on every 2s live frame) — this is the main perf win.
  const pinSig = useObservable<string>("");
  function refreshPins(
    nextNodes: NodeBasicInfo[],
    nextOnline: Set<string>,
    nextRecords?: { [uuid: string]: LiveRecord },
  ) {
    const next = buildPins(nextNodes, nextOnline, nextRecords ?? records.value);
    const sig = next
      .map((p) => `${p.id}:${p.tint}:${p.online ? 1 : 0}:${p.subtitle}`)
      .join("|");
    if (sig === pinSig.value) return; // nothing visible changed; skip re-render
    pinSig.setValue(sig);
    pins.setValue(next);
  }

  /**
   * Re-authenticate a password-mode instance whose session token expired, then
   * persist the fresh token. Returns the updated instance (with new token) or
   * null when re-login isn't possible / fails. No-op for non-password auth.
   */
  async function renewSession(inst: Instance): Promise<Instance | null> {
    const auth = inst.auth;
    if (!auth || auth.mode !== "password" || !auth.username || !auth.password) {
      return null;
    }
    const r = await getBackend(inst.kind).login(inst.baseUrl, auth.username, auth.password, auth.twoFactor);
    if (!r.ok || !r.sessionToken) return null;
    updateSessionToken(inst.id, r.sessionToken);
    const renewed: Instance = {
      ...inst,
      auth: { ...auth, sessionToken: r.sessionToken },
    };
    instance.setValue(renewed);
    return renewed;
  }

  /**
   * Backfill each node's CPU history from the load-records endpoint so the
   * list shows a full past curve the moment it opens (instead of slowly
   * filling from live WS samples). Best-effort and bounded in parallelism.
   */
  async function seedHistory(inst: Instance, list: NodeBasicInfo[]): Promise<void> {
    const seeded: { [uuid: string]: number[] } = {};
    const CONCURRENCY = 4;
    let i = 0;
    async function worker() {
      while (i < list.length) {
        const n = list[i++];
        try {
          const recs = await getBackend(inst.kind).fetchLoadRecords(inst.baseUrl, n.uuid, "cpu", SEED_HOURS, inst.auth);
          const marks = buildLoadMarks("cpu", recs);
          if (marks.length > 0) {
            const series = marks.map((m) => Math.max(0, Math.min(1, m.value / 100)));
            seeded[n.uuid] =
              series.length > HISTORY_MAX ? series.slice(series.length - HISTORY_MAX) : series;
          }
        } catch {
          /* skip a node that fails to seed */
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
    // Merge: keep any live samples that arrived while seeding.
    const merged = { ...seeded, ...history.value };
    for (const uuid of Object.keys(seeded)) {
      if (!history.value[uuid] || history.value[uuid].length < seeded[uuid].length) {
        merged[uuid] = seeded[uuid];
      }
    }
    history.setValue(merged);
  }

  const seededOnce = useObservable<boolean>(false);

  async function reload() {
    let inst = getActiveInstance();
    instance.setValue(inst);
    if (!inst) {
      status.setValue("idle");
      error.setValue("");
      setNodes([]);
      online.setValue(new Set<string>());
      records.setValue({});
      pins.setValue([]);
      return;
    }
    status.setValue("loading");
    error.setValue("");
    const backend = getBackend(inst.kind);
    // Some backends (Nezha) deliver the full node list over the live transport,
    // and their REST node endpoint rejects guests. For those, when there's no
    // auth, skip the REST fetch and let the live `onData` populate `nodes`.
    if (backend.caps.liveProvidesNodes && (!inst.auth || inst.auth.mode === "none")) {
      return;
    }
    try {
      let list: NodeBasicInfo[];
      try {
        list = await backend.fetchNodes(inst.baseUrl, inst.auth);
      } catch (firstErr: any) {
        // Session may have expired — try a single re-login for password auth.
        const renewed = /401|未授权/.test(String(firstErr?.message)) ? await renewSession(inst) : null;
        if (!renewed) throw firstErr;
        inst = renewed;
        list = await backend.fetchNodes(inst.baseUrl, inst.auth);
      }
      setNodes(list);
      refreshPins(list, online.value);
      status.setValue("connected");
      // Backfill sparkline history once, in the background (non-blocking).
      if (!seededOnce.value) {
        seededOnce.setValue(true);
        seedHistory(inst, list);
      }
    } catch (e: any) {
      error.setValue(e?.message || String(e));
      status.setValue("error");
    }
  }

  // Manage the live WebSocket bound to the active instance.
  useEffect(() => {
    let client: LiveClient | null = null;
    const inst = instance.value;

    seededOnce.setValue(false); // re-seed history for the newly active instance
    reload();

    if (inst) {
      const backend = getBackend(inst.kind);
      client = new LiveClient(
        inst,
        {
          onData: (servers: NezhaServer[], data: LiveData) => {
            const nextOnline = new Set(data.online || []);
            const nextRecords = data.data || {};
            // Gate the online Set swap: only replace the reference when the
            // membership actually changed. The reference is read by the list
            // view to drive category counts + filter + sort, so a stable
            // reference across frames stops that whole pipeline from rerunning
            // every 2s when nobody went on/offline. (Same idea as pinSig.)
            const prevOnline = online.value;
            let onlineChanged = prevOnline.size !== nextOnline.size;
            if (!onlineChanged) {
              for (const u of nextOnline) {
                if (!prevOnline.has(u)) {
                  onlineChanged = true;
                  break;
                }
              }
            }
            if (onlineChanged) online.setValue(nextOnline);
            records.setValue(nextRecords);
            // Backends whose live transport carries full server records (Nezha)
            // can populate the node list too — essential for guest mode where
            // the REST node endpoint is unavailable. Only (re)build when empty
            // or membership changed, to avoid churning the UI. Komari passes an
            // empty `servers` array, so this block is a no-op there.
            let list = nodes.value;
            if (backend.caps.liveProvidesNodes && servers.length > 0 && backend.nodesFromLive) {
              const have = new Set(list.map((n) => n.uuid));
              const seen = servers.map((s) => String(s.id));
              const sameSet =
                list.length === servers.length && seen.every((u) => have.has(u));
              if (list.length === 0 || !sameSet) {
                list = backend.nodesFromLive(servers);
                setNodes(list);
              }
            }
            // Append the latest CPU load (0..1) to each node's rolling history.
            const prev = history.value;
            const next: { [uuid: string]: number[] } = {};
            for (const uuid of Object.keys(nextRecords)) {
              const rec = nextRecords[uuid];
              const cpu = isFinite(rec?.cpu?.usage) ? rec.cpu.usage / 100 : 0;
              const series = (prev[uuid] || []).concat(cpu);
              next[uuid] =
                series.length > HISTORY_MAX
                  ? series.slice(series.length - HISTORY_MAX)
                  : series;
            }
            history.setValue(next);
            refreshPins(list, nextOnline, nextRecords);
          },
          onStatus: (s) => {
            // Don't override a hard error from the initial fetch.
            if (s === "connected") status.setValue("connected");
            else if (s === "disconnected") status.setValue("disconnected");
            else status.setValue("error");
          },
        },
        () => instance.value?.auth,
        () => nodes.value.map((n) => n.uuid),
      );
      client.start();
    }

    return () => {
      client?.stop();
    };
  }, [instance.value?.id]);

  const state: MonitorState = {
    instance,
    nodes,
    nodeIndex,
    online,
    records,
    history,
    pins,
    status,
    error,
    reload,
  };

  return (
    <MonitorContext.Provider value={state}>{children}</MonitorContext.Provider>
  );
}

export function useMonitor(): MonitorState {
  return useContext(MonitorContext);
}
