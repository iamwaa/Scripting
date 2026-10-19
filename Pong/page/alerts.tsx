// ============================================================================
// Alert rules management (Nezha). List / toggle / delete / add-edit alert
// rules. S: Single Purpose — alert-rule CRUD UI; all I/O via server facade.
// Writes hit the live panel; destructive ops confirm first.
// ============================================================================
import {
  Button,
  Dialog,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Picker,
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
  listAlertRules,
  saveAlertRule,
  deleteAlertRule,
} from "../class/server";
import type { AlertRule, AlertRuleCond, Instance } from "../class/types";

/** Human labels for the common Nezha rule metric types. */
const RULE_TYPES: { value: string; label: string }[] = [
  { value: "cpu", label: "CPU 使用率 %" },
  { value: "memory", label: "内存使用率 %" },
  { value: "swap", label: "交换使用率 %" },
  { value: "disk", label: "磁盘使用率 %" },
  { value: "net_in_speed", label: "下行速率" },
  { value: "net_out_speed", label: "上行速率" },
  { value: "net_all_speed", label: "总速率" },
  { value: "transfer_in_cycle", label: "周期入流量" },
  { value: "transfer_out_cycle", label: "周期出流量" },
  { value: "offline", label: "离线" },
  { value: "load1", label: "1 分钟负载" },
  { value: "tcp_conn_count", label: "TCP 连接数" },
];

function ruleTypeLabel(t: string): string {
  return RULE_TYPES.find((r) => r.value === t)?.label ?? t;
}

/** Short summary of a rule's conditions for the list row. */
function condSummary(conds: AlertRuleCond[]): string {
  if (!conds.length) return "无条件";
  return conds
    .map((c) => {
      const parts: string[] = [ruleTypeLabel(c.type)];
      if (c.min != null) parts.push(`≥${c.min}`);
      if (c.max != null) parts.push(`≤${c.max}`);
      if (c.duration != null) parts.push(`${c.duration}s`);
      return parts.join(" ");
    })
    .join("，");
}

export function View() {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor();
  const inst = monitor.instance.value;
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  async function refresh() {
    if (!inst) return;
    setLoading(true);
    setError("");
    try {
      setRules(await listAlertRules(inst));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function openEditor(rule?: AlertRule) {
    if (!inst) return;
    await Navigation.present({
      element: <AlertRuleEditor instance={inst} rule={rule} onSaved={refresh} />,
    });
  }

  async function confirmDelete(rule: AlertRule) {
    if (!inst) return;
    const ok = await Dialog.confirm({
      title: "删除告警规则",
      message: `确定删除「${rule.name}」？此操作不可撤销。`,
    });
    if (!ok) return;
    try {
      await deleteAlertRule(inst, rule.id);
      await refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function toggleEnabled(rule: AlertRule) {
    if (!inst) return;
    try {
      await saveAlertRule(inst, { ...rule, enabled: !rule.enabled });
      await refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={"告警规则"}
        toolbar={{
          cancellationAction: <Button title={"完成"} action={dismiss} />,
          topBarTrailing: (
            <Button title={"新建"} systemImage={"plus"} action={() => openEditor()} />
          ),
        }}
      >
        {loading ? (
          <Section>
            <Text foregroundStyle={"secondaryLabel"}>加载中…</Text>
          </Section>
        ) : error ? (
          <Section>
            <Text foregroundStyle={"systemRed"}>{error}</Text>
          </Section>
        ) : rules.length === 0 ? (
          <Section footer={<Text>新建规则以监控 CPU、内存、离线等指标并触发通知。</Text>}>
            <HStack>
              <Image systemName={"bell.badge"} foregroundStyle={"tertiaryLabel"} />
              <Text foregroundStyle={"secondaryLabel"}>暂无告警规则</Text>
              <Spacer />
            </HStack>
          </Section>
        ) : (
          <Section header={<Text>{rules.length} 条规则</Text>}>
            {rules.map((r) => (
              <VStack
                key={`${r.id}`}
                alignment={"leading"}
                spacing={3}
                padding={{ vertical: 4 }}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button title={"删除"} role={"destructive"} action={() => confirmDelete(r)} />,
                    <Button title={"编辑"} action={() => openEditor(r)} />,
                  ],
                }}
              >
                <HStack>
                  <Image
                    systemName={r.enabled ? "bell.fill" : "bell.slash"}
                    foregroundStyle={r.enabled ? "systemGreen" : "systemGray"}
                  />
                  <Text font={"headline"} lineLimit={1}>
                    {r.name || `规则 #${r.id}`}
                  </Text>
                  <Spacer />
                  <Toggle value={r.enabled} onChanged={() => toggleEnabled(r)} />
                </HStack>
                <Text font={"caption"} foregroundStyle={"secondaryLabel"}>
                  {condSummary(r.rules)}
                </Text>
              </VStack>
            ))}
          </Section>
        )}
      </List>
    </NavigationStack>
  );
}

/** Add / edit a single alert rule. Supports one or more simple conditions. */
function AlertRuleEditor({
  instance,
  rule,
  onSaved,
}: {
  instance: Instance;
  rule?: AlertRule;
  onSaved: () => Promise<void> | void;
}) {
  const dismiss = Navigation.useDismiss();
  const [name, setName] = useState<string>(rule?.name ?? "");
  const [enabled, setEnabled] = useState<boolean>(rule?.enabled ?? true);
  const [triggerMode, setTriggerMode] = useState<number>(rule?.triggerMode ?? 0);
  const [ngId, setNgId] = useState<string>(String(rule?.notificationGroupId ?? 0));
  const [conds, setConds] = useState<AlertRuleCond[]>(
    rule?.rules?.length ? rule.rules : [{ type: "cpu", max: 90, duration: 10, cover: 0 }],
  );
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  function updateCond(i: number, patch: Partial<AlertRuleCond>) {
    setConds(conds.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addCond() {
    setConds([...conds, { type: "memory", max: 90, duration: 10, cover: 0 }]);
  }
  function removeCond(i: number) {
    setConds(conds.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!name.trim()) {
      setMsg("请填写规则名称");
      return;
    }
    if (conds.length === 0) {
      setMsg("至少需要一个条件");
      return;
    }
    setBusy(true);
    setMsg("保存中…");
    const payload: AlertRule = {
      id: rule?.id ?? 0,
      name: name.trim(),
      enabled,
      triggerMode,
      notificationGroupId: parseInt(ngId, 10) || 0,
      rules: conds.map((c) => ({
        type: c.type,
        max: c.max,
        min: c.min,
        // Nezha requires duration >= 3 for non-transfer rules.
        duration: c.type.startsWith("transfer") ? undefined : Math.max(3, c.duration ?? 10),
        cover: c.cover ?? 0,
      })),
    };
    try {
      await saveAlertRule(instance, payload);
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
        navigationTitle={rule ? "编辑规则" : "新建规则"}
        toolbar={{
          cancellationAction: <Button title={"取消"} action={dismiss} />,
          confirmationAction: (
            <Button title={"保存"} disabled={busy || !name.trim()} action={save} />
          ),
        }}
      >
        <Section header={<Text>基本</Text>}>
          <TextField title={"名称"} prompt={"规则名称"} value={name} onChanged={setName} />
          <Toggle title={"启用"} value={enabled} onChanged={setEnabled} />
          <Picker title={"触发模式"} value={triggerMode} onChanged={setTriggerMode} pickerStyle={"menu"}>
            <Text tag={0}>持续触发</Text>
            <Text tag={1}>单次触发</Text>
          </Picker>
          <TextField
            title={"通知组 ID"}
            prompt={"0 表示不通知"}
            value={ngId}
            onChanged={setNgId}
          />
        </Section>

        {conds.map((c, i) => (
          <Section
            key={`${i}`}
            header={<Text>条件 {i + 1}</Text>}
            footer={
              conds.length > 1 ? (
                <Button title={"移除此条件"} role={"destructive"} action={() => removeCond(i)} />
              ) : undefined
            }
          >
            <Picker
              title={"指标"}
              value={c.type}
              onChanged={(v: string) => updateCond(i, { type: v })}
              pickerStyle={"menu"}
            >
              {RULE_TYPES.map((rt) => (
                <Text key={rt.value} tag={rt.value}>
                  {rt.label}
                </Text>
              ))}
            </Picker>
            {c.type !== "offline" ? (
              <>
                <TextField
                  title={"上限 (max)"}
                  prompt={"超过则触发，留空忽略"}
                  value={c.max != null ? String(c.max) : ""}
                  onChanged={(v: string) =>
                    updateCond(i, { max: v.trim() === "" ? undefined : parseFloat(v) })
                  }
                />
                <TextField
                  title={"下限 (min)"}
                  prompt={"低于则触发，留空忽略"}
                  value={c.min != null ? String(c.min) : ""}
                  onChanged={(v: string) =>
                    updateCond(i, { min: v.trim() === "" ? undefined : parseFloat(v) })
                  }
                />
              </>
            ) : null}
            <TextField
              title={"持续 (秒)"}
              prompt={"至少 3 秒"}
              value={c.duration != null ? String(c.duration) : ""}
              onChanged={(v: string) =>
                updateCond(i, { duration: v.trim() === "" ? undefined : parseInt(v, 10) })
              }
            />
          </Section>
        ))}

        <Section>
          <Button action={addCond}>
            <HStack spacing={6}>
              <Image systemName={"plus.circle"} />
              <Text>添加条件</Text>
            </HStack>
          </Button>
        </Section>

        {msg ? (
          <Section>
            <Text font={"footnote"} foregroundStyle={"secondaryLabel"}>
              {msg}
            </Text>
          </Section>
        ) : null}
      </List>
    </NavigationStack>
  );
}
