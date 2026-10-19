// ============================================================================
// Cron / scheduled task management (Nezha). List, create/edit, trigger, delete
// scheduled tasks. Also covers Nezha's "command execution" model: a cron with
// task_type=1 (trigger-only) + command + servers, then runCronTask() to fire
// it on demand. S: Single Purpose — cron CRUD + trigger; I/O via server.ts.
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
  listCronTasks,
  saveCronTask,
  deleteCronTask,
  runCronTask,
} from "../class/server";
import type { CronTask, Instance } from "../class/types";

export function View() {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor();
  const inst = monitor.instance.value;
  const [tasks, setTasks] = useState<CronTask[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  async function refresh() {
    if (!inst) return;
    setLoading(true);
    setError("");
    try { setTasks(await listCronTasks(inst)); } catch (e: any) { setError(e.message || String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  async function openEditor(t?: CronTask) {
    if (!inst) return;
    await Navigation.present({ element: <CronEditor instance={inst} task={t} onSaved={refresh} /> });
  }

  async function confirmDelete(t: CronTask) {
    if (!inst) return;
    const ok = await Dialog.confirm({ title: "删除计划任务", message: `确定删除「${t.name}」？` });
    if (!ok) return;
    try { await deleteCronTask(inst, t.id); await refresh(); } catch (e: any) { setError(e.message); }
  }

  async function triggerNow(t: CronTask) {
    if (!inst) return;
    try {
      await runCronTask(inst, t.id);
      await refresh();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <NavigationStack>
      <List navigationTitle={"计划任务"}
        toolbar={{ cancellationAction: <Button title={"完成"} action={dismiss} />,
          topBarTrailing: <Button title={"新建"} systemImage={"plus"} action={() => openEditor()} /> }}>
        {loading ? <Section><Text foregroundStyle={"secondaryLabel"}>加载中…</Text></Section>
        : error ? <Section><Text foregroundStyle={"systemRed"}>{error}</Text></Section>
        : tasks.length === 0 ? (
          <Section footer={<Text>新建计划任务以定时或在面板上触发命令执行。</Text>}>
            <HStack><Image systemName={"clock"} foregroundStyle={"tertiaryLabel"} />
            <Text foregroundStyle={"secondaryLabel"}>暂无计划任务</Text><Spacer /></HStack>
          </Section>
        ) : (
          <Section header={<Text>{tasks.length} 个任务</Text>}>
            {tasks.map(t => (
              <VStack key={`${t.id}`} alignment={"leading"} spacing={2} padding={{ vertical: 3 }}
                leadingSwipeActions={{ allowsFullSwipe: false, actions: [
                  <Button title={"执行"} systemImage={"play"} action={() => triggerNow(t)} />,
                ]}}
                trailingSwipeActions={{ allowsFullSwipe: false, actions: [
                  <Button title={"删除"} role={"destructive"} action={() => confirmDelete(t)} />,
                  <Button title={"编辑"} action={() => openEditor(t)} />,
                ]}}>
                <HStack>
                  <Image systemName={t.taskType === 1 ? "bolt.fill" : "clock.arrow.circlepath"}
                    foregroundStyle={t.taskType === 1 ? "systemOrange" : "systemBlue"} />
                  <Text font={"headline"} lineLimit={1}>{t.name}</Text>
                  <Spacer />
                  <Text font={"caption"} foregroundStyle={"secondaryLabel"}>
                    {t.scheduler ? t.scheduler : "手动触发"}</Text>
                </HStack>
                {t.command ? <Text font={"caption"} foregroundStyle={"tertiaryLabel"} lineLimit={2}>{t.command}</Text> : null}
                {t.lastResult ? <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>上次：{t.lastResult}</Text> : null}
              </VStack>
            ))}
          </Section>
        )}
      </List>
    </NavigationStack>
  );
}

function CronEditor({ instance, task, onSaved }: {
  instance: Instance; task?: CronTask; onSaved: () => Promise<void> | void;
}) {
  const dismiss = Navigation.useDismiss();
  const [name, setName] = useState(task?.name ?? "");
  const [command, setCommand] = useState(task?.command ?? "");
  const [taskType, setTaskType] = useState<number>(task?.taskType ?? 0);
  const [scheduler, setScheduler] = useState(task?.scheduler ?? "");
  const [servers, setServers] = useState<string>((task?.servers ?? []).join(","));
  const [cover, setCover] = useState<number>(task?.cover ?? 0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    if (!name.trim()) { setMsg("请填写名称"); return; }
    setBusy(true); setMsg("保存中…");
    try {
      await saveCronTask(instance, {
        id: task?.id ?? 0, name: name.trim(), command: command.trim(),
        scheduler: taskType === 1 ? "" : scheduler,
        taskType, cover, pushSuccessful: false, notificationGroupId: 0,
        servers: servers.split(",").map(s => parseInt(s.trim(),10)).filter(n => isFinite(n)),
      });
      setBusy(false); dismiss(); await onSaved();
    } catch (e: any) { setBusy(false); setMsg(`保存失败：${e.message || String(e)}`); }
  }

  return (
    <NavigationStack>
      <List navigationTitle={task ? "编辑任务" : "新建任务"}
        toolbar={{ cancellationAction: <Button title={"取消"} action={dismiss} />,
          confirmationAction: <Button title={"保存"} disabled={busy||!name.trim()} action={save} /> }}>
        <Section header={<Text>基本</Text>}>
          <TextField title={"名称"} prompt={"任务名称"} value={name} onChanged={setName} />
          <Toggle title={"定时执行"} value={taskType === 0} onChanged={v => setTaskType(v ? 0 : 1)} />
          {taskType === 0 ? (
            <TextField title={"Cron"} prompt={"如 0 0 * * *"} value={scheduler} onChanged={setScheduler} />
          ) : null}
        </Section>
        <Section header={<Text>命令</Text>}>
          <TextField title={"命令"} prompt={"shell 命令"} value={command} onChanged={setCommand} />
        </Section>
        <Section header={<Text>目标</Text>}>
          <TextField title={"服务器 ID"} prompt={"用逗号分隔"} value={servers} onChanged={setServers} />
          <Toggle title={"覆盖模式"} value={cover === 0} onChanged={v => setCover(v ? 0 : 1)} />
          <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
            {cover === 0 ? "对全部服务器执行，排除右侧列表" : "仅对右侧列表中的服务器执行"}
          </Text>
        </Section>
        {msg ? <Section><Text font={"footnote"} foregroundStyle={"secondaryLabel"}>{msg}</Text></Section> : null}
      </List>
    </NavigationStack>
  );
}
