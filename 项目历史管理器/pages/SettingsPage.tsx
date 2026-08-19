import { HStack, Image, List, NavigationLink, Section, useState } from "scripting"
import { AppConfig } from "../types"
import { PathMetric } from "../components/rows"
import { PathSettingPage } from "./PathSettingPage"

export function SettingsPage({
  config,
  onConfigChanged,
}: {
  config: AppConfig
  onConfigChanged: (config: AppConfig) => void
}) {
  const [currentConfig, setCurrentConfig] = useState<AppConfig>(config)

  function applyConfig(nextConfig: AppConfig) {
    setCurrentConfig(nextConfig)
    onConfigChanged(nextConfig)
  }

  return (
    <List navigationTitle="设置" navigationBarTitleDisplayMode="inline">
      <Section title="路径设置">
        <NavigationLink
          destination={
            <PathSettingPage type="backup" config={currentConfig} onConfigChanged={applyConfig} />
          }
        >
          <HStack spacing={10}>
            <Image systemName="externaldrive" foregroundStyle="tintColor" />
            <PathMetric title="备份目录" value={currentConfig.backupRoot} />
          </HStack>
        </NavigationLink>
        <NavigationLink
          destination={
            <PathSettingPage type="project" config={currentConfig} onConfigChanged={applyConfig} />
          }
        >
          <HStack spacing={10}>
            <Image systemName="folder" foregroundStyle="tintColor" />
            <PathMetric title="项目目录" value={currentConfig.projectRoot} />
          </HStack>
        </NavigationLink>
      </Section>
    </List>
  )
}
