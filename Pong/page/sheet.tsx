// ============================================================================
// Bottom sheet — the floating control over the map.
// S: Single Purpose — entry point into the full list or a tapped country.
// ============================================================================
import {
  Button,
  HStack,
  Image,
  Text,
  VStack,
  useObservable,
  useContext,
} from "scripting";
import { MapSelectionContext } from "../context/MapSelection";
import { useMonitor } from "../context/Monitor";
import { View as ListView } from "./list";
import { contentDetents, barMaxWidth } from "../class/ui";

const STATUS_LABEL: Record<string, { text: string; color: string; icon: string }> = {
  idle: { text: "未配置", color: "systemGray", icon: "questionmark.circle" },
  loading: { text: "连接中", color: "systemYellow", icon: "arrow.triangle.2.circlepath" },
  connected: { text: "已连接", color: "systemGreen", icon: "checkmark.circle.fill" },
  disconnected: { text: "已断开", color: "systemOrange", icon: "wifi.slash" },
  error: { text: "连接失败", color: "systemRed", icon: "exclamationmark.triangle.fill" },
};

export function View() {
  const selection = useContext(MapSelectionContext);
  const monitor = useMonitor();
  const countryPresented = useObservable<boolean>(false);
  const listPresented = useObservable<boolean>(false);

  // A tapped marker now selects a country code; resolve it to that country's pin.
  const selectedCode = (selection.value as any)?.tag as string | undefined;
  const selectedPin = selectedCode
    ? monitor.pins.value.find((p) => p.id === selectedCode)
    : undefined;

  const st = STATUS_LABEL[monitor.status.value] ?? STATUS_LABEL.idle;
  const total = monitor.nodes.value.length;
  const onlineCount = monitor.online.value.size;

  return (
    <HStack
      spacing={10}
      padding={{ bottom: 6 }}
      frame={barMaxWidth() ? { maxWidth: barMaxWidth() } : undefined}
    >
      {/* Status + overview button -> full node list */}
      <Button
        buttonStyle={"glass"}
        action={() => listPresented.setValue(true)}
        sheet={{
          isPresented: listPresented,
          content: <ListView presentationDetents={contentDetents()} />,
        }}
      >
        <HStack padding={5} spacing={6}>
          <Image systemName={st.icon} foregroundStyle={st.color} />
          <VStack alignment={"leading"} spacing={0}>
            <Text font={"headline"} lineLimit={1}>
              {monitor.instance.value?.name ?? "探针面板"}
            </Text>
            <Text font={"caption"} foregroundStyle={"secondaryLabel"} lineLimit={1}>
              {st.text} · 在线 {onlineCount}/{total}
            </Text>
          </VStack>
        </HStack>
      </Button>

      {/* Tapped-country button -> that country's server list */}
      {selectedPin ? (
        <Button
          buttonStyle={"glass"}
          action={() => countryPresented.setValue(true)}
          sheet={{
            isPresented: countryPresented,
            content: (
              <ListView
                uuids={selectedPin.uuids}
                title={selectedPin.title}
                presentationDetents={contentDetents()}
              />
            ),
          }}
        >
          <HStack padding={5} spacing={4}>
            <Image systemName={"chevron.up.circle.fill"} />
            <Text font={"headline"} lineLimit={1} frame={{ maxWidth: 140 }}>
              {selectedPin.title}
            </Text>
          </HStack>
        </Button>
      ) : null}
    </HStack>
  );
}
