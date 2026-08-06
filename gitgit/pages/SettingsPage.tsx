/**
 * pages/SettingsPage.tsx - 设置页
 *
 * 配置 Git 提交身份（user.name / user.email）与 GitHub Token。
 * Token 用 SecureField 输入，保存到 Keychain。
 * 提示框统一用声明式 alert，避免部分场景命令式弹窗不显示。
 */

import {
  List,
  Section,
  Text,
  HStack,
  Button,
  Toggle,
  Image,
  Navigation,
  Toolbar,
  ToolbarItem,
  useState,
  useEffect,
  useRef,
} from "scripting"
import { FormRow } from "../components/FormRow"
import { AvatarView } from "../components/AvatarView"
import {
  getIdentity,
  setIdentity,
  hasToken,
  setToken,
  clearToken,
  getVerifiedUser,
  saveVerifiedUser,
} from "../services/authStore"
import {
  readNotifyEnabled,
  writeNotifyEnabled,
} from "../services/storage"
import { verifyToken, getCurrentUser } from "../api/githubApi"
import type { GitIdentity } from "../services/authStore"
import type { VerifiedGithubUser } from "../types/git"
import {
  COLOR_SECONDARY_LABEL,
  COLOR_GREEN,
  COLOR_ACCENT,
} from "../constants/colors"

type AlertState = { title: string; message: string } | null

export function SettingsPage() {
  // 与仓库 Tab 一致：左上角关闭 present 根界面
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [token, setTokenState] = useState("")
  const [tokenConfigured, setTokenConfigured] = useState(false)
  const [githubUser, setGithubUser] = useState<VerifiedGithubUser | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [savingIdentity, setSavingIdentity] = useState(false)
  const [showClearAlert, setShowClearAlert] = useState(false)
  const [alertState, setAlertState] = useState<AlertState>(null)
  // 同步读 Storage，避免 useState(true) 先显示开、load 后再变关
  const [notifyEnabled, setNotifyEnabled] = useState(() => readNotifyEnabled())
  // Toggle 挂载/受控同步时可能误触 onChanged(false)，首帧内忽略写盘
  const notifyWriteReadyRef = useRef(false)

  useEffect(() => {
    loadSettings()
    notifyWriteReadyRef.current = true
  }, [])

  function showAlert(title: string, message: string) {
    setAlertState({ title, message })
  }

  async function loadSettings() {
    const identity = await getIdentity()
    if (identity) {
      setName(identity.name)
      setEmail(identity.email)
    }
    const configured = hasToken()
    setTokenConfigured(configured)
    // 恢复上次验证成功的用户；token 不存在时验证状态已随清除作废
    const verified = configured ? getVerifiedUser() : null
    setGithubUser(verified)
    // 旧缓存只有用户名没有头像：后台拉取补齐并回写缓存，失败静默（验证按钮在用户已认证时隐藏，不补齐老用户永远看不到头像）
    if (verified && !verified.avatarUrl) {
      getCurrentUser()
        .then((user) => {
          const next = { login: user.login, avatarUrl: user.avatarUrl || "" }
          setGithubUser(next)
          try {
            saveVerifiedUser(next)
          } catch {
            // 忽略持久化失败
          }
        })
        .catch(() => {})
    }
  }

  function handleNotifyChanged(value: boolean) {
    if (!notifyWriteReadyRef.current) {
      // 挂载期误触：不写 Storage，用当前存储值把开关拉回
      setNotifyEnabled(readNotifyEnabled())
      return
    }
    if (value === notifyEnabled) return
    try {
      writeNotifyEnabled(value)
      setNotifyEnabled(value)
    } catch (e: any) {
      showAlert("保存失败", String(e?.message || e))
    }
  }

  async function handleSaveIdentity() {
    setSavingIdentity(true)
    try {
      const n = name.trim()
      const e = email.trim()
      // 允许清空：清空后走默认 gitgit
      if (!n && !e) {
        await setIdentity({ name: "", email: "" })
        showAlert("已清除", "将使用默认身份 gitgit / gitgit@local")
        return
      }
      if (!n || !e) {
        showAlert("gitgit", "姓名与邮箱需同时填写，或全部留空使用默认")
        return
      }
      const identity: GitIdentity = { name: n, email: e }
      await setIdentity(identity)
      showAlert("已保存", "Git 身份已更新")
    } catch (e: any) {
      showAlert("保存失败", String(e?.message || e))
    } finally {
      setSavingIdentity(false)
    }
  }

  // 保存 token：先写 Keychain，再验证；验证失败不清 token
  async function handleSaveToken() {
    const trimmed = token.trim()
    if (!trimmed) {
      showAlert("gitgit", "请输入 Token")
      return
    }
    try {
      setToken(trimmed)
    } catch (e: any) {
      showAlert("保存失败", String(e?.message || e))
      return
    }
    setTokenConfigured(true)
    setTokenState("")
    setVerifying(true)
    try {
      const user = await verifyToken()
      const verified = { login: user.login, avatarUrl: user.avatarUrl || "" }
      setGithubUser(verified)
      // 持久化失败仅影响下次进入页面的验证状态显示，不吞掉本次验证成功
      try {
        saveVerifiedUser(verified)
      } catch {
        // 忽略持久化失败
      }
      showAlert("验证成功", `已认证为 @${user.login}`)
    } catch (e: any) {
      setGithubUser(null)
      showAlert(
        "Token 已保存",
        `但验证未通过（${String(e?.message || e)}）。token 已保存，可稍后重试验证。`
      )
    } finally {
      setVerifying(false)
    }
  }

  function confirmClearToken() {
    setShowClearAlert(true)
  }

  function doClearToken() {
    setShowClearAlert(false)
    try {
      clearToken()
      setTokenConfigured(false)
      setGithubUser(null)
    } catch (e: any) {
      showAlert("清除失败", String(e?.message || e))
    }
  }

  async function handleReverify() {
    setVerifying(true)
    try {
      const user = await verifyToken()
      const verified = { login: user.login, avatarUrl: user.avatarUrl || "" }
      setGithubUser(verified)
      // 持久化失败仅影响下次进入页面的验证状态显示，不吞掉本次验证成功
      try {
        saveVerifiedUser(verified)
      } catch {
        // 忽略持久化失败
      }
      showAlert("验证成功", `已认证为 @${user.login}`)
    } catch (e: any) {
      showAlert("验证失败", String(e?.message || e))
    } finally {
      setVerifying(false)
    }
  }

  // 清除确认优先，否则显示普通提示
  const activeAlert = showClearAlert
    ? {
        title: "清除 Token？",
        message: "移除后需要重新输入才能进行远端操作。",
        isConfirm: true as const,
      }
    : alertState
      ? {
          title: alertState.title,
          message: alertState.message,
          isConfirm: false as const,
        }
      : null

  return (
    <List
      navigationTitle="设置"
      navigationBarTitleDisplayMode="large"
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarLeading">
            <Button action={dismiss}>
              <Image systemName="xmark" fontWeight="semibold" foregroundStyle="red" />
            </Button>
          </ToolbarItem>
        </Toolbar>
      }
      alert={{
        title: activeAlert?.title ?? "",
        message: <Text>{activeAlert?.message ?? ""}</Text>,
        isPresented: activeAlert != null,
        onChanged: (presented: boolean) => {
          if (!presented) {
            setShowClearAlert(false)
            setAlertState(null)
          }
        },
        actions: activeAlert?.isConfirm ? (
          <>
            <Button
              title="取消"
              role="cancel"
              action={() => setShowClearAlert(false)}
            />
            <Button title="清除" role="destructive" action={doClearToken} />
          </>
        ) : (
          <Button title="好" role="cancel" action={() => setAlertState(null)} />
        ),
      }}
    >
      <Section
        header={<Text>通知</Text>}
        footer={
          <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
            提交、推送、拉取、克隆完成后的系统通知
          </Text>
        }
      >
        <Toggle
          title="推送通知"
          systemImage="bell"
          value={notifyEnabled}
          onChanged={handleNotifyChanged}
        />
      </Section>
      
      <Section
        header={<Text>Git 身份</Text>}
        footer={
          <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
            不填写则默认使用 gitgit / gitgit@local 提交与拉取合并
          </Text>
        }
      >
        <FormRow label="姓名" value={name} prompt="gitgit" onChanged={setName} />
        <FormRow label="邮箱" value={email} prompt="gitgit@local" onChanged={setEmail} />
        <Button
          title={savingIdentity ? "保存中…" : "保存身份"}
          action={handleSaveIdentity}
          disabled={savingIdentity}
        />
      </Section>

      <Section
        header={<Text>GitHub Token</Text>}
        footer={
          <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
            Token 需开启 repo 权限
          </Text>
        }
      >
        <HStack alignment="center" spacing={6}>
          {githubUser ? (
            <AvatarView url={githubUser.avatarUrl} size={20} />
          ) : (
            <Image
              systemName={tokenConfigured ? "checkmark.shield.fill" : "key.fill"}
              foregroundStyle={
                tokenConfigured ? COLOR_GREEN : COLOR_SECONDARY_LABEL
              }
            />
          )}
          <Text font="subheadline" foregroundStyle={COLOR_SECONDARY_LABEL}>
            {githubUser
              ? `已认证 @${githubUser.login}`
              : tokenConfigured
                ? "Token 已配置（未验证）"
                : "未配置 Token"}
          </Text>
        </HStack>

        {!tokenConfigured ? (
          <>
            <FormRow
              label="Token"
              value={token}
              prompt="ghp_… / github_pat_…"
              onChanged={setTokenState}
              secure
            />
            <Button
              title={verifying ? "保存并验证中…" : "保存并验证"}
              action={handleSaveToken}
              disabled={verifying || !token.trim()}
            />
          </>
        ) : (
          <>
            {githubUser ? null : (
              <Button
                title={verifying ? "验证中…" : "重新验证"}
                action={handleReverify}
                disabled={verifying}
              />
            )}
            <Button
              title="清除 Token"
              role="destructive"
              action={confirmClearToken}
            />
          </>
        )}
      </Section>
    </List>
  )
}
