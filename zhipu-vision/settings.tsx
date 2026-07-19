// API 设置界面 — 智谱视觉分析配置
import { NavigationStack, List, Section, Text, TextField, SecureField, Button, HStack, VStack, useState, useEffect, Navigation, Toolbar, ToolbarItem } from "scripting"
import { ConfigData, loadConfig, saveConfig } from "./config"

const DEFAULT_API_BASE = "https://open.bigmodel.cn/api/paas/v4/"
const DEFAULT_MODEL = "glm-4.6v"

export function SettingsView() {
  const dismiss = Navigation.useDismiss()
  const [apiKey, setApiKey] = useState("")
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadConfig().then(config => {
      setApiKey(config.apiKey)
      setApiBase(config.apiBase)
      setModel(config.model)
    })
  }, [])

  async function handleSave() {
    if (!apiKey.trim()) {
      return
    }
    setSaving(true)
    await saveConfig({
      apiKey: apiKey.trim(),
      apiBase: apiBase.trim() || DEFAULT_API_BASE,
      model: model.trim() || DEFAULT_MODEL,
    })
    setSaving(false)
    dismiss()
  }

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle="API 设置"
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem
              placement="topBarLeading"
            >
              <Button
                title="取消"
                action={() => dismiss()}
              />
            </ToolbarItem>
            <ToolbarItem
              placement="topBarTrailing"
            >
              <Button
                title={saving ? "保存中…" : "保存"}
                action={handleSave}
                disabled={saving || !apiKey.trim()}
              />
            </ToolbarItem>
          </Toolbar>
        }
      >
        {/* API 凭证 */}
        <Section
          header={<Text>API 凭证</Text>}
          footer={<Text>在智谱开放平台获取 API Key，仅保存在本机 App Group 目录中。</Text>}
        >
          <SecureField
            title="API Key"
            prompt="输入你的智谱 API Key"
            value={apiKey}
            onChanged={setApiKey}
          />
        </Section>

        {/* 模型与服务端点 */}
        <Section
          header={<Text>模型与服务端点</Text>}
          footer={<Text>一般无需修改；如需切换模型或私有部署，可在此调整。</Text>}
        >
          <TextField
            title="API Base URL"
            prompt="API 基础地址"
            value={apiBase}
            onChanged={setApiBase}
          />
          <TextField
            title="模型名称"
            prompt="模型名称"
            value={model}
            onChanged={setModel}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}
