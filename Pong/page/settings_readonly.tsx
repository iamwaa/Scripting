// ============================================================================
// Site settings — read-only view of the active panel's configuration.
// Nezha: GET /setting → returns a large SettingResponse; we render common
// visible fields. Komari: GET /settings/ → returns key-value map.
// Write-back is NOT implemented — the Setting model is large and editing it
// safely requires the full panel form, which is out of scope for a mobile app.
// S: Single Purpose — read-only config display; I/O via server.ts.
// ============================================================================
import {
  Button, HStack, Image, List, Navigation, NavigationStack,
  Section, Spacer, Text, VStack, useEffect, useState,
} from "scripting";
import { useMonitor } from "../context/Monitor";
import { fetchSiteSettings } from "../class/server";
import type { SiteSettings, Instance } from "../class/types";

export function View() {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor(); const inst = monitor.instance.value;
  const [settings, setSettings] = useState<SiteSettings>({});
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");

  useEffect(() => {
    if (!inst) { setLoading(false); return; }
    setLoading(true);
    fetchSiteSettings(inst).then(s => { setSettings(s || {}); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  /** Render non-object, non-array setting values in a readable row. */
  function renderVal(k: string, v: any): string {
    if (v === true) return "是";
    if (v === false) return "否";
    if (v === "" || v == null) return "—";
    return String(v);
  }

  return (
    <NavigationStack>
      <List navigationTitle={"站点设置"}
        toolbar={{ cancellationAction: <Button title={"完成"} action={dismiss} /> }}>
        {loading ? <Section><Text foregroundStyle={"secondaryLabel"}>加载中…</Text></Section>
        : error ? <Section><Text foregroundStyle={"systemRed"}>{error}</Text></Section>
        : Object.keys(settings).length === 0 ? (
          <Section><Text foregroundStyle={"secondaryLabel"}>无配置数据</Text></Section>
        ) : (
          <Section footer={<Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>只读显示。编辑配置请在面板后台操作。</Text>}>
            {Object.keys(settings).sort().map(k => {
              const v = settings[k];
              if (v != null && typeof v === "object") return null; // skip nested
              return (
                <HStack key={k} alignment={"firstTextBaseline"} spacing={8}>
                  <Text font={"subheadline"} lineLimit={1} foregroundStyle={"secondaryLabel"}>{k}</Text>
                  <Spacer />
                  <Text font={"caption"} lineLimit={2}>{renderVal(k, v)}</Text>
                </HStack>
              );
            })}
          </Section>
        )}
      </List>
    </NavigationStack>
  );
}
