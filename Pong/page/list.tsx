// ============================================================================
// Node list page — search + category filtering + custom groups.
// S: Single Purpose — list presentation, filtering, navigation.
// P: filtering logic lives in class/filter.ts; groups in class/groups.ts.
// ============================================================================
import {
  Button,
  Group,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  ScrollView,
  Spacer,
  Text,
  VStack,
  useObservable,
  useState,
  useMemo,
} from "scripting";
import { useMonitor } from "../context/Monitor";
import { View as DetailView } from "./detail";
import { View as SettingsView } from "./settings";
import { View as GroupsView } from "./groups";
import { View as ServicesView } from "./services";
import {
  formatSpeed,
  formatUptime,
  formatBytes,
} from "../class/format";
import { regionToName } from "../class/geo";
import { healthTint, getBackend } from "../class/server";
import { contentDetents } from "../class/ui";
import {
  buildCategories,
  applyFilter,
  parseTags,
  type Category,
} from "../class/filter";
import { loadGroups, toggleMember } from "../class/groups";

export function View({
  uuids,
  title,
}: {
  uuids?: string[];
  title?: string;
} = {}) {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor();
  const settingsPresented = useObservable<boolean>(false);
  const groupsPresented = useObservable<boolean>(false);
  const servicesPresented = useObservable<boolean>(false);
  const inst = monitor.instance.value;
  const showServices = inst ? getBackend(inst.kind).caps.hasServiceOverview : false;
  const [query, setQuery] = useState<string>("");
  const [catId, setCatId] = useState<string>("all");

  const all = monitor.nodes.value;
  const scoped = uuids != null;
  const online = monitor.online.value;
  const customGroups = loadGroups();

  // The category/filter/sort pipeline is pure over (nodes, online, query,
  // catId, groups). Memoize it so the 2s live-record frames — which change
  // `records` but not these inputs — don't rerun the whole pipeline. `online`
  // now has a stable reference across frames (gated in Monitor.onData), so this
  // recomputes only on real membership / query / category / group changes.
  const nodes = useMemo(
    () => (uuids ? all.filter((n) => uuids.includes(n.uuid)) : all),
    [all, uuids],
  );
  const categories = useMemo(
    () => buildCategories(nodes, online, customGroups),
    [nodes, online, customGroups],
  );
  const activeCat: Category =
    categories.find((c) => c.id === catId) ?? categories[0];
  const ordered = useMemo(() => {
    const filtered = applyFilter(nodes, query, activeCat, online, customGroups);
    return filtered
      .slice()
      .sort((a, b) => Number(online.has(b.uuid)) - Number(online.has(a.uuid)));
  }, [nodes, query, activeCat, online, customGroups]);

  return (
    <NavigationStack>
      <List
        navigationTitle={title ?? "节点列表"}
        navigationBarTitleDisplayMode={"inline"}
        listStyle={"plain"}
        searchable={{
          value: query,
          onChanged: setQuery,
          placement: "navigationBarDrawer",
          prompt: "搜索名称 / 地区 / 分组 / 标签",
        }}
        refreshable={async () => {
          await monitor.reload();
        }}
        toolbar={{
          cancellationAction: [
            <Button title={"关闭"} systemImage={"xmark"} action={dismiss} />,
          ],
          topBarTrailing: scoped
            ? []
            : [
                ...(showServices
                  ? [
                      <Button
                        action={() => servicesPresented.setValue(true)}
                        sheet={{
                          isPresented: servicesPresented,
                          content: <ServicesView presentationDetents={contentDetents()} />,
                        }}
                      >
                        <Image systemName={"checkmark.shield"} />
                      </Button>,
                    ]
                  : []),
                <Button
                  action={() => groupsPresented.setValue(true)}
                  sheet={{
                    isPresented: groupsPresented,
                    content: <GroupsView presentationDetents={contentDetents()} />,
                  }}
                >
                  <Image systemName={"folder.badge.gearshape"} />
                </Button>,
                <Button
                  action={() => settingsPresented.setValue(true)}
                  sheet={{
                    isPresented: settingsPresented,
                    content: <SettingsView presentationDetents={contentDetents()} />,
                  }}
                >
                  <Image systemName={"gearshape"} />
                </Button>,
              ],
        }}
      >
        {monitor.instance.value == null ? (
          <EmptyState onConfigure={() => settingsPresented.setValue(true)} />
        ) : monitor.error.value && nodes.length === 0 ? (
          <Text foregroundStyle={"systemRed"}>{monitor.error.value}</Text>
        ) : (
          <>
            <CategoryBar
              categories={categories}
              activeId={activeCat.id}
              onSelect={setCatId}
            />

            <Text
              font={"caption"}
              foregroundStyle={"secondaryLabel"}
              listRowSeparator={"hidden"}
              listRowInsets={{ top: 2, bottom: 2, leading: 18, trailing: 16 }}
            >
              {activeCat.id === "all" ? "共" : `${activeCat.label} ·`} {ordered.length} 个节点
              {query ? ` · 匹配“${query}”` : ""}
            </Text>

            {ordered.length === 0 ? (
              <HStack padding={{ vertical: 20 }} listRowSeparator={"hidden"}>
                <Spacer />
                <Text foregroundStyle={"tertiaryLabel"}>没有匹配的节点</Text>
                <Spacer />
              </HStack>
            ) : (
              ordered.map((node) => (
                <NodeRow key={node.uuid} uuid={node.uuid} />
              ))
            )}
          </>
        )}
      </List>
    </NavigationStack>
  );
}

function CategoryBar({
  categories,
  activeId,
  onSelect,
}: {
  categories: Category[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollView
      axes={"horizontal"}
      showsIndicators={false}
      listRowSeparator={"hidden"}
      listRowInsets={{ top: 6, bottom: 4, leading: 16, trailing: 16 }}
    >
      <HStack spacing={8}>
        {categories.map((c) => (
          <Chip
            key={c.id}
            label={c.label}
            count={c.count}
            active={c.id === activeId}
            onTap={() => onSelect(c.id)}
          />
        ))}
      </HStack>
    </ScrollView>
  );
}

function Chip({
  label,
  count,
  active,
  onTap,
}: {
  label: string;
  count: number;
  active: boolean;
  onTap: () => void;
}) {
  return (
    <Button action={onTap}>
      <HStack
        spacing={5}
        padding={{ horizontal: 13, vertical: 7 }}
        background={active ? "systemBlue" : "secondarySystemFill"}
        clipShape={{ type: "capsule" }}
      >
        <Text
          font={"subheadline"}
          fontWeight={active ? "semibold" : "regular"}
          foregroundStyle={active ? "white" : "label"}
          lineLimit={1}
        >
          {label}
        </Text>
        <Text
          font={"caption2"}
          fontWeight={"medium"}
          foregroundStyle={active ? "white" : "secondaryLabel"}
          opacity={active ? 0.85 : 1}
        >
          {count}
        </Text>
      </HStack>
    </Button>
  );
}

function EmptyState({ onConfigure }: { onConfigure: () => void }) {
  return (
    <VStack spacing={12} padding={20} frame={{ maxWidth: "infinity" }}>
      <Image systemName={"antenna.radiowaves.left.and.right"} frame={{ width: 60, height: 60 }} foregroundStyle={"systemGreen"} />
      <Text font={"headline"}>尚未配置探针</Text>
      <Text font={"footnote"} foregroundStyle={"secondaryLabel"} multilineTextAlignment={"center"}>
        添加你的探针面板地址后即可查看节点的实时状态与地理分布。
      </Text>
      <Button action={onConfigure} buttonStyle={"borderedProminent"}>
        <HStack spacing={4}>
          <Image systemName={"plus"} foregroundStyle={"white"} />
          <Text foregroundStyle={"white"}>前往设置</Text>
        </HStack>
      </Button>
    </VStack>
  );
}

function NodeRow({ uuid }: { uuid: string }) {
  const monitor = useMonitor();
  const detailPresented = useObservable<boolean>(false);

  const node = monitor.nodeIndex.value[uuid];
  if (!node) return <></>;

  const isOnline = monitor.online.value.has(uuid);
  const rec = monitor.records.value[uuid];
  const dotColor = healthTint(isOnline, rec);
  const series = monitor.history.value[uuid] || [];
  const groups = loadGroups();
  const tags = parseTags(node.tags);

  return (
    <Button
      listRowSeparator={"hidden"}
      listRowInsets={{ top: 6, bottom: 6, leading: 16, trailing: 16 }}
      action={() => detailPresented.setValue(true)}
      sheet={{
        isPresented: detailPresented,
        content: <DetailView uuid={uuid} presentationDetents={contentDetents()} />,
      }}
      contextMenu={{
        menuItems: (
          <Group>
            {groups.length === 0 ? (
              <Button title={"暂无自定义分组"} action={() => {}} />
            ) : (
              groups.map((g) => (
                <Button
                  key={g.id}
                  title={`${g.uuids.includes(uuid) ? "✓ " : ""}${g.name}`}
                  action={() => {
                    toggleMember(g.id, uuid);
                    monitor.reload();
                  }}
                />
              ))
            )}
          </Group>
        ),
      }}
    >
      <VStack
        alignment={"leading"}
        spacing={10}
        padding={14}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        glassEffect={{ glass: UIGlass.regular(), shape: { type: "rect", cornerRadius: 20 } }}
        clipShape={{ type: "rect", cornerRadius: 20 }}
        shadow={{ color: "rgba(0,0,0,0.12)", radius: 8, x: 0, y: 3 }}
      >
        <HStack spacing={9}>
          <VStack
            frame={{ width: 9, height: 9 }}
            background={dotColor}
            clipShape={{ type: "circle" }}
          />
          <Text font={"headline"} fontWeight={"semibold"} lineLimit={1}>
            {node.name}
          </Text>
          <Spacer />
          <Text font={"caption2"} foregroundStyle={dotColor} fontWeight={"medium"} lineLimit={1}>
            {isOnline && rec && rec.uptime > 0 ? formatUptime(rec.uptime) : "离线"}
          </Text>
        </HStack>

        {node.group || tags.length > 0 ? (
          <HStack spacing={6}>
            {node.group ? <Badge text={node.group} tint={"systemIndigo"} /> : null}
            {tags.map((t) => (
              <Badge key={t} text={`#${t}`} tint={"systemGray"} />
            ))}
            <Spacer />
          </HStack>
        ) : null}

        {/* CPU / RAM live readouts */}
        <HStack spacing={8}>
          <MiniStat
            label={"CPU"}
            value={rec ? `${(rec.cpu?.usage ?? 0).toFixed(0)}%` : "—"}
            r={rec ? (rec.cpu?.usage ?? 0) / 100 : 0}
            online={isOnline}
          />
          <MiniStat
            label={"内存"}
            value={
              rec && rec.ram?.total
                ? `${(((rec.ram.used ?? 0) / rec.ram.total) * 100).toFixed(0)}%`
                : "—"
            }
            r={rec && rec.ram?.total ? (rec.ram.used ?? 0) / rec.ram.total : 0}
            online={isOnline}
          />
        </HStack>

        <Sparkline data={series} online={isOnline} fallbackTint={dotColor} />

        <HStack spacing={12}>
          <HStack spacing={3}>
            <Image systemName={"globe.asia.australia"} font={"caption2"} foregroundStyle={"tertiaryLabel"} />
            <Text font={"caption2"} foregroundStyle={"secondaryLabel"} lineLimit={1}>
              {regionToName(node.region)}
            </Text>
          </HStack>
          <Spacer />
          {isOnline && rec ? (
            <>
              <Text font={"caption2"} foregroundStyle={"systemGreen"} lineLimit={1}>
                ↑ {formatSpeed(rec.network.up)}
              </Text>
              <Text font={"caption2"} foregroundStyle={"systemBlue"} lineLimit={1}>
                ↓ {formatSpeed(rec.network.down)}
              </Text>
            </>
          ) : (
            <Text font={"caption2"} foregroundStyle={"tertiaryLabel"} lineLimit={1}>
              {rec ? formatBytes(rec.network.totalUp + rec.network.totalDown) : "—"}
            </Text>
          )}
        </HStack>
      </VStack>
    </Button>
  );
}

function Badge({ text, tint }: { text: string; tint: string }) {
  return (
    <Text
      font={"caption2"}
      foregroundStyle={"white"}
      padding={{ horizontal: 7, vertical: 2 }}
      background={tint}
      clipShape={{ type: "capsule" }}
      lineLimit={1}
    >
      {text}
    </Text>
  );
}

/** Compact CPU/RAM readout chip. */
function MiniStat({
  label,
  value,
  r,
  online,
}: {
  label: string;
  value: string;
  r: number;
  online: boolean;
}) {
  const ratio = isNaN(r) ? 0 : Math.max(0, Math.min(1, r));
  const tint = !online ? "tertiaryLabel" : loadColor(ratio);
  return (
    <HStack
      spacing={6}
      padding={{ horizontal: 12, vertical: 9 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={"tertiarySystemFill"}
      clipShape={{ type: "rect", cornerRadius: 14 }}
    >
      <VStack
        frame={{ width: 6, height: 6 }}
        background={tint}
        clipShape={{ type: "circle" }}
      />
      <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
        {label}
      </Text>
      <Spacer />
      <Text font={"subheadline"} fontWeight={"semibold"} foregroundStyle={online ? "label" : "tertiaryLabel"}>
        {value}
      </Text>
    </HStack>
  );
}

/**
 * Variable-height sparkline of recent CPU load. Each bar's HEIGHT reflects the
 * sample value (so a real curve is visible immediately), and its colour tracks
 * load severity. Falls back to a flat idle pattern before history seeds.
 */
function Sparkline({
  data,
  online,
  fallbackTint,
}: {
  data: number[];
  online: boolean;
  fallbackTint: string;
}) {
  const MAXBARS = 36;
  const BARW = 5;
  const MAXH = 32;
  const MINH = 3;
  const seeded = data.length >= 6;
  const pts = seeded
    ? data.slice(-MAXBARS)
    : new Array(MAXBARS).fill(0).map(() => 0.06 + Math.random() * 0.05);

  return (
    <HStack spacing={3} alignment={"bottom"} frame={{ height: MAXH, maxWidth: "infinity", alignment: "leading" }}>
      {pts.map((v, i) => {
        const r = isNaN(v) ? 0 : Math.max(0, Math.min(1, v));
        const h = MINH + (MAXH - MINH) * r;
        return (
          <VStack
            key={`${i}`}
            frame={{ width: BARW, height: h }}
            background={seeded && online ? loadColor(r) : fallbackTint}
            opacity={seeded ? 0.92 : 0.3}
            clipShape={{ type: "capsule" }}
          />
        );
      })}
    </HStack>
  );
}

function loadColor(r: number): string {
  if (isNaN(r)) return "systemGray";
  if (r >= 0.9) return "systemRed";
  if (r >= 0.7) return "systemOrange";
  if (r >= 0.4) return "systemYellow";
  return "systemGreen";
}
