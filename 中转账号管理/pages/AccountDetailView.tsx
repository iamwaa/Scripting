import { useState, useEffect, useRef, Navigation, NavigationStack, List, Section, Text, Button, HStack, Image, ProgressView, Toolbar, ToolbarItem } from "scripting"
import type { Account, CheckinStatus } from "../types"
import { isSub2ApiAccount, fmtQuota, fmtRawQuotaForAccount, localMonthString, getSelfQuotaValue, getSelfUsedQuotaValue, getSelfDisplayName, fmtTime, getAccountTypeText, isRecordOnlyAccount, fmtCheckinAward, isCheckinTimeReached } from "../utils/format"
import { getErrorMessage, showConfirm } from "../utils/error"
import { loadAccounts, getSecret } from "../services/storage"
import { fetchSelf, fetchCheckinStatus, checkSiteStatus, loginAccount, loginByWebView } from "../services/auth"
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
  // 当前执行中的操作名，用于进度提示
  const [busyLabel, setBusyLabel] = useState("")
  const [checkinMonth, setCheckinMonth] = useState(localMonthString())
  const [toastMessage, setToastMessage] = useState("")
  const [showToast, setShowToast] = useState(false)
  // 本页数据变更一律延后通知列表：归档/删除会让账号在列表中移动或消失，
  // 行被移除会连带销毁本页的 NavigationLink，导致返回按钮失效
  const pendingNotifyRef = useRef(false)

  function notify(message: string) {
    setToastMessage(message)
    setShowToast(true)
  }

  function markChanged() {
    pendingNotifyRef.current = true
  }

  function flushChanged() {
    if (!pendingNotifyRef.current) return
    pendingNotifyRef.current = false
    onChanged()
  }

  function goBack() {
    dismiss()
    setTimeout(flushChanged, 400)
  }

  // 手势返回等未走返回按钮的情况下兜底通知列表
  useEffect(() => flushChanged, [])

  useEffect(() => {
    const next = loadAccounts().find(a => a.id === accountId)
    setAccount(next)
    setCheckinMonth(localMonthString())
    setBusy(false)
    // 归档与仅记录账号不自动请求接口
    if (next && !next.archived && !isRecordOnlyAccount(next)) {
      refreshDetailSilently(localMonthString(), next)
    }
  }, [accountId, refreshKey])

  function refreshLocal() {
    const next = loadAccounts().find(a => a.id === accountId)
    if (next) setAccount(next)
    setRefreshKey(prev => prev + 1)
    markChanged()
  }

  async function refreshDetailSilently(month = localMonthString(), target?: Account) {
    const latest = target ?? loadAccounts().find(item => item.id === accountId) ?? account
    if (!latest) return
    setBusy(true)
    setBusyLabel("刷新账号信息中...")
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
    markChanged()
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
      markChanged()
    } catch (e: any) {
      const message = getErrorMessage(e)
      patchAccount(latest.id, { lastError: message, ...getCheckinDisabledPatch(message) })
      const next = loadAccounts().find(a => a.id === accountId)
      if (next) setAccount(next)
      markChanged()
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
    setBusyLabel(label === "签到状态" ? "更新签到状态中..." : `${label}中...`)
    try {
      await task(account)
      patchAccount(account.id, { lastError: "" })
      refreshLocal()
      const successMessage = label === "签到状态" ? "签到状态已更新" : label === "网页登录" ? "网页登录成功" : label === "登录" ? "登录成功" : `${label}完成`
      notify(successMessage)
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
    setBusyLabel("加载签到日历...")
    try {
      const latest = loadAccounts().find(item => item.id === accountId) ?? account
      if (!latest) {
        notify("签到状态失败：账号不存在或已被删除")
        return
      }
      const data = await fetchCheckinStatus(latest, nextMonth)
      patchAccount(latest.id, { lastCheckin: data, lastError: "", ...getTodayCheckinPatch(data) })
      setAccount(loadAccounts().find(a => a.id === accountId))
      markChanged()
    } catch (e: any) {
      const message = getErrorMessage(e)
      if (account) patchAccount(account.id, { lastError: message, ...getCheckinDisabledPatch(message) })
      notify(`签到状态失败：${message}`)
      markChanged()
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
    const ok = await showConfirm({
      title: "删除账号？",
      message: `确定删除“${account.name}”吗？\n\n该操作只删除本机记录，但保存的密码、Cookie/令牌和缓存数据也会一并清除，且无法撤销。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (!ok) return
    const deletedName = account.name
    setBusy(true)
    setBusyLabel("删除账号...")
    try {
      deleteAccount(account.id)
      markChanged()
      notify(`“${deletedName}”已删除`)
      setTimeout(goBack, 700)
    } finally {
      setBusy(false)
    }
  }

  // 归档 / 取消归档：归档后不再参与首页统计与批量操作
  function toggleArchive() {
    if (!account) {
      notify("操作失败：账号不存在或已被删除")
      return
    }
    const nextArchived = !account.archived
    patchAccount(account.id, { archived: nextArchived })
    setAccount(loadAccounts().find(a => a.id === accountId))
    markChanged()
    notify(nextArchived ? "已归档，不再参与首页操作" : "已取消归档")
  }

  if (!account) {
    return <List navigationTitle="账号不存在" navigationBarTitleDisplayMode="inline" tabBarVisibility="hidden">
      <Section>
        <Text foregroundStyle="systemRed">账号不存在或已被删除，请返回刷新列表。</Text>
      </Section>
    </List>
  }

  const todayCheckin = getTodayCheckinInfo(account)
  const recordOnly = isRecordOnlyAccount(account)
  // 奖励范围：min/max 不同才显示区间（新版 sub2api 连签奖励递增；单一奖励站点只显示单值）
  const minCheckinQuota = account.lastCheckin?.min_quota
  const maxCheckinQuota = account.lastCheckin?.max_quota
  const checkinRewardRangeText = minCheckinQuota !== undefined && maxCheckinQuota !== undefined && maxCheckinQuota !== minCheckinQuota
    ? `${fmtQuota(minCheckinQuota)} ~ ${fmtQuota(maxCheckinQuota)}`
    : fmtQuota(minCheckinQuota ?? maxCheckinQuota)

  return <List
    navigationTitle={account.name}
    navigationBarTitleDisplayMode="inline"
    navigationBarBackButtonHidden
    tabBarVisibility="hidden"
    toolbar={<Toolbar>
      <ToolbarItem placement="topBarLeading">
        <Button action={goBack}>
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
      {busy ? <HStack spacing={8}><ProgressView /><Text>{busyLabel || "处理中..."}</Text></HStack> : null}
      {account.archived ? <Text foregroundStyle="systemOrange">已归档：不计入总览，也不参与首页批量操作</Text> : null}
      {recordOnly ? <Text foregroundStyle="secondaryLabel">仅记录账号：不参与余额查询与接口签到</Text> : null}
      <Text>类型：{getAccountTypeText(account)}</Text>
      <Text>站点：{account.baseUrl}</Text>
      <Text>站点状态：{getSiteStatusDetail(account.lastSiteStatus)}</Text>
      <Text>认证：{getAuthSourceText(account)}</Text>
      <Text>更新：{fmtTime(account.updatedAt)}</Text>
      {account.lastError ? <Text foregroundStyle="systemRed">错误：{getErrorMessage(account.lastError)}</Text> : null}
    </Section>
    
    <Section title="账号操作">
      {recordOnly ? null : <Button action={login} disabled={busy || !(account?.username && getSecret(account?.passwordKey)) && !(getSecret(account?.accessTokenKey) && account?.lastSelf?.id)}>
        <HStack spacing={8} alignment="center">
          <Image systemName="person.crop.circle.badge.checkmark" foregroundStyle={busy || !(account?.username && getSecret(account?.passwordKey)) && !(getSecret(account?.accessTokenKey) && account?.lastSelf?.id) ? "systemGray4" : "tintColor"} font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle={busy || !(account?.username && getSecret(account?.passwordKey)) && !(getSecret(account?.accessTokenKey) && account?.lastSelf?.id) ? "systemGray4" : "tintColor"}>登录账号</Text>
        </HStack>
      </Button>}
      {recordOnly ? null : <Button action={webLogin} disabled={busy}>
        <HStack spacing={8} alignment="center">
          <Image systemName="globe" foregroundStyle={busy ? "systemGray4" : "tintColor"} font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle={busy ? "systemGray4" : "tintColor"}>网页登录获取 Cookie/令牌</Text>
        </HStack>
      </Button>}
      <Button action={toggleArchive} disabled={busy}>
        <HStack spacing={8} alignment="center">
          <Image systemName={account.archived ? "tray.and.arrow.up" : "archivebox"} foregroundStyle={busy ? "systemGray4" : "tintColor"} font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle={busy ? "systemGray4" : "tintColor"}>{account.archived ? "取消归档" : "归档账号"}</Text>
        </HStack>
      </Button>
      <Button action={remove} disabled={busy}>
        <HStack spacing={8} alignment="center">
          <Image systemName="trash" foregroundStyle={busy ? "systemGray4" : "systemRed"} font="body" frame={{ width: 24, alignment: "center" }} />
          <Text foregroundStyle={busy ? "systemGray4" : "systemRed"}>删除账号</Text>
        </HStack>
      </Button>
    </Section>
    
    {recordOnly ? <Section title="账号信息">
      <Text>账号：{account.username || "未填写"}</Text>
      <Text>密码：{getSecret(account.passwordKey) ? "已保存" : "未保存"}</Text>
    </Section> : <Section title="余额">
      <Text>用户 ID：{account.lastSelf?.id ?? "-"}</Text>
      <Text>用户名：{getSelfDisplayName(account.lastSelf) ?? account.username ?? "-"}</Text>
      <Text>分组：{account.lastSelf?.group ?? "-"}</Text>
      <Text>剩余额度：{fmtQuota(getSelfQuotaValue(account.lastSelf))} ({fmtRawQuotaForAccount(account, getSelfQuotaValue(account.lastSelf))})</Text>
      <Text>已用额度：{fmtQuota(getSelfUsedQuotaValue(account.lastSelf))} ({fmtRawQuotaForAccount(account, getSelfUsedQuotaValue(account.lastSelf))})</Text>
      {isSub2ApiAccount(account) ? <Text>并发：{account.lastSelf?.concurrency ?? "-"}</Text> : null}
      <Text>请求次数：{account.lastSelf?.request_count ?? "-"}</Text>
    </Section>}

    <Section title="签到">
      {account.excludeFromBatchCheckin && !recordOnly ? <Text foregroundStyle="systemOrange">⚠️ 已排除批量签到（仅网页签到）</Text> : null}
      {recordOnly ? <Text foregroundStyle="secondaryLabel">仅记录账号只支持在列表长按手动标注签到状态</Text> : null}
      <Text>今日状态：{todayCheckin.checked ? `已签到${todayCheckin.record?.quota_awarded !== undefined ? `，奖励 ${fmtCheckinAward(todayCheckin.record.quota_awarded)}` : ""}` : (() => {
        const checkinTime = account.checkinTime
        const checkinTimeReached = checkinTime ? isCheckinTimeReached(checkinTime) : true
        return checkinTime && !checkinTimeReached ? `未签到（签到时间 ${checkinTime}）` : "未签到"
      })()}</Text>
      {recordOnly ? null : <Text>功能启用：{account.lastCheckin?.enabled === undefined ? "未知" : account.lastCheckin.enabled ? "是" : "否"}</Text>}
      {recordOnly ? null : <Text>奖励范围：{checkinRewardRangeText}</Text>}
      {recordOnly ? null : <CheckinCalendar
        month={checkinMonth}
        status={account.lastCheckin}
        busy={busy}
        onChangeMonth={changeCheckinMonth}
        onRefresh={() => syncStatus(checkinMonth)}
      />}
    </Section>
  </List>
}
