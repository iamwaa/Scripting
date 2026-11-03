// ============================================================================
// 节点更新配置 — 为「某一台 VPS」填写 SSH 连接信息。
// Telegram 通知已拆到 page/notify.tsx（按机器存，可与更新设置分开改）。
// 空窗期/开关/频率属于升级策略，在 page/update.tsx 的「自动更新」分组里改。
// S: 一个节点的 SSH 配置表单（新建 / 编辑 / 删除），带「测试连接」。
// ============================================================================
import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  SecureField,
  Text,
  TextField,
  Toggle,
  useEffect,
  useObservable,
} from "scripting";
import type { Color, PresentationDetent } from "scripting";
import {
  getDefaultKeyPath,
  getDefaultUser,
  getNodeUpdateConfig,
  keyFileExists,
  normalizeHost,
  normalizeUser,
  setNodeUpdateConfig,
  testConnection,
  type UpdateConfig,
} from "../class/update";

const DIM: Color = "secondaryLabel";
const GOOD: Color = "systemGreen";
const BAD: Color = "systemRed";

function FormRow({
  label,
  value,
  prompt,
  onChanged,
  secure = false,
  labelWidth = 96,
  keyboardType,
}: {
  label: string;
  value: string;
  prompt?: string;
  onChanged: (v: string) => void;
  secure?: boolean;
  labelWidth?: number;
  keyboardType?: "numberPad" | "URL" | "default" | "numbersAndPunctuation";
}) {
  // label 保留给无障碍朗读；prompt 兜底一个空格，避免字段标签显示两次
  const props = {
    label: <Text>{label}</Text>,
    value,
    prompt: prompt ?? " ",
    onChanged,
    keyboardType: keyboardType as any,
  };
  return (
    <HStack alignment={"center"} spacing={12} frame={{ maxWidth: Infinity }}>
      <Text font={16} frame={{ width: labelWidth, alignment: "leading" }}>
        {label}
      </Text>
      {secure ? <SecureField {...props} /> : <TextField {...props} />}
      {value.length > 0 ? (
        <Button action={() => onChanged("")} buttonStyle={"plain"}>
          <Image systemName={"xmark.circle.fill"} font={15} foregroundStyle={DIM} />
        </Button>
      ) : null}
    </HStack>
  );
}

/** 保存后的节点配置（null 表示已删除） */
export type SaveResult = UpdateConfig | null;

export function View({
  instanceId,
  nodeUuid,
  nodeName,
  onSaved,
  presentationDetents,
  onClose,
}: {
  instanceId: string;
  nodeUuid: string;
  nodeName: string;
  onSaved?: (cfg: SaveResult) => void;
  presentationDetents?: PresentationDetent[];
  onClose?: () => void;
}) {
  const dismissNav = Navigation.useDismiss();
  // 优先用父级回调关闭 sheet（与更新面板一致），没有则回退到导航 dismiss
  const dismiss = () => (onClose ? onClose() : dismissNav());
  const existing = getNodeUpdateConfig(instanceId, nodeUuid);

  const host = useObservable<string>(existing?.host ?? "");
  const port = useObservable<string>(String(existing?.port ?? 22));
  const user = useObservable<string>(existing?.user ?? getDefaultUser());
  const keyPath = useObservable<string>(existing?.keyPath ?? getDefaultKeyPath());
  const password = useObservable<string>("");
  /** 传输方式：ssh = SSHClient（密钥/密码）；cli = 系统 ssh（无密钥网关） */
  const transport = useObservable<string>(existing?.transport ?? "ssh");
  /** 非 root 账号需要 sudo -n 提权才能跑 /root/bin/sg-update */
  const sudoOn = useObservable<boolean>(existing?.sudo ?? false);

  const busy = useObservable<boolean>(false);
  const message = useObservable<string>("");
  const messageOk = useObservable<boolean>(false);
  const keyMissing = useObservable<boolean>(false);

  // 挂载时：检查私钥是否存在（cli 通道不需要）
  useEffect(() => {
    void (async () => {
      if (transport.value === "cli") {
        keyMissing.setValue(false);
        return;
      }
      keyMissing.setValue(!(await keyFileExists(keyPath.value)));
    })();
    // 只在挂载时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function build(): UpdateConfig | null {
    // 主机/账号框里可能被粘进了 `user@host`、`Hostname` 标签或整行（复制 SSH 连接信息时的常见误填）
    const hostNorm = normalizeHost(host.value);
    const userNorm = normalizeUser(user.value);
    const h = hostNorm.host || userNorm.host || "";
    if (!h) return null;
    const cfg: UpdateConfig = {
      host: h,
      port: Number(port.value.trim()) || 22,
      // 粘贴的 `user@host` 里的用户名最可信，其次才是输入框
      user: hostNorm.user || userNorm.user || "root",
      transport: transport.value === "cli" ? "cli" : "ssh",
    };
    if (sudoOn.value) cfg.sudo = true;
    // cli 通道不存私钥/密码（服务端不校验它们）
    if (cfg.transport === "ssh") {
      cfg.keyPath = keyPath.value.trim();
      const pwd = password.value.trim() || existing?.password;
      if (pwd) cfg.password = pwd;
    }
    return cfg;
  }

  /** 保存：只写本机配置（通知已拆到独立的 page/notify.tsx） */
  function save() {
    const cfg = build();
    if (!cfg) {
      messageOk.setValue(false);
      message.setValue("请先填写 SSH 主机地址");
      return;
    }
    setNodeUpdateConfig(instanceId, nodeUuid, cfg);
    onSaved?.(cfg);
    dismiss();
  }

  async function test() {
    const cfg = build();
    if (!cfg) {
      messageOk.setValue(false);
      message.setValue("请先填写 SSH 主机地址");
      return;
    }
    busy.setValue(true);
    message.setValue("正在连接…");
    try {
      const r = await testConnection(cfg);
      messageOk.setValue(r.ok);
      if (r.ok) {
        message.setValue(
          `${r.message} · magpie v${r.state?.magpie_version || "未安装"} · cf-probe v${r.state?.probe_version || "未安装"}`,
        );
      } else {
        message.setValue(r.needInstall ? r.message : `连接失败：${r.message}`);
      }
      busy.setValue(false);
      return;
    } catch (e) {
      messageOk.setValue(false);
      message.setValue(`连接失败：${e}`);
    } finally {
      busy.setValue(false);
    }
  }

  async function remove() {
    const ok = await Dialog.confirm({
      title: "删除更新配置",
      message: `删除「${nodeName}」的服务器更新配置？之后该节点不再显示更新入口。`,
      confirmLabel: "删除",
    });
    if (ok !== true) return;
    setNodeUpdateConfig(instanceId, nodeUuid, null);
    onSaved?.(null);
    dismiss();
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={`更新 · ${nodeName}`}
        navigationBarTitleDisplayMode={"inline"}
        presentationDetents={presentationDetents}
        toolbar={{
          cancellationAction: [<Button title={"取消"} action={dismiss} />],
          confirmationAction: [<Button title={"保存"} action={save} />],
        }}
      >
        <Section
          header={<Text font={13}>SSH 连接</Text>}
          footer={
            <Text font={12} foregroundStyle={DIM}>
              {transport.value === "cli"
                ? "无密钥网关：服务端用 none 认证，只校验用户名（公钥/密码都会被拒）。需要本机系统 ssh 可用；账号不是 root 时打开下面的 sudo 提权。"
                : "这台 VPS 上需要有 /root/bin/sg-update。私钥路径相对 App 的 Documents 目录，留空则不用密钥；下面的密码是备选。"}
            </Text>
          }
        >
          <Picker
            title="登录方式"
            value={transport.value}
            onChanged={(v: string) => {
              transport.setValue(v);
              keyMissing.setValue(false);
            }}
          >
            <Text tag={"ssh"}>SSH 密钥 / 密码</Text>
            <Text tag={"cli"}>无密钥网关</Text>
          </Picker>
          <FormRow
            label="主机"
            value={host.value}
            prompt="IP 或域名"
            onChanged={(v) => host.setValue(v)}
          />
          <FormRow
            label="端口"
            value={port.value}
            prompt="22"
            keyboardType={"numberPad"}
            onChanged={(v) => port.setValue(v)}
          />
          <FormRow label="账号" value={user.value} prompt="root" onChanged={(v) => user.setValue(v)} />
          {transport.value === "ssh" ? (
            <>
              <FormRow
                label="私钥路径"
                value={keyPath.value}
                prompt="留空则用密码"
                onChanged={(v) => {
                  keyPath.setValue(v);
                  keyMissing.setValue(false);
                }}
              />
              {keyMissing.value ? (
                <Text font={12} foregroundStyle={"systemOrange"}>
                  没找到这个私钥文件，请填下面的密码，或修正路径。
                </Text>
              ) : null}
              <FormRow
                label="密码"
                value={password.value}
                prompt={existing?.password ? "已保存，留空不修改" : "没有私钥时填写"}
                secure={true}
                onChanged={(v) => password.setValue(v)}
              />
            </>
          ) : (
            <Toggle
              title="sudo 提权"
              value={sudoOn.value}
              onChanged={(v: boolean) => sudoOn.setValue(v)}
            />
          )}
          <Button title="测试连接" action={test} disabled={busy.value} />
          {message.value ? (
            <Text font={14} foregroundStyle={messageOk.value ? GOOD : BAD}>
              {message.value}
            </Text>
          ) : null}
        </Section>

        {existing ? (
          <Section>
            <Button title="删除更新配置" tint={BAD} action={remove} />
          </Section>
        ) : null}
      </List>
    </NavigationStack>
  );
}
