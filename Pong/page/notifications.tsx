// ============================================================================
// Notification channels management (Nezha). List / toggle / add-edit / delete
// notification providers. Read-only site settings shown alongside.
// S: Single Purpose — notification channel CRUD; I/O via server facade.
// ============================================================================
import {
  Button,
  Dialog,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useState,
} from "scripting";
import { useMonitor } from "../context/Monitor";
import {
  listNotifications,
  saveNotification,
  deleteNotification,
} from "../class/server";
import type { NotificationChannel, Instance } from "../class/types";

export function View() {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor();
  const inst = monitor.instance.value;
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  async function refresh() {
    if (!inst) return;
    setLoading(true);
    setError("");
    try {
      setChannels(await listNotifications(inst));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function openEditor(ch?: NotificationChannel) {
    if (!inst) return;
    await Navigation.present({
      element: <NotificationEditor instance={inst} channel={ch} onSaved={refresh} />,
    });
  }

  async function confirmDelete(ch: NotificationChannel) {
    if (!inst) return;
    const ok = await Dialog.confirm({
      title: "删除通知渠道",
      message: `确定删除「${ch.name}」？此操作不可撤销。`,
    });
    if (!ok) return;
    try {
      await deleteNotification(inst, ch.id);
      await refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={"通知渠道"}
        toolbar={{
          cancellationAction: <Button title={"完成"} action={dismiss} />,
          topBarTrailing: (
            <Button title={"新建"} systemImage={"plus"} action={() => openEditor()} />
          ),
        }}
      >
        {loading ? (
          <Section><Text foregroundStyle={"secondaryLabel"}>加载中…</Text></Section>
        ) : error ? (
          <Section><Text foregroundStyle={"systemRed"}>{error}</Text></Section>
        ) : channels.length === 0 ? (
          <Section footer={<Text>新建通知渠道以接收告警推送（Telegram / Webhook 等）。</Text>}>
            <HStack><Image systemName={"bell.slash"} foregroundStyle={"tertiaryLabel"} /><Text foregroundStyle={"secondaryLabel"}>暂无通知渠道</Text><Spacer /></HStack>
          </Section>
        ) : (
          <Section header={<Text>{channels.length} 个渠道</Text>}>
            {channels.map((c) => (
              <VStack
                key={`${c.id}`}
                alignment={"leading"}
                spacing={2}
                padding={{ vertical: 3 }}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button title={"删除"} role={"destructive"} action={() => confirmDelete(c)} />,
                    <Button title={"编辑"} action={() => openEditor(c)} />,
                  ],
                }}
              >
                <HStack>
                  <Image systemName={"bell.and.waves.left.and.right"} foregroundStyle={"systemGreen"} />
                  <Text font={"headline"} lineLimit={1}>{c.name || `渠道 #${c.id}`}</Text>
                  <Spacer />
                  <Text font={"caption"} foregroundStyle={"secondaryLabel"}>{c.requestMethod === 2 ? "GET" : "POST"}</Text>
                </HStack>
                {c.url ? <Text font={"caption"} foregroundStyle={"tertiaryLabel"} lineLimit={1}>{c.url}</Text> : null}
              </VStack>
            ))}
          </Section>
        )}
      </List>
    </NavigationStack>
  );
}

function NotificationEditor({
  instance, channel, onSaved,
}: {
  instance: Instance;
  channel?: NotificationChannel;
  onSaved: () => Promise<void> | void;
}) {
  const dismiss = Navigation.useDismiss();
  const [name, setName] = useState<string>(channel?.name ?? "");
  const [url, setUrl] = useState<string>(channel?.url ?? "");
  const [method, setMethod] = useState<number>(channel?.requestMethod ?? 1);
  const [body, setBody] = useState<string>(channel?.requestBody ?? "");
  const [skipCheck, setSkipCheck] = useState<boolean>(channel?.skipCheck ?? false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    if (!name.trim()) { setMsg("请填写名称"); return; }
    if (!url.trim()) { setMsg("请填写 Webhook URL"); return; }
    setBusy(true);
    setMsg("保存中…");
    try {
      await saveNotification(instance, {
        id: channel?.id ?? 0,
        name: name.trim(),
        url: url.trim(),
        requestMethod: method,
        requestBody: body,
        skipCheck,
      });
      setBusy(false);
      dismiss();
      await onSaved();
    } catch (e: any) {
      setBusy(false);
      setMsg(`保存失败：${e?.message || String(e)}`);
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={channel ? "编辑渠道" : "新建渠道"}
        toolbar={{
          cancellationAction: <Button title={"取消"} action={dismiss} />,
          confirmationAction: <Button title={"保存"} disabled={busy || !name.trim() || !url.trim()} action={save} />,
        }}
      >
        <Section header={<Text>基本信息</Text>}>
          <TextField title={"名称"} prompt={"例如 Telegram"} value={name} onChanged={setName} />
          <TextField title={"Webhook URL"} prompt={"https://"} value={url} onChanged={setUrl} />
          <Toggle title={"跳过 TLS 验证"} value={skipCheck} onChanged={setSkipCheck} />
        </Section>
        <Section header={<Text>请求配置</Text>}>
          <TextField title={"请求体"} prompt={"JSON 模板（可选）"} value={body} onChanged={setBody} />
        </Section>
        {msg ? <Section><Text font={"footnote"} foregroundStyle={"secondaryLabel"}>{msg}</Text></Section> : null}
      </List>
    </NavigationStack>
  );
}
