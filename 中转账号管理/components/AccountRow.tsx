import { Section, Text, HStack, VStack, Spacer, Image, Button, Menu, NavigationLink, Group, ProgressView } from "scripting"
import type { Account, AccountSortKey, AccountSortPreference, SortDirection } from "../types"
import { isSub2ApiAccount, fmtQuota, fmtRawQuotaForAccount, shortUrl, getSelfQuotaValue, getSelfUsedQuotaValue, getPlatformText, localDateString, isCheckinTimeReached, fmtCheckinAward } from "../utils/format"
import { getErrorMessage } from "../utils/error"
import { getAuthSourceText, getSiteStatusView, getSiteStatusLatencyText, getSiteStatusLatencyColor, getAccountSortTitle, getTodayCheckinInfo } from "../services/account"

// 账户总览 Section
export function AccountSummary({ accounts }: { accounts: Account[] }) {
  const totalQuota = accounts.reduce((sum, item) => sum + (Number(getSelfQuotaValue(item.lastSelf)) || 0), 0)
  const checkedCount = accounts.filter(account => getTodayCheckinInfo(account).checked).length

  return <Section title="总览">
    <HStack spacing={12}>
      <VStack alignment="leading" spacing={4} frame={{ width: 90, alignment: "leading" }}>
        <Text font="caption" foregroundStyle="secondaryLabel">账号</Text>
        <Text font="title2">{accounts.length}</Text>
      </VStack>
      <VStack alignment="leading" spacing={4} frame={{ width: 90, alignment: "leading" }}>
        <Text font="caption" foregroundStyle="secondaryLabel">已签到</Text>
        <Text font="title2">{checkedCount}</Text>
      </VStack>
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="caption" foregroundStyle="secondaryLabel">总余额</Text>
        <Text font="title2">{fmtQuota(totalQuota)}</Text>
      </VStack>
    </HStack>
  </Section>
}

// 账户列表行内容
export function AccountRowContent({ account }: { account: Account }) {
  const authText = getAuthSourceText(account)
  const siteStatus = getSiteStatusView(account)
  const latencyText = getSiteStatusLatencyText(account.lastSiteStatus)
  const todayCheckin = getTodayCheckinInfo(account)
  const checkinTime = account.checkinTime
  const checkinTimeReached = checkinTime ? isCheckinTimeReached(checkinTime) : true
  const checkinText = todayCheckin.checked
    ? `已签${todayCheckin.record?.quota_awarded !== undefined ? ` ${fmtCheckinAward(todayCheckin.record.quota_awarded)}` : ""}`
    : checkinTime && !checkinTimeReached
      ? `签到时间 ${checkinTime}`
      : "未签"

  return <HStack spacing={12}>
    <VStack alignment="center" spacing={2} frame={{ width: 52 }}>
      <Image systemName={siteStatus.icon} foregroundStyle={siteStatus.color as any} />
      <Text font="caption2" foregroundStyle={siteStatus.color as any}>{siteStatus.text}</Text>
      {latencyText ? <Text font="caption2" foregroundStyle={getSiteStatusLatencyColor(account.lastSiteStatus) as any}>{latencyText}</Text> : null}
    </VStack>
    <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <HStack>
        {account.excludeFromBatchCheckin ? <Image systemName="minus.circle" foregroundStyle="systemOrange" font={13} frame={{ width: 18, alignment: "center" }} /> : null}
        <Text font="headline">{account.name}</Text>
        <HStack spacing={3}>
          <Image font={13} systemName={todayCheckin.checked ? "checkmark.seal.fill" : "seal"} foregroundStyle={todayCheckin.checked ? "systemGreen" : "secondaryLabel"} frame={{ width: 18, alignment: "center" }} />
          <Text font="caption" foregroundStyle={todayCheckin.checked ? "systemGreen" : "secondaryLabel"}>{checkinText}</Text>
        </HStack>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel">{authText}</Text>
      </HStack>
      <HStack spacing={6}>
        <Text font="caption" foregroundStyle="secondaryLabel">{shortUrl(account.baseUrl)} · {getPlatformText(account)}</Text>
      </HStack>
      <HStack spacing={10}>
        <Text font="caption">余额 {fmtQuota(getSelfQuotaValue(account.lastSelf))}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">已用 {fmtQuota(getSelfUsedQuotaValue(account.lastSelf))}</Text>
      </HStack>
      {account.lastError ? <Text font="caption" foregroundStyle="systemRed">{getErrorMessage(account.lastError)}</Text> : null}
    </VStack>
  </HStack>
}

// 账户右键/长按菜单
export function AccountRowMenu({ account, onDelete, onQuickSync, onQuickCheckin, onOpenSite, onCheckSiteStatus, onToggleManualCheckin, onToggleExclude, disabled }: { account: Account, onDelete: (account: Account) => void, onQuickSync: (account: Account) => void, onQuickCheckin: (account: Account) => void, onOpenSite: (account: Account) => void, onCheckSiteStatus: (account: Account) => void, onToggleManualCheckin: (account: Account) => void, onToggleExclude: (account: Account) => void, disabled?: boolean }) {
  const todayCheckin = getTodayCheckinInfo(account)

  function openAccountSite() {
    onOpenSite(account)
  }

  return <Group>
    <Button title="查询余额" systemImage="arrow.clockwise" action={() => onQuickSync(account)} disabled={disabled} />
    <Button title="签到" systemImage="checkmark.seal" action={() => onQuickCheckin(account)} disabled={disabled} />
    <Button title="连通性检测" systemImage="network" action={() => onCheckSiteStatus(account)} disabled={disabled} />
    <Button title="网页签到" systemImage="safari" action={openAccountSite} disabled={disabled} />
    <Button
      title={todayCheckin.checked ? "标注未签" : "标注已签"}
      systemImage={todayCheckin.checked ? "xmark.seal" : "checkmark.seal.fill"}
      action={() => onToggleManualCheckin(account)}
      disabled={disabled}
    />
    <Button
      title={account.excludeFromBatchCheckin ? "加入批量签到" : "排除批量签到"}
      systemImage={account.excludeFromBatchCheckin ? "plus.circle" : "minus.circle"}
      action={() => onToggleExclude(account)}
      disabled={disabled}
    />
    <Button title="删除账号" systemImage="trash" role="destructive" action={() => onDelete(account)} disabled={disabled} />
  </Group>
}

// 账户列表头部
export function AccountListHeader({ sortKey, sortDirection, onSelectSort }: { sortKey: AccountSortKey, sortDirection: SortDirection, onSelectSort: (key: AccountSortKey) => void }) {
  const directionIcon = sortDirection === "asc" ? "arrow.up" : "arrow.down"

  function SortButton({ itemKey, title }: { itemKey: AccountSortKey, title: string }) {
    const active = sortKey === itemKey
    return <Button
      title={title}
      systemImage={active ? directionIcon : undefined}
      action={() => onSelectSort(itemKey)}
    />
  }

  return <HStack>
    <Text>账号列表</Text>
    <Spacer />
    <Menu label={<HStack spacing={4}>
      <Text font="caption" foregroundStyle="secondaryLabel">{getAccountSortTitle(sortKey)}</Text>
      <Image systemName={directionIcon} foregroundStyle="secondaryLabel" font="caption2" />
    </HStack>}>
      <SortButton itemKey="name" title="按名称" />
      <SortButton itemKey="platform" title="按平台" />
      <SortButton itemKey="quota" title="按金额" />
      <SortButton itemKey="checkin" title="按签到状态" />
    </Menu>
  </HStack>
}

// 批量操作按钮
export function BatchActionButton({ title, busyTitle, systemImage, active, disabled, action }: { title: string, busyTitle: string, systemImage: string, active: boolean, disabled: boolean, action: () => void }) {
  if (active) {
    return <Button action={() => {}} disabled={false}>
      <HStack spacing={8}><ProgressView /><Text>{busyTitle}</Text></HStack>
    </Button>
  }
  const color = disabled ? "systemGray4" : "tintColor"
  return <Button action={action} disabled={disabled}>
    <HStack spacing={8} alignment="center">
      <Image systemName={systemImage} foregroundStyle={color} font="body" frame={{ width: 24, alignment: "center" }} />
      <Text foregroundStyle={color}>{title}</Text>
    </HStack>
  </Button>
}
