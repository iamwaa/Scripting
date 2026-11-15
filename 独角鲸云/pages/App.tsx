import { TabView, Tab, useState, Navigation } from 'scripting'
import { savedToken } from '../api/client'
import VMPage from './VMPage'
import MarketPage from './MarketPage'
import AccountPage from './AccountPage'

export default function App() {
  const [token, setToken] = useState(() => savedToken())
  const dismiss = Navigation.useDismiss()
  return <TabView tint="systemBlue">
    <Tab title="云主机" systemImage="server.rack"><VMPage token={token} onClose={dismiss} /></Tab>
    <Tab title="市场" systemImage="square.grid.2x2"><MarketPage onClose={dismiss} /></Tab>
    <Tab title="账户" systemImage="person.crop.circle"><AccountPage token={token} onToken={setToken} onClose={dismiss} /></Tab>
  </TabView>
}
