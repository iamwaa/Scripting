import {
  Navigation,
  NavigationStack,
  List,
  Section,
  Picker,
  Toggle,
  Text,
  VStack,
  Button,
  Script,
  Widget,
  useState,
} from "scripting";
import { IPProvider } from "../types/ip";
import { IPSettings, loadSettings, saveSettings } from "../services/settings";
import { IP_PROVIDERS } from "../api/ip";

// 供选择行展示的文案，标签直接挂在 Picker 的直接子元素上。
const PROVIDER_OPTIONS: { id: IPProvider; note: string }[] = [
  { id: "ippure", note: "官方风险分数，直接反映 IP 纯净度" },
  { id: "ip-api", note: "本地按运营商关键词估算，无纯净度分数" },
];

function SettingsView() {
  const dismiss = Navigation.useDismiss();
  const [settings, setSettings] = useState<IPSettings>(loadSettings);

  // 每次变更立即持久化并请求刷新小组件。
  const update = (next: IPSettings) => {
    setSettings(next);
    saveSettings(next);
    Widget.reloadAll();
  };

  const fallbackProvider: IPProvider = settings.preferredProvider === "ippure" ? "ip-api" : "ippure";

  return (
    <NavigationStack>
      <List
        navigationTitle="设置"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        toolbar={{
          confirmationAction: <Button title="完成" action={dismiss} />,
        }}
      >
        <Section
          header={<Text>数据来源接口</Text>}
          footer={
            <Text>
              {settings.preferredProvider === "ippure"
                ? "优先调用 IPPure，返回官方风险分数、是否原生 IP 和住宅/机房判断。"
                : "优先调用 ip-api，仅提供归属地；纯净度由本地关键词估算，仅供参考。"}
            </Text>
          }
        >
          {/* title 与 Section 头重复，用 labelsHidden 只隐藏视觉行，保留无障碍标签 */}
          <Picker
            title="数据来源"
            value={settings.preferredProvider}
            onChanged={(value: string) => update({ ...settings, preferredProvider: value as IPProvider })}
            pickerStyle="inline"
            labelsHidden={true}
          >
            {PROVIDER_OPTIONS.map((option) => (
              <VStack alignment="leading" spacing={3} tag={option.id}>
                <Text font={16}>{IP_PROVIDERS[option.id].name}</Text>
                <Text font={12} foregroundStyle="secondaryLabel">{option.note}</Text>
              </VStack>
            ))}
          </Picker>
        </Section>

        <Section
          footer={
            <Text>
              {settings.fallbackEnabled
                ? `当 ${IP_PROVIDERS[settings.preferredProvider].name} 请求失败时，自动改用 ${IP_PROVIDERS[fallbackProvider].name}，并在组件上标注实际来源。`
                : `仅使用 ${IP_PROVIDERS[settings.preferredProvider].name}，请求失败时组件显示无法获取数据。`}
            </Text>
          }
        >
          <Toggle
            title="失败时使用备用接口"
            value={settings.fallbackEnabled}
            onChanged={(value) => update({ ...settings, fallbackEnabled: value })}
          />
        </Section>
      </List>
    </NavigationStack>
  );
}

export async function presentSettings() {
  await Navigation.present({ element: <SettingsView /> });
  Script.exit();
}
