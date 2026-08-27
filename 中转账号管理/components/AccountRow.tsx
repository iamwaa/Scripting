import { Section, Text, HStack, VStack, Spacer, Image, Button, Menu, Group, ProgressView } from "scripting"
import type { VirtualNode } from "scripting"
import type { Account, AccountSortKey, SortDirection } from "../types"
import { fmtQuota, shortUrl, getSelfQuotaValue, getSelfUsedQuotaValue, getAccountTypeText, isRecordOnlyAccount, isCheckinTimeReached, fmtCheckinAward } from "../utils/format"
import { getErrorMessage } from "../utils/error"
import { getAuthSourceText, getSiteStatusView, getSiteStatusLatencyText, getSiteStatusLatencyColor, getAccountSortTitle, getTodayCheckinInfo } from "../services/account"

// 账户总览 Section
export function AccountSummary({ accounts }: { accounts: Account[] }) {
  const totalQuota = accounts.reduce((sum, item) => sum + (Number(getSelfQuotaValue(item.lastSelf)) || 0), 0)
  const checkedCount = accounts.filter(account => getTodayCheckinInfo(account).checked).length

  return <Section title="总览">
    <HStack spacing={12}>
      <VStack alignment="leading" spacing={4} frame={{ width: 80, alignment: "leading" }}>
        <Text font="caption" foregroundStyle="secondaryLabel">账号</Text>
        <Text font="title2">{accounts.length}</Text>
      </VStack>
      <VStack alignment="leading" spacing={4} frame={{ width: 80, alignment: "leading" }}>
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
export function AccountRowContent({ account, busy = false }: { account: Account, busy?: boolean }) {
  const authText = getAuthSourceText(account)
  const siteStatus = getSiteStatusView(account)
  const latencyText = getSiteStatusLatencyText(account.lastSiteStatus)
  const todayCheckin = getTodayCheckinInfo(account)
  const recordOnly = isRecordOnlyAccount(account)
  const checkinTime = account.checkinTime
  const checkinTimeReached = checkinTime ? isCheckinTimeReached(checkinTime) : true
  const checkinText = todayCheckin.checked
    ? `已签${todayCheckin.record?.quota_awarded !== undefined ? ` ${fmtCheckinAward(todayCheckin.record.quota_awarded)}` : ""}`
    : checkinTime && !checkinTimeReached
      ? `签到时间 ${checkinTime}`
      : "未签"

  return <HStack spacing={12}>
    <VStack alignment="center" spacing={2} frame={{ width: 52 }}>
      {/* 该账号正在执行操作时用转圈替代站点图标，提供行内进度反馈 */}
      {busy
        ? <HStack alignment="center" frame={{ height: 18 }}><ProgressView /></HStack>
        : <Image systemName={siteStatus.icon} foregroundStyle={siteStatus.color as any} />}
      <Text font="caption2" foregroundStyle={siteStatus.color as any}>{siteStatus.text}</Text>
      {latencyText ? <Text font="caption2" foregroundStyle={getSiteStatusLatencyColor(account.lastSiteStatus) as any}>{latencyText}</Text> : null}
    </VStack>
    <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <HStack>
        {account.archived ? <Image systemName="archivebox.fill" foregroundStyle="secondaryLabel" font={13} frame={{ width: 18, alignment: "center" }} /> : null}
        {account.excludeFromBatchCheckin && !recordOnly ? <Image systemName="minus.circle" foregroundStyle="systemOrange" font={13} frame={{ width: 18, alignment: "center" }} /> : null}
        <Text font="headline" foregroundStyle={account.archived ? "secondaryLabel" : "label"}>{account.name}</Text>
        <HStack spacing={3}>
          <Image font={13} systemName={todayCheckin.checked ? "checkmark.seal.fill" : "seal"} foregroundStyle={todayCheckin.checked ? "systemGreen" : "secondaryLabel"} frame={{ width: 18, alignment: "center" }} />
          <Text font="caption" foregroundStyle={todayCheckin.checked ? "systemGreen" : "secondaryLabel"}>{checkinText}</Text>
        </HStack>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel">{authText}</Text>
      </HStack>
      <HStack spacing={6}>
        <Text font="caption" foregroundStyle="secondaryLabel">{shortUrl(account.baseUrl)} · {getAccountTypeText(account)}</Text>
      </HStack>
      <HStack spacing={10}>
        {/* 仅记录账号不查余额，此处改展示记录的账号名 */}
        {recordOnly
          ? <Text font={12} foregroundStyle="secondaryLabel">账号 {account.username || "未填写"}</Text>
          : <Text font="caption">余额 {fmtQuota(getSelfQuotaValue(account.lastSelf))}</Text>}
        {recordOnly ? null : <Text font="caption" foregroundStyle="secondaryLabel">已用 {fmtQuota(getSelfUsedQuotaValue(account.lastSelf))}</Text>}
      </HStack>
      {account.lastError ? <Text font="caption" foregroundStyle="systemRed">{getErrorMessage(account.lastError)}</Text> : null}
    </VStack>
  </HStack>
}

// 账户右键/长按菜单：只保留查询类操作，归档、删除与排除改由滑动操作触发
export function AccountRowMenu({ account, onQuickSync, onQuickCheckin, onOpenSite, onCheckSiteStatus, onToggleManualCheckin, disabled }: { account: Account, onQuickSync: (account: Account) => void, onQuickCheckin: (account: Account) => void, onOpenSite: (account: Account) => void, onCheckSiteStatus: (account: Account) => void, onToggleManualCheckin: (account: Account) => void, disabled?: boolean }) {
  const todayCheckin = getTodayCheckinInfo(account)
  const recordOnly = isRecordOnlyAccount(account)

  return <Group>
    {recordOnly ? null : <Button title="查询余额" systemImage="arrow.clockwise" action={() => onQuickSync(account)} disabled={disabled} />}
    {/* 今日已签到后隐藏签到与网页签到；仅记录账号的“打开站点”不受影响 */}
    {recordOnly || todayCheckin.checked ? null : <Button title="签到" systemImage="checkmark.seal" action={() => onQuickCheckin(account)} disabled={disabled} />}
    <Button title="连通性检测" systemImage="network" action={() => onCheckSiteStatus(account)} disabled={disabled} />
    {recordOnly
      ? <Button title="打开站点" systemImage="safari" action={() => onOpenSite(account)} disabled={disabled} />
      : todayCheckin.checked ? null : <Button title="网页签到" systemImage="safari" action={() => onOpenSite(account)} disabled={disabled} />}
    <Button
      title={todayCheckin.checked ? "标注未签" : "标注已签"}
      systemImage={todayCheckin.checked ? "xmark.seal" : "checkmark.seal.fill"}
      action={() => onToggleManualCheckin(account)}
      disabled={disabled}
    />
  </Group>
}

// 列表行滑动操作：右滑（leading）归档/取消归档，左滑（trailing）从左到右依次为删除、排除签到
// trailing 数组的第一项贴屏幕右缘，因此数组顺序与视觉顺序相反
// 滑动按钮不设 role，避免触发时行内闪动，危险语义用 tint 表达
export function buildAccountSwipeActions({ account, onDelete, onToggleExclude, onToggleArchive, disabled }: { account: Account, onDelete: (account: Account) => void, onToggleExclude: (account: Account) => void, onToggleArchive: (account: Account) => void, disabled?: boolean }) {
  const archived = account.archived === true
  const trailingActions: VirtualNode[] = []
  // 仅记录账号与归档账号都不参与批量签到，无需排除开关
  if (!archived && !isRecordOnlyAccount(account)) {
    trailingActions.push(<Button
      key="exclude"
      title={account.excludeFromBatchCheckin ? "加入签到" : "排除签到"}
      systemImage={account.excludeFromBatchCheckin ? "plus.circle" : "minus.circle"}
      tint="systemOrange"
      action={() => onToggleExclude(account)}
      disabled={disabled}
    />)
  }
  trailingActions.push(<Button
    key="delete"
    title="删除"
    systemImage="trash"
    tint="systemRed"
    action={() => onDelete(account)}
    disabled={disabled}
  />)

  return {
    leading: {
      allowsFullSwipe: true,
      actions: [
        <Button
          key="archive"
          title={archived ? "取消归档" : "归档"}
          systemImage={archived ? "tray.and.arrow.up" : "archivebox"}
          tint={archived ? "systemBlue" : "systemIndigo"}
          action={() => onToggleArchive(account)}
          disabled={disabled}
        />,
      ],
    },
    // 删除不允许整屏滑动直接触发，必须点按按钮再二次确认
    trailing: {
      allowsFullSwipe: false,
      actions: trailingActions,
    },
  }
}

// 账户列表头部
export function AccountListHeader({ title = "账号列表", sortKey, sortDirection, onSelectSort }: { title?: string, sortKey: AccountSortKey, sortDirection: SortDirection, onSelectSort: (key: AccountSortKey) => void }) {
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
    <Text>{title}</Text>
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
export function BatchActionButton({ title, busyTitle, systemImage, active, disabled, action, progress }: { title: string, busyTitle: string, systemImage: string, active: boolean, disabled: boolean, action: () => void, progress?: { current: number, total: number } }) {
  if (active) {
    return <Button action={() => {}} disabled={false}>
      <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
        <HStack spacing={8}><ProgressView /><Text>{busyTitle}</Text></HStack>
        {/* 有总量信息时显示确定性进度条，随处理进度动画推进 */}
        {progress && progress.total > 0 ? <ProgressView value={progress.current} total={progress.total} /> : null}
      </VStack>
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
