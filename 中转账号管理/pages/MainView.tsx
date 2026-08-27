import { useState, useObservable, Navigation, TabView, Tab } from "scripting"
import { AccountListView } from "./AccountListView"

// 主页面：底部导航切换账号页与归档页，两个标签共用账号列表页
export function MainView() {
  // dismiss 必须在被 present 的根组件里获取，标签内部再取会拿不到当前弹层
  const dismiss = Navigation.useDismiss()
  const selection = useObservable<string>("active")
  // 归档或删除后自增，驱动另一个标签重新加载数据
  const [dataVersion, setDataVersion] = useState(0)

  function notifyDataChanged() {
    setDataVersion(version => version + 1)
  }

  return <TabView selection={selection}>
    <Tab title="账号" systemImage="person.2.fill" value="active">
      <AccountListView scope="active" dataVersion={dataVersion} onDataChanged={notifyDataChanged} onClose={dismiss} />
    </Tab>
    <Tab title="归档" systemImage="archivebox.fill" value="archived">
      <AccountListView scope="archived" dataVersion={dataVersion} onDataChanged={notifyDataChanged} onClose={dismiss} />
    </Tab>
  </TabView>
}
