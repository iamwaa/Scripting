import { useState, useEffect, Navigation, NavigationStack, List, Section, Text, Button, HStack, Spacer, Image, NavigationLink, Toolbar, ToolbarItem } from "scripting"
import type { Account, AccountSortKey, SortDirection, SelfInfo, CheckinStatus } from "../types"
import { SITE_STATUS_AUTO_CHECK_INTERVAL } from "../constants"
import { isSub2ApiAccount, localDateString, now, shouldSkipBatchCheckinByTime } from "../utils/format"
import { getErrorMessage } from "../utils/error"
import { loadAccounts, saveAccounts, loadAccountSortPreference, saveAccountSortPreference, patchAccount } from "../services/storage"
import { checkSiteStatus, fetchSelf, fetchCheckinStatus, doCheckin, openManualCheckinWebView } from "../services/auth"
import { sortAccounts, getAccountSortTitle, getTodayCheckinPatch, getManualTodayCheckinPatch, getCheckinCount, getCheckinRecords, getTodayCheckinInfo, getOfflineSiteStatus, getCheckinDisabledPatch, deleteAccount, runQuickAccountAction, quickSyncAccount, quickCheckinAccount } from "../services/account"
import { AccountSummary, AccountRowContent, AccountRowMenu, AccountListHeader, BatchActionButton } from "../components/AccountRow"
import { AccountDetailView } from "./AccountDetailView"
import { AddEditView } from "./AddEditView"

// 检查是否需要自动检测站点状态
function shouldAutoCheckSiteStatus(account: Account) {
  const checkedAt = account.lastSiteStatus?.checkedAt
  return !checkedAt || now() - checkedAt >= SITE_STATUS_AUTO_CHECK_INTERVAL
}

// 清除已过期的连通性缓存数据（延迟/状态等）
function clearExpiredSiteStatuses(accounts: Account[]) {
  let changed = false
  for (const account of accounts) {
    if (shouldAutoCheckSiteStatus(account) && account.lastSiteStatus) {
      account.lastSiteStatus = undefined
      changed = true
    }
  }
  if (changed) saveAccounts(accounts)
  return changed
}

// 主页面
export function MainView() {
  const dismiss = Navigation.useDismiss()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState("")
  const [toastMessage, setToastMessage] = useState("")
  const [showToast, setShowToast] = useState(false)
  const initialSort = loadAccountSortPreference()
  const [sortKey, setSortKey] = useState<AccountSortKey>(initialSort.key)
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialSort.direction)

  function reload() {
    setAccounts(loadAccounts())
  }

  useEffect(() => {
    reload()
    void checkSiteStatuses()
  }, [])

  async function checkSiteStatuses(showResult = false) {
    const currentAccounts = loadAccounts()
    // 清除已过期的延迟缓存数据
    if (clearExpiredSiteStatuses(currentAccounts)) reload()
    const targetAccounts = showResult ? currentAccounts : currentAccounts.filter(shouldAutoCheckSiteStatus)
    if (currentAccounts.length === 0) {
      if (showResult) {
        setToastMessage("请先添加账号后再检测连通性")
        setShowToast(true)
      }
      return
    }
    if (targetAccounts.length === 0) return
    setBusy(true)
    setBusyLabel("检测连通性中...")
    if (showResult) {
      saveAccounts(currentAccounts.map(account => ({
        ...account,
        lastSiteStatus: undefined,
      })))
      reload()
    }
    let ok = 0
    let fail = 0
    const total = targetAccounts.length
    try {
      for (let i = 0; i < targetAccounts.length; i++) {
        const account = targetAccounts[i]
        setBusyLabel(`检测连通性中 (${i + 1}/${total})...`)
        try {
          const status = await checkSiteStatus(account)
          patchAccount(account.id, { lastSiteStatus: status })
          if (status.state === "offline") fail++
          else ok++
        } catch (e: any) {
          patchAccount(account.id, { lastSiteStatus: getOfflineSiteStatus(e) })
          fail++
        }
        reload()
      }
    } finally {
      setBusy(false)
      setBusyLabel("")
    }
    if (showResult) {
      setToastMessage(`连通性检测完成：正常 ${ok}，异常 ${fail}`)
      setShowToast(true)
    }
  }

  async function syncAll() {
    if (accounts.length === 0) {
      setToastMessage("请先添加账号后再批量查询")
      setShowToast(true)
      return
    }
    setBusy(true)
    setBusyLabel("批量查余额中...")
    let ok = 0
    let fail = 0
    const allAccounts = loadAccounts()
    const total = allAccounts.length
    for (let i = 0; i < allAccounts.length; i++) {
      const account = allAccounts[i]
      setBusyLabel(`批量查余额中 (${i + 1}/${total})...`)
      try {
        const siteStatus = await checkSiteStatus(account)
        patchAccount(account.id, { lastSiteStatus: siteStatus })
        const latest = loadAccounts().find(item => item.id === account.id) ?? account
        const data = await fetchSelf(latest)
        patchAccount(account.id, { lastSelf: data, lastError: "" })
        ok++
      } catch (e: any) {
        patchAccount(account.id, { lastError: getErrorMessage(e) })
        fail++
      }
      reload()
    }
    setBusy(false)
    setBusyLabel("")
    setToastMessage(`批量查询完成：成功 ${ok}，失败 ${fail}`)
    setShowToast(true)
  }

  async function checkinAll() {
    if (accounts.length === 0) {
      setToastMessage("请先添加账号后再批量签到")
      setShowToast(true)
      return
    }
    setBusy(true)
    setBusyLabel("批量签到中...")
    let ok = 0
    let fail = 0
    let skipped = 0
    let skippedExcluded = 0
    let skippedTime = 0
    let skippedSigned = 0
    const allAccounts = loadAccounts()
    const total = allAccounts.length
    let processed = 0
    for (const account of allAccounts) {
      processed++
      setBusyLabel(`批量签到中 (${processed}/${total})...`)
      if (account.excludeFromBatchCheckin) {
        skipped++
        skippedExcluded++
        continue
      }
      if (shouldSkipBatchCheckinByTime(account)) {
        skipped++
        skippedTime++
        continue
      }
      if (getTodayCheckinInfo(account).checked) {
        skipped++
        skippedSigned++
        continue
      }
      try {
        await doCheckin(account)
        let self: SelfInfo | undefined
        let status: CheckinStatus | undefined
        try { self = await fetchSelf(account) } catch {}
        try { status = await fetchCheckinStatus(account) } catch {}
        patchAccount(account.id, { lastSelf: self, lastCheckin: status, lastError: "", ...getTodayCheckinPatch(status) })
        ok++
      } catch (e: any) {
        const message = getErrorMessage(e)
        patchAccount(account.id, { lastError: message, ...getCheckinDisabledPatch(message) })
        fail++
      }
      reload()
    }
    setBusy(false)
    setBusyLabel("")
    const skippedParts = [
      skippedExcluded ? `排除 ${skippedExcluded}` : "",
      skippedTime ? `未到时间 ${skippedTime}` : "",
      skippedSigned ? `已签 ${skippedSigned}` : "",
    ].filter(Boolean).join("，")
    if (ok === 0 && fail === 0) {
      setToastMessage(skipped > 0 ? `没有符合签到条件的账号：已跳过 ${skipped} 个${skippedParts ? `（${skippedParts}）` : ""}` : "没有账号需要签到")
      setShowToast(true)
      return
    }
    const message = skipped > 0 ? `成功 ${ok}，失败 ${fail}，跳过 ${skipped}${skippedParts ? `（${skippedParts}）` : ""}` : `成功 ${ok}，失败 ${fail}`
    setToastMessage(`批量签到完成：${message}`)
    setShowToast(true)
  }

  async function quickSync(account: Account) {
    setBusy(true)
    try {
      await runQuickAccountAction(account, "快捷查询", quickSyncAccount)
      setToastMessage(`"${account.name}"余额已更新`)
    } catch (e: any) {
      setToastMessage(`查询失败：${getErrorMessage(e)}`)
    } finally {
      reload()
      setBusy(false)
      setShowToast(true)
    }
  }

  async function quickCheckin(account: Account) {
    setBusy(true)
    try {
      await runQuickAccountAction(account, "快捷签到", quickCheckinAccount, true)
      setToastMessage(`"${account.name}"签到完成`)
    } catch (e: any) {
      setToastMessage(`签到失败：${getErrorMessage(e)}`)
    } finally {
      reload()
      setBusy(false)
      setShowToast(true)
    }
  }

  async function quickCheckSiteStatus(account: Account) {
    setBusy(true)
    try {
      const status = await checkSiteStatus(account)
      patchAccount(account.id, { lastSiteStatus: status })
      const stateText = status.state === "online" ? "在线" : status.state === "warning" ? "异常" : "离线"
      const latencyText = status.state === "online" && status.latencyMs !== undefined ? `，${status.latencyMs}ms` : ""
      setToastMessage(`"${account.name}"${stateText}${latencyText}`)
    } catch (e: any) {
      patchAccount(account.id, { lastSiteStatus: getOfflineSiteStatus(e) })
      setToastMessage(`连通性检测失败：${getErrorMessage(e)}`)
    } finally {
      reload()
      setBusy(false)
      setShowToast(true)
    }
  }

  async function quickOpenSite(account: Account) {
    setBusy(true)
    setToastMessage(`正在打开"${account.name}"网页签到...`)
    setShowToast(true)
    try {
      await openManualCheckinWebView(account)
      const latest = loadAccounts().find(item => item.id === account.id) ?? account
      try {
        const status = await fetchCheckinStatus(latest)
        patchAccount(latest.id, { lastCheckin: status, lastError: "", ...getTodayCheckinPatch(status) })
        setToastMessage(`"${account.name}"签到状态已更新`)
      } catch (e: any) {
        const message = getErrorMessage(e)
        const balancePatch: Partial<Account> = { lastError: message, ...getCheckinDisabledPatch(message) }
        try {
          balancePatch.lastSelf = await fetchSelf(latest)
          setToastMessage(`网页已关闭，签到接口不可用`)
        } catch {
          setToastMessage(`网页已关闭，签到接口不可用`)
        }
        patchAccount(latest.id, balancePatch)
      }
    } catch (e: any) {
      const message = getErrorMessage(e)
      patchAccount(account.id, { lastError: message, ...getCheckinDisabledPatch(message) })
      setToastMessage(`网页签到失败：${message}`)
    } finally {
      reload()
      setBusy(false)
      setShowToast(true)
    }
  }

  function quickDelete(account: Account) {
    deleteAccount(account.id)
    reload()
    setToastMessage(`"${account.name}"已删除`)
    setShowToast(true)
  }

  function quickToggleManualCheckin(account: Account) {
    const nextChecked = !getTodayCheckinInfo(account).checked
    patchAccount(account.id, getManualTodayCheckinPatch(account, nextChecked))
    reload()
    setToastMessage(nextChecked ? `"${account.name}"已标注为已签` : `"${account.name}"已标注为未签`)
    setShowToast(true)
  }

  function quickToggleExclude(account: Account) {
    patchAccount(account.id, { excludeFromBatchCheckin: !account.excludeFromBatchCheckin })
    reload()
    const newState = !account.excludeFromBatchCheckin
    setToastMessage(newState ? `"${account.name}"已排除批量签到` : `"${account.name}"已加入批量签到`)
    setShowToast(true)
  }

  function selectSort(nextKey: AccountSortKey) {
    if (nextKey === sortKey) {
      const nextDirection = sortDirection === "asc" ? "desc" : "asc"
      setSortDirection(nextDirection)
      saveAccountSortPreference({ key: sortKey, direction: nextDirection })
      return
    }
    setSortKey(nextKey)
    setSortDirection("asc")
    saveAccountSortPreference({ key: nextKey, direction: "asc" })
  }

  const sortedAccounts = sortAccounts(accounts, sortKey, sortDirection)

  return <NavigationStack>
    <List
      navigationTitle="账号管理"
      navigationBarTitleDisplayMode="large"
      refreshable={async () => reload()}
      toolbar={<Toolbar>
        <ToolbarItem placement="topBarLeading">
          <Button action={dismiss}>
            <Image systemName="xmark" foregroundStyle="systemRed" fontWeight="semibold" />
          </Button>
        </ToolbarItem>
        <ToolbarItem placement="topBarTrailing">
          <Button action={async () => await Navigation.present(<NavigationStack><AddEditView onSaved={reload} /></NavigationStack>)} disabled={busy}>
            <Text fontWeight="semibold" foregroundStyle="tintColor">添加</Text>
          </Button>
        </ToolbarItem>
      </Toolbar>}
      toast={{ message: toastMessage, isPresented: showToast, onChanged: setShowToast, position: "top" }}
    >
      <AccountSummary accounts={accounts} />

      <Section header={<Text>批量操作</Text>} footer={<Text>如果站点开启 Turnstile/2FA，请使用浏览器登录后的 Cookie。脚本不会绕过验证码。</Text>}>
        <BatchActionButton title="查询余额" busyTitle={busyLabel} systemImage="arrow.clockwise" active={busy && busyLabel.startsWith("批量查余额")} disabled={busy} action={syncAll} />
        <BatchActionButton title="签到" busyTitle={busyLabel} systemImage="checkmark.seal.fill" active={busy && busyLabel.startsWith("批量签到")} disabled={busy} action={checkinAll} />
        <BatchActionButton title="连通性检测" busyTitle={busyLabel} systemImage="network" active={busy && busyLabel.startsWith("检测连通性")} disabled={busy} action={() => checkSiteStatuses(true)} />
      </Section>

      <Section header={<AccountListHeader sortKey={sortKey} sortDirection={sortDirection} onSelectSort={selectSort} />}>
        {accounts.length === 0 ? <Text foregroundStyle="secondaryLabel">暂无账号，点击右上角"添加"。</Text> : null}
        {sortedAccounts.map(account => <NavigationLink
          key={account.id}
          destination={<AccountDetailView key={`detail-${account.id}`} accountId={account.id} onChanged={reload} />}
          contextMenu={{ menuItems: <AccountRowMenu account={account} onDelete={quickDelete} onQuickSync={quickSync} onQuickCheckin={quickCheckin} onOpenSite={quickOpenSite} onCheckSiteStatus={quickCheckSiteStatus} onToggleManualCheckin={quickToggleManualCheckin} onToggleExclude={quickToggleExclude} disabled={busy} /> }}
        >
          <AccountRowContent account={account} />
        </NavigationLink>)}
      </Section>
    </List>
  </NavigationStack>
}
