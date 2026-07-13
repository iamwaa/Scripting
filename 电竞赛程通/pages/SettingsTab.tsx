import { NavigationStack, List, Section, Text, TextField, Picker, Toggle, Button, Toolbar, ToolbarItem, Image, Link, VStack, HStack } from "scripting"
import { useState } from "scripting"
import type { VirtualNode } from "scripting"
import type { Settings } from "../types"
import type { ApiUsage } from "../api"

const NOTIFY_OPTIONS = [
  { label: "关闭", value: 0 },
  { label: "15 分钟", value: 15 },
  { label: "30 分钟", value: 30 },
  { label: "1 小时", value: 60 },
  { label: "2 小时", value: 120 },
]

interface SettingsTabProps {
  tabItem: VirtualNode
  tag: number
  settings: Settings
  usage: ApiUsage | null
  onSave: (s: Settings) => void
  onClose: () => void
}

export function SettingsTab({ settings, usage, onSave, onClose }: SettingsTabProps) {
  const [apiToken, setApiToken] = useState(settings.apiToken ?? "")

  // 提前时间变更即落盘
  const handleMinutesChange = (next: string) => {
    onSave({
      apiToken: apiToken.trim() || null,
      defaultNotifyMinutesBefore: Number(next) || 0,
      notifyAtStart: settings.notifyAtStart,
    })
  }

  // 切换即落盘
  const handleNotifyAtStartChange = (value: boolean) => {
    onSave({
      apiToken: apiToken.trim() || null,
      defaultNotifyMinutesBefore: settings.defaultNotifyMinutesBefore,
      notifyAtStart: value,
    })
  }

  // API Token 在输入框失焦时落盘,避免每次按键触发数据重载
  const handleTokenBlur = () => {
    onSave({
      apiToken: apiToken.trim() || null,
      defaultNotifyMinutesBefore: settings.defaultNotifyMinutesBefore,
      notifyAtStart: settings.notifyAtStart,
    })
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="设置"
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button action={onClose}>
                <Image
                  systemName="xmark"
                  fontWeight="semibold"
                  foregroundStyle="red"
                />
              </Button>
            </ToolbarItem>
          </Toolbar>
        }
      >
        <Section
          header={<Text> API Token</Text>}
          footer={
            <VStack alignment="leading" spacing={4}>
              <Text foregroundStyle="secondaryLabel">免费计划提供每小时 1000次调用额度</Text>
              <HStack alignment="firstTextBaseline" spacing={0}>
                <Text foregroundStyle="secondaryLabel">申请地址：</Text>
                <Link url="https://www.pandascore.co"><Text font="caption">pandascore.co</Text></Link>
              </HStack>
            </VStack>
          }>
          <TextField
            title="API Token"
            prompt="粘贴 PandaScore Token"
            value={apiToken}
            onChanged={(v: string) => setApiToken(v)}
            onBlur={handleTokenBlur}
          />
          {/* PandaScore 无专门用量查询接口,以每次响应头 X-Rate-Limit-Remaining 为准 */}
          {usage && usage.remaining != null ? (
            <Text font="body" foregroundStyle="secondaryLabel">
              本小时剩余请求数：{usage.remaining}
            </Text>
          ) : (
            <Text font="body" foregroundStyle="secondaryLabel">
              暂无用量数据，发起请求后将显示剩余配额
            </Text>
          )}
        </Section>

        <Section header={<Text>通知</Text>} footer={<Text>已订阅的比赛将通过本地通知提醒</Text>}>
          <Toggle
            title="开始时通知"
            value={settings.notifyAtStart}
            onChanged={handleNotifyAtStartChange}
          />
          <Picker
            title="提前提醒"
            value={String(settings.defaultNotifyMinutesBefore)}
            onChanged={handleMinutesChange}
          >
            {NOTIFY_OPTIONS.map((opt) => (
              <Text key={String(opt.value)} tag={String(opt.value)}>
                {opt.label}
              </Text>
            ))}
          </Picker>
        </Section>
      </List>
    </NavigationStack>
  )
}
