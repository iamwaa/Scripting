// ============================================================================
// User management (Nezha). List users, create, delete. S: Single Purpose.
// ============================================================================
import {
  Button, Dialog, HStack, Image, List, Navigation, NavigationStack,
  Section, SecureField, Spacer, Text, TextField, VStack, useEffect, useState,
} from "scripting";
import { useMonitor } from "../context/Monitor";
import { listUsers, createUser, deleteUser } from "../class/server";
import type { ManagedUser, Instance } from "../class/types";

export function View() {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor(); const inst = monitor.instance.value;
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");

  async function refresh() { if (!inst) return; setLoading(true); setError("");
    try { setUsers(await listUsers(inst)); } catch(e: any) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, []);

  async function openCreator() {
    if (!inst) return;
    const u = await Dialog.prompt({ title: "新建用户", message: "输入用户名" });
    if (!u) return;
    const p = await Dialog.prompt({ title: "密码", message: `为 ${u} 设置密码`, inputIsSecure: true });
    if (!p) return;
    try { await createUser(inst, u.trim(), p); await refresh(); } catch(e: any) { setError(e.message); }
  }

  async function confirmDelete(u: ManagedUser) {
    if (!inst) return;
    const ok = await Dialog.confirm({ title: "删除用户", message: `确定删除 ${u.username}？` });
    if (!ok) return;
    try { await deleteUser(inst, u.id); await refresh(); } catch(e: any) { setError(e.message); }
  }

  return (
    <NavigationStack>
      <List navigationTitle={"用户管理"}
        toolbar={{ cancellationAction: <Button title={"完成"} action={dismiss} />,
          topBarTrailing: <Button title={"新建"} systemImage={"plus"} action={openCreator} /> }}>
        {loading ? <Section><Text foregroundStyle={"secondaryLabel"}>加载中…</Text></Section>
        : error ? <Section><Text foregroundStyle={"systemRed"}>{error}</Text></Section>
        : users.length === 0 ? (
          <Section><HStack><Image systemName={"person.slash"} foregroundStyle={"tertiaryLabel"} />
            <Text foregroundStyle={"secondaryLabel"}>暂无用户</Text><Spacer /></HStack></Section>
        ) : (
          <Section header={<Text>{users.length} 个用户</Text>}>
            {users.map(u => (
              <VStack key={u.id} alignment={"leading"} spacing={1} padding={{ vertical: 3 }}
                trailingSwipeActions={{ allowsFullSwipe: false, actions: [
                  <Button title={"删除"} role={"destructive"} action={() => confirmDelete(u)} />,
                ]}}>
                <HStack>
                  <Image systemName={"person.circle"} foregroundStyle={"systemBlue"} />
                  <Text>{u.username}</Text>
                  <Spacer />
                  <Text font={"caption"} foregroundStyle={"secondaryLabel"}>{u.role === "admin" ? "管理员" : "用户"}</Text>
                </HStack>
              </VStack>
            ))}
          </Section>
        )}
      </List>
    </NavigationStack>
  );
}
