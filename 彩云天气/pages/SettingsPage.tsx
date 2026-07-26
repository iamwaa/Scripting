import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  VStack,
  ZStack,
  useState,
} from "scripting"
import { FormRow } from "../components/FormRow"
import { PageBackground } from "../components/PageBackground"
import { GlassBadge } from "../components/glass"
import { textColor, weatherCardProps, weatherListChrome } from "../components/tokens"
import {
  clearApiToken,
  hasApiToken,
  loadApiToken,
  saveApiToken,
} from "../services/settingsService"

function maskToken(token: string): string {
  const t = token.trim()
  if (!t) return "未配置"
  if (t.length <= 8) return "••••"
  return `${t.slice(0, 4)}••••${t.slice(-4)}`
}

export function SettingsPage({
  onTokenSaved,
}: {
  onTokenSaved?: () => void
}) {
  const dismiss = Navigation.useDismiss()
  const [token, setToken] = useState(() => loadApiToken())
  const [savedHint, setSavedHint] = useState<string | null>(null)
  const configured = hasApiToken()

  const onSave = () => {
    const trimmed = token.trim()
    if (!trimmed) {
      setSavedHint("请填写 Token 后再保存")
      return
    }
    saveApiToken(trimmed)
    setToken(trimmed)
    setSavedHint("Token 已保存")
    onTokenSaved?.()
  }

  const onClear = async () => {
    const ok = await Dialog.confirm("清除后需要重新填写才能查询天气。", "清除 Token")
    if (ok !== true) return
    clearApiToken()
    setToken("")
    setSavedHint("已清除 Token")
    onTokenSaved?.()
  }

  return (
    <NavigationStack>
      <ZStack alignment="top" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <PageBackground />
        <List
          {...weatherListChrome}
          navigationTitle="设置"
          navigationBarTitleDisplayMode="inline"
          toolbar={{
            topBarLeading: (
              <Button title="" systemImage="xmark" action={dismiss} />
            ),
            topBarTrailing: (
              <Button title="保存" action={onSave} />
            ),
          }}
        >
          {/* 不用 Section footer，避免系统页脚条带背景 */}
          <Section
            header={
              <Text font="subheadline" fontWeight="semibold" foregroundStyle={textColor.secondary}>
                彩云 Token
              </Text>
            }
          >
            <VStack alignment="leading" spacing={12} {...weatherCardProps}>
              <FormRow
                label="Token"
                value={token}
                prompt="粘贴你的彩云 Token"
                onChanged={value => {
                  setToken(value)
                  setSavedHint(null)
                }}
                secure
                labelWidth={56}
              />
              <HStack spacing={8}>
                <GlassBadge style={configured ? "info" : "warning"}>
                  <Text font={11} fontWeight="medium">
                    {configured ? "已配置" : "未配置"}
                  </Text>
                </GlassBadge>
                <Text font="caption" foregroundStyle={textColor.secondary}>
                  {maskToken(loadApiToken())}
                </Text>
              </HStack>
              {savedHint ? (
                <Text
                  font="footnote"
                  foregroundStyle={savedHint.includes("请填写") ? "systemOrange" : "systemGreen"}
                >
                  {savedHint}
                </Text>
              ) : null}
              <Text font="caption" foregroundStyle={textColor.secondary}>
                请在彩云天气开放平台申请 Token 并粘贴到此处。
              </Text>
            </VStack>
          </Section>

          {configured ? (
            <Section>
              {/* 行本身做玻璃底，避免 Button 包一层产生不透明白底 */}
              <HStack spacing={10} {...weatherCardProps}>
                <Button action={onClear} buttonStyle="plain">
                  <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                    <Image systemName="trash" font={16} foregroundStyle="systemRed" />
                    <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      <Text font="body" fontWeight="medium" foregroundStyle={textColor.primary}>
                        清除 Token
                      </Text>
                      <Text font="caption" foregroundStyle={textColor.secondary}>
                        清除后需重新填写才能查询
                      </Text>
                    </VStack>
                  </HStack>
                </Button>
              </HStack>
            </Section>
          ) : null}
        </List>
      </ZStack>
    </NavigationStack>
  )
}
