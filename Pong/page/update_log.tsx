// ============================================================================
// 升级日志 — 读取服务器 /var/log/sg-update.log 的尾部。
// S: 只读展示 + 下拉刷新；连接参数来自该节点的更新配置。
// ============================================================================
import { List, NavigationStack, ScrollView, Section, Text, useEffect, useObservable } from "scripting";
import type { Color } from "scripting";
import { getActiveInstance } from "../class/config";
import { getNodeUpdateConfig, isUpdatable, readLog } from "../class/update";

export function View({ uuid }: { uuid: string }) {
  const inst = getActiveInstance();
  const cfg = inst ? getNodeUpdateConfig(inst.id, uuid) : undefined;
  const text = useObservable<string>("正在读取日志…");
  const busy = useObservable<boolean>(false);

  async function load() {
    if (!isUpdatable(cfg)) {
      text.setValue("该节点还没配置服务器更新");
      return;
    }
    busy.setValue(true);
    try {
      const res = await readLog(cfg!, 80);
      text.setValue(res.ok ? res.output || "（日志为空）" : `读取失败：${res.error ?? res.output}`);
    } catch (e) {
      text.setValue(`读取失败：${e}`);
    } finally {
      busy.setValue(false);
    }
  }

  // 进页自动拉一次；refreshable 提供下拉刷新
  useEffect(() => {
    load();
  }, []);

  return (
    <NavigationStack>
      <List navigationTitle="升级日志" navigationBarTitleDisplayMode={"inline"} refreshable={load}>
        <Section>
          <ScrollView frame={{ height: 520 }}>
            <Text
              font={12}
              monospaced={true}
              foregroundStyle={"secondaryLabel" as Color}
              frame={{ maxWidth: Infinity, alignment: "leading" }}
            >
              {text.value}
            </Text>
          </ScrollView>
        </Section>
      </List>
    </NavigationStack>
  );
}
