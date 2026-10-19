// ============================================================================
// Ad-hoc command execution (Komari). Run a shell command on one or more
// selected nodes and view per-node results. S: Single Purpose — exec + result
// display; I/O via server.ts. ============================================================================
import {
  Button, Dialog, HStack, Image, List, Navigation, NavigationStack,
  Section, Spacer, Text, TextField, VStack, useEffect, useState,
} from "scripting";
import { useMonitor } from "../context/Monitor";
import { execCommand, fetchExecResult } from "../class/server";
import type { Instance } from "../class/types";

export function View() {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor(); const inst = monitor.instance.value;
  const nodes = monitor.nodes.value;
  const [command, setCommand] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [taskId, setTaskId] = useState("");
  const [results, setResults] = useState<{ uuid: string; ok: boolean; output: string }[]>([]);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");

  function toggleNode(uuid: string) {
    const prev = selected;
    const next = prev.includes(uuid) ? prev.filter(u => u !== uuid) : [...prev, uuid];
    setSelected(next);
  }

  async function run() {
    if (!inst || !command.trim()) return;
    if (selected.length === 0) { setMsg("请选择至少一个节点"); return; }
    setBusy(true); setMsg("下发中…");
    try {
      const r = await execCommand(inst, command.trim(), selected);
      setTaskId(r.taskId || "");
      setMsg(r.message || "命令已下发");
      if (r.taskId) {
        // Best-effort immediate poll for results.
        setTimeout(async () => {
          try {
            const rs = await fetchExecResult(inst, r.taskId);
            setResults(rs);
          } catch {}
        }, 2000);
      }
    } catch(e: any) { setMsg(`执行失败：${e.message}`); }
    finally { setBusy(false); }
  }

  async function pollResults() {
    if (!inst || !taskId) return;
    try {
      const rs = await fetchExecResult(inst, taskId);
      setResults(rs);
      setMsg(`已获取 ${rs.length} 条结果`);
    } catch(e: any) { setMsg(`拉取结果失败：${e.message}`); }
  }

  return (
    <NavigationStack>
      <List navigationTitle={"命令执行"}
        toolbar={{ cancellationAction: <Button title={"完成"} action={dismiss} /> }}>
        <Section header={<Text>命令</Text>}>
          <TextField title={"命令"} prompt={"ls -la /"} value={command} onChanged={setCommand} />
          <Button action={run} disabled={busy || !command.trim()}>
            <HStack spacing={6}>
              <Image systemName={busy ? "arrow.triangle.2.circlepath" : "play.fill"} />
              <Text>{busy ? "执行中…" : `在 ${selected.length} 台节点上执行`}</Text>
            </HStack>
          </Button>
        </Section>

        <Section header={<Text>目标节点</Text>}>
          {nodes.length === 0
            ? <Text foregroundStyle={"secondaryLabel"}>暂无节点</Text>
            : nodes.map(n => (
                <Button key={n.uuid} action={() => toggleNode(n.uuid)}>
                  <HStack>
                    <Image systemName={selected.includes(n.uuid) ? "checkmark.circle.fill" : "circle"}
                      foregroundStyle={selected.includes(n.uuid) ? "systemBlue" : "systemGray"} />
                    <Text>{n.name}</Text>
                    <Spacer />
                  </HStack>
                </Button>
              ))}
        </Section>

        {msg ? <Section><Text>{msg}</Text></Section> : null}

        {taskId ? (
          <Section header={<Text>结果</Text>}>
            <Button action={pollResults}><Text>刷新结果</Text></Button>
            {results.map(r => (
              <VStack key={r.uuid} alignment={"leading"} spacing={2} padding={{ vertical: 2 }}>
                <HStack>
                  <Image systemName={r.ok ? "checkmark.circle" : "xmark.circle"}
                    foregroundStyle={r.ok ? "systemGreen" : "systemRed"} />
                  <Text>{r.uuid}</Text>
                  <Spacer />
                </HStack>
                {r.output ? <Text font={"caption"} fontDesign={"monospaced"}>{r.output}</Text> : null}
              </VStack>
            ))}
          </Section>
        ) : null}
      </List>
    </NavigationStack>
  );
}
