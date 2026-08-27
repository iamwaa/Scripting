import { Tab, TabView, useState } from "scripting"
import { AppConfig } from "../types"
import { HomePage } from "./HomePage"
import { SettingsPage } from "./SettingsPage"

export function AppTabs({ initialConfig, onConfigChanged }: { initialConfig: AppConfig; onConfigChanged: (config: AppConfig) => void }) {
  const [config, setConfig] = useState(initialConfig)

  function updateConfig(next: AppConfig) {
    setConfig(next)
    onConfigChanged(next)
  }

  return (
    <TabView tabIndex={0} tabViewStyle="tabBarOnly">
      <Tab title="测试" systemImage="testtube.2" value={0}>
        <HomePage config={config} onConfigChanged={updateConfig} />
      </Tab>
      <Tab title="设置" systemImage="gearshape" value={1}>
        <SettingsPage config={config} onChanged={updateConfig} />
      </Tab>
    </TabView>
  )
}
