/**
 * index.tsx - gitgit 入口
 *
 * TabView：仓库列表 + 设置。
 * present 后 exit 的有限生命周期：关闭页面后释放实例。
 */

import {
  Script,
  Navigation,
  NavigationStack,
  TabView,
  Tab,
  useObservable,
} from "scripting"
import { RepoListPage } from "./pages/RepoListPage"
import { SettingsPage } from "./pages/SettingsPage"

function View() {
  const selection = useObservable(0)

  return (
    <TabView selection={selection}>
      <Tab title="仓库" systemImage="folder.fill" value={0}>
        <NavigationStack>
          <RepoListPage />
        </NavigationStack>
      </Tab>
      <Tab title="设置" systemImage="gearshape.fill" value={1}>
        <NavigationStack>
          <SettingsPage />
        </NavigationStack>
      </Tab>
    </TabView>
  )
}

async function run() {
  await Navigation.present(<View />)
  // 页面关闭后终止实例，释放资源
  Script.exit()
}

run()
