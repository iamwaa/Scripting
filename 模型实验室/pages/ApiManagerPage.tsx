import { Button, HStack, Image, List, NavigationLink, Section, Text, VStack } from "scripting"
import { ApiProfile, AppConfig } from "../types"
import { addApi, apiDisplayName, apiSummary, createApi, maskApiKey, removeApi, updateApi } from "../utils/apiProfiles"
import { ApiEditorPage } from "./ApiEditorPage"

export function ApiManagerPage({ config, onChanged }: { config: AppConfig; onChanged: (config: AppConfig) => void }) {
  function appendApi() {
    onChanged(addApi(config, createApi()))
  }

  function activate(id: string) {
    onChanged({ ...config, activeApiID: id })
  }

  async function confirmRemove(api: ApiProfile) {
    const confirmed = await Dialog.confirm({
      title: "删除接口",
      message: `删除「${apiDisplayName(api)}」后，它的地址与密钥会一并从本机移除。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (confirmed !== true) return
    onChanged(removeApi(config, api.id))
  }

  function apiRow(api: ApiProfile) {
    const isActive = api.id === config.activeApiID
    // 滑动菜单数组第一项贴屏幕右缘，所以「删除」放最外侧、「设为当前」在内侧
    const actions = [<Button key="delete" title="删除" tint="red" action={() => void confirmRemove(api)} />]
    if (!isActive) actions.push(<Button key="activate" title="设为当前" tint="blue" action={() => activate(api.id)} />)
    return (
      <NavigationLink
        key={api.id}
        trailingSwipeActions={{ allowsFullSwipe: false, actions }}
        destination={
          <ApiEditorPage
            api={api}
            isActive={isActive}
            onChanged={patch => onChanged(updateApi(config, api.id, patch))}
            onActivate={() => activate(api.id)}
          />
        }
      >
        <HStack alignment="center" spacing={10} frame={{ maxWidth: Infinity }}>
          <Image
            systemName={isActive ? "checkmark.circle.fill" : "circle"}
            foregroundStyle={isActive ? "blue" : "tertiaryLabel"}
            font={15}
            imageScale="small"
            frame={{ width: 26, alignment: "center" }}
          />
          <VStack alignment="leading" spacing={3} frame={{ maxWidth: Infinity, alignment: "leading" }}>
            <Text>{apiDisplayName(api)}</Text>
            <Text foregroundStyle="secondaryLabel" font={12} lineLimit={1}>{apiSummary(api)}</Text>
            <Text foregroundStyle="tertiaryLabel" font={11}>{maskApiKey(api.apiKey)}</Text>
          </VStack>
        </HStack>
      </NavigationLink>
    )
  }

  return (
    <List
      navigationTitle="接口管理"
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      toolbar={{ confirmationAction: <Button title="添加" action={appendApi} /> }}
    >
      <Section header={<Text>接口列表</Text>} footer={<Text>点按接口进入编辑，左滑可删除或设为当前。全部接口与密钥保存在本机，重开脚本后仍在。</Text>}>
        {config.apis.length === 0 ? (
          <>
            <Text foregroundStyle="secondaryLabel">尚未添加接口</Text>
            <Button title="添加接口" systemImage="plus.circle" action={appendApi} />
          </>
        ) : config.apis.map(apiRow)}
      </Section>
    </List>
  )
}
