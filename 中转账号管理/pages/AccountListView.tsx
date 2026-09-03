import { useState, useEffect, Navigation, NavigationStack, List, Section, Text, Button, Image, NavigationLink, Toolbar, ToolbarItem } from "scripting"
import type { Account, AccountSortKey, SortDirection } from "../types"
import { isRecordOnlyAccount } from "../utils/format"
import { getErrorMessage, showConfirm } from "../utils/error"
import { loadAccounts, loadAccountSortPreference, saveAccountSortPreference, patchAccount } from "../services/storage"
import { checkSiteStatus, fetchSelf, fetchCheckinStatus, openManualCheckinWebView } from "../services/auth"
import type { ManualCheckinRefresh } from "../services/webApi"
import { sortAccounts, getTodayCheckinPatch, getManualTodayCheckinPatch, getTodayCheckinInfo, getOfflineSiteStatus, getCheckinDisabledPatch, deleteAccount, runQuickAccountAction, quickSyncAccount, quickCheckinAccount, getActiveAccounts } from "../services/account"
import { AccountSummary, AccountRowContent, AccountRowMenu, AccountListHeader, BatchActionButton, buildAccountSwipeActions } from "../components/AccountRow"
import { useBatchAccountActions } from "../hooks/useBatchAccountActions"
import { AccountDetailView } from "./AccountDetailView"
import { AddEditView } from "./AddEditView"

// 列表范围：账号页只显示未归档账号，归档页只显示已归档账号
export type AccountListScope = "active" | "archived"

// 账号列表页，两个标签共用：范围不同，行为按 scope 收敛
export function AccountListView({ scope, dataVersion, onDataChanged, onClose }: { scope: AccountListScope, dataVersion: number, onDataChanged: () => void, onClose: () => void }) {
  const archivedScope = scope === "archived"
  const [accounts, setAccounts] = useState<Account[]>([])
  const [toastMessage, setToastMessage] = useState("")
  const [showToast, setShowToast] = useState(false)
  const initialSort = loadAccountSortPreference()
  const [sortKey, setSortKey] = useState<AccountSortKey>(initialSort.key)
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialSort.direction)

  function reload() {
    setAccounts(loadAccounts())
  }

  function toast(message: string) {
    setToastMessage(message)
    setShowToast(true)
  }

  // 归档与删除会让账号在两个标签间移动，需要通知另一个标签重新加载
  function reloadAndNotify() {
    reload()
    onDataChanged()
  }

  const { busy, busyLabel, busyProgress, busyAccountId, setBusy, setBusyAccountId, checkSiteStatuses, syncAll, checkinAll } = useBatchAccountActions({ reload, toast })

  useEffect(() => {
    reload()
    // 账号页与归档页均自动检测连通性（各自只检测对应范围的账号）
    if (archivedScope) {
      void checkSiteStatuses(false, "archived")
    } else {
      void checkSiteStatuses()
    }
  }, [])

  // 另一个标签归档或删除账号后同步刷新
  useEffect(() => {
    reload()
  }, [dataVersion])

  async function quickSync(account: Account) {
    setBusy(true)
    setBusyAccountId(account.id)
    try {
      await runQuickAccountAction(account, "快捷查询", quickSyncAccount)
      setToastMessage(`“${account.name}”余额信息已更新`)
    } catch (e: any) {
      setToastMessage(`查询失败：${getErrorMessage(e)}`)
    } finally {
      reload()
      setBusy(false)
      setBusyAccountId(undefined)
      setShowToast(true)
    }
  }

  async function quickCheckin(account: Account) {
    setBusy(true)
    setBusyAccountId(account.id)
    try {
      const data = await runQuickAccountAction(account, "快捷签到", quickCheckinAccount, true)
      setToastMessage(data?.already_checked ? `“${account.name}”今日已签到，无需重复签到` : `“${account.name}”签到成功`)
    } catch (e: any) {
      setToastMessage(`签到失败：${getErrorMessage(e)}`)
    } finally {
      reload()
      setBusy(false)
      setBusyAccountId(undefined)
      setShowToast(true)
    }
  }

  async function quickCheckSiteStatus(account: Account) {
    setBusy(true)
    setBusyAccountId(account.id)
    try {
      const status = await checkSiteStatus(account)
      patchAccount(account.id, { lastSiteStatus: status })
      const stateText = status.state === "online" ? "在线" : status.state === "warning" ? "异常" : "离线"
      const latencyText = status.state === "online" && status.latencyMs !== undefined ? `，${status.latencyMs}ms` : ""
      setToastMessage(`“${account.name}”${stateText}${latencyText}`)
    } catch (e: any) {
      patchAccount(account.id, { lastSiteStatus: getOfflineSiteStatus(e) })
      setToastMessage(`连通性检测失败：${getErrorMessage(e)}`)
    } finally {
      reload()
      setBusy(false)
      setBusyAccountId(undefined)
      setShowToast(true)
    }
  }

  async function quickOpenSite(account: Account) {
    setBusy(true)
    setBusyAccountId(account.id)
    toast(isRecordOnlyAccount(account) ? `正在打开“${account.name}”的站点…` : `正在打开“${account.name}”的签到页面…`)
    try {
      // 部分站点关页后 Cookie 立即失效，网页签到会在 WebView 存活时先页内预查一份结果
      const refresh: ManualCheckinRefresh | undefined = await openManualCheckinWebView(account)
      // 仅记录账号不调接口，关页后不刷新余额与签到状态
      if (isRecordOnlyAccount(account)) {
        setToastMessage(`“${account.name}”站点已关闭`)
        return
      }
      const latest = loadAccounts().find(item => item.id === account.id) ?? account
      // 页内预查缺失的部分才降级到原生请求
      const [selfResult, statusResult] = await Promise.allSettled([
        refresh?.self ? Promise.resolve(refresh.self) : fetchSelf(latest),
        refresh?.checkin ? Promise.resolve(refresh.checkin) : fetchCheckinStatus(latest),
      ])
      const patch: Partial<Account> = {}
      if (selfResult.status === "fulfilled") {
        patch.lastSelf = selfResult.value
      }
      if (statusResult.status === "fulfilled") {
        patch.lastCheckin = statusResult.value
        patch.lastError = ""
        Object.assign(patch, getTodayCheckinPatch(statusResult.value))
        setToastMessage(`“${account.name}”签到状态已更新`)
      } else {
        const message = getErrorMessage(statusResult.reason)
        patch.lastError = message
        Object.assign(patch, getCheckinDisabledPatch(message))
        setToastMessage(`网页已关闭，签到状态刷新失败：${message}`)
      }
      patchAccount(latest.id, patch)
    } catch (e: any) {
      const message = getErrorMessage(e)
      patchAccount(account.id, { lastError: message, ...getCheckinDisabledPatch(message) })
      setToastMessage(`网页签到失败：${message}`)
    } finally {
      reload()
      setBusy(false)
      setBusyAccountId(undefined)
      setShowToast(true)
    }
  }

  async function quickDelete(account: Account) {
    const confirmed = await showConfirm({
      title: "删除账号？",
      message: `确定删除“${account.name}”吗？\n\n该操作只删除本机记录，但保存的密码、Cookie/令牌和缓存数据也会一并清除，且无法撤销。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (!confirmed) return
    deleteAccount(account.id)
    reloadAndNotify()
    toast(`“${account.name}”已删除`)
  }

  function quickToggleManualCheckin(account: Account) {
    const nextChecked = !getTodayCheckinInfo(account).checked
    patchAccount(account.id, getManualTodayCheckinPatch(account, nextChecked))
    reload()
    toast(nextChecked ? `“${account.name}”已标记为今日已签到` : `“${account.name}”已标记为今日未签到`)
  }

  function quickToggleExclude(account: Account) {
    patchAccount(account.id, { excludeFromBatchCheckin: !account.excludeFromBatchCheckin })
    reload()
    toast(!account.excludeFromBatchCheckin ? `“${account.name}”已从批量签到中排除` : `“${account.name}”已加入批量签到`)
  }

  function quickToggleArchive(account: Account) {
    const nextArchived = !account.archived
    patchAccount(account.id, { archived: nextArchived })
    reloadAndNotify()
    toast(nextArchived ? `“${account.name}”已归档，不再参与账号页操作` : `“${account.name}”已取消归档`)
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

  const scopedAccounts = archivedScope ? accounts.filter(account => account.archived) : getActiveAccounts(accounts)
  const sortedAccounts = sortAccounts(scopedAccounts, sortKey, sortDirection)
  const emptyText = archivedScope
    ? "暂无归档账号，在“账号”标签右滑账号即可归档。"
    : accounts.length > 0 ? "账号已全部归档，可在“归档”标签中恢复。" : "暂无账号，点击右上角“添加”。"

  function renderAccountRow(account: Account) {
    const swipeActions = buildAccountSwipeActions({
      account,
      onDelete: quickDelete,
      onToggleExclude: quickToggleExclude,
      onToggleArchive: quickToggleArchive,
      disabled: busy,
    })
    return <NavigationLink
      key={account.id}
      destination={<AccountDetailView key={`detail-${account.id}`} accountId={account.id} onChanged={reloadAndNotify} />}
      leadingSwipeActions={swipeActions.leading}
      trailingSwipeActions={swipeActions.trailing}
      contextMenu={{
        menuItems: <AccountRowMenu
          account={account}
          onQuickSync={quickSync}
          onQuickCheckin={quickCheckin}
          onOpenSite={quickOpenSite}
          onCheckSiteStatus={quickCheckSiteStatus}
          onToggleManualCheckin={quickToggleManualCheckin}
          disabled={busy}
        />,
      }}
    >
      <AccountRowContent account={account} busy={busyAccountId === account.id} />
    </NavigationLink>
  }

  return <NavigationStack>
    <List
      navigationTitle={archivedScope ? "归档账号" : "账号管理"}
      navigationBarTitleDisplayMode="large"
      refreshable={async () => reload()}
      toolbar={<Toolbar>
        <ToolbarItem placement="topBarLeading">
          <Button action={onClose}>
            <Image systemName="xmark" foregroundStyle="systemRed" fontWeight="semibold" />
          </Button>
        </ToolbarItem>
        {archivedScope ? null : <ToolbarItem placement="topBarTrailing">
          <Button action={async () => await Navigation.present(<NavigationStack><AddEditView onSaved={reload} /></NavigationStack>)} disabled={busy}>
            <Text fontWeight="semibold" foregroundStyle="tintColor">添加</Text>
          </Button>
        </ToolbarItem>}
      </Toolbar>}
      toast={{ message: toastMessage, isPresented: showToast, onChanged: setShowToast, position: "top" }}
    >
      <AccountSummary accounts={scopedAccounts} />

      {archivedScope ? null : <Section header={<Text>批量操作</Text>}>
        <BatchActionButton title="查询余额" busyTitle={busyLabel} systemImage="arrow.clockwise" active={busy && busyLabel.startsWith("批量查余额")} disabled={busy} action={syncAll} progress={busyProgress} />
        <BatchActionButton title="签到" busyTitle={busyLabel} systemImage="checkmark.seal.fill" active={busy && busyLabel.startsWith("批量签到")} disabled={busy} action={checkinAll} progress={busyProgress} />
        <BatchActionButton title="连通性检测" busyTitle={busyLabel} systemImage="network" active={busy && busyLabel.startsWith("检测连通性")} disabled={busy} action={() => checkSiteStatuses(true)} progress={busyProgress} />
      </Section>}

      <Section
        header={<AccountListHeader title={archivedScope ? "归档列表" : "账号列表"} sortKey={sortKey} sortDirection={sortDirection} onSelectSort={selectSort} />}
        footer={<Text>{archivedScope
          ? "归档账号不计入总览与批量操作。右滑取消归档，左滑删除，长按更多操作。"
          : "右滑归档，左滑删除或排除批量签到，长按更多操作。"}</Text>}
      >
        {sortedAccounts.length === 0 ? <Text foregroundStyle="secondaryLabel">{emptyText}</Text> : null}
        {sortedAccounts.map(renderAccountRow)}
      </Section>
    </List>
  </NavigationStack>
}
