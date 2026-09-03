import { useState, useEffect, Navigation, Form, Section, Text, Button, Picker, Toggle, HStack, Spacer, Image, ProgressView, DatePicker, Toolbar, ToolbarItem } from "scripting"
import type { Account, AccountDraft, AccountPlatform, SelfInfo } from "../types"
import { normalizeBaseUrl, shortUrl, timeStringToTimestamp } from "../utils/format"
import { getErrorMessage, showConfirm } from "../utils/error"
import { loadAccounts, patchAccount, getSecret } from "../services/storage"
import { getWebLoginCookie, fetchSelf } from "../services/auth"
import { upsertAccount, findDuplicateSiteAccounts } from "../services/account"
import { LabeledTextField } from "../components/FormFields"

// 添加/编辑账号页面
export function AddEditView({ initial, onSaved }: { initial?: Account, onSaved: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(initial?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "")
  const [checkinSite, setCheckinSite] = useState(initial?.checkinSite ?? "")
  const [platform, setPlatform] = useState<AccountPlatform>(initial?.platform ?? "newapi")
  const [username, setUsername] = useState(initial?.username ?? "")
  const [password, setPassword] = useState(initial ? getSecret(initial.passwordKey) : "")
  const [cookie, setCookie] = useState(initial ? getSecret(initial.cookieKey) : "")
  const [accessToken, setAccessToken] = useState(initial ? getSecret(initial.accessTokenKey) : "")
  const [checkinTime, setCheckinTime] = useState(initial?.checkinTime ?? "")
  // 仅记录账号：不兼容平台只保存站点与账号信息，无需填写登录信息
  const [recordOnly, setRecordOnly] = useState(initial?.recordOnly === true)
  // 已有账号快照，用于实时提示站点重复
  const [existingAccounts, setExistingAccounts] = useState<Account[]>([])
  const [webSelf, setWebSelf] = useState<SelfInfo | undefined>(initial?.lastSelf)
  const [cookieAuthSource, setCookieAuthSource] = useState<Account["authSource"] | undefined>(undefined)
  const [webBusy, setWebBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toastMessage, setToastMessage] = useState("")
  const [showToast, setShowToast] = useState(false)

  useEffect(() => {
    setExistingAccounts(loadAccounts())
  }, [])

  const duplicateAccounts = findDuplicateSiteAccounts(existingAccounts, baseUrl, initial?.id)
  const duplicateNames = duplicateAccounts.map(item => item.name).join("、")

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
    // 保存前确认重复站点，避免误添加重复账号
    const duplicates = findDuplicateSiteAccounts(loadAccounts(), baseUrl, initial?.id)
    if (duplicates.length > 0) {
      const confirmed = await showConfirm({
        title: "站点重复",
        message: `已有账号使用相同站点：${duplicates.map(item => item.name).join("、")}\n${normalizeBaseUrl(baseUrl)}\n\n仍要保存吗？`,
        confirmLabel: "继续保存",
        cancelLabel: "取消",
        destructive: false,
      })
      if (!confirmed) return
    }
    setSaving(true)
    try {
      const saved = upsertAccount({
        id: initial?.id,
        name,
        baseUrl,
        checkinSite,
        platform,
        username,
        password,
        cookie,
        accessToken,
        checkinTime,
        lastSelf: webSelf,
        recordOnly,
        authSource: accessToken.trim() ? "accessToken" : cookie.trim() ? (cookieAuthSource ?? "cookie") : undefined,
      })
      // 保存后自动用令牌（或会话 Cookie）查询用户信息；访问令牌账号由此自动解析用户 ID
      let balanceMessage = "，余额信息已更新"
      if (recordOnly) {
        // 仅记录账号不调用任何接口
        balanceMessage = "（仅记录账号，不查询余额）"
      } else {
        try {
          const self = await fetchSelf(saved)
          patchAccount(saved.id, { lastSelf: self, lastError: "" })
          if (accessToken.trim() && !self?.id) {
            balanceMessage = "，但未能自动解析用户 ID，该站点可能不支持令牌查询用户信息"
          }
        } catch (e: any) {
          balanceMessage = accessToken.trim()
            ? `，但未能用访问令牌解析用户 ID，请检查令牌是否有效（${getErrorMessage(e)}）`
            : `，但余额查询失败：${getErrorMessage(e)}`
          patchAccount(saved.id, { lastError: getErrorMessage(e) })
        }
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
          <Image systemName="chevron.left" fontWeight="semibold" foregroundStyle="tintColor" />
        </Button>
      </ToolbarItem>
      <ToolbarItem placement="topBarTrailing"><Button action={save} disabled={saving || webBusy}><Text fontWeight="semibold" foregroundStyle="tintColor">{saving ? "保存中..." : "保存"}</Text></Button></ToolbarItem>
    </Toolbar>}
    toast={{ message: toastMessage, isPresented: showToast, onChanged: setShowToast, position: "top" }}
  >
    <Section header={<Text>账号类型</Text>} footer={<Text>{recordOnly
      ? "只在本机记录站点与账号，不查余额不接口签到，仍可打开站点、检测连通性和手动标注签到。"
      : "适用于脚本不兼容的平台，开启后无需填登录信息。"}</Text>}>
      <Toggle title="仅记录账号" value={recordOnly} onChanged={setRecordOnly} />
    </Section>
    <Section header={<Text>基础信息</Text>} footer={<Text>签到站点仅用于网页签到，留空则使用上方站点地址。</Text>}>
      <LabeledTextField title="显示名称" value={name} onChanged={setName} prompt="主站 / 小号 A" />
      <LabeledTextField title="站点地址" value={baseUrl} onChanged={setBaseUrl} prompt={"https://example.com"} />
      {duplicateAccounts.length > 0 ? <HStack spacing={8} alignment="center">
        <Image systemName="exclamationmark.triangle.fill" foregroundStyle="systemOrange" font={13} />
        <Text font={13} foregroundStyle="systemOrange">站点重复：已有账号“{duplicateNames}”使用该站点</Text>
      </HStack> : null}
      <LabeledTextField title="签到站点" value={checkinSite} onChanged={setCheckinSite} prompt="可选，如 https://qd.example.com" />
      {recordOnly ? null : <Picker title="平台类型" value={platform} onChanged={(value: string) => setPlatform(value === "sub2api" ? "sub2api" : "newapi")}>
        <Text tag="newapi">NewAPI</Text>
        <Text tag="sub2api">Sub2API</Text>
      </Picker>}
      {recordOnly ? null : <HStack spacing={12}>
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
      </HStack>}
    </Section>
    {recordOnly ? <Section header={<Text>账号信息（可选）</Text>} footer={<Text>仅作本机备忘，不用于自动登录。</Text>}>
      <LabeledTextField title="账号" value={username} onChanged={setUsername} prompt="可选" />
      <LabeledTextField title="密码" value={password} onChanged={setPassword} prompt="可选" />
    </Section> : null}
    {recordOnly ? null : <Section header={<Text>账号密码登录</Text>} footer={<Text>{platform === "sub2api" ? "Sub2API 使用邮箱和密码登录；站点启用 Turnstile 或 2FA 时改用网页登录。" : "站点启用 Turnstile 或 2FA 时改用网页登录获取 Cookie。"}</Text>}>
      <LabeledTextField title={platform === "sub2api" ? "邮箱" : "用户名"} value={username} onChanged={setUsername} prompt="可选" />
      <LabeledTextField title="密码" value={password} onChanged={setPassword} prompt="可选" />
    </Section>}
    {!recordOnly && platform !== "sub2api" ? <Section header={<Text>访问令牌登录（NewAPI）</Text>} footer={<Text>在 NewAPI 个人设置中生成，保存后自动解析用户 ID。</Text>}>
      <LabeledTextField title="访问令牌" value={accessToken} onChanged={setAccessToken} prompt="32位 Access Token" />
    </Section> : null}
    {recordOnly ? null : <Section
      header={<Text>{platform === "sub2api" ? "网页登录令牌" : "第三方登录 Cookie"}</Text>}
      footer={<Text>{platform === "sub2api"
        ? "Sub2API 使用 localStorage.auth_token，建议用下方网页登录，也可手动粘贴。"
        : "适用于 GitHub / OIDC / LinuxDO / Discord / Telegram / 微信等第三方登录，粘贴浏览器请求头中的 Cookie。"}</Text>}
    >
      <LabeledTextField title={platform === "sub2api" ? "令牌" : "Cookie"} value={cookie} onChanged={value => { setCookie(value); setCookieAuthSource("cookie") }} axis="vertical" prompt={platform === "sub2api" ? "auth_token" : "session=...; other=..."} />
      <Button action={webLoginCookie} disabled={webBusy}>
        {webBusy ? <HStack spacing={8} alignment="center">
          <ProgressView />
          <Text foregroundStyle="systemGray4">网页登录中...</Text>
        </HStack> : <HStack spacing={8} alignment="center">
          <Image systemName="globe" foregroundStyle="tintColor" font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle="tintColor">网页登录获取 Cookie/令牌</Text>
        </HStack>}
      </Button>
    </Section>}
  </Form>
}
