import { useState, Notification } from "scripting"
import type { Account, SelfInfo, CheckinStatus } from "../types"
import { SITE_STATUS_AUTO_CHECK_INTERVAL } from "../constants"
import { localDateString, now, shouldSkipBatchCheckinByTime } from "../utils/format"
import { getErrorMessage, isAlreadyCheckedInError } from "../utils/error"
import { loadAccounts, saveAccounts, patchAccount } from "../services/storage"
import { checkSiteStatus, fetchSelf, fetchCheckinStatus, doCheckin } from "../services/auth"
import { getTodayCheckinPatch, getTodayCheckinInfo, getOfflineSiteStatus, getCheckinDisabledPatch, getCheckinRewardPatch, getActiveAccounts, getApiOperableAccounts } from "../services/account"

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

// 批量操作与忙碌状态：三个批量流程都只处理未归档账号，仅记录账号不参与接口操作
export function useBatchAccountActions({ reload, toast }: { reload: () => void, toast: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState("")
  // 批量操作的确定性进度（当前/总数）与正在处理的账号（行内转圈）
  const [busyProgress, setBusyProgress] = useState({ current: 0, total: 0 })
  const [busyAccountId, setBusyAccountId] = useState<string | undefined>(undefined)

  function resetBusy() {
    setBusy(false)
    setBusyLabel("")
    setBusyProgress({ current: 0, total: 0 })
    setBusyAccountId(undefined)
  }

  async function checkSiteStatuses(showResult = false, scope: "active" | "archived" = "active") {
    const currentAccounts = loadAccounts()
    // 清除已过期的延迟缓存数据
    if (clearExpiredSiteStatuses(currentAccounts)) reload()
    // 归档页检测归档账号，账号页检测未归档账号（仅记录账号仍可检测站点连通性）
    const candidates = scope === "archived"
      ? currentAccounts.filter(a => a.archived)
      : getActiveAccounts(currentAccounts)
    const targetAccounts = showResult ? candidates : candidates.filter(shouldAutoCheckSiteStatus)
    if (candidates.length === 0) {
      if (showResult) toast(currentAccounts.length > 0 ? "账号已全部归档，可在归档页检测连通性" : "请先添加账号后再检测连通性")
      return
    }
    if (targetAccounts.length === 0) return
    // 请求后台运行权限（自动和手动检测都支持）
    const canBackground = await BackgroundKeeper.keepAlive()
    setBusy(true)
    setBusyLabel(canBackground ? "检测连通性中（支持后台运行）..." : "检测连通性中...")
    if (showResult) {
      // 只重置参与检测的账号状态，保留归档账号的历史缓存
      saveAccounts(currentAccounts.map(account => account.archived ? account : {
        ...account,
        lastSiteStatus: undefined,
      }))
      reload()
    }
    let ok = 0
    let fail = 0
    const total = targetAccounts.length
    try {
      for (let i = 0; i < targetAccounts.length; i++) {
        const account = targetAccounts[i]
        setBusyLabel(`检测连通性中 (${i + 1}/${total})...`)
        setBusyProgress({ current: i + 1, total })
        setBusyAccountId(account.id)
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
      // 释放后台运行权限
      if (canBackground) await BackgroundKeeper.stopKeepAlive()
      resetBusy()
      // 发送通知，点击时不需要打开脚本
      if (targetAccounts.length > 0) {
        await Notification.schedule({
          title: "连通性检测完成",
          body: `正常 ${ok} 个，异常 ${fail} 个`,
          threadIdentifier: "batch-operations",
          tapAction: "none",
          silent: false,
        })
      }
    }
  }

  async function syncAll() {
    // 归档与仅记录账号不参与批量查余额
    const allAccounts = loadAccounts()
    const targetAccounts = getApiOperableAccounts(allAccounts)
    if (targetAccounts.length === 0) {
      toast(allAccounts.length > 0 ? "没有参与批量查余额的账号（归档与仅记录账号不参与）" : "请先添加账号后再批量查询")
      return
    }
    // 请求后台运行权限
    const canBackground = await BackgroundKeeper.keepAlive()
    setBusy(true)
    setBusyLabel(canBackground ? "批量查余额中（支持后台运行）..." : "批量查余额中...")
    let ok = 0
    let fail = 0
    const total = targetAccounts.length
    try {
      for (let i = 0; i < targetAccounts.length; i++) {
        const account = targetAccounts[i]
        setBusyLabel(`批量查余额中 (${i + 1}/${total})...`)
        setBusyProgress({ current: i + 1, total })
        setBusyAccountId(account.id)
        try {
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
    } finally {
      // 释放后台运行权限
      if (canBackground) await BackgroundKeeper.stopKeepAlive()
      resetBusy()
      // 发送通知，点击时不需要打开脚本
      await Notification.schedule({
        title: "批量查余额完成",
        body: `成功 ${ok} 个，失败 ${fail} 个`,
        threadIdentifier: "batch-operations",
        tapAction: "none",
        silent: false,
      })
    }
  }

  async function checkinAll() {
    // 归档与仅记录账号不参与批量签到
    const allAccounts = loadAccounts()
    const targetAccounts = getApiOperableAccounts(allAccounts)
    if (targetAccounts.length === 0) {
      toast(allAccounts.length > 0 ? "没有参与批量签到的账号（归档与仅记录账号不参与）" : "请先添加账号后再批量签到")
      return
    }
    // 请求后台运行权限
    const canBackground = await BackgroundKeeper.keepAlive()
    setBusy(true)
    setBusyLabel(canBackground ? "批量签到中（支持后台运行）..." : "批量签到中...")
    let ok = 0
    let fail = 0
    let skipped = 0
    let skippedExcluded = 0
    let skippedTime = 0
    let skippedSigned = 0
    let skippedDisabled = 0
    const total = targetAccounts.length
    let processed = 0
    try {
      for (const account of targetAccounts) {
        processed++
        setBusyLabel(`批量签到中 (${processed}/${total})...`)
        setBusyProgress({ current: processed, total })
        setBusyAccountId(account.id)
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
        if (account.lastCheckin?.enabled === false) {
          skipped++
          skippedDisabled++
          continue
        }
        if (getTodayCheckinInfo(account).checked) {
          skipped++
          skippedSigned++
          continue
        }
        try {
          // 服务端提示今日已签时按已签处理：继续刷新状态并本地标记，避免每次批量签到重复尝试并报失败
          const checkinResult = await doCheckin(account).catch((e: any) => {
            if (!isAlreadyCheckedInError(e)) throw e
            return { already_checked: true }
          })
          const alreadyChecked = checkinResult?.already_checked === true
          let self: SelfInfo | undefined
          let status: CheckinStatus | undefined
          try { self = await fetchSelf(account) } catch {}
          try { status = await fetchCheckinStatus(account) } catch {}
          // 仅写入成功获取的字段，避免刷新失败时用 undefined 覆盖已有缓存；
          // checkinRewards 记录本次真实奖励金额（旧版 sub2api 无历史接口时用于补充月历金额）
          // 不更新站点状态，连通性由专门的检测负责
          const patch: Partial<Account> = { lastError: "", ...getTodayCheckinPatch(status), ...getCheckinRewardPatch(account, checkinResult) }
          if (self) patch.lastSelf = self
          if (status) patch.lastCheckin = status
          // 已签但状态刷新失败时用本地记录兜底，保证下次批量签到跳过该账号
          if (alreadyChecked && !patch.lastTodayCheckinDate) {
            patch.lastTodayCheckinDate = localDateString()
            patch.lastTodayCheckin = { checkin_date: localDateString() }
          }
          patchAccount(account.id, patch)
          if (alreadyChecked) {
            skipped++
            skippedSigned++
          } else {
            ok++
          }
        } catch (e: any) {
          const message = getErrorMessage(e)
          // 签到失败可能是业务错误（功能未开启等）而非站点离线，不改动 lastSiteStatus
          patchAccount(account.id, { lastError: message, ...getCheckinDisabledPatch(message) })
          fail++
        }
        reload()
      }
    } finally {
      // 释放后台运行权限
      if (canBackground) await BackgroundKeeper.stopKeepAlive()
      resetBusy()
      // 构建结果消息
      const skippedParts = [
        skippedExcluded ? `排除 ${skippedExcluded}` : "",
        skippedTime ? `未到时间 ${skippedTime}` : "",
        skippedSigned ? `已签 ${skippedSigned}` : "",
        skippedDisabled ? `未开启 ${skippedDisabled}` : "",
      ].filter(Boolean).join("，")
      let resultMessage: string
      if (ok === 0 && fail === 0) {
        resultMessage = skipped > 0 ? `没有符合签到条件的账号：已跳过 ${skipped} 个${skippedParts ? `（${skippedParts}）` : ""}` : "没有账号需要签到"
      } else {
        const message = skipped > 0 ? `成功 ${ok}，失败 ${fail}，跳过 ${skipped}${skippedParts ? `（${skippedParts}）` : ""}` : `成功 ${ok}，失败 ${fail}`
        resultMessage = `批量签到完成：${message}`
      }
      // 发送通知，点击时不需要打开脚本
      await Notification.schedule({
        title: "批量签到完成",
        body: resultMessage,
        threadIdentifier: "batch-operations",
        tapAction: "none",
        silent: false,
      })
    }
  }

  return {
    busy,
    busyLabel,
    busyProgress,
    busyAccountId,
    setBusy,
    setBusyAccountId,
    checkSiteStatuses,
    syncAll,
    checkinAll,
  }
}
