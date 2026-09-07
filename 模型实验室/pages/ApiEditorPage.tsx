import { Button, Form, HStack, Image, Section, Text } from "scripting"
import { FormRow } from "../components/FormRow"
import { ApiProfile } from "../types"
import { apiDisplayName } from "../utils/apiProfiles"

export function ApiEditorPage({ api, isActive, onChanged, onActivate }: {
  api: ApiProfile
  isActive: boolean
  onChanged: (patch: Partial<ApiProfile>) => void
  onActivate: () => void
}) {
  return (
    <Form navigationTitle={apiDisplayName(api)} navigationBarTitleDisplayMode="inline" tabBarVisibility="hidden">
      <Section header={<Text>接口信息</Text>} footer={<Text>地址填到兼容路径为止（通常以 /v1 结尾），/models 与 /chat/completions 会自动拼接。名称留空时列表显示地址主机名。</Text>}>
        <FormRow label="名称" value={api.name} prompt="例如 官方直连" onChanged={value => onChanged({ name: value })} labelWidth={58} />
        <FormRow label="URL" value={api.baseURL} prompt="https://example.com/v1" onChanged={value => onChanged({ baseURL: value })} labelWidth={58} />
        <FormRow label="KEY" value={api.apiKey} prompt="sk-..." onChanged={value => onChanged({ apiKey: value })} labelWidth={58} />
      </Section>
      <Section header={<Text>当前接口</Text>} footer={<Text>修改即时保存在本机，删除请在接口列表左滑。</Text>}>
        {isActive ? (
          <HStack alignment="center" spacing={8}>
            <Image systemName="checkmark.circle.fill" foregroundStyle="green" font={15} imageScale="small" />
            <Text foregroundStyle="green">正在使用这个接口</Text>
          </HStack>
        ) : (
          <Button title="设为当前接口" systemImage="checkmark.circle" action={onActivate} />
        )}
      </Section>
    </Form>
  )
}
