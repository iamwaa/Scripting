import { useState, useEffect, Navigation, NavigationStack, List, Section, Text, Button, HStack, Image, ProgressView, Toolbar, ToolbarItem } from "scripting"
import type { Account, CheckinStatus } from "../types"
import { isSub2ApiAccount, fmtQuota, fmtRawQuotaForAccount, localMonthString, getSelfQuotaValue, getSelfUsedQuotaValue, getSelfDisplayName, localDateString, fmtTime, getPlatformText, fmtCheckinAward, isCheckinTimeReached } from "../utils/format"
import { getErrorMessage, showConfirm } from "../utils/error"
import { loadAccounts, getSecret } from "../services/storage"
import { fetchSelf, fetchCheckinStatus, doCheckin, checkSiteStatus, loginAccount, loginByWebView, openManualCheckinWebView } from "../services/auth"
import { patchAccount, deleteAccount, getAuthSourceText, getSiteStatusView, getSiteStatusDetail, getTodayCheckinInfo, getTodayCheckinPatch, getCheckinDisabledPatch } from "../services/account"
import { CheckinCalendar } from "../components/CheckinCalendar"
import { AddEditView } from "./AddEditView"

// 账户详情页面
export function AccountDetailView({ accountId, onChanged }: { accountId: string, onChanged: () => void }) {
  const dismiss = Navigation.useDismiss()
  const initialAccount = loadAccounts().find(a => a.id === accountId)
  const [account, setAccount] = useState<Account | undefined>(initialAccount)
  const [refreshKey, setRefreshKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [checkinMonth, setCheckinMonth] = useState(localMonthString())
  const [toastMessage, setToastMessage] = useState("")
  const [showToast, setShowToast] = useState(false)

  function notify(message: string) {
    setToastMessage(message)
    setShowToast(true)
  }

  useEffect(() => {
    const next = loadAccounts().find(a => a.id === accountId)
    setAccount(next)
    setCheckinMonth(localMonthString())
    setBusy(false)
    if (next) {
      refreshDetailSilently(localMonthString(), next)
    }
  }, [accountId, refreshKey])

  function refreshLocal() {
    const next = loadAccounts().find(a => a.id === accountId)
    if (next) setAccount(next)
    setRefreshKey(prev => prev + 1)
    onChanged()
  }

  async function refreshDetailSilently(month = localMonthString(), target?: Account) {
    const latest = target ?? loadAccounts().find(item => item.id === accountId) ?? account
    if (!latest) return
    setBusy(true)
    const patch: Partial<Account> = {}
    // 并行刷新余额、签到状态、站点状态
    const [selfResult, statusResult, siteResult] = await Promise.allSettled([
      fetchSelf(latest),
      fetchCheckinStatus(latest, month),
      checkSiteStatus(latest),
    ])
    if (selfResult.status === "fulfilled") {
      patch.lastSelf = selfResult.value
      patch.lastError = ""
    } else {
      patch.lastError = getErrorMessage(selfResult.reason)
    }
    if (statusResult.status === "fulfilled") {
      patch.lastCheckin = statusResult.value
      Object.assign(patch, getTodayCheckinPatch(statusResult.value))
    } else {
      // fetchSelf 成功即表示登录有效，签到接口失败不应覆盖成登录错误，避免误报“登录失效”
      if (selfResult.status !== "fulfilled") patch.lastError = getErrorMessage(statusResult.reason)
      Object.assign(patch, getCheckinDisabledPatch((statusResult.reason as any)?.message ?? statusResult.reason))
    }
    if (siteResult.status === "fulfilled") {
      patch.lastSiteStatus = siteResult.value
    }
    patchAccount(latest.id, patch)
    const next = loadAccounts().find(a => a.id === accountId)
    if (next) setAccount(next)
    onChanged()
    setBusy(false)
  }

  async function refreshStatusSilently(month = localMonthString(), target?: Account) {
    const latest = target ?? loadAccounts().find(item => item.id === accountId) ?? account
    if (!latest) return
    setBusy(true)
    try {
      const data = await fetchCheckinStatus(latest, month)
      patchAccount(latest.id, { lastCheckin: data, lastError: "", ...getTodayCheckinPatch(data) })
      const next = loadAccounts().find(a => a.id === accountId)
      if (next) setAccount(next)
      onChanged()
    } catch (e: any) {
      const message = getErrorMessage(e)
      patchAccount(latest.id, { lastError: message, ...getCheckinDisabledPatch(message) })
      const next = loadAccounts().find(a => a.id === accountId)
      if (next) setAccount(next)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function runAction(label: string, task: (account: Account) => Promise<any>, checkinAware = false) {
    if (!account) {
      notify(`${label}失败：账号不存在或已被删除`)
      return
    }
    setBusy(true)
    try {
      await task(account)
      patchAccount(account.id, { lastError: "" })
      refreshLocal()
      notify(`${label}完成`)
    } catch (e: any) {
      const message = getErrorMessage(e)
      patchAccount(account.id, { lastError: message, ...(checkinAware ? getCheckinDisabledPatch(message) : {}) })
      refreshLocal()
      notify(`${label}失败：${message}`)
    } finally {
      setBusy(false)
    }
  }

  async function syncStatus(month = checkinMonth) {
    await runAction("签到状态", async current => {
      const latest = loadAccounts().find(item => item.id === accountId) ?? current
      const data = await fetchCheckinStatus(latest, month)
      patchAccount(latest.id, { lastCheckin: data, ...getTodayCheckinPatch(data) })
      return data
    }, true)
  }

  async function changeCheckinMonth(nextMonth: string) {
    setCheckinMonth(nextMonth)
    setBusy(true)
    try {
      const latest = loadAccounts().find(item => item.id === accountId) ?? account
      if (!latest) {
        notify("签到状态失败：账号不存在或已被删除")
        return
      }
      const data = await fetchCheckinStatus(latest, nextMonth)
      patchAccount(latest.id, { lastCheckin: data, lastError: "", ...getTodayCheckinPatch(data) })
      setAccount(loadAccounts().find(a => a.id === accountId))
      onChanged()
    } catch (e: any) {
      const message = getErrorMessage(e)
      if (account) patchAccount(account.id, { lastError: message, ...getCheckinDisabledPatch(message) })
      notify(`签到状态失败：${message}`)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function webLogin() {
    await runAction("网页登录", async a => {
      await loginByWebView(a)
      const latest = loadAccounts().find(item => item.id === a.id) ?? a
      const self = await fetchSelf(latest)
      patchAccount(a.id, { lastSelf: self, lastError: "" })
      refreshLocal()
      return self
    })
  }

  async function login() {
    await runAction("登录", async a => {
      await loginAccount(a)
      const latest = loadAccounts().find(item => item.id === a.id) ?? a
      const self = await fetchSelf(latest)
      patchAccount(a.id, { lastSelf: self, lastError: "" })
      refreshLocal()
      return self
    })
  }

  async function remove() {
    if (!account) {
      notify("删除失败：账号不存在或已被删除")
      return
    }
    const ok = await showConfirm({ title: "删除账号？", message: `确定删除 ${account.name} 吗？`, confirmLabel: "删除", cancelLabel: "取消" })
    if (!ok) return
    const deletedName = account.name
    setBusy(true)
    try {
      deleteAccount(account.id)
      onChanged()
      notify(`"${deletedName}"已删除`)
      setTimeout(() => dismiss(), 700)
    } finally {
      setBusy(false)
    }
  }

  if (!account) {
    return <List navigationTitle="账号不存在" navigationBarTitleDisplayMode="inline">
      <Section>
        <Text foregroundStyle="systemRed">账号不存在或已被删除，请返回刷新列表。</Text>
      </Section>
    </List>
  }

  const todayCheckin = getTodayCheckinInfo(account)

  return <List
    navigationTitle={account.name}
    navigationBarTitleDisplayMode="inline"
    navigationBarBackButtonHidden
    toolbar={<Toolbar>
      <ToolbarItem placement="topBarLeading">
        <Button action={dismiss}>
          <Image systemName="chevron.left" foregroundStyle="tintColor" fontWeight="semibold" />
        </Button>
      </ToolbarItem>
      <ToolbarItem placement="topBarTrailing">
        <Button action={async () => await Navigation.present(<NavigationStack><AddEditView initial={account} onSaved={refreshLocal} /></NavigationStack>)}>
          <Text fontWeight="semibold" foregroundStyle="tintColor">编辑</Text>
        </Button>
      </ToolbarItem>
    </Toolbar>}
    toast={{ message: toastMessage, isPresented: showToast, onChanged: setShowToast, position: "top" }}
  >
    <Section title="状态">
      {busy ? <HStack spacing={8}><ProgressView /><Text>处理中...</Text></HStack> : null}
      <Text>平台：{getPlatformText(account)}</Text>
      <Text>站点：{account.baseUrl}</Text>
      <Text>站点状态：{getSiteStatusDetail(account.lastSiteStatus)}</Text>
      <Text>认证：{getAuthSourceText(account)}</Text>
      <Text>更新：{fmtTime(account.updatedAt)}</Text>
      {account.lastError ? <Text foregroundStyle="systemRed">错误：{getErrorMessage(account.lastError)}</Text> : null}
    </Section>
    
    <Section title="账号操作">
      <Button action={login} disabled={busy || !(account?.username && getSecret(account?.passwordKey)) && !(getSecret(account?.accessTokenKey) && account?.lastSelf?.id)}>
        <HStack spacing={8} alignment="center">
          <Image systemName="person.crop.circle.badge.checkmark" foregroundStyle={busy || !(account?.username && getSecret(account?.passwordKey)) && !(getSecret(account?.accessTokenKey) && account?.lastSelf?.id) ? "systemGray4" : "tintColor"} font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle={busy || !(account?.username && getSecret(account?.passwordKey)) && !(getSecret(account?.accessTokenKey) && account?.lastSelf?.id) ? "systemGray4" : "tintColor"}>登录账号</Text>
        </HStack>
      </Button>
      <Button action={webLogin} disabled={busy}>
        <HStack spacing={8} alignment="center">
          <Image systemName="globe" foregroundStyle={busy ? "systemGray4" : "tintColor"} font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle={busy ? "systemGray4" : "tintColor"}>网页登录获取 Cookie/令牌</Text>
        </HStack>
      </Button>
      <Button action={remove} disabled={busy}>
        <HStack spacing={8} alignment="center">
          <Image systemName="trash" foregroundStyle={busy ? "systemGray4" : "systemRed"} font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle={busy ? "systemGray4" : "systemRed"}>删除账号</Text>
        </HStack>
      </Button>
    </Section>
    
    <Section title="余额">
      <Text>用户 ID：{account.lastSelf?.id ?? "-"}</Text>
      <Text>用户名：{getSelfDisplayName(account.lastSelf) ?? account.username ?? "-"}</Text>
      <Text>分组：{account.lastSelf?.group ?? "-"}</Text>
      <Text>剩余额度：{fmtQuota(getSelfQuotaValue(account.lastSelf))} ({fmtRawQuotaForAccount(account, getSelfQuotaValue(account.lastSelf))})</Text>
      <Text>已用额度：{fmtQuota(getSelfUsedQuotaValue(account.lastSelf))} ({fmtRawQuotaForAccount(account, getSelfUsedQuotaValue(account.lastSelf))})</Text>
      {isSub2ApiAccount(account) ? <Text>并发：{account.lastSelf?.concurrency ?? "-"}</Text> : null}
      <Text>请求次数：{account.lastSelf?.request_count ?? "-"}</Text>
    </Section>

    <Section title="签到">
      {account.excludeFromBatchCheckin ? <Text foregroundStyle="systemOrange">⚠️ 已排除批量签到（仅网页签到）</Text> : null}
      <Text>今日状态：{todayCheckin.checked ? `已签到${todayCheckin.record?.quota_awarded !== undefined ? `，奖励 ${fmtCheckinAward(todayCheckin.record.quota_awarded)}` : ""}` : (() => {
        const checkinTime = account.checkinTime
        const checkinTimeReached = checkinTime ? isCheckinTimeReached(checkinTime) : true
        return checkinTime && !checkinTimeReached ? `未签到（签到时间 ${checkinTime}）` : "未签到"
      })()}</Text>
      <Text>功能启用：{account.lastCheckin?.enabled === undefined ? "未知" : account.lastCheckin.enabled ? "是" : "否"}</Text>
      <Text>奖励范围：{isSub2ApiAccount(account) ? fmtQuota(account.lastCheckin?.min_quota) : `${fmtQuota(account.lastCheckin?.min_quota)} ~ ${fmtQuota(account.lastCheckin?.max_quota)}`}</Text>
      <CheckinCalendar
        month={checkinMonth}
        status={account.lastCheckin}
        busy={busy}
        onChangeMonth={changeCheckinMonth}
        onRefresh={() => syncStatus(checkinMonth)}
      />
    </Section>
  </List>
}
