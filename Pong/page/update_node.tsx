// ============================================================================
// 节点更新配置 — 为「某一台 VPS」填写 SSH 连接信息，顺带管理服务器侧的
// Telegram 通知（按机器存，不跟节点走）。
// 空窗期/开关/频率属于升级策略，在 page/update.tsx 的「自动更新」分组里改。
// S: 一个节点的配置表单（新建 / 编辑 / 删除），带「测试连接」「发测试通知」。
// ============================================================================
import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Section,
  SecureField,
  Text,
  TextField,
  useEffect,
  useObservable,
} from "scripting";
import type { Color, PresentationDetent } from "scripting";
import {
  getDefaultKeyPath,
  getDefaultUser,
  getNodeUpdateConfig,
  isUpdatable,
  keyFileExists,
  readSettings,
  sendTestNotification,
  setDefaultKeyPath,
  setDefaultUser,
  setNodeUpdateConfig,
  setOption,
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

type Baseline = { chat: string; bot: string };

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

  // 服务器侧设置：Telegram 通知（不跟节点走，按机器存）。
  // 空窗期与自动更新开关/频率属于升级策略，在 page/update.tsx 的「自动更新」分组里改。
  const tgChat = useObservable<string>("");
  const tgBot = useObservable<string>("");
  const tgToken = useObservable<string>("");
  const tgTokenSet = useObservable<boolean>(false);
  const settingsBusy = useObservable<boolean>(false);
  /** 服务器上一次读到的值（判“用户是否改过”的基准） */
  const baseline = useObservable<Baseline | null>(null);

  const busy = useObservable<boolean>(false);
  const message = useObservable<string>("");
  const messageOk = useObservable<boolean>(false);
  const keyMissing = useObservable<boolean>(false);

  // 挂载时：检查私钥是否存在；已有配置就连服务器拉一次 Telegram 配置
  useEffect(() => {
    void (async () => {
      keyMissing.setValue(!(await keyFileExists(keyPath.value)));
    })();
    if (isUpdatable(existing)) void loadSettings(existing);
    // 只在挂载时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function build(): UpdateConfig | null {
    const h = host.value.trim();
    if (!h) return null;
    const cfg: UpdateConfig = {
      host: h,
      port: Number(port.value.trim()) || 22,
      user: user.value.trim() || "root",
      keyPath: keyPath.value.trim(),
    };
    const pwd = password.value.trim() || existing?.password;
    if (pwd) cfg.password = pwd;
    return cfg;
  }

  /** 从服务器拉一次 Telegram 配置，用于回填与判改 */
  async function loadSettings(cfg?: UpdateConfig | null) {
    const target = cfg ?? build();
    if (!target) return;
    settingsBusy.setValue(true);
    try {
      const s = await readSettings(target);
      if (s) {
        tgChat.setValue(s.tg_chat);
        tgBot.setValue(s.tg_bot);
        tgTokenSet.setValue(s.tg_token_set);
        baseline.setValue({ chat: s.tg_chat, bot: s.tg_bot });
      }
    } catch {
      // 读不到就保持原样，用户仍可填完保存
    } finally {
      settingsBusy.setValue(false);
    }
  }

  /** 把与服务器不同的设置项下发；返回失败项描述 */
  async function pushSettings(cfg: UpdateConfig) {
    const fails: string[] = [];
    const cur: Baseline = { chat: tgChat.value.trim(), bot: tgBot.value.trim() };
    const base = baseline.value;

    // 有基线：只下发改过的（也允许主动清空）。
    // 无基线：只推用户明确填了的非空值——空字符串会把服务器上已有的通知配置抹掉
    //（往同一台服务器配第二个节点时最容易撞上）。
    const shouldPush = (k: keyof Baseline) => (base ? base[k] !== cur[k] : cur[k] !== "");

    const push = async (label: string, key: string, value: string) => {
      const r = await setOption(cfg, key, value);
      if (!r.ok) fails.push(`${label}：${(r.error ?? r.output).trim().slice(-80)}`);
    };

    if (shouldPush("chat")) await push("Telegram chat", "tg_chat", cur.chat);
    if (shouldPush("bot")) await push("Bot 用户名", "tg_bot", cur.bot);
    // token 只在填了新值时才覆盖；留空表示不动
    const tok = tgToken.value.trim();
    if (tok) await push("Bot Token", "tg_token", tok);

    // 下发成功部分归入基准，避免下次重复推
    if (fails.length === 0) baseline.setValue(cur);
    return fails;
  }

  function save() {
    const cfg = build();
    if (!cfg) {
      messageOk.setValue(false);
      message.setValue("请先填写 SSH 主机地址");
      return;
    }
    setNodeUpdateConfig(instanceId, nodeUuid, cfg);
    // 记住这台机器的私钥路径/账号，下次给别的节点预填
    setDefaultKeyPath(cfg.keyPath || "");
    setDefaultUser(cfg.user || "root");
    onSaved?.(cfg);

    // 服务器设置异步下发，失败时留在当前页提示
    busy.setValue(true);
    void (async () => {
      try {
        const fails = await pushSettings(cfg);
        busy.setValue(false);
        if (fails.length > 0) {
          messageOk.setValue(false);
          message.setValue(`配置已保存在本机，但服务器设置未生效：${fails.join("；")}`);
          return;
        }
        dismiss();
      } catch (e) {
        busy.setValue(false);
        messageOk.setValue(false);
        message.setValue(`配置已保存在本机，服务器设置下发失败：${e}`);
      }
    })();
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
      message.setValue(
        r.ok
          ? `连接成功 · magpie v${r.state?.magpie_version ?? "?"} · cf-probe v${r.state?.probe_version ?? "?"}`
          : `连接失败：${r.message}`,
      );
      busy.setValue(false);
      // 连上后读取服务器现有的 Telegram 设置
      if (r.ok) await loadSettings();
      return;
    } catch (e) {
      messageOk.setValue(false);
      message.setValue(`连接失败：${e}`);
    } finally {
      busy.setValue(false);
    }
  }

  /** 发一条测试通知（先确保当前填的已下发） */
  async function testNotify() {
    const cfg = build();
    if (!cfg) {
      messageOk.setValue(false);
      message.setValue("请先填写 SSH 主机地址");
      return;
    }
    settingsBusy.setValue(true);
    message.setValue("正在发送测试通知…");
    try {
      const fails = await pushSettings(cfg);
      if (fails.length > 0) {
        messageOk.setValue(false);
        message.setValue(`设置未生效：${fails.join("；")}`);
        return;
      }
      const r = await sendTestNotification(cfg);
      messageOk.setValue(r.ok);
      message.setValue(r.ok ? "测试通知已发送，请在 Telegram 查看" : `发送失败：${(r.error ?? r.output).trim().slice(-120)}`);
      tgToken.setValue("");
    } catch (e) {
      messageOk.setValue(false);
      message.setValue(`发送失败：${e}`);
    } finally {
      settingsBusy.setValue(false);
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
              这台 VPS 上需要有 /root/bin/sg-update。私钥路径相对 App 的 Documents 目录（默认 .ssh/id_ed12345；
              私钥读不到时才会用下面的密码。
            </Text>
          }
        >
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
          <FormRow
            label="私钥路径"
            value={keyPath.value}
            prompt=".ssh/id_ed12345"
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
          <Button title="测试连接" action={test} disabled={busy.value || settingsBusy.value} />
          {message.value ? (
            <Text font={14} foregroundStyle={messageOk.value ? GOOD : BAD}>
              {message.value}
            </Text>
          ) : null}
          
        </Section>

        <Section
          header={<Text font={13}>Telegram 通知（可选）</Text>}
          footer={
            <Text font={12} foregroundStyle={DIM}>
              自动升级成功/失败会推送到这个 chat。在 Telegram 里找 @BotFather 建 bot 拿 token，再给自己发一条消息，
              然后浏览器打开 api.telegram.org/bot【token】/getUpdates 拿 chat id（负数也要完整填写）。
              Token 只存服务器上一个 600 权限文件，不会写回手机。
            </Text>
          }
        >
          <FormRow
            label="Bot Token"
            value={tgToken.value}
            prompt={tgTokenSet.value ? "已配置，留空不修改" : "123456:ABC-DEF..."}
            secure={true}
            onChanged={(v) => tgToken.setValue(v)}
          />
          <FormRow
            label="Bot 用户名"
            value={tgBot.value}
            prompt="例如 my_notify_bot"
            onChanged={(v) => tgBot.setValue(v)}
          />
          <FormRow
            label="Chat ID"
            value={tgChat.value}
            prompt="-1001234567890 或 123456789"
            keyboardType={"numbersAndPunctuation"}
            onChanged={(v) => tgChat.setValue(v)}
          />
          {tgTokenSet.value ? (
            <Text font={12} foregroundStyle={GOOD}>
              服务器上已有 token{tgChat.value.trim() ? "，配置齐备" : "，还差 chat id"}
            </Text>
          ) : null}
          <Button
            title="发送测试通知"
            systemImage={"paperplane"}
            action={testNotify}
            disabled={busy.value || settingsBusy.value}
          />
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
