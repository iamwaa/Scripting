import { Widget, Script } from 'scripting'
import { savedToken } from './api/client'
import { loadWidgetVMs, WidgetData } from './api/widgetVMs'
import InstanceWidget from './components/InstanceWidget'
import { parseWidgetParameter, selectionLabel, widgetCapacity } from './utils/widgetSelection'
import { widgetDemoCount, widgetDemoData } from './utils/widgetDemo'

async function run() {
  const selection = parseWidgetParameter(Widget.parameter || '')
  let data: WidgetData = { items: [], total: 0, label: selectionLabel(selection) }
  try {
    const demoCount = widgetDemoCount(Widget.parameter || '', widgetCapacity(Widget.family))
    if (demoCount != null) {
      data = widgetDemoData(demoCount)
    } else {
      const token = savedToken()
      data = token ? await loadWidgetVMs(token, selection, widgetCapacity(Widget.family)) : {
        ...data, title: '请先登录', message: '打开独角鲸云，在「账户」保存登录凭据。',
      }
    }
  } catch {
    data = { ...data, title: '加载失败', message: '请打开脚本检查登录或网络后重试。' }
  }
  Widget.present(<InstanceWidget data={data} family={Widget.family} />, {
    policy: 'after', date: new Date(Date.now() + 15 * 60 * 1000),
  })
  Script.exit()
}

void run()
