// ============================================================================
// API Tokens management (Nezha). List, create (with token display once), delete.
// S: Single Purpose — token CRUD; I/O via server.ts.
// ============================================================================
import {
  Button, Dialog, HStack, Image, List, Navigation, NavigationStack, Pasteboard,
  Section, Spacer, Text, TextField, VStack, useEffect, useState,
} from "scripting";
import { useMonitor } from "../context/Monitor";
import { listApiTokens, createApiToken, deleteApiToken } from "../class/server";
import type { ApiToken, Instance } from "../class/types";

export function View() {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor(); const inst = monitor.instance.value;
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");

  async function refresh() { if (!inst) return; setLoading(true); setError("");
    try { setTokens(await listApiTokens(inst)); } catch(e: any) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, []);

  async function openCreator() {
    if (!inst) return;
    const note = await Dialog.prompt({ title: "新建 Token", message: "输入备注名" });
    if (!note) return;
    try {
      const created = await createApiToken(inst, note.trim());
      await refresh();
      if (created?.token) {
        try { Pasteboard.setString(created.token); } catch {}
        await Dialog.alert({ title: "Token 已创建", message: `Token: ${created.token}\n\n已复制到剪贴板。关闭后无法再次查看明文。` });
      }
    } catch(e: any) { setError(e.message); }
  }

  async function confirmDelete(t: ApiToken) {
    if (!inst) return;
    const ok = await Dialog.confirm({ title: "删除 Token", message: `确定删除 "${t.note || t.token}"？` });
    if (!ok) return;
    try { await deleteApiToken(inst, t.id); await refresh(); } catch(e: any) { setError(e.message); }
  }

  return (
    <NavigationStack>
      <List navigationTitle={"API Tokens"}
        toolbar={{ cancellationAction: <Button title={"完成"} action={dismiss} />,
          topBarTrailing: <Button title={"新建"} systemImage={"plus"} action={openCreator} /> }}>
        {loading ? <Section><Text foregroundStyle={"secondaryLabel"}>加载中…</Text></Section>
        : error ? <Section><Text foregroundStyle={"systemRed"}>{error}</Text></Section>
        : tokens.length === 0 ? (
          <Section><HStack><Image systemName={"key.slash"} foregroundStyle={"tertiaryLabel"} />
            <Text foregroundStyle={"secondaryLabel"}>暂无 API Token</Text><Spacer /></HStack></Section>
        ) : (
          <Section header={<Text>{tokens.length} 个 Token</Text>}
            footer={<Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>明文 Token 仅在创建时显示一次。</Text>}>
            {tokens.map(t => (
              <VStack key={t.id} alignment={"leading"} spacing={1} padding={{ vertical: 3 }}
                trailingSwipeActions={{ allowsFullSwipe: false, actions: [
                  <Button title={"删除"} role={"destructive"} action={() => confirmDelete(t)} />,
                ]}}>
                <HStack>
                  <Image systemName={"key.horizontal"} foregroundStyle={"systemPurple"} />
                  <Text>{t.note || `Token #${t.id}`}</Text>
                  <Spacer />
                  {t.createdAt ? <Text font={"caption"} foregroundStyle={"secondaryLabel"}>{t.createdAt}</Text> : null}
                </HStack>
              </VStack>
            ))}
          </Section>
        )}
      </List>
    </NavigationStack>
  );
}
