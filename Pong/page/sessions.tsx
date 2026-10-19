// ============================================================================
// Sessions management (Komari). List active login sessions, revoke individual
// sessions or all sessions. S: Single Purpose — session CRUD; I/O via server.
// ============================================================================
import {
  Button, Dialog, HStack, Image, List, Navigation, NavigationStack,
  Section, Spacer, Text, VStack, useEffect, useState,
} from "scripting";
import { useMonitor } from "../context/Monitor";
import { listSessions, revokeSession } from "../class/server";
import type { LoginSession, Instance } from "../class/types";

export function View() {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor(); const inst = monitor.instance.value;
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");

  async function refresh() { if (!inst) return; setLoading(true); setError("");
    try { setSessions(await listSessions(inst)); } catch(e: any) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, []);

  async function confirmRevoke(s: LoginSession) {
    if (!inst) return;
    const ok = await Dialog.confirm({ title: "踢出会话", message: "确定踢出该会话？" });
    if (!ok) return;
    try { await revokeSession(inst, s.id); await refresh(); } catch(e: any) { setError(e.message); }
  }

  return (
    <NavigationStack>
      <List navigationTitle={"会话管理"}
        toolbar={{ cancellationAction: <Button title={"完成"} action={dismiss} /> }}>
        {loading ? <Section><Text foregroundStyle={"secondaryLabel"}>加载中…</Text></Section>
        : error ? <Section><Text foregroundStyle={"systemRed"}>{error}</Text></Section>
        : sessions.length === 0 ? (
          <Section><HStack><Image systemName={"rectangle.badge.person.crop"} foregroundStyle={"tertiaryLabel"} />
            <Text foregroundStyle={"secondaryLabel"}>暂无会话</Text><Spacer /></HStack></Section>
        ) : (
          <Section header={<Text>{sessions.length} 个会话</Text>}
            footer={<Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>左滑可踢出非当前会话。</Text>}>
            {sessions.map(s => (
              <VStack key={s.id} alignment={"leading"} spacing={1} padding={{ vertical: 3 }}
                trailingSwipeActions={s.current ? undefined : { allowsFullSwipe: false, actions: [
                  <Button title={"踢出"} role={"destructive"} action={() => confirmRevoke(s)} />,
                ]}}>
                <HStack>
                  {s.current
                    ? <Image systemName={"person.fill.checkmark"} foregroundStyle={"systemGreen"} />
                    : <Image systemName={"person"} foregroundStyle={"systemGray"} />}
                  <Text>{s.userAgent ? s.userAgent.split(" ")[0] : "未知"}</Text>
                  <Spacer />
                  {s.ip ? <Text font={"caption"} foregroundStyle={"secondaryLabel"}>{s.ip}</Text> : null}
                  {s.current ? <Text font={"caption"} foregroundStyle={"systemGreen"}>当前</Text> : null}
                </HStack>
              </VStack>
            ))}
          </Section>
        )}
      </List>
    </NavigationStack>
  );
}
