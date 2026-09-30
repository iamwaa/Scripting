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
import type { Color } from "scripting"
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
  readErrorNotifyEnabled,
  writeErrorNotifyEnabled,
} from "../services/storage"
import { getHistoryCacheStats } from "../services/gitService"
import {
  buildPerformanceReport,
  clearSlowOperations,
  getSlowOperations,
} from "../utils/performance"
import { checkTokenValidity } from "../api/githubApi"
import type { GitIdentity } from "../services/authStore"
import type { VerifiedGithubUser } from "../types/git"
import {
  COLOR_SECONDARY_LABEL,
  COLOR_GREEN,
  COLOR_ACCENT,
  COLOR_ORANGE,
  COLOR_RED,
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
  // Token 常驻有效性校验：区分无效（已过期/被撤销）与无法校验（网络）
  const [tokenCheck, setTokenCheck] = useState<{
    status: "checking" | "valid" | "invalid" | "error"
    message?: string
  } | null>(null)
  const [savingIdentity, setSavingIdentity] = useState(false)
  const [showClearAlert, setShowClearAlert] = useState(false)
  const [alertState, setAlertState] = useState<AlertState>(null)
  const [diagnosticCount, setDiagnosticCount] = useState(
    () => getSlowOperations().length
  )
  // 同步读 Storage，避免 useState(true) 先显示开、load 后再变关
  const [notifyEnabled, setNotifyEnabled] = useState(() => readNotifyEnabled())
  const [errorNotifyEnabled, setErrorNotifyEnabled] = useState(() => readErrorNotifyEnabled())
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
    // 已配置 Token 时常驻校验一次有效性（后台，不阻塞设置页渲染）
    if (configured) {
      runTokenCheck()
    }
  }

  // 后台校验 Token 是否仍有效：无效时清已验证用户，无法校验时保留上次结果
  async function runTokenCheck() {
    setTokenCheck({ status: "checking" })
    const result = await checkTokenValidity()
    if (result.status === "valid") {
      const next = {
        login: result.user.login,
        avatarUrl: result.user.avatarUrl || "",
      }
      setGithubUser(next)
      setTokenCheck({ status: "valid" })
      try {
        saveVerifiedUser(next)
      } catch {
        // 忽略持久化失败
      }
    } else if (result.status === "invalid") {
      // Token 确实失效：作废已验证用户，提示重新输入
      setGithubUser(null)
      setTokenCheck({ status: "invalid", message: result.message })
    } else {
      // 无法校验（网络）：保留上次结果，仅标注
      setTokenCheck({ status: "error", message: result.message })
    }
  }

  function handleNotifyChanged(value: boolean) {
    if (!notifyWriteReadyRef.current) {
      // 挂载期误触：不写 Storage，用当前存储值把开关拉回
      setNotifyEnabled(readNotifyEnabled())
      setErrorNotifyEnabled(readErrorNotifyEnabled())
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

  function handleErrorNotifyChanged(value: boolean) {
    if (!notifyWriteReadyRef.current) {
      setErrorNotifyEnabled(readErrorNotifyEnabled())
      return
    }
    if (value === errorNotifyEnabled) return
    try {
      writeErrorNotifyEnabled(value)
      setErrorNotifyEnabled(value)
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
    setTokenCheck({ status: "checking" })
    try {
      const result = await checkTokenValidity()
      if (result.status === "valid") {
        const verified = {
          login: result.user.login,
          avatarUrl: result.user.avatarUrl || "",
        }
        setGithubUser(verified)
        setTokenCheck({ status: "valid" })
        // 持久化失败仅影响下次进入页面的验证状态显示，不吞掉本次验证成功
        try {
          saveVerifiedUser(verified)
        } catch {
          // 忽略持久化失败
        }
        showAlert("验证成功", `已认证为 @${result.user.login}`)
      } else if (result.status === "invalid") {
        setGithubUser(null)
        setTokenCheck({ status: "invalid", message: result.message })
        showAlert("Token 无效", `${result.message}。请检查后重新输入。`)
      } else {
        setTokenCheck({ status: "error", message: result.message })
        showAlert(
          "Token 已保存",
          `但无法校验（${result.message}）。token 已保存，可稍后重试验证。`
        )
      }
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
      setTokenCheck(null)
    } catch (e: any) {
      showAlert("清除失败", String(e?.message || e))
    }
  }

  // 手动验证有效性：区分有效 / 无效 / 无法校验
  async function handleReverify() {
    setVerifying(true)
    setTokenCheck({ status: "checking" })
    try {
      const result = await checkTokenValidity()
      if (result.status === "valid") {
        const verified = {
          login: result.user.login,
          avatarUrl: result.user.avatarUrl || "",
        }
        setGithubUser(verified)
        setTokenCheck({ status: "valid" })
        try {
          saveVerifiedUser(verified)
        } catch {
          // 忽略持久化失败
        }
        showAlert("验证成功", `已认证为 @${result.user.login}`)
      } else if (result.status === "invalid") {
        setGithubUser(null)
        setTokenCheck({ status: "invalid", message: result.message })
        showAlert("Token 无效", `${result.message}。请清除后重新输入。`)
      } else {
        setTokenCheck({ status: "error", message: result.message })
        showAlert("无法验证", `${result.message}。请检查网络后重试。`)
      }
    } finally {
      setVerifying(false)
    }
  }

  function handleCopyDiagnostics() {
    const cache = getHistoryCacheStats()
    const report = buildPerformanceReport({
      historyRepoCount: cache.repoCount,
      historyEntryCount: cache.entryCount,
      historyRepoLimit: cache.repoLimit,
      historyEntryLimit: cache.entryLimit,
    })
    Pasteboard.setString(report)
    setDiagnosticCount(getSlowOperations().length)
    showAlert("已复制", "性能诊断已复制到剪贴板")
  }

  function handleClearDiagnostics() {
    clearSlowOperations()
    setDiagnosticCount(0)
    showAlert("已清除", "内存中的性能诊断已清除")
  }

  // Token 状态行的图标/颜色/文案（区分未配置/校验中/有效/无效/无法校验）
  const tokenStatus: { icon: string; color: Color; text: string } = (() => {
    if (!tokenConfigured) {
      return { icon: "key.fill", color: COLOR_SECONDARY_LABEL, text: "未配置 Token" }
    }
    if (tokenCheck?.status === "checking") {
      return {
        icon: "arrow.triangle.2.circlepath",
        color: COLOR_SECONDARY_LABEL,
        text: "正在验证有效性…",
      }
    }
    if (tokenCheck?.status === "invalid") {
      return {
        icon: "xmark.shield.fill",
        color: COLOR_RED,
        text: `Token 无效：${tokenCheck.message || "请重新输入"}`,
      }
    }
    if (tokenCheck?.status === "error") {
      return {
        icon: "exclamationmark.triangle.fill",
        color: COLOR_ORANGE,
        text: githubUser
          ? `已认证 @${githubUser.login}（本次无法校验）`
          : "Token 已配置（无法校验）",
      }
    }
    if (githubUser) {
      return {
        icon: "checkmark.shield.fill",
        color: COLOR_GREEN,
        text: `已认证 @${githubUser.login}`,
      }
    }
    return {
      icon: "checkmark.shield.fill",
      color: COLOR_GREEN,
      text: "Token 已配置",
    }
  })()

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
      onAppear={() => setDiagnosticCount(getSlowOperations().length)}
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
            提交、推送、拉取、克隆完成后的系统通知；失败通知为可选项
          </Text>
        }
      >
        <Toggle
          title="完成通知"
          systemImage="bell"
          value={notifyEnabled}
          onChanged={handleNotifyChanged}
        />
        <Toggle
          title="失败通知"
          systemImage="bell.badge"
          value={errorNotifyEnabled}
          onChanged={handleErrorNotifyChanged}
        />
      </Section>

      <Section
        header={<Text>GitHub Token</Text>}
        footer={
          <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
            需开启 repo 和 workflow 权限
          </Text>
        }
      >
        <HStack alignment="center" spacing={6}>
          {githubUser && tokenCheck?.status !== "invalid" ? (
            <AvatarView url={githubUser.avatarUrl} size={20} />
          ) : (
            <Image
              systemName={tokenStatus.icon}
              foregroundStyle={tokenStatus.color}
            />
          )}
          <Text font="subheadline" foregroundStyle={tokenStatus.color}>
            {tokenStatus.text}
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
            <Button
              title={verifying ? "验证中…" : "验证有效性"}
              systemImage="checkmark.shield"
              action={handleReverify}
              disabled={verifying}
            />
            <Button
              title="清除 Token"
              systemImage="trash"
              foregroundStyle="red"
              action={confirmClearToken}
            />
          </>
        )}
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
        header={<Text>性能诊断</Text>}
        footer={
          <Text font={13} foregroundStyle={COLOR_SECONDARY_LABEL}>
            仅在本次运行中保留超过 2 秒的操作，最多 30 条
          </Text>
        }
      >
        <HStack alignment="center" spacing={20}>
          <Image systemName="gauge" foregroundStyle={COLOR_ACCENT} />
          <Text>慢操作记录</Text>
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>{diagnosticCount}</Text>
        </HStack>
        <Button
          title="复制性能诊断"
          systemImage="doc.on.doc"
          action={handleCopyDiagnostics}
        />
        <Button
          title="清除诊断记录"
          systemImage="trash"
          foregroundStyle="red"
          action={handleClearDiagnostics}
          disabled={diagnosticCount === 0}
        />
      </Section>
    </List>
  )
}
