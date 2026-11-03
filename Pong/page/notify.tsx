// ============================================================================
// 通知设置页 — 给某一台 VPS 配 Telegram 通知（按机器存，可被多个节点共用）。
// 入口在节点详情的「运维」分组，与「服务器更新设置」并列。
// S: 单一职责 — 只负责 Telegram 三项 + 测试发送，不碰 SSH 连接信息。
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
  getNodeUpdateConfig,
  getTgPreset,
  isUpdatable,
  readSettings,
  sendTestNotification,
  setOption,
  setTgPreset,
  type UpdateConfig,
} from "../class/update";

const DIM: Color = "secondaryLabel";
const GOOD: Color = "systemGreen";
const BAD: Color = "systemRed";

/** 与 update_node.tsx 同一套表单行（两处都只需要这一个小组件） */
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

type Baseline = { chat: string; bot: string };

export function View({
  instanceId,
  nodeUuid,
  nodeName,
  presentationDetents,
  onClose,
}: {
  instanceId: string;
  nodeUuid: string;
  nodeName: string;
  presentationDetents?: PresentationDetent[];
  onClose?: () => void;
}) {
  const dismissNav = Navigation.useDismiss();
  const dismiss = () => (onClose ? onClose() : dismissNav());
  // 通知按机器存，所以要用该节点的 SSH 连接信息去读写
  const cfg: UpdateConfig | undefined = getNodeUpdateConfig(instanceId, nodeUuid);
  const usable = isUpdatable(cfg);

  const preset = getTgPreset();
  const tgChat = useObservable<string>(preset.chat);
  const tgBot = useObservable<string>(preset.bot);
  const tgToken = useObservable<string>("");
  const tgTokenSet = useObservable<boolean>(preset.tokenSet);
  const baseline = useObservable<Baseline | null>(null);

  const busy = useObservable<boolean>(false);
  const message = useObservable<string>("");
  const messageOk = useObservable<boolean>(false);

  useEffect(() => {
    void (async () => {
      if (usable && cfg) await loadSettings(cfg);
    })();
    // 只在挂载时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 读服务器上的 tg_*，回填并建立「改没改」的基准 */
  async function loadSettings(target: UpdateConfig) {
    busy.setValue(true);
    try {
      const s = await readSettings(target);
      if (s) {
        tgChat.setValue(s.tg_chat || preset.chat);
        tgBot.setValue(s.tg_bot || preset.bot);
        tgTokenSet.setValue(s.tg_token_set || preset.tokenSet);
        baseline.setValue({ chat: s.tg_chat, bot: s.tg_bot });
      }
    } catch {
      // 读不到就保持预填值，用户仍可保存
    } finally {
      busy.setValue(false);
    }
  }

  /** 下发与服务器不同的项；返回失败描述 */
  async function pushSettings(target: UpdateConfig): Promise<string[]> {
    const fails: string[] = [];
    const cur: Baseline = { chat: tgChat.value.trim(), bot: tgBot.value.trim() };
    const base = baseline.value;
    // 有基线只推改动；无基线只推非空值，避免把服务器上已有配置抹掉
    const shouldPush = (k: keyof Baseline) => (base ? base[k] !== cur[k] : cur[k] !== "");

    const push = async (label: string, key: string, value: string) => {
      const r = await setOption(target, key, value);
      if (!r.ok) fails.push(`${label}：${(r.error ?? r.output).trim().slice(-80)}`);
    };

    if (shouldPush("chat")) await push("Telegram chat", "tg_chat", cur.chat);
    if (shouldPush("bot")) await push("Bot 用户名", "tg_bot", cur.bot);
    const tok = tgToken.value.trim();
    if (tok) await push("Bot Token", "tg_token", tok);

    if (fails.length === 0) baseline.setValue(cur);
    return fails;
  }

  function currentCfg(): UpdateConfig | null {
    return getNodeUpdateConfig(instanceId, nodeUuid) ?? null;
  }

  async function test() {
    const target = currentCfg();
    if (!target) {
      messageOk.setValue(false);
      message.setValue("这台服务器还没配 SSH 连接信息，先去「服务器更新设置」填好");
      return;
    }
    busy.setValue(true);
    message.setValue("正在发送测试通知…");
    try {
      const fails = await pushSettings(target);
      if (fails.length > 0) {
        messageOk.setValue(false);
        message.setValue(`设置未生效：${fails.join("；")}`);
        return;
      }
      const r = await sendTestNotification(target);
      messageOk.setValue(r.ok);
      message.setValue(
        r.ok ? "测试通知已发送，请在 Telegram 查看" : `发送失败：${(r.error ?? r.output).trim().slice(-120)}`,
      );
      tgToken.setValue("");
    } catch (e) {
      messageOk.setValue(false);
      message.setValue(`发送失败：${e}`);
    } finally {
      busy.setValue(false);
    }
  }

  /** 保存：写手机侧预设 + 下发到当前选中的服务器 */
  async function save() {
    setTgPreset({ bot: tgBot.value.trim(), chat: tgChat.value.trim(), token: tgToken.value.trim() });
    const target = currentCfg();
    if (!target) {
      messageOk.setValue(false);
      message.setValue("预设已保存在本机；但这台服务器还没配 SSH，无法下发");
      return;
    }
    busy.setValue(true);
    try {
      const fails = await pushSettings(target);
      busy.setValue(false);
      if (fails.length > 0) {
        messageOk.setValue(false);
        message.setValue(`预设已保存在本机，但服务器设置未生效：${fails.join("；")}`);
        return;
      }
      dismiss();
    } catch (e) {
      busy.setValue(false);
      messageOk.setValue(false);
      message.setValue(`预设已保存在本机，服务器设置下发失败：${e}`);
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={`通知 · ${nodeName}`}
        navigationBarTitleDisplayMode={"inline"}
        presentationDetents={presentationDetents}
        toolbar={{
          cancellationAction: [<Button title={"关闭"} action={dismiss} />],
          confirmationAction: [<Button title={"保存"} action={save} />],
        }}
      >
        <Section
          header={<Text font={13}>Telegram 通知</Text>}
          footer={
            <Text font={12} foregroundStyle={DIM}>
              自动升级成功/失败会推送到这个 chat。在 Telegram 里找 @BotFather 建 bot 拿 token，再给自己发一条消息，
              然后浏览器打开 api.telegram.org/bot【token】/getUpdates 拿 chat id（负数也要完整填写）。
              Token 只存服务器上一个 600 权限文件，手机侧另存一份预设用于回填，不会显示出来。
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
            action={test}
            disabled={busy.value}
          />
          {message.value ? (
            <Text font={14} foregroundStyle={messageOk.value ? GOOD : BAD}>
              {message.value}
            </Text>
          ) : null}
        </Section>

        <Section
          header={<Text font={13}>作用范围</Text>}
          footer={
            <Text font={12} foregroundStyle={DIM}>
              通知按「机器」存：同一台 VPS 上的多个节点共用一份。手机侧会记住这套 token / chat id，
              配下一台服务器时自动预填。
            </Text>
          }
        >
          <Text font={14} foregroundStyle={DIM}>
            当前写入：{nodeName}
          </Text>
        </Section>
      </List>
    </NavigationStack>
  );
}
