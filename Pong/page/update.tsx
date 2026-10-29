// ============================================================================
// 服务器更新面板 — 通过 SSH 驱动当前实例上的 /root/bin/sg-update。
// S: 一个页面展示 magpie / cf-probe 的版本、可用更新与最近升级记录。
// ============================================================================
import {
  Button,
  HStack,
  List,
  NavigationLink,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  Toggle,
  useEffect,
  useObservable,
} from "scripting";
import type { Color, PresentationDetent } from "scripting";
import { getActiveInstance } from "../class/config";
import { checkUpdates, getNodeUpdateConfig, isUpdatable, rollbackMagpie, setOption, upgrade, upgradeDanmu, upgradeProbeOnly, type UpdateState } from "../class/update";
import { View as LogView } from "./update_log";

const OK: Color = "systemGreen";
const WARN: Color = "systemOrange";
const BAD: Color = "systemRed";
const DIM: Color = "secondaryLabel";

function Row({ label, value, tint }: { label: string; value: string; tint?: Color }) {
  return (
    <HStack>
      <Text font={16}>{label}</Text>
      <Spacer />
      <Text font={16} foregroundStyle={tint ?? DIM}>
        {value}
      </Text>
    </HStack>
  );
}

function Footer({ text }: { text: string }) {
  return (
    <Text font={12} foregroundStyle={DIM}>
      {text}
    </Text>
  );
}

export function View({
  uuid,
  presentationDetents,
  onClose,
}: {
  /** 当前节点 id：配置和升降都按节点走 */
  uuid?: string;
  presentationDetents?: PresentationDetent[];
  onClose?: () => void;
}) {
  return <Panel uuid={uuid} presentationDetents={presentationDetents} onClose={onClose} />;
}

/** 实际的更新面板（内层组件，才能使用 hook） */
function Panel({
  uuid,
  presentationDetents,
  onClose,
}: {
  uuid?: string;
  presentationDetents?: PresentationDetent[];
  onClose?: () => void;
}) {
  const inst = getActiveInstance();
  const nodeUuid = uuid ?? "";
  const cfg = inst && nodeUuid ? getNodeUpdateConfig(inst.id, nodeUuid) : undefined;
  const usable = isUpdatable(cfg);
  const state = useObservable<UpdateState>({});
  const loading = useObservable<boolean>(false);
  const working = useObservable<boolean>(false);
  const message = useObservable<string>("");
  // 自动更新设置：按服务器状态初始化，改完立即下发
  const autoOn = useObservable<boolean>(true);
  const autoEvery = useObservable<number>(24);
  const deferHours = useObservable<number>(6);
  const settingsBusy = useObservable<boolean>(false);
  // 进页面自动检测：只跑一次，避免刷新循环
  const autoChecked = useObservable<boolean>(false);

  const problem = usable
    ? ""
    : "这个节点还没配置服务器更新（详情页「运维」）";

  async function refresh(notify = false) {
    if (!cfg || !usable) return;
    loading.setValue(true);
    try {
      const { state: next, result } = await checkUpdates(cfg);
      if (next) {
        state.setValue(next);
        // 用服务器实际值回填开关、频率与空窗期
        autoOn.setValue(next.auto_enabled !== "0");
        autoEvery.setValue(Number(next.auto_every) || 24);
        deferHours.setValue(Number(next.defer_hours) || 0);
        if (notify) message.setValue("检查完成");
      } else {
        message.setValue(`检查失败：${result.error ?? "服务器未返回状态"}`);
      }
    } catch (e) {
      message.setValue(`检查失败：${e}`);
    } finally {
      loading.setValue(false);
    }
  }

  // 进页面先拉一次真实状态，否则版本行全是 —
  useEffect(() => {
    if (!usable || autoChecked.value) return;
    autoChecked.setValue(true);
    refresh();
  }, [usable]);

  /** 下发一个自动更新设置项 */
  async function pushSetting(key: string, value: string, okText: string) {
    if (!cfg) return;
    settingsBusy.setValue(true);
    try {
      const res = await setOption(cfg, key, value);
      message.setValue(res.ok ? okText : `设置失败：${(res.error ?? res.output).trim().slice(-120)}`);
      if (!res.ok) await refresh();
    } catch (e) {
      message.setValue(`设置失败：${e}`);
    } finally {
      settingsBusy.setValue(false);
    }
  }

  async function doUpgrade(targets: { magpie?: string; probe?: string }) {
    if (!cfg) return;
    working.setValue(true);
    message.setValue("正在升级，请勿关闭页面…");
    try {
      const res = await upgrade(cfg, targets);
      await refresh();
      message.setValue(res.ok ? "升级完成" : `升级失败：${(res.error ?? res.output).slice(-200)}`);
    } catch (e) {
      message.setValue(`升级失败：${e}`);
    } finally {
      working.setValue(false);
    }
  }

  const s = state.value;
  const magpieTarget = s.magpie_update_available || s.magpie_target;
  const probeTarget = s.probe_update_available || s.probe_target;
  const danmuTarget = s.danmu_update_available || s.danmu_target;
  const hasUpdate = !!magpieTarget || !!probeTarget || !!danmuTarget;
  const magpieTint: Color = magpieTarget ? WARN : s.container_state === "running" ? OK : BAD;
  const probeTint: Color = probeTarget ? WARN : s.probe_service === "active" ? OK : BAD;
  const danmuTint: Color = danmuTarget ? WARN : OK;
  const pendingLabel = [magpieTarget && "magpie", probeTarget && "cf-probe", danmuTarget && "danmu-api"]
    .filter(Boolean)
    .join(" + ");
  const busyAny = working.value || loading.value;

  return (
    <NavigationStack>
      <List
        navigationTitle="服务器更新"
        navigationBarTitleDisplayMode={"inline"}
        presentationDetents={presentationDetents}
        toolbar={
          onClose ? { cancellationAction: [<Button title="关闭" systemImage="xmark" action={onClose} />] } : undefined
        }
        refreshable={async () => {
          await refresh(true);
        }}
      >
        {problem ? (
          <Section>
            <Text font={15} foregroundStyle={BAD}>
              {problem}
            </Text>
            <Text font={13} foregroundStyle={DIM}>
              请在节点详情页的「运维」里填写这台 VPS 的更新信息（SSH 主机与私钥/密码）。
            </Text>
          </Section>
        ) : null}

        <Section
          header={<Text font={13}>Magpie 网关</Text>}
          footer={
            <Footer
              text={
                s.last_magpie_upgrade
                  ? `最近升级 ${s.last_magpie_from ?? "?"} → v${s.magpie_version} · ${s.last_magpie_upgrade}`
                  : "尚无升级记录"
              }
            />
          }
        >
          <Row label="运行版本" value={s.magpie_version ? `v${s.magpie_version}` : "—"} />
          <Row label="最新版本" value={s.magpie_latest ? `v${s.magpie_latest}` : "—"} />
          <Row
            label="状态"
            value={magpieTarget ? `可升级到 v${magpieTarget}` : s.container_state === "running" ? "运行中" : s.container_state || "未知"}
            tint={magpieTint}
          />
          <Row label="公网入口" value={s.gateway || "—"} />
        </Section>

        <Section
          header={<Text font={13}>cf-probe 探针</Text>}
          footer={
            <Footer
              text={
                s.last_probe_upgrade
                  ? `最近升级 ${s.last_probe_from ?? "?"} → v${s.probe_version} · ${s.last_probe_upgrade}`
                  : "尚未升级过"
              }
            />
          }
        >
          <Row label="运行版本" value={s.probe_version ? `v${s.probe_version}` : "—"} />
          <Row label="最新版本" value={s.probe_latest ? `v${s.probe_latest}` : "—"} />
          <Row
            label="服务状态"
            value={probeTarget ? `可升级到 v${probeTarget}` : s.probe_service === "active" ? "运行中" : s.probe_service || "未知"}
            tint={probeTint}
          />
        </Section>

        <Section
          header={<Text font={13}>danmu-api 弹幕接口</Text>}
          footer={
            <Footer
              text={
                s.danmu_version
                  ? `跟随上游仓库提交自动重建；当前 ${s.danmu_version}`
                  : "尚未部署 danmu-api（服务器上无 /opt/danmu-api）"
              }
            />
          }
        >
          <Row label="运行版本" value={s.danmu_version ? `#${s.danmu_version}` : "—"} />
          <Row label="上游最新" value={s.danmu_latest ? `#${s.danmu_latest}` : "—"} />
          <Row
            label="状态"
            value={danmuTarget ? `可更新到 #${danmuTarget}` : s.danmu_version ? "已是最新" : "未部署"}
            tint={danmuTint}
          />
        </Section>

        <Section
          header={<Text font={13}>自动更新</Text>}
          footer={
            <Footer
              text={
                autoOn.value
                  ? `每 ${autoEvery.value} 小时检查一次，有新版本就自动升级${
                      deferHours.value ? `；0 点到 ${deferHours.value} 点不升级` : ""
                    }${s.deferred === "1" ? "（当前在空窗期，等待升级）" : ""}`
                  : "已关闭：不会再自动检查或升级，登录服务器手动操作仍可用"
              }
            />
          }
        >
          <Toggle
            title="自动检查并升级"
            value={autoOn.value}
            onChanged={(v: boolean) => {
              autoOn.setValue(v);
              pushSetting("auto_enabled", v ? "1" : "0", v ? "已开启自动更新" : "已关闭自动更新");
            }}
            disabled={settingsBusy.value || !!problem}
          />
          <Picker
            title="检查频率"
            value={String(autoEvery.value)}
            onChanged={(v: string) => {
              const h = Number(v) || 24;
              autoEvery.setValue(h);
              pushSetting("auto_every", String(h), `已设为每 ${h} 小时`);
            }}
            disabled={!autoOn.value || settingsBusy.value || !!problem}
          >
            {[1, 3, 6, 12, 24].map((h) => (
              <Text key={String(h)} tag={String(h)}>
                {h === 24 ? "每天一次" : `每 ${h} 小时`}
              </Text>
            ))}
          </Picker>
          <Picker
            title="空窗期"
            pickerStyle={"menu"}
            value={String(deferHours.value)}
            onChanged={(v: string) => {
              const h = Number(v) || 0;
              deferHours.setValue(h);
              pushSetting("defer_hours", String(h), h === 0 ? "已关闭空窗期" : `已设为 0–${h} 点不升级`);
            }}
            disabled={!autoOn.value || settingsBusy.value || !!problem}
          >
            {[0, 2, 4, 6, 8].map((h) => (
              <Text key={String(h)} tag={String(h)}>
                {h === 0 ? "无（随时升级）" : `0 点到 ${h} 点`}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section
          header={<Text font={13}>操作</Text>}
        >
          <Button
            title={loading.value ? "检查中…" : "检查更新"}
            systemImage={"arrow.triangle.2.circlepath"}
            action={() => refresh(true)}
            disabled={busyAny || !!problem}
          />
          <Button
            title={working.value ? "处理中…" : hasUpdate ? `一键升级（${pendingLabel}）` : "全部升级到最新"}
            systemImage={"square.and.arrow.down.on.square"}
            action={() => doUpgrade({ magpie: magpieTarget || undefined, probe: probeTarget || undefined })}
            disabled={busyAny || !!problem}
          />
          {magpieTarget ? (
            <Button
              title={`只升级 magpie → v${magpieTarget}`}
              action={() => doUpgrade({ magpie: magpieTarget })}
              disabled={busyAny || !!problem}
            />
          ) : null}
          {probeTarget ? (
            <Button
              title={`只升级 cf-probe → v${probeTarget}`}
              action={async () => {
                if (!cfg) return;
                working.setValue(true);
                message.setValue("正在升级 cf-probe…");
                const res = await upgradeProbeOnly(cfg);
                working.setValue(false);
                await refresh();
                message.setValue(res.ok ? "cf-probe 升级完成" : `升级失败：${(res.error ?? res.output).slice(-160)}`);
              }}
              disabled={busyAny || !!problem}
            />
          ) : null}
          {danmuTarget ? (
            <Button
              title={busyAny ? "处理中…" : `只更新 danmu-api → #${danmuTarget}`}
              systemImage={"arrow.triangle.2.circlepath"}
              action={async () => {
                if (!cfg) return;
                working.setValue(true);
                message.setValue("正在更新 danmu-api（拉取并重建镜像），请勿关闭页面…");
                try {
                  const res = await upgradeDanmu(cfg);
                  await refresh();
                  message.setValue(res.ok ? "danmu-api 更新完成" : `更新失败：${(res.error ?? res.output).slice(-160)}`);
                } catch (e) {
                  message.setValue(`更新失败：${e}`);
                } finally {
                  working.setValue(false);
                }
              }}
              disabled={busyAny || !!problem}
            />
          ) : null}
          <NavigationLink title="升级日志" destination={<LogView uuid={nodeUuid} />} />
        </Section>

        {message.value ? (
          <Section>
            <Text font={14} foregroundStyle={DIM}>
              {message.value}
            </Text>
          </Section>
        ) : null}

        {s.last_error ? (
          <Section header={<Text font={13}>最近错误</Text>}>
            <Text font={13} foregroundStyle={BAD}>
              {s.last_error}
            </Text>
          </Section>
        ) : null}

        <Section header={<Text font={13}>维护</Text>}>
          <Button
            title="回滚 magpie"
            systemImage={"arrow.uturn.backward.circle"}
            action={async () => {
              if (!cfg) return;
              const ok = await Dialog.confirm({
                title: "回滚 magpie",
                message: s.rollback_version
                  ? `将 magpie 回滚到 v${s.rollback_version}（最近一次升级前的版本）。`
                  : "将恢复到最近一次升级前的版本。",
              });
              if (ok !== true) return;
              working.setValue(true);
              message.setValue("正在回滚…");
              const res = await rollbackMagpie(cfg);
              working.setValue(false);
              await refresh();
              message.setValue(res.ok ? "已回滚" : `回滚失败：${(res.error ?? res.output).slice(-160)}`);
            }}
            disabled={busyAny || !!problem}
          />
        </Section>
      </List>
    </NavigationStack>
  );
}
