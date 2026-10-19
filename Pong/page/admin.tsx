// ============================================================================
// Admin management hub — route to backend-gated management features.
// Listed features are determined by the active instance's caps; absent caps
// mean the backend doesn't have that concept (no dead buttons).
// S: Single Purpose — feature list + navigation, no I/O.
// ============================================================================
import {
  Button,
  Group,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  VStack,
} from "scripting";
import { useMonitor } from "../context/Monitor";
import { getBackend } from "../class/server";
import { View as AlertsView } from "./alerts";
import { View as NotificationsView } from "./notifications";
import { View as CronView } from "./cron";
import { View as ExecView } from "./exec";
import { View as UsersView } from "./users";
import { View as TokensView } from "./tokens";
import { View as SessionsView } from "./sessions";
import { View as SettingsReadonlyView } from "./settings_readonly";
import type { BackendCaps } from "../class/types";

/** A feature entry in the admin hub. */
type AdminFeature = {
  /** Cap key checked to show/hide this entry. */
  cap: keyof BackendCaps;
  icon: string;
  title: string;
  subtitle: string;
  /** Page view component to present. */
  view: () => any;
};

export function View() {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor();
  const inst = monitor.instance.value;
  const caps = inst ? getBackend(inst.kind).caps : null;

  const features: AdminFeature[] = [
    {
      cap: "hasAlertRules",
      icon: "bell.badge",
      title: "告警规则",
      subtitle: "按指标/阈值持续监控服务器状态",
      view: () => <AlertsView />,
    },
    {
      cap: "hasNotifications",
      icon: "bell.and.waves.left.and.right",
      title: "通知渠道",
      subtitle: "管理 Telegram / Webhook 等通知",
      view: () => <NotificationsView />,
    },
    {
      cap: "hasCronTasks",
      icon: "clock.arrow.circlepath",
      title: "计划任务",
      subtitle: "定时或手动触发的面板命令",
      view: () => <CronView />,
    },
    {
      cap: "hasCommandExec",
      icon: "terminal",
      title: "命令执行",
      subtitle: "在多台服务器上实时执行命令",
      view: () => <ExecView />,
    },
    {
      cap: "hasUserMgmt",
      icon: "person.2",
      title: "用户管理",
      subtitle: "管理面板登录用户与权限",
      view: () => <UsersView />,
    },
    {
      cap: "hasApiTokens",
      icon: "key.horizontal",
      title: "API Tokens",
      subtitle: "管理面板 PAT 访问令牌",
      view: () => <TokensView />,
    },
    {
      cap: "hasSessionMgmt",
      icon: "list.bullet.rectangle",
      title: "会话管理",
      subtitle: "查看活跃登录会话",
      view: () => <SessionsView />,
    },
    {
      cap: "hasSiteSettings",
      icon: "gearshape.2",
      title: "站点设置",
      subtitle: "查看探针面板配置",
      view: () => <SettingsReadonlyView />,
    },
  ];

  async function openView(feature: AdminFeature) {
    const v = feature.view();
    if (!v) return; // page not built yet
    await Navigation.present({ element: v });
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={"管理面板"}
        toolbar={{
          cancellationAction: [<Button title={"完成"} action={dismiss} />],
        }}
      >
        {inst ? (
          <Section
            header={<Text>{caps?.label ?? "探针"} 管理</Text>}
            footer={
              <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
                仅显示当前探针后端支持的功能。管理操作直接写入面板，请确认凭证有对应权限。
              </Text>
            }
          >
            {features
              .filter((f) => caps && (caps as any)[f.cap])
              .map((f) => (
                <Button key={f.cap} action={() => openView(f)}>
                  <VStack
                    alignment={"leading"}
                    spacing={2}
                    padding={{ vertical: 4, horizontal: 12 }}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                  >
                    <HStack spacing={10}>
                      <Image
                        systemName={f.icon}
                        font={"title3"}
                        foregroundStyle={"accentColor"}
                      />
                      <VStack alignment={"leading"} spacing={1}>
                        <Text font={"subheadline"}>{f.title}</Text>
                        <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
                          {f.subtitle}
                        </Text>
                      </VStack>
                      <Spacer />
                      {f.view() ? (
                        <Image systemName={"chevron.right"} font={"caption2"} foregroundStyle={"tertiaryLabel"} />
                      ) : (
                        <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
                          待开发
                        </Text>
                      )}
                    </HStack>
                  </VStack>
                </Button>
              ))}
          </Section>
        ) : (
          <Section>
            <Text foregroundStyle={"secondaryLabel"}>未配置探针</Text>
          </Section>
        )}
      </List>
    </NavigationStack>
  );
}
