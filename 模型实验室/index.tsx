import { Navigation, Script } from "scripting"
import { AppTabs } from "./pages/AppTabs"
import { loadConfig, saveConfig } from "./utils/storage"

async function run() {
  const config = loadConfig()
  await Navigation.present(<AppTabs initialConfig={config} onConfigChanged={saveConfig} />)
  Script.exit()
}

run()
