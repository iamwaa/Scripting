import { useState, Navigation, Form, Section, Text, Button, Picker, HStack, Spacer, Image, ProgressView, DatePicker, Toolbar, ToolbarItem } from "scripting"
import type { Account, AccountDraft, AccountPlatform, SelfInfo } from "../types"
import { isSub2ApiAccount, getPlatformText, normalizeBaseUrl, shortUrl, timeStringToTimestamp } from "../utils/format"
import { getErrorMessage } from "../utils/error"
import { loadAccounts, patchAccount } from "../services/storage"
import { getWebLoginCookie, fetchSelf } from "../services/auth"
import { upsertAccount } from "../services/account"
import { LabeledTextField } from "../components/FormFields"

// 添加/编辑账号页面
export function AddEditView({ initial, onSaved }: { initial?: Account, onSaved: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(initial?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "")
  const [platform, setPlatform] = useState<AccountPlatform>(initial?.platform ?? "newapi")
  const [username, setUsername] = useState(initial?.username ?? "")
  const [password, setPassword] = useState("")
  const [cookie, setCookie] = useState("")
  const [accessToken, setAccessToken] = useState("")
  const [accessTokenUserId, setAccessTokenUserId] = useState("")
  const [checkinTime, setCheckinTime] = useState(initial?.checkinTime ?? "")
  const [webSelf, setWebSelf] = useState<SelfInfo | undefined>(initial?.lastSelf)
  const [cookieAuthSource, setCookieAuthSource] = useState<Account["authSource"] | undefined>(undefined)
  const [webBusy, setWebBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toastMessage, setToastMessage] = useState("")
  const [showToast, setShowToast] = useState(false)

  async function pasteCookie() {
    const text = await Pasteboard.getString()
    if (text) {
      setCookie(text)
      setCookieAuthSource("cookie")
    }
  }

  async function pasteAccessToken() {
    const text = await Pasteboard.getString()
    if (text) {
      // 支持多种格式：纯令牌、Bearer 令牌、包含 access_token 的 JSON
      let token = text.trim()
      if (token.startsWith('{')) {
        try {
          const parsed = JSON.parse(token)
          token = parsed.access_token || parsed.token || parsed.accessToken || token
        } catch {}
      }
      if (token.startsWith('Bearer ')) token = token.slice(7)
      setAccessToken(token)
    }
  }

  async function webLoginCookie() {
    setWebBusy(true)
    try {
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
      const result = await getWebLoginCookie(normalizedBaseUrl)
      const credential = platform === "sub2api" ? result.authToken : result.cookieHeader
      if (!credential) throw new Error(platform === "sub2api" ? "未获取到 Sub2API auth_token" : "未获取到 Cookie")
      setCookie(credential)
      setCookieAuthSource("web")
      if (result.storageSelf) {
        setWebSelf(result.storageSelf)
        if (!username && result.storageSelf.username) setUsername(result.storageSelf.username)
      }
      if (!name) {
        setName(result.pageTitle || shortUrl(normalizedBaseUrl))
      }
      setToastMessage(platform === "sub2api" ? "登录令牌已获取，保存账号后生效" : "Cookie 已获取，保存账号后生效")
      setShowToast(true)
    } catch (e: any) {
      setToastMessage(`网页登录失败：${getErrorMessage(e)}`)
      setShowToast(true)
    } finally {
      setWebBusy(false)
    }
  }

  async function save() {
    // 验证访问令牌必须配合用户 ID
    if (accessToken.trim() && !accessTokenUserId.trim()) {
      setToastMessage("使用访问令牌登录时，请填写用户 ID")
      setShowToast(true)
      return
    }
    if (accessTokenUserId.trim() && !Number.isFinite(Number(accessTokenUserId))) {
      setToastMessage("用户 ID 必须为数字")
      setShowToast(true)
      return
    }
    setSaving(true)
    try {
      const saved = upsertAccount({
        id: initial?.id,
        name,
        baseUrl,
        platform,
        username,
        password,
        cookie,
        accessToken,
        accessTokenUserId,
        checkinTime,
        lastSelf: webSelf,
        authSource: accessToken.trim() ? "accessToken" : cookie.trim() ? (cookieAuthSource ?? "cookie") : undefined,
      })
      let balanceMessage = "，余额信息已更新"
      try {
        const self = await fetchSelf(saved)
        patchAccount(saved.id, { lastSelf: self, lastError: "" })
      } catch (e: any) {
        balanceMessage = `，但余额查询失败：${getErrorMessage(e)}`
        patchAccount(saved.id, { lastError: getErrorMessage(e) })
      }
      onSaved()
      setToastMessage(`“${saved.name}”已保存${balanceMessage}`)
      setShowToast(true)
      setTimeout(() => dismiss(), 900)
    } catch (e: any) {
      setToastMessage(`保存失败：${getErrorMessage(e)}`)
      setShowToast(true)
    } finally {
      setSaving(false)
    }
  }

  return <Form
    navigationTitle={initial ? "编辑账号" : "添加账号"}
    navigationBarTitleDisplayMode="inline"
    toolbar={<Toolbar>
        <ToolbarItem placement="topBarLeading">
          <Button action={dismiss}>
            <Image systemName="chevron.left" fontWeight="semibold" foregroundStyle="tintColor"/>
          </Button>
        </ToolbarItem>
        <ToolbarItem placement="topBarTrailing"><Button action={save} disabled={saving || webBusy}><Text fontWeight="semibold" foregroundStyle="tintColor">{saving ? "保存中..." : "保存"}</Text></Button></ToolbarItem>
    </Toolbar>}
    toast={{ message: toastMessage, isPresented: showToast, onChanged: setShowToast, position: "top" }}
  >
    <Section title="基础信息">
      <LabeledTextField title="显示名称" value={name} onChanged={setName} prompt="主站 / 小号 A" />
      <LabeledTextField title="站点地址" value={baseUrl} onChanged={setBaseUrl} prompt={"https://example.com"} />
      <Picker title="平台类型" value={platform} onChanged={(value: string) => setPlatform(value === "sub2api" ? "sub2api" : "newapi")}>
        <Text tag="newapi">NewAPI</Text>
        <Text tag="sub2api">Sub2API</Text>
      </Picker>
      <HStack spacing={12}>
        <Text>签到时间</Text>
        <Spacer />
        <HStack spacing={0}>
          {checkinTime ? <Button action={() => setCheckinTime("")} buttonStyle="borderless" padding={{ horizontal: 0 }}>
            <Text font="subheadline" foregroundStyle="systemRed">清除</Text>
          </Button> : null}
          <DatePicker
            title=""
            displayedComponents={["hourAndMinute"]}
            value={checkinTime ? timeStringToTimestamp(checkinTime) : timeStringToTimestamp("00:00")}
            frame={{ width: 80 }}
            onChanged={(value: number) => {
              const date = new Date(value)
              const hours = `${date.getHours()}`.padStart(2, "0")
              const minutes = `${date.getMinutes()}`.padStart(2, "0")
              setCheckinTime(`${hours}:${minutes}`)
            }}
          />
        </HStack>
      </HStack>
    </Section>
    <Section header={<Text>账号密码登录</Text>} footer={<Text>{platform === "sub2api" ? "Sub2API 账号密码登录使用邮箱和密码；如果站点启用了 Turnstile 或 2FA，建议改用网页登录获取登录令牌。" : "如果站点启用了 Turnstile 或 2FA，建议改用浏览器登录后的 Cookie。"}</Text>}>
      <LabeledTextField title={platform === "sub2api" ? "邮箱" : "用户名"} value={username} onChanged={setUsername} prompt="可选" />
      <LabeledTextField title="密码" value={password} onChanged={setPassword} prompt={initial ? "留空则不修改" : "可选"} />
    </Section>
    <Section
      header={<Text>{platform === "sub2api" ? "网页登录令牌" : "第三方登录 Cookie"}</Text>}
      footer={<Text>{platform === "sub2api"
        ? `Sub2API 前端使用 localStorage.auth_token。推荐点\u201C网页登录获取 Cookie/令牌\u201D，也可以手动粘贴 auth_token。`
        : `适用于 GitHub / OIDC / LinuxDO / Discord / Telegram / 微信等第三方登录。粘贴浏览器请求头中的 Cookie。`}</Text>}
    >
      <LabeledTextField title={platform === "sub2api" ? "令牌" : "Cookie"} value={cookie} onChanged={value => { setCookie(value); setCookieAuthSource("cookie") }} axis="vertical" prompt={initial ? "留空则不修改" : platform === "sub2api" ? "auth_token" : "session=...; other=..."} />
      <Button action={webLoginCookie} disabled={webBusy}>
        {webBusy ? <HStack spacing={8} alignment="center">
          <ProgressView />
          <Text foregroundStyle="systemGray4">网页登录中...</Text>
        </HStack> : <HStack spacing={8} alignment="center">
          <Image systemName="globe" foregroundStyle="tintColor" font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle="tintColor">网页登录获取 Cookie/令牌</Text>
        </HStack>}
      </Button>
      <Button action={pasteCookie}>
        <HStack spacing={8} alignment="center">
          <Image systemName="doc.on.clipboard" foregroundStyle="tintColor" font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle="tintColor">{platform === "sub2api" ? "从剪贴板粘贴令牌" : "从剪贴板粘贴 Cookie"}</Text>
        </HStack>
      </Button>
    </Section>
    {platform !== "sub2api" ? <Section header={<Text>访问令牌登录（NewAPI）</Text>} footer={<Text>适用于 NewAPI 站点的访问令牌（Access Token），可在个人设置中生成。使用访问令牌时需要填写用户 ID，可从页面 URL 或 API 响应中获取。</Text>}>
      <LabeledTextField title="访问令牌" value={accessToken} onChanged={setAccessToken} prompt="32位 Access Token" />
      <LabeledTextField title="用户 ID" value={accessTokenUserId} onChanged={setAccessTokenUserId} prompt="必填，用户数字 ID" />
      <Button action={pasteAccessToken}>
        <HStack spacing={8} alignment="center">
          <Image systemName="doc.on.clipboard" foregroundStyle="tintColor" font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle="tintColor">从剪贴板粘贴访问令牌</Text>
        </HStack>
      </Button>
    </Section> : null}
  </Form>
}
