import {
  List,
  Section,
  Text,
  SecureField,
  Button,
  useState,
} from "scripting"
import { getApiKey, saveApiKey } from "../utils/storage"
import { showAlert } from "../utils/ui"

export function SettingsPage() {
  const [apiKey, setApiKey] = useState(getApiKey())
  const [showSavedToast, setShowSavedToast] = useState(false)

  // 保存 API Key 到本地
  function handleSave() {
    saveApiKey(apiKey)
    setApiKey(getApiKey())
    setShowSavedToast(true)
  }

  // 清除已保存的 API Key
  function handleClear() {
    saveApiKey("")
    setApiKey("")
    showAlert("已清除 API Key，将使用免费层级")
  }

  return (
    <List
      navigationTitle="设置"
      navigationBarTitleDisplayMode="inline"
      toast={{
        message: "已保存",
        position: "top",
        duration: 2,
        isPresented: showSavedToast,
        onChanged: setShowSavedToast,
      }}
    >
      <Section
        header={<Text>TempMail API Key</Text>}
        footer={
          <Text font="caption2">
            免费层级可不填。填写后可享受更长有效期与更高配额。可在 accounts.tempmail.lol 获取。
          </Text>
        }
      >
        <SecureField
          title="API Key"
          prompt="可选，例如 tempmail.xxx 或 tm.xxx"
          value={apiKey}
          onChanged={setApiKey}
        />
        <Button title="保存" action={handleSave} />
        {apiKey ? (
          <Button title="清除" role="destructive" action={handleClear} />
        ) : null}
      </Section>
      <Section title="接口说明">
        <Text>服务商：tempmail.lol</Text>
        <Text>文档：https://tempmail.lol/zh/api</Text>
      </Section>
    </List>
  )
}
