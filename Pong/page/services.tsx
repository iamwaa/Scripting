// ============================================================================
// Service monitor — two read-only views over the panel's latency/uptime
// "services" (Nezha `/service`):
//   • 列表: per-service availability % + current delay
//   • 可用率墙: 30-day HeatMap (X=day, Y=service, color=daily availability)
// Only meaningful for backends whose caps.hasServiceOverview is true.
// S: Single Purpose — read-only service views; data shaping in class/uptime.ts.
// ============================================================================
import {
  Chart,
  HeatMapChart,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Picker,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting";
import { getActiveInstance } from "../class/config";
import { fetchServiceOverview } from "../class/server";
import type { ServiceOverview } from "../class/types";
import {
  buildUptimeMatrix,
  serviceDomain,
  dayDomain,
  rowUptime,
  uptimeCellTint,
  UPTIME_DAYS,
} from "../class/uptime";

/** Color for an aggregate uptime percentage. */
function uptimeTint(p: number): string {
  if (p >= 99.5) return "systemGreen";
  if (p >= 95) return "systemYellow";
  if (p >= 80) return "systemOrange";
  return "systemRed";
}

// ----------------------------------------------------------------------------
// List view — one row per service with availability bar + current delay.
// ----------------------------------------------------------------------------
function ServiceRow({ s }: { s: ServiceOverview }) {
  return (
    <VStack alignment={"leading"} spacing={6} padding={{ vertical: 4 }}>
      <HStack>
        <Image
          systemName={s.up ? "checkmark.circle.fill" : "xmark.circle.fill"}
          foregroundStyle={s.up ? "systemGreen" : "systemRed"}
        />
        <Text font={"subheadline"} lineLimit={1}>
          {s.name}
        </Text>
        <Spacer />
        <Text font={"caption"} foregroundStyle={uptimeTint(s.uptime)}>
          {s.uptime.toFixed(2)}%
        </Text>
      </HStack>
      <ProgressView
        value={Math.max(0, Math.min(1, s.uptime / 100))}
        total={1}
        progressViewStyle={"linear"}
      />
      <HStack>
        <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
          可用率
        </Text>
        <Spacer />
        <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
          {s.currentDelay > 0 ? `当前 ${s.currentDelay.toFixed(0)} ms` : "无延迟数据"}
        </Text>
      </HStack>
    </VStack>
  );
}

function ServiceListView({ services }: { services: ServiceOverview[] }) {
  return (
    <Section
      header={<Text>{services.length} 个监控项</Text>}
      footer={
        <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
          可用率与当前延迟来自哪吒服务监控（最近统计窗口）。
        </Text>
      }
    >
      {services.map((s) => (
        <ServiceRow key={`${s.id}`} s={s} />
      ))}
    </Section>
  );
}

// ----------------------------------------------------------------------------
// Uptime wall — 30-day availability HeatMap. Each cell's color is driven
// per-mark (semantic green→red, gray for no-data) rather than the default
// single-hue intensity ramp, so the wall reads like a status page.
// ----------------------------------------------------------------------------
const LEGEND: { tint: string; label: string }[] = [
  { tint: "systemGreen", label: "≥99.5%" },
  { tint: "systemYellow", label: "≥95%" },
  { tint: "systemOrange", label: "≥80%" },
  { tint: "systemRed", label: "<80%" },
  { tint: "systemGray5", label: "无数据" },
];

function Legend() {
  return (
    <HStack spacing={10}>
      {LEGEND.map((l) => (
        <HStack key={l.label} spacing={3}>
          <VStack
            frame={{ width: 10, height: 10 }}
            background={l.tint}
            clipShape={{ type: "rect", cornerRadius: 2 }}
          />
          <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
            {l.label}
          </Text>
        </HStack>
      ))}
    </HStack>
  );
}

function UptimeWallView({ services }: { services: ServiceOverview[] }) {
  // Build matrix + axis domains once per data change.
  const cells = useMemo(() => buildUptimeMatrix(services, UPTIME_DAYS), [services]);
  const rows = useMemo(() => serviceDomain(cells), [cells]);
  const xDomain = useMemo(() => dayDomain(UPTIME_DAYS), []);

  // Each row ~26pt; cap visible height so many services stay scrollable.
  const wallHeight = Math.max(120, Math.min(rows.length * 26 + 20, 420));

  const marks = cells.map((c) => ({
    x: c.x,
    y: c.y,
    value: c.value,
    foregroundStyle: uptimeCellTint(c.value, c.noData),
    cornerRadius: 2,
  }));

  if (cells.length === 0) {
    return (
      <Section
        footer={
          <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
            可用率墙需要哪吒返回每日上线/掉线统计。开启面板的历史存储后才会有数据。
          </Text>
        }
      >
        <HStack padding={{ vertical: 10 }}>
          <Image systemName={"square.grid.3x3"} foregroundStyle={"tertiaryLabel"} />
          <Text foregroundStyle={"secondaryLabel"}>暂无每日可用率数据</Text>
          <Spacer />
        </HStack>
      </Section>
    );
  }

  return (
    <>
      <Section header={<Text>最近 {UPTIME_DAYS} 天可用率</Text>}>
        <VStack alignment={"leading"} spacing={8} padding={{ vertical: 6 }}>
          <Chart
            frame={{ height: wallHeight }}
            chartXAxis={"hidden"}
            chartYAxis={"visible"}
            chartXScale={xDomain}
            chartYScale={rows}
          >
            <HeatMapChart marks={marks} />
          </Chart>
          <HStack>
            <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
              ← {UPTIME_DAYS} 天前
            </Text>
            <Spacer />
            <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
              今天 →
            </Text>
          </HStack>
          <Legend />
        </VStack>
      </Section>

      <Section
        header={<Text>各监控项总可用率</Text>}
        footer={
          <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
            按窗口内全部检测次数汇总；灰格表示当天无检测记录，不计入。
          </Text>
        }
      >
        {rows.map((name) => {
          const up = rowUptime(cells, name);
          return (
            <HStack key={name}>
              <Text font={"subheadline"} lineLimit={1}>
                {name}
              </Text>
              <Spacer />
              <Text font={"caption"} foregroundStyle={uptimeTint(up)}>
                {up.toFixed(2)}%
              </Text>
            </HStack>
          );
        })}
      </Section>
    </>
  );
}

// ----------------------------------------------------------------------------
// Container — loads services once, toggles between list and wall.
// ----------------------------------------------------------------------------
export function View() {
  const dismiss = Navigation.useDismiss();
  const [loading, setLoading] = useState<boolean>(true);
  const [services, setServices] = useState<ServiceOverview[]>([]);
  const [error, setError] = useState<string>("");
  const [mode, setMode] = useState<number>(0); // 0 = 列表, 1 = 可用率墙

  useEffect(() => {
    let cancelled = false;
    const inst = getActiveInstance();
    if (!inst) {
      setLoading(false);
      setError("未配置探针");
      return;
    }
    setLoading(true);
    fetchServiceOverview(inst)
      .then((list) => {
        if (cancelled) return;
        setServices(list);
        setLoading(false);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message || String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <NavigationStack>
      <List
        navigationTitle={"服务监控"}
        toolbar={{
          topBarTrailing: [<Text onTapGesture={() => dismiss()}>完成</Text>],
        }}
      >
        {loading ? (
          <HStack padding={{ vertical: 14 }}>
            <ProgressView />
            <Text foregroundStyle={"secondaryLabel"}>加载中…</Text>
            <Spacer />
          </HStack>
        ) : error ? (
          <Section>
            <Text foregroundStyle={"systemRed"}>{error}</Text>
          </Section>
        ) : services.length === 0 ? (
          <Section
            footer={
              <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
                哪吒的服务监控在面板「服务」中配置。游客只能查看公开的监控项。
              </Text>
            }
          >
            <HStack padding={{ vertical: 10 }}>
              <Image systemName={"bell.slash"} foregroundStyle={"tertiaryLabel"} />
              <Text foregroundStyle={"secondaryLabel"}>暂无服务监控</Text>
              <Spacer />
            </HStack>
          </Section>
        ) : (
          <>
            <Section>
              <Picker title={"视图"} value={mode} onChanged={setMode} pickerStyle={"segmented"}>
                <Text tag={0}>列表</Text>
                <Text tag={1}>可用率墙</Text>
              </Picker>
            </Section>
            {mode === 0 ? (
              <ServiceListView services={services} />
            ) : (
              <UptimeWallView services={services} />
            )}
          </>
        )}
      </List>
    </NavigationStack>
  );
}
