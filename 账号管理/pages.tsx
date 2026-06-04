import { useState, useEffect, useMemo, useCallback, NavigationStack, List, Section, HStack, VStack, Text, Button, Spacer, Image, 
  Navigation, Script, TextField, Menu, Toggle,ToolbarItem,Toolbar,ToolbarSpacer
} from "scripting"

import {
  AccountItem, BookmarkItem, WebDAVConfig, CustomField, ICloudConfigMeta, ensureICloudConfigIndex, loadICloudConfigIndex, createICloudConfig, renameICloudConfig, deleteICloudConfig, switchICloudConfig, generateId, getGroupLetter, processUrl, getICloudFilePassword, saveICloudFilePassword, encryptPayload, decryptPayload, normalizeSyncPayload, uploadToWebDAV, downloadFromWebDAV, testWebDAVConnection, saveWebDAVConfig, isEncryptedFormat, syncAccountsToICloud, restoreAccountsFromICloud, checkICloudConfigFileExists, ICLOUD_SYNC_ENABLED_KEY, ICLOUD_LAST_SYNC_TIME_KEY, WEBDAV_CONFIG_KEY, maskPassword, maskApiKey, sortByDisplayTitle, getCurrentICloudConfig
} from "./utils"

import { AvatarIcon, FormRow, AccountRow, BookmarkRow } from "./components"

// --- 页面 Props 类型定义 ---
export type AccountEditorPageProps = { initialAccount?: AccountItem; onSave: (account: AccountItem) => void }
export type AccountPreviewPageProps = { account: AccountItem; onUpdate: (updatedAccount: AccountItem) => void; onDelete: (id: string) => void }
export type ApiListPageProps = { accounts: AccountItem[]; setAccounts: (acc: AccountItem[]) => void; isSelecting: boolean; setIsSelecting: (isSelecting: boolean) => void }

export type BookmarkEditorPageProps = { initialBookmark?: BookmarkItem; onSave: (bookmark: BookmarkItem) => void }
export type BookmarkPreviewPageProps = {
  bookmark: BookmarkItem
  onUpdate: (updatedBookmark: BookmarkItem) => void
  onDelete: (id: string) => void
  onDuplicate?: (bookmark: BookmarkItem) => void
}

export type SettingsPageProps = {
  accounts: AccountItem[];
  setAccounts: (acc: AccountItem[]) => void;
  bookmarks: BookmarkItem[];
  setBookmarks: (items: BookmarkItem[]) => void;
  webdavConfig: WebDAVConfig | null;
  setWebdavConfig: (cfg: WebDAVConfig | null) => void;
}

type ActionResponse<T> = { success: boolean; data?: T; error?: string; canceled?: boolean; toast?: { message: string; isError?: boolean } }

type ICloudConfigManagerPageProps = {
  initialConfigs: ICloudConfigMeta[]
  initialCurrentId: string
  onCreate: () => Promise<ActionResponse<ICloudConfigMeta>>
  onRename: (config: ICloudConfigMeta) => Promise<ActionResponse<ICloudConfigMeta[]>>
  onDelete: (config: ICloudConfigMeta) => Promise<ActionResponse<ICloudConfigMeta[]>>
  onSwitch: (config: ICloudConfigMeta) => Promise<ActionResponse<void>>
}

// 全局变量，用于跨页面维持 toast 状态
let pendingActionToast: { msg: string; isError: boolean } | null = null;

// Account 业务页面
export const AccountEditorPage = ({ initialAccount, onSave }: AccountEditorPageProps) => {
  const [name, setName] = useState<string>(initialAccount?.name || "")
  const [tagsStr, setTagsStr] = useState<string>(initialAccount?.tags?.join(", ") || "")
  const [avatarUrl, setAvatarUrl] = useState<string>(initialAccount?.avatarUrl || "")
  const [username, setUsername] = useState<string>(initialAccount?.username || "")
  const [email, setEmail] = useState<string>(initialAccount?.email || "")
  const [password, setPassword] = useState<string>(initialAccount?.password || "")
  const [apiKey, setApiKey] = useState<string>(initialAccount?.apiKey || "")
  const [url, setUrl] = useState<string>(initialAccount?.url || "")
  const [notes, setNotes] = useState<string>(initialAccount?.notes || "")
  const [customFields, setCustomFields] = useState<CustomField[]>(initialAccount?.customFields || [])

  const [toast, setToast] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false })
  const showToast = (msg: string, isError = false) => setToast({ msg, isError })
  const dismiss = Navigation.useDismiss()

  const handleAddCustomField = async () => {
    const key = await Dialog.prompt({ title: "新增附加信息", message: "请输入信息标题" })
    if (key?.trim()) setCustomFields([...customFields, { id: generateId(), key: key.trim(), value: "" }])
  }

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) return showToast("账号名称不能为空", true)
    if (!username.trim() && !email.trim() && !apiKey.trim() && !password.trim()) return showToast("请至少填写一种凭据信息", true)

    const parsedTags = tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean)
    const validCustomFields = customFields.filter(f => f.key.trim() && f.value.trim())

    onSave({
      id: initialAccount?.id || generateId(),
      name: name.trim(),
      createdAt: initialAccount?.createdAt || new Date().toLocaleDateString(),
      username: username.trim() || undefined,
      email: email.trim() || undefined,
      password: password.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      url: url.trim() || undefined,
      notes: notes.trim() || undefined,
      avatarUrl: avatarUrl.trim() || undefined,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
      customFields: validCustomFields.length > 0 ? validCustomFields : undefined,
      isPinned: initialAccount?.isPinned || false
    })
    dismiss()
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={initialAccount ? "编辑账号" : "新增账号"}
        navigationBarTitleDisplayMode="inline"
        toast={{ isPresented: toast.msg !== "", onChanged: (v) => { if (!v) setToast({ msg: "", isError: false }) }, message: toast.msg || " ", position: "top", textColor: toast.isError ? "#FF3B30" : undefined }}
        toolbar={{
          topBarLeading: <Button action={() => dismiss()}><HStack spacing={5}><Image systemName="chevron.left" fontWeight="semibold" foregroundStyle="#007AFF"/></HStack></Button>,
          topBarTrailing: <Button action={handleSave}><Text foregroundStyle="#007AFF" fontWeight="semibold">保存</Text></Button>,
        }}
      >
        <Section header={<Text>基础信息</Text>}>
          <FormRow label="账号名称" value={name} onChanged={setName} prompt="例如：GitHub, OpenAI" autofocus={!initialAccount} />
          <FormRow label="分类标签" value={tagsStr} onChanged={setTagsStr} prompt="多个标签用逗号分隔（可选）" />
          <FormRow label="头像链接" value={avatarUrl} onChanged={setAvatarUrl} prompt="自定义 Logo 地址（可选）" />
        </Section>
        <Section header={<Text>账号凭据</Text>} footer={<Text foregroundStyle="#8E8E93" font="footnote">请至少填写一种登录凭据或密钥</Text>}>
          <FormRow label="用户名" value={username} onChanged={setUsername} prompt="登录账号（可选）" />
          <FormRow label="邮箱" value={email} onChanged={setEmail} prompt="注册邮箱（可选）" />
          <FormRow label="密码" value={password} onChanged={setPassword} prompt="登录密码（可选）" />
          <FormRow label="API Key" value={apiKey} onChanged={setApiKey} prompt="授权密钥 Token（可选）" />
        </Section>
        <Section header={<Text>附加信息</Text>}>
          <FormRow label="网址" value={url} onChanged={setUrl} prompt="https://example.com（可选）" />
          <FormRow label="备注" value={notes} onChanged={setNotes} prompt="其他备忘信息（可选）" />
          {customFields.map(field => (
            <HStack key={field.id} alignment="center" spacing={8} padding={{ vertical: 4 }}>
              <Text frame={{ width: 75, alignment: "leading" }} lineLimit={1} foregroundStyle="#333333">{field.key}</Text>
              <TextField label={<Text>{""}</Text>} value={field.value} onChanged={v => setCustomFields(customFields.map(f => f.id === field.id ? { ...f, value: v } : f))} prompt="请输入内容" />
              <HStack alignment="center" spacing={12} frame={{ width: 60, alignment: "trailing" }}>
                {field.value.length > 0 ? <Button buttonStyle="plain" action={() => setCustomFields(customFields.map(f => f.id === field.id ? { ...f, value: "" } : f))}><Image systemName="xmark.circle.fill" foregroundStyle="#C7C7CC" font="subheadline" /></Button> : <VStack frame={{ width: 18 }} />}
                <Button buttonStyle="plain" action={() => setCustomFields(customFields.filter(f => f.id !== field.id))}><Image systemName="minus.circle.fill" foregroundStyle="#FF3B30" font="title3" /></Button>
              </HStack>
            </HStack>
          ))}
          <Button action={handleAddCustomField}>
            <HStack alignment="center" spacing={8} padding={{ vertical: 4 }}><Image systemName="plus.circle.fill" foregroundStyle="#007AFF" /><Text foregroundStyle="#007AFF">添加自定义条目</Text></HStack>
          </Button>
        </Section>
      </List>
    </NavigationStack>
  )
}

export const AccountPreviewPage = ({ account, onUpdate, onDelete }: AccountPreviewPageProps) => {
  const [currentAccount, setCurrentAccount] = useState<AccountItem>(account)
  const [toast, setToast] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false })
  const showToast = (msg: string, isError = false) => setToast({ msg, isError })
  const dismiss = Navigation.useDismiss()
  const ShapeVStack = VStack as any

  const handleEdit = () => {
    Navigation.present(<AccountEditorPage initialAccount={currentAccount} onSave={(acc) => { setCurrentAccount(acc); onUpdate(acc); showToast("修改已保存") }} />)
  }

  const handleDelete = async () => {
    if (await Dialog.confirm({ title: "确认删除", message: `确定要删除「${currentAccount.name}」吗？操作不可逆转。` })) {
      onDelete(currentAccount.id)
      dismiss()
    }
  }

  const CopyableRow = ({ label, value, isSecret = false, maskedValue }: { label: string, value: string, isSecret?: boolean, maskedValue?: string }) => (
    <Button action={() => { Pasteboard.setString(value); showToast(`${label}已复制`) }}>
      <HStack alignment="center">
         <Text>{label}</Text>
         <Spacer />
         <Text foregroundStyle="#8E8E93" lineLimit={1} frame={{ maxWidth: 220, alignment: "trailing" }}>{isSecret ? (maskedValue || "••••••••") : value}</Text>
      </HStack>
    </Button>
  )

  const hasAdditionalInfo = !!(currentAccount.url || currentAccount.notes || currentAccount.customFields?.length)

  return (
    <NavigationStack>
      <List
        navigationTitle="账号详情"
        navigationBarTitleDisplayMode="inline"
        toast={{ isPresented: toast.msg !== "", onChanged: (v) => { if (!v) setToast({ msg: "", isError: false }) }, message: toast.msg || " ", position: "top", textColor: toast.isError ? "#FF3B30" : undefined }}
        toolbar={{
          topBarLeading: <Button action={() => dismiss()}><HStack spacing={5}><Image systemName="chevron.left" fontWeight="semibold" foregroundStyle="#007AFF"/></HStack></Button>,
          topBarTrailing: <Button action={handleEdit}><Text foregroundStyle="#007AFF">编辑</Text></Button>,
        }}
      >
        <HStack spacing={16} padding={{ vertical: 10 }} alignment="center">
          <AvatarIcon url={currentAccount.avatarUrl} name={currentAccount.name} size={64} />
          <VStack alignment="leading" spacing={8}>
            <Text font="title2" fontWeight="bold">{currentAccount.name}</Text>
            {currentAccount.tags?.length ? (
              <HStack spacing={6}>
                {currentAccount.tags.map((tag, index) => (
                  <ShapeVStack key={index} background="quaternarySystemFill" clipShape={{ type: "rect", cornerRadius: 4 }}>
                    <Text font="caption2" foregroundStyle="#007AFF" fontWeight="medium" padding={{ horizontal: 6, vertical: 2 }}>{tag}</Text>
                  </ShapeVStack>
                ))}
              </HStack>
            ) : undefined}
          </VStack>
          <Spacer />
        </HStack>

        <Section header={<Text>凭据信息</Text>} footer={!hasAdditionalInfo ? <Text font="footnote" foregroundStyle="#8E8E93">点击信息即可快速复制</Text> : undefined}>
          {currentAccount.username ? <CopyableRow label="用户名" value={currentAccount.username} /> : undefined}
          {currentAccount.email ? <CopyableRow label="邮箱" value={currentAccount.email} /> : undefined}
          {currentAccount.password ? <CopyableRow label="密码" value={currentAccount.password} isSecret maskedValue={maskPassword(currentAccount.password)} /> : undefined}
          {currentAccount.apiKey ? <CopyableRow label="API Key" value={currentAccount.apiKey} isSecret maskedValue={maskApiKey(currentAccount.apiKey)} /> : undefined}
        </Section>

        {hasAdditionalInfo ? (
          <Section header={<Text>附加信息</Text>} footer={<Text font="footnote" foregroundStyle="#8E8E93">点击信息即可快速复制</Text>}>
            {currentAccount.url ? <CopyableRow label="网址" value={currentAccount.url} /> : undefined}
            {currentAccount.notes ? <CopyableRow label="备注" value={currentAccount.notes} /> : undefined}
            {currentAccount.customFields?.map(field => <CopyableRow key={field.id} label={field.key} value={field.value} />)}
          </Section>
        ) : undefined}

        <Section>
          <Button action={handleDelete}><HStack frame={{ maxWidth: "infinity" }} alignment="center"><Text foregroundStyle="#FF3B30">删除此账号</Text></HStack></Button>
        </Section>
      </List>
    </NavigationStack>
  )
}

export const ApiListPage = ({ accounts, setAccounts, isSelecting, setIsSelecting }: ApiListPageProps) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [toast, setToast] = useState({ msg: "", isError: false, isPresented: false })
  
  const showToast = useCallback((msg: string, isError = false) => {
    setToast(prev => ({ ...prev, isPresented: false }))
    setTimeout(() => setToast({ msg, isError, isPresented: true }), 150)
  }, [])

  useEffect(() => {
    if (!isSelecting && pendingActionToast) {
      const pt = pendingActionToast;
      pendingActionToast = null;
      setTimeout(() => showToast(pt.msg, pt.isError), 0); 
    }
  }, [isSelecting, showToast])

  const { filteredAccounts, groupedAccounts, sortedGroups, allTags } = useMemo(() => {
    let filtered = accounts
    if (activeTag) filtered = filtered.filter(a => a.tags?.includes(activeTag))

    const grouped = filtered.reduce((acc, account) => {
      const group = account.isPinned ? "置顶" : getGroupLetter(account.name)
      if (!acc[group]) acc[group] = []
      acc[group].push(account)
      return acc
    }, {} as Record<string, AccountItem[]>)

    Object.values(grouped).forEach(groupItems => groupItems.sort((a, b) => sortByDisplayTitle(a.name, b.name)))
    
    const sorted = Object.keys(grouped).sort((a, b) => {
      if (a === "置顶") return -1;
      if (b === "置顶") return 1;
      return a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b);
    })
    const tags = Array.from(new Set(accounts.flatMap(a => a.tags || []))).sort()
    
    return { filteredAccounts: filtered, groupedAccounts: grouped, sortedGroups: sorted, allTags: tags }
  }, [accounts, activeTag])

  const addAccount = async () => {
    await Navigation.present(<AccountEditorPage onSave={acc => { setAccounts([...accounts, acc]); showToast("账号已添加") }} />)
  }

  const openPreviewPage = (account: AccountItem) => {
    Navigation.present(
      <AccountPreviewPage 
        account={account} 
        onUpdate={updatedAccount => { setAccounts(accounts.map(a => a.id === updatedAccount.id ? updatedAccount : a)) }}
        onDelete={id => { setAccounts(accounts.filter(a => a.id !== id)); showToast("账号已删除", true) }}
      />
    )
  }

  const isAllSelected = filteredAccounts.length > 0 && selectedIds.size === filteredAccounts.length

  return (
    <NavigationStack>
      <List
        navigationTitle={activeTag ? `筛选: ${activeTag}` : "账号管理"}
        navigationBarTitleDisplayMode="inline"
        toast={{ isPresented: toast.isPresented, onChanged: (v) => { if (!v) setToast(prev => ({ ...prev, isPresented: false })) }, message: toast.msg || " ", position: "top", textColor: toast.isError ? "#FF3B30" : undefined }}
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              {isSelecting ? (
                <Button key="cancel-select" action={() => { setIsSelecting(false); setSelectedIds(new Set()) }}>
                  <Text foregroundStyle="#007AFF" fontWeight="semibold">取消</Text>
                </Button>
              ) : activeTag ? (
                <Button key="cancel-filter" action={() => setActiveTag(null)}>
                  <Text foregroundStyle="#007AFF" fontWeight="semibold">取消</Text>
                </Button>
              ) : (
                <Button key="close" action={() => Script.exit()}>
                  <Image systemName="xmark" foregroundStyle="#FF3B30" fontWeight="semibold" />
                </Button>
              )}
            </ToolbarItem>

            {isSelecting && (
              <ToolbarItem placement="topBarTrailing">
                <Button key="select-all" action={() => { 
                  if (isAllSelected) { 
                    setSelectedIds(new Set()); showToast("已取消全选") 
                  } else { 
                    const allIds = new Set(filteredAccounts.map(a => a.id)); setSelectedIds(allIds); showToast(`已选择 ${allIds.size} 条信息`) 
                  } 
                }}>
                  <Text foregroundStyle="#007AFF" fontWeight="semibold">{isAllSelected ? "取消全选" : "全选"}</Text>
                </Button>
              </ToolbarItem>
            )}

            {!isSelecting && (
              <ToolbarItem placement="topBarTrailing">
                <Button key="add-btn" action={addAccount}>
                  <Image systemName="plus" foregroundStyle="#007AFF" fontWeight="semibold" />
                </Button>
              </ToolbarItem>
            )}
            
            {!isSelecting && (
              <ToolbarSpacer placement="topBarTrailing" />
            )}
            
            {!isSelecting && accounts.length > 0 && (
              <ToolbarItem placement="topBarTrailing">
                <Menu key="more-menu" label={<Image systemName={activeTag ? "line.3.horizontal.decrease.circle.fill" : "ellipsis"} foregroundStyle={activeTag ? "#FF9500" : "#007AFF"} font="title3" />}>
                  {filteredAccounts.length > 0 && <Button action={() => { setIsSelecting(true); setSelectedIds(new Set()) }}><HStack><Text>选择</Text><Image systemName="checkmark.circle" /></HStack></Button>}
                  {allTags.length > 0 && <Menu label={<HStack><Text>筛选标签</Text><Image systemName="line.3.horizontal.decrease" /></HStack>}><Button action={() => setActiveTag(null)}><HStack><Text>显示全部</Text>{activeTag === null && <Image systemName="checkmark" />}</HStack></Button>{allTags.map(tag => <Button key={tag} action={() => setActiveTag(tag)}><HStack><Text>{tag}</Text>{activeTag === tag && <Image systemName="checkmark" />}</HStack></Button>)}</Menu>}
                </Menu>
              </ToolbarItem>
            )}

            {isSelecting && (
              <ToolbarItem placement="bottomBar">
                <HStack key="bottom-actions" spacing={16} alignment="center" padding={{ horizontal: 10 }}>
                  <Button disabled={selectedIds.size === 0} action={() => {
                    if (selectedIds.size === 0) return;
                    const selectedItems = accounts.filter(a => selectedIds.has(a.id))
                    const copyText = selectedItems.map(a => {
                      const parts = [`标题: ${a.name}`]
                      if (a.username) parts.push(`用户名: ${a.username}`)
                      if (a.email) parts.push(`邮箱: ${a.email}`)
                      if (a.password) parts.push(`密码: ${a.password}`)
                      if (a.apiKey) parts.push(`API Key: ${a.apiKey}`)
                      if (a.url) parts.push(`网址: ${a.url}`)
                      if (a.notes) parts.push(`备注: ${a.notes}`)
                      if (a.tags && a.tags.length > 0) parts.push(`标签: ${a.tags.join(', ')}`)
                      if (a.customFields && a.customFields.length > 0) a.customFields.forEach(f => parts.push(`${f.key}: ${f.value}`))
                      return parts.join('\n')
                    }).join('\n\n' + '='.repeat(10) + '\n\n')
                    Pasteboard.setString(copyText)
                    pendingActionToast = { msg: `已复制 ${selectedItems.length} 条信息`, isError: false }
                    setSelectedIds(new Set()); setIsSelecting(false)
                  }}><HStack spacing={4} alignment="center"><Image systemName="doc.on.doc" foregroundStyle={selectedIds.size > 0 ? "#007AFF" : "#C7C7CC"} font="footnote" fontWeight="semibold" /><Text foregroundStyle={selectedIds.size > 0 ? "#007AFF" : "#C7C7CC"} font="footnote" fontWeight="semibold">复制</Text></HStack></Button>
                  <Text font="footnote" fontWeight="semibold" foregroundStyle="#8E8E93">已选择 {selectedIds.size} 项</Text>
                  <Button disabled={selectedIds.size === 0} action={async () => {
                    if (selectedIds.size === 0) return;
                    const count = selectedIds.size;
                    if (await Dialog.confirm({ title: "确认删除", message: `确认删除这 ${count} 条信息吗？操作不可恢复。` })) {
                      setAccounts(accounts.filter(a => !selectedIds.has(a.id)))
                      pendingActionToast = { msg: `已删除 ${count} 条信息`, isError: true }
                      setSelectedIds(new Set()); setIsSelecting(false)
                    }
                  }}><HStack spacing={4} alignment="center"><Image systemName="trash" foregroundStyle={selectedIds.size > 0 ? "#FF3B30" : "#C7C7CC"} font="footnote" fontWeight="semibold" /><Text foregroundStyle={selectedIds.size > 0 ? "#FF3B30" : "#C7C7CC"} font="footnote" fontWeight="semibold">删除</Text></HStack></Button>
                </HStack>
              </ToolbarItem>
            )}
          </Toolbar>
        }
      >
        {filteredAccounts.length === 0 ? (
          <VStack padding={40} frame={{ maxWidth: "infinity" }} alignment="center"><Image systemName="person.circle" foregroundStyle="#C7C7CC" font="largeTitle" /><Text foregroundStyle="#8E8E93" font="body" padding={{ top: 12 }}>暂无账号，点击右上角 + 添加</Text></VStack>
        ) : (
          sortedGroups.map(group => (
            <Section key={group} header={<Text>{group}</Text>}>
              {groupedAccounts[group].map((account: AccountItem) => (
                <AccountRow 
                  key={account.id}
                  account={account}
                  isSelecting={isSelecting}
                  isSelected={selectedIds.has(account.id)}
                  onSelectToggle={() => {
                    const newSet = new Set(selectedIds)
                    if (newSet.has(account.id)) newSet.delete(account.id)
                    else newSet.add(account.id)
                    setSelectedIds(newSet)
                    showToast(newSet.size > 0 ? `已选择 ${newSet.size} 个项目` : "已取消选择")
                  }}
                  onClick={() => openPreviewPage(account)}
                  onDelete={() => { setAccounts(accounts.filter(a => a.id !== account.id)); showToast("已删除", true) }}
                  onPinToggle={() => { setAccounts(accounts.map(a => a.id === account.id ? { ...a, isPinned: !a.isPinned } : a)); showToast(account.isPinned ? "已取消置顶" : "已置顶") }}
                  showToast={showToast}
                />
              ))}
            </Section>
          ))
        )}
      </List>
    </NavigationStack>
  )
}

// Bookmark 业务页面
export const BookmarkEditorPage = ({ initialBookmark, onSave }: BookmarkEditorPageProps) => {
  const [title, setTitle] = useState<string>(initialBookmark?.title || "")
  const [url, setUrl] = useState<string>(initialBookmark?.url || "")
  const [tagsStr, setTagsStr] = useState<string>(initialBookmark?.tags?.join(", ") || "")
  const [iconUrl, setIconUrl] = useState<string>(initialBookmark?.iconUrl || "")
  const [notes, setNotes] = useState<string>(initialBookmark?.notes || "")
  const [customFields, setCustomFields] = useState<CustomField[]>(initialBookmark?.customFields || [])
  const [toast, setToast] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false })
  const dismiss = Navigation.useDismiss()
  const showToast = (msg: string, isError = false) => setToast({ msg, isError })

  const handleAddCustomField = async () => {
    const key = await Dialog.prompt({ title: "新增附加信息", message: "请输入信息标题" })
    if (key?.trim()) setCustomFields([...customFields, { id: generateId(), key: key.trim(), value: "" }])
  }

  const handleSave = () => {
    if (!title.trim()) return showToast("书签名称不能为空", true)
    if (!url.trim()) return showToast("书签链接不能为空", true)
    const finalUrl = processUrl(url.trim())
    if (!finalUrl) return showToast("请输入有效的书签链接", true)
    const parsedTags = tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean)
    const validCustomFields = customFields.filter(f => f.key.trim() && f.value.trim())

    onSave({
      id: initialBookmark?.id || generateId(),
      title: title.trim(),
      createdAt: initialBookmark?.createdAt || new Date().toLocaleDateString(),
      url: finalUrl,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
      notes: notes.trim() || undefined,
      iconUrl: iconUrl.trim() || undefined,
      customFields: validCustomFields.length > 0 ? validCustomFields : undefined,
      isPinned: initialBookmark?.isPinned || false
    })
    dismiss()
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={initialBookmark ? "编辑书签" : "新增书签"}
        navigationBarTitleDisplayMode="inline"
        toast={{ isPresented: toast.msg !== "", onChanged: (v) => { if (!v) setToast({ msg: "", isError: false }) }, message: toast.msg || " ", position: "top", textColor: toast.isError ? "#FF3B30" : undefined }}
        toolbar={{
          topBarLeading: <Button action={() => dismiss()}><HStack spacing={5}><Image systemName="chevron.left" fontWeight="semibold" foregroundStyle="#007AFF"/></HStack></Button>,
          topBarTrailing: <Button action={handleSave}><Text foregroundStyle="#007AFF" fontWeight="semibold">保存</Text></Button>,
        }}
      >
        <Section header={<Text>链接信息</Text>}>
          <FormRow label="书签名称" value={title} onChanged={setTitle} prompt="例如：GitHub 首页" autofocus={!initialBookmark} />
          <FormRow label="书签链接" value={url} onChanged={setUrl} prompt="https://example.com" />
          <FormRow label="分类标签" value={tagsStr} onChanged={setTagsStr} prompt="多个标签用逗号分隔（可选）" />
          <FormRow label="图标链接" value={iconUrl} onChanged={setIconUrl} prompt="站点图标地址（可选）" />
        </Section>
        <Section header={<Text>附加信息</Text>}>
          <FormRow label="备注" value={notes} onChanged={setNotes} prompt="其他备忘信息（可选）" />
          {customFields.map((field: CustomField) => (
            <HStack key={field.id} alignment="center" spacing={8} padding={{ vertical: 4 }}>
              <Text frame={{ width: 75, alignment: "leading" }} lineLimit={1} foregroundStyle="#333333">{field.key}</Text>
              <TextField label={<Text>{""}</Text>} value={field.value} onChanged={(v: string) => setCustomFields(customFields.map(f => f.id === field.id ? { ...f, value: v } : f))} prompt="请输入内容" />
              <HStack alignment="center" spacing={12} frame={{ width: 60, alignment: "trailing" }}>
                {field.value.length > 0 && <Button buttonStyle="plain" action={() => setCustomFields(customFields.map(f => f.id === field.id ? { ...f, value: "" } : f))}><Image systemName="xmark.circle.fill" foregroundStyle="#C7C7CC" font="subheadline" /></Button>}
                <Button buttonStyle="plain" action={() => setCustomFields(customFields.filter(f => f.id !== field.id))}><Image systemName="minus.circle.fill" foregroundStyle="#FF3B30" font="title3" /></Button>
              </HStack>
            </HStack>
          ))}
          <Button action={handleAddCustomField}><HStack alignment="center" spacing={8} padding={{ vertical: 4 }}><Image systemName="plus.circle.fill" foregroundStyle="#007AFF" /><Text foregroundStyle="#007AFF">添加自定义条目</Text></HStack></Button>
        </Section>
      </List>
    </NavigationStack>
  )
}

export const BookmarkPreviewPage = ({ bookmark, onUpdate, onDelete }: BookmarkPreviewPageProps) => {
  const [currentBookmark, setCurrentBookmark] = useState<BookmarkItem>(bookmark)
  const [toast, setToast] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false })
  const dismiss = Navigation.useDismiss()
  const showToast = (msg: string, isError = false) => setToast({ msg, isError })

  const handleEdit = () => { Navigation.present(<BookmarkEditorPage initialBookmark={currentBookmark} onSave={(nextBookmark: BookmarkItem) => { setCurrentBookmark(nextBookmark); onUpdate(nextBookmark); showToast("修改已保存") }} />) }
  const handleDelete = async () => { if (await Dialog.confirm({ title: "确认删除", message: `确定要删除「${currentBookmark.title}」吗？` })) { onDelete(currentBookmark.id); dismiss() } }
  const CopyableRow = ({ label, value }: { label: string, value: string }) => (
    <Button action={() => { Pasteboard.setString(value); showToast(`${label}已复制`) }}><HStack alignment="center"><Text>{label}</Text><Spacer /><Text foregroundStyle="#8E8E93" lineLimit={1} frame={{ maxWidth: 220, alignment: "trailing" }}>{value}</Text></HStack></Button>
  )
  
  const hasAdditionalInfo = !!(currentBookmark.notes || currentBookmark.customFields?.length)

  return (
    <NavigationStack>
      <List
        navigationTitle="书签详情"
        navigationBarTitleDisplayMode="inline"
        toast={{ isPresented: toast.msg !== "", onChanged: (v) => { if (!v) setToast({ msg: "", isError: false }) }, message: toast.msg || " ", position: "top", textColor: toast.isError ? "#FF3B30" : undefined }}
        toolbar={{
          topBarLeading: <Button action={() => dismiss()}><HStack spacing={5}><Image systemName="chevron.left" fontWeight="semibold" foregroundStyle="#007AFF"/></HStack></Button>,
          topBarTrailing: <Button action={handleEdit}><Text foregroundStyle="#007AFF">编辑</Text></Button>,
        }}
      >
        <HStack spacing={16} padding={{ vertical: 10 }} alignment="center">
          <AvatarIcon url={currentBookmark.iconUrl} name={currentBookmark.title} size={64} />
          <VStack alignment="leading" spacing={8}>
            <Text font="title2" fontWeight="bold">{currentBookmark.title}</Text>
            {currentBookmark.tags?.length ? (
              <HStack spacing={6}>
                {currentBookmark.tags.map((tag: string, index: number) => { const ShapeVStack = VStack as any; return <ShapeVStack key={index} background="quaternarySystemFill" clipShape={{ type: "rect", cornerRadius: 4 }}><Text font="caption2" foregroundStyle="#007AFF" fontWeight="medium" padding={{ horizontal: 6, vertical: 2 }}>{tag}</Text></ShapeVStack> })}
              </HStack>
            ) : undefined}
          </VStack>
          <Spacer />
        </HStack>

        <Section 
          header={<Text>链接信息</Text>} 
          footer={!hasAdditionalInfo ? <Text font="footnote" foregroundStyle="#8E8E93">点击信息即可快速复制</Text> : undefined}
        >
          <CopyableRow label="链接" value={currentBookmark.url} />
        </Section>

        {hasAdditionalInfo ? (
          <Section 
            header={<Text>附加信息</Text>} 
            footer={<Text font="footnote" foregroundStyle="#8E8E93">点击信息即可快速复制</Text>}
          >
            {currentBookmark.notes ? <CopyableRow label="备注" value={currentBookmark.notes} /> : undefined}
            {currentBookmark.customFields?.map((field: CustomField) => <CopyableRow key={field.id} label={field.key} value={field.value} />)}
          </Section>
        ) : undefined}
        
        <Section><Button action={handleDelete}><HStack frame={{ maxWidth: "infinity" }} alignment="center"><Text foregroundStyle="#FF3B30">删除此书签</Text></HStack></Button></Section>
      </List>
    </NavigationStack>
  )
}

export const BookmarkListPage = ({ bookmarks, setBookmarks, isSelecting, setIsSelecting }: { bookmarks: BookmarkItem[], setBookmarks: (items: BookmarkItem[]) => void, isSelecting: boolean, setIsSelecting: (isSelecting: boolean) => void }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [toast, setToast] = useState({ msg: "", isError: false, isPresented: false })

  const showToast = useCallback((msg: string, isError = false) => {
    setToast(prev => ({ ...prev, isPresented: false }))
    setTimeout(() => setToast({ msg, isError, isPresented: true }), 150)
  }, [])

  useEffect(() => {
    if (!isSelecting && pendingActionToast) {
      const pt = pendingActionToast
      pendingActionToast = null
      setTimeout(() => showToast(pt.msg, pt.isError), 0)
    }
  }, [isSelecting, showToast])

  const { filteredBookmarks, groupedBookmarks, sortedGroups, allTags } = useMemo(() => {
    let filtered = bookmarks
    if (activeTag) filtered = filtered.filter(item => item.tags?.includes(activeTag))

    const grouped = filtered.reduce((acc, bookmark) => {
      const group = bookmark.isPinned ? "置顶" : getGroupLetter(bookmark.title)
      if (!acc[group]) acc[group] = []
      acc[group].push(bookmark)
      return acc
    }, {} as Record<string, BookmarkItem[]>)

    Object.values(grouped).forEach(groupItems => groupItems.sort((a, b) => sortByDisplayTitle(a.title, b.title)))

    const sorted = Object.keys(grouped).sort((a, b) => {
      if (a === "置顶") return -1;
      if (b === "置顶") return 1;
      return a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b);
    })
    const tags = Array.from(new Set(bookmarks.flatMap(item => item.tags || []))).sort()

    return { filteredBookmarks: filtered, groupedBookmarks: grouped, sortedGroups: sorted, allTags: tags }
  }, [bookmarks, activeTag])

  const addBookmark = async () => { Navigation.present(<BookmarkEditorPage onSave={bookmark => { setBookmarks([...bookmarks, bookmark]); showToast("书签已添加") }} />) }
  const openPreviewPage = (bookmark: BookmarkItem) => {
    Navigation.present(
      <BookmarkPreviewPage 
        bookmark={bookmark} 
        onUpdate={(updatedBookmark: BookmarkItem) => { setBookmarks(bookmarks.map(item => item.id === updatedBookmark.id ? updatedBookmark : item)) }} 
        onDelete={(id: string) => { setBookmarks(bookmarks.filter(item => item.id !== id)); showToast("书签已删除", true) }} 
        onDuplicate={(nextBookmark: BookmarkItem) => { setBookmarks([...bookmarks, nextBookmark]); showToast("书签副本已添加") }} 
      />
    )
  }

  const isAllSelected = filteredBookmarks.length > 0 && selectedIds.size === filteredBookmarks.length

  return (
    <NavigationStack>
      <List
        navigationTitle={activeTag ? `筛选: ${activeTag}` : "书签管理"}
        navigationBarTitleDisplayMode="inline"
        toast={{ isPresented: toast.isPresented, onChanged: (v) => { if (!v) setToast(prev => ({ ...prev, isPresented: false })) }, message: toast.msg || " ", position: "top", textColor: toast.isError ? "#FF3B30" : undefined }}
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              {isSelecting ? (
                <Button key="cancel-select" action={() => { setIsSelecting(false); setSelectedIds(new Set()) }}>
                  <Text foregroundStyle="#007AFF" fontWeight="semibold">取消</Text>
                </Button>
              ) : activeTag ? (
                <Button key="cancel-filter" action={() => setActiveTag(null)}>
                  <Text foregroundStyle="#007AFF" fontWeight="semibold">取消</Text>
                </Button>
              ) : (
                <Button key="close" action={() => Script.exit()}>
                  <Image systemName="xmark" foregroundStyle="#FF3B30" fontWeight="semibold" />
                </Button>
              )}
            </ToolbarItem>

            {isSelecting && (
              <ToolbarItem placement="topBarTrailing">
                <Button key="select-all" action={() => { 
                  if (isAllSelected) { 
                    setSelectedIds(new Set()); showToast("已取消全选") 
                  } else { 
                    const allIds = new Set(filteredBookmarks.map(item => item.id)); setSelectedIds(allIds); showToast(`已选择 ${allIds.size} 条书签`) 
                  } 
                }}>
                  <Text foregroundStyle="#007AFF" fontWeight="semibold">{isAllSelected ? "取消全选" : "全选"}</Text>
                </Button>
              </ToolbarItem>
            )}

            {!isSelecting && (
              <ToolbarItem placement="topBarTrailing">
                <Button key="add-btn" action={addBookmark}>
                  <Image systemName="plus" foregroundStyle="#007AFF" fontWeight="semibold" />
                </Button>
              </ToolbarItem>
            )}
            
            {!isSelecting && (
              <ToolbarSpacer placement="topBarTrailing" />
            )}
            
            {!isSelecting && bookmarks.length > 0 && (
              <ToolbarItem placement="topBarTrailing">
                <Menu key="more-menu" label={<Image systemName={activeTag ? "line.3.horizontal.decrease.circle.fill" : "ellipsis"} foregroundStyle={activeTag ? "#FF9500" : "#007AFF"} font="title3" />}>
                  {filteredBookmarks.length > 0 && <Button action={() => { setIsSelecting(true); setSelectedIds(new Set()) }}><HStack><Text>选择</Text><Image systemName="checkmark.circle" /></HStack></Button>}
                  {allTags.length > 0 && <Menu label={<HStack><Text>筛选标签</Text><Image systemName="line.3.horizontal.decrease" /></HStack>}><Button action={() => setActiveTag(null)}><HStack><Text>显示全部</Text>{activeTag === null && <Image systemName="checkmark" />}</HStack></Button>{allTags.map(tag => <Button key={tag} action={() => setActiveTag(tag)}><HStack><Text>{tag}</Text>{activeTag === tag && <Image systemName="checkmark" />}</HStack></Button>)}</Menu>}
                </Menu>
              </ToolbarItem>
            )}
            
            {isSelecting && (
              <ToolbarItem placement="bottomBar">
                <HStack key="bottom-actions" spacing={16} alignment="center" padding={{ horizontal: 10 }}>
                  <Button disabled={selectedIds.size === 0} action={() => {
                    if (selectedIds.size === 0) return
                    const selectedItems = bookmarks.filter(item => selectedIds.has(item.id))
                    const copyText = selectedItems.map(item => {
                      const parts = [`标题: ${item.title}`, `链接: ${item.url}`]
                      if (item.notes) parts.push(`备注: ${item.notes}`)
                      if (item.tags?.length) parts.push(`标签: ${item.tags.join(', ')}`)
                      if (item.customFields && item.customFields.length > 0) item.customFields.forEach(f => parts.push(`${f.key}: ${f.value}`))
                      return parts.join('\n')
                    }).join('\n\n' + '='.repeat(10) + '\n\n')
                    Pasteboard.setString(copyText)
                    pendingActionToast = { msg: `已复制 ${selectedItems.length} 条书签`, isError: false }
                    setSelectedIds(new Set()); setIsSelecting(false)
                  }}><HStack spacing={4} alignment="center"><Image systemName="doc.on.doc" foregroundStyle={selectedIds.size > 0 ? "#007AFF" : "#C7C7CC"} font="footnote" fontWeight="semibold" /><Text foregroundStyle={selectedIds.size > 0 ? "#007AFF" : "#C7C7CC"} font="footnote" fontWeight="semibold">复制</Text></HStack></Button>
                  <Text font="footnote" fontWeight="semibold" foregroundStyle="#8E8E93">已选择 {selectedIds.size} 项</Text>
                  <Button disabled={selectedIds.size === 0} action={async () => {
                    if (selectedIds.size === 0) return
                    const count = selectedIds.size
                    if (await Dialog.confirm({ title: "确认删除", message: `确认删除这 ${count} 条书签吗？操作不可恢复。` })) {
                      setBookmarks(bookmarks.filter(item => !selectedIds.has(item.id)))
                      pendingActionToast = { msg: `已删除 ${count} 条书签`, isError: true }
                      setSelectedIds(new Set()); setIsSelecting(false)
                    }
                  }}><HStack spacing={4} alignment="center"><Image systemName="trash" foregroundStyle={selectedIds.size > 0 ? "#FF3B30" : "#C7C7CC"} font="footnote" fontWeight="semibold" /><Text foregroundStyle={selectedIds.size > 0 ? "#FF3B30" : "#C7C7CC"} font="footnote" fontWeight="semibold">删除</Text></HStack></Button>
                </HStack>
              </ToolbarItem>
            )}
          </Toolbar>
        }
      >
        {filteredBookmarks.length === 0 ? (
          <VStack padding={40} frame={{ maxWidth: "infinity" }} alignment="center"><Image systemName="bookmark.circle" foregroundStyle="#C7C7CC" font="largeTitle" /><Text foregroundStyle="#8E8E93" font="body" padding={{ top: 12 }}>暂无书签，点击右上角 + 添加</Text></VStack>
        ) : (
          sortedGroups.map(group => (
            <Section key={group} header={<Text>{group}</Text>}>
              {groupedBookmarks[group].map(bookmark => (
                <BookmarkRow
                  key={bookmark.id}
                  bookmark={bookmark}
                  isSelecting={isSelecting}
                  isSelected={selectedIds.has(bookmark.id)}
                  onSelectToggle={() => {
                    const newSet = new Set(selectedIds)
                    if (newSet.has(bookmark.id)) newSet.delete(bookmark.id)
                    else newSet.add(bookmark.id)
                    setSelectedIds(newSet); showToast(newSet.size > 0 ? `已选择 ${newSet.size} 个项目` : "已取消选择")
                  }}
                  onClick={() => openPreviewPage(bookmark)}
                  onDelete={() => { setBookmarks(bookmarks.filter(item => item.id !== bookmark.id)); showToast("已删除", true) }}
                  onPinToggle={() => { setBookmarks(bookmarks.map(item => item.id === bookmark.id ? { ...item, isPinned: !item.isPinned } : item)); showToast(bookmark.isPinned ? "已取消置顶" : "已置顶") }}
                  showToast={showToast}
                />
              ))}
            </Section>
          ))
        )}
      </List>
    </NavigationStack>
  )
}

// 搜索和设置页面
export const SearchPage = ({ accounts, setAccounts, bookmarks, setBookmarks }: { accounts: AccountItem[], setAccounts: (acc: AccountItem[]) => void, bookmarks: BookmarkItem[], setBookmarks: (items: BookmarkItem[]) => void }) => {
  const [searchText, setSearchText] = useState<string>("")
  const [toast, setToast] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false })
  const showToast = (msg: string, isError = false) => setToast({ msg, isError })

  const filteredAccounts = useMemo(() => {
    if (!searchText.trim()) return []
    const query = searchText.toLowerCase()
    return accounts
      .filter(a => 
        a.name.toLowerCase().includes(query) || (a.username && a.username.toLowerCase().includes(query)) || (a.email && a.email.toLowerCase().includes(query)) || (a.url && a.url.toLowerCase().includes(query)) || (a.notes && a.notes.toLowerCase().includes(query)) || (a.apiKey && a.apiKey.toLowerCase().includes(query)) || (a.tags && a.tags.some(tag => tag.toLowerCase().includes(query))) || (a.customFields && a.customFields.some(field => field.key.toLowerCase().includes(query) || field.value.toLowerCase().includes(query)))
      )
      .sort((a, b) => sortByDisplayTitle(a.name, b.name))
  }, [accounts, searchText])

  const openPreviewPage = (account: AccountItem) => {
    Navigation.present(<AccountPreviewPage account={account} onUpdate={(updatedAccount: AccountItem) => { setAccounts(accounts.map(a => a.id === updatedAccount.id ? updatedAccount : a)) }} onDelete={(id: string) => { setAccounts(accounts.filter(a => a.id !== id)); showToast("账号已删除", true) }} />)
  }

  const filteredBookmarks = useMemo(() => {
    if (!searchText.trim()) return []
    const query = searchText.toLowerCase()
    return bookmarks
      .filter((item: BookmarkItem) =>
        item.title.toLowerCase().includes(query) || item.url.toLowerCase().includes(query) || (item.notes && item.notes.toLowerCase().includes(query)) || (item.tags && item.tags.some((tag: string) => tag.toLowerCase().includes(query))) || (item.customFields && item.customFields.some((field: CustomField) => field.key.toLowerCase().includes(query) || field.value.toLowerCase().includes(query)))
      )
      .sort((a, b) => sortByDisplayTitle(a.title, b.title))
  }, [bookmarks, searchText])

  const openBookmarkPreviewPage = (bookmark: BookmarkItem) => {
    Navigation.present(<BookmarkPreviewPage bookmark={bookmark} onUpdate={(updatedBookmark: BookmarkItem) => { setBookmarks(bookmarks.map(item => item.id === updatedBookmark.id ? updatedBookmark : item)) }} onDelete={(id: string) => { setBookmarks(bookmarks.filter(item => item.id !== id)); showToast("书签已删除", true) }} />)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="搜索"
        navigationBarTitleDisplayMode="inline"
        toast={{ isPresented: toast.msg !== "", onChanged: (v) => { if (!v) setToast({ msg: "", isError: false }) }, message: toast.msg || " ", position: "top", textColor: toast.isError ? "#FF3B30" : undefined }}
        searchable={{ value: searchText, onChanged: setSearchText, prompt: "搜索" }}
      >
        {!searchText.trim() ? (
          <VStack padding={40} frame={{ maxWidth: "infinity" }} alignment="center"><Image systemName="magnifyingglass" foregroundStyle="#C7C7CC" font="largeTitle" /><Text foregroundStyle="#8E8E93" font="body" padding={{ top: 12 }}>请输入关键字搜索信息</Text></VStack>
        ) : filteredAccounts.length === 0 && filteredBookmarks.length === 0 ? (
          <VStack padding={40} frame={{ maxWidth: "infinity" }} alignment="center"><Image systemName="doc.text.magnifyingglass" foregroundStyle="#C7C7CC" font="largeTitle" /><Text foregroundStyle="#8E8E93" font="body" padding={{ top: 12 }}>未找到匹配的账号或书签</Text></VStack>
        ) : (
          <>
            {filteredAccounts.length > 0 ? (
              <Section header={<Text>账号</Text>}>
                {filteredAccounts.map(account => <AccountRow key={account.id} account={account} onClick={() => openPreviewPage(account)} onDelete={() => { setAccounts(accounts.filter(a => a.id !== account.id)); showToast("已删除", true) }} onPinToggle={() => { setAccounts(accounts.map(a => a.id === account.id ? { ...a, isPinned: !a.isPinned } : a)); showToast(account.isPinned ? "已取消置顶" : "已置顶") }} showToast={showToast} />)}
              </Section>
            ) : undefined}
            {filteredBookmarks.length > 0 ? (
              <Section header={<Text>书签</Text>}>
                {filteredBookmarks.map(bookmark => <BookmarkRow key={bookmark.id} bookmark={bookmark} onClick={() => openBookmarkPreviewPage(bookmark)} onDelete={() => { setBookmarks(bookmarks.filter(item => item.id !== bookmark.id)); showToast("书签已删除", true) }} onPinToggle={() => { setBookmarks(bookmarks.map(item => item.id === bookmark.id ? { ...item, isPinned: !item.isPinned } : item)); showToast(bookmark.isPinned ? "已取消置顶" : "已置顶") }} showToast={showToast} />)}
              </Section>
            ) : undefined}
          </>
        )}
      </List>
    </NavigationStack>
  )
}

export const ICloudConfigManagerPage = ({ 
  initialConfigs, 
  initialCurrentId, 
  onCreate, 
  onRename, 
  onDelete, 
  onSwitch 
}: ICloudConfigManagerPageProps) => {
  const dismiss = Navigation.useDismiss()
  
  const [configs, setConfigs] = useState<ICloudConfigMeta[]>(initialConfigs)
  const [currentId, setCurrentId] = useState<string>(initialCurrentId)
  
  const [toast, setToast] = useState({ msg: "", isError: false, isPresented: false })
  const showToast = useCallback((msg: string, isError = false) => {
    setToast(prev => ({ ...prev, isPresented: false }))
    setTimeout(() => setToast({ msg, isError, isPresented: true }), 150)
  }, [])

  const handleCreate = async () => {
    const result = await onCreate()
    if (result.success && result.data) {
      const updated = loadICloudConfigIndex()
      setConfigs([...updated.configs])
      dismiss()
    } else if (result.toast) {
      showToast(result.toast.message, result.toast.isError)
    } else if (result.error) {
      showToast(result.error, true)
    }
  }

  const handleRename = async (config: ICloudConfigMeta) => {
    const result = await onRename(config)
    if (result.success && result.data) {
      setConfigs([...result.data])
      showToast("重命名成功")
    } else if (result.error) {
      showToast(result.error, true)
    }
  }

  const handleDelete = async (config: ICloudConfigMeta) => {
    const result = await onDelete(config)
    if (result.success && result.data) {
      setConfigs([...result.data])
      const index = loadICloudConfigIndex()
      setCurrentId(index.currentConfigId)
      showToast(`已删除配置「${config.name}」`, true)
    } else if (result.error) {
      showToast(result.error, true)
    }
  }

  const handleSwitch = async (config: ICloudConfigMeta) => {
    const result = await onSwitch(config)
    if (result.success) {
      dismiss()
    } else if (result.toast) {
      showToast(result.toast.message, result.toast.isError)
    } else if (result.error) {
      showToast(result.error, true)
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="iCloud 配置列表"
        navigationBarTitleDisplayMode="inline"
        toast={{ 
          isPresented: toast.isPresented, 
          onChanged: (v) => { if (!v) setToast(prev => ({ ...prev, isPresented: false })) }, 
          message: toast.msg || " ", 
          position: "top", 
          textColor: toast.isError ? "#FF3B30" : undefined 
        }}
        toolbar={{
          topBarLeading: <Button action={() => dismiss()}><HStack spacing={5}><Image systemName="chevron.left" fontWeight="semibold" foregroundStyle="#007AFF"/></HStack></Button>,
          topBarTrailing: <Button action={handleCreate}><Text foregroundStyle="#007AFF" fontWeight="semibold">新增</Text></Button>,
        }}
      >
        <Section footer={<Text font="footnote" foregroundStyle="#8E8E93">每个配置对应一个独立的 iCloud 加密文件；切换配置时会校验目标文件密码并加载对应数据。</Text>}>
          {configs.map(config => {
            const isCurrent = config.id === currentId
            return (
              <HStack key={`${config.id}-${currentId}`} padding={{ vertical: 6 }} alignment="center">
                <Button action={() => handleSwitch(config)} buttonStyle="plain">
                  <VStack alignment="leading" spacing={2}>
                    <HStack spacing={6} alignment="center">
                      <Text fontWeight={isCurrent ? "semibold" : undefined} foregroundStyle={isCurrent ? "#007AFF" : undefined}>{config.name}</Text>
                      {isCurrent ? <Text font="caption2" foregroundStyle="#007AFF">当前</Text> : undefined}
                    </HStack>
                    <Text font="caption" foregroundStyle="#8E8E93">{config.lastSyncAt ? `最后同步：${new Date(config.lastSyncAt).toLocaleString()}` : "尚未同步"}</Text>
                  </VStack>
                </Button>
                <Spacer />
<Menu label={<Image systemName="ellipsis.circle" foregroundStyle="#007AFF" />}>
  {!isCurrent && (
    <Button action={() => handleSwitch(config)}>
      <HStack>
        <Text>切换到此配置</Text>
        <Image systemName="arrow.right.circle" />
      </HStack>
    </Button>
  )}
  
  <Button action={() => handleRename(config)}>
    <HStack>
      <Text>重命名</Text>
      <Image systemName="pencil" />
    </HStack>
  </Button>

  {!isCurrent && configs.length > 1 ? (
    <Button action={() => handleDelete(config)} role="destructive">
      <HStack>
        <Text foregroundStyle="#FF3B30">删除</Text>
        <Image systemName="trash" foregroundStyle="#FF3B30" />
      </HStack>
    </Button>
  ) : undefined}
</Menu>
              </HStack>
            )
          })}
        </Section>
      </List>
    </NavigationStack>
  )
}

export const SettingsPage = ({ accounts, setAccounts, bookmarks, setBookmarks, webdavConfig, setWebdavConfig }: SettingsPageProps) => {
  const [toast, setToast] = useState({ msg: "", isError: false, isPresented: false })
  const showToast = useCallback((msg: string, isError = false) => { setToast(prev => ({ ...prev, isPresented: false })); setTimeout(() => setToast({ msg, isError, isPresented: true }), 150) }, [])

  const [icloudEnabled, setIcloudEnabled] = useState<boolean>(() => Storage.get(ICLOUD_SYNC_ENABLED_KEY) ?? false)
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(() => Storage.get(ICLOUD_LAST_SYNC_TIME_KEY) ?? null)
  const [icloudConfigs, setIcloudConfigs] = useState<ICloudConfigMeta[]>(() => ensureICloudConfigIndex().configs)
  const [currentIcloudConfigId, setCurrentIcloudConfigId] = useState<string>(() => ensureICloudConfigIndex().currentConfigId)

  useEffect(() => {
    let isMounted = true
    const poll = () => {
      if (!isMounted) return
      const index = loadICloudConfigIndex()
      setIcloudConfigs(index.configs)
      setCurrentIcloudConfigId(index.currentConfigId)
      const currentConfig = index.configs.find(item => item.id === index.currentConfigId)
      setLastSyncTime(currentConfig?.lastSyncAt ?? (Storage.get(ICLOUD_LAST_SYNC_TIME_KEY) ?? null))
      setTimeout(poll, 2000)
    }
    poll()
    return () => { isMounted = false }
  }, [])

  const currentIcloudConfig = useMemo(() => icloudConfigs.find(item => item.id === currentIcloudConfigId) || getCurrentICloudConfig(), [icloudConfigs, currentIcloudConfigId])

  const promptForPassword = async (title: string, message: string, defaultValue?: string, onToast?: (msg: string, isError?: boolean) => void): Promise<string | null> => {
    const reportToast = onToast || showToast
    const pwd = await Dialog.prompt({ title, message, placeholder: "请输入密码", defaultValue: defaultValue || "" })
    if (!pwd || !pwd.trim()) { reportToast("已取消操作：请输入密码", true); return null }
    return pwd.trim()
  }

  const promptToCreatePassword = async (subject: string, onToast?: (msg: string, isError?: boolean) => void): Promise<string | null> => {
    const reportToast = onToast || showToast
    const newPwd = await promptForPassword(`创建${subject}密码`, `${subject}尚未设置文件密码，请先创建一个文件绑定密码。`, undefined, reportToast)
    if (!newPwd) return null
    const confirmPwd = await promptForPassword(`确认${subject}密码`, "请再次输入刚刚设置的文件密码。", undefined, reportToast)
    if (!confirmPwd) return null
    if (newPwd !== confirmPwd) {
      reportToast("两次输入的密码不一致", true)
      return null
    }
    return newPwd
  }

  const ensureICloudConfigPassword = async (config: ICloudConfigMeta, mode: "open" | "create" | "switch" | "upload" | "export", onToast?: (msg: string, isError?: boolean) => void): Promise<string | null> => {
    const reportToast = onToast || showToast
    const existingPwd = getICloudFilePassword(config.id)
    if (existingPwd) {
      const title = mode === "switch" ? "验证配置密码" : "验证文件密码"
      const message = mode === "switch"
        ? `切换到配置「${config.name}」前，请输入该配置文件绑定的密码。`
        : mode === "upload"
          ? `上传到 WebDAV 前，请输入当前配置「${config.name}」的文件绑定密码。`
          : mode === "export"
            ? `导出本地备份前，请先验证当前配置「${config.name}」的文件绑定密码。`
            : mode === "create"
              ? `请为配置「${config.name}」创建文件绑定密码。`
              : `打开配置「${config.name}」前，请输入该配置文件绑定的密码。`
      const verifyPwd = await promptForPassword(title, message, undefined, reportToast)
      if (!verifyPwd) return null
      if (verifyPwd !== existingPwd) {
        reportToast("文件密码错误", true)
        return null
      }
      return existingPwd
    }

    // 没有本地保存的密码，检查 iCloud 文件是否已存在
    const fileExists = await checkICloudConfigFileExists(config)
    if (fileExists) {
      // 文件已存在但无本地密码 → 需要验证已有密码
      const title = mode === "switch" ? "验证配置密码" : "验证文件密码"
      const message = mode === "switch"
        ? `切换到配置「${config.name}」前，请输入该配置文件绑定的密码。`
        : mode === "open"
          ? `配置「${config.name}」的 iCloud 文件已存在，请输入该文件绑定的密码以启用同步。`
          : `配置「${config.name}」的 iCloud 文件已存在，请输入该文件绑定的密码。`
      const verifyPwd = await promptForPassword(title, message, undefined, reportToast)
      if (!verifyPwd) return null
      try {
        await restoreAccountsFromICloud(verifyPwd, config)
        saveICloudFilePassword(config.id, verifyPwd)
        return verifyPwd
      } catch {
        reportToast("文件密码错误或文件损坏", true)
        return null
      }
    }

    // 文件不存在 → 创建新密码
    const createdPwd = await promptToCreatePassword(`配置「${config.name}」`, reportToast)
    if (!createdPwd) return null
    saveICloudFilePassword(config.id, createdPwd)
    return createdPwd
  }

  const configureWebDAV = async () => {
    const url = await Dialog.prompt({ title: "WebDAV 配置", message: "请输入地址", placeholder: "https://...", defaultValue: webdavConfig?.url || "" })
    if (!url) return
    const username = await Dialog.prompt({ title: "WebDAV 配置", message: "请输入用户名", defaultValue: webdavConfig?.username || "" })
    if (!username) return
    const password = await Dialog.prompt({ title: "WebDAV 配置", message: "请输入密码", defaultValue: webdavConfig?.password || "" })
    if (!password) return
    const config: WebDAVConfig = { url: url.trim().replace(/\/$/, ""), username: username.trim(), password: password.trim() }
    const isValid = await testWebDAVConnection(config)
    if (!isValid) return showToast("WebDAV 连接失败，请检查地址、用户名或密码", true)
    saveWebDAVConfig(config); setWebdavConfig(config); showToast("WebDAV 配置已保存，连接测试通过") 
  }

  const clearWebDAVConfig = async () => {
    if (await Dialog.confirm({ title: "断开连接", message: "确定要清除 WebDAV 配置吗？这不会删除云端已有的数据。" })) {
      try { Storage.remove(WEBDAV_CONFIG_KEY) } catch { Storage.set(WEBDAV_CONFIG_KEY, "") }
      setWebdavConfig(null); showToast("WebDAV 配置已清除")
    }
  }

  const handleWebDAVSync = async (isUpload: boolean) => {
    if (!webdavConfig) return showToast("请先配置 WebDAV", true)
    try {
      if (isUpload) {
        const filePwd = await ensureICloudConfigPassword(currentIcloudConfig, "upload")
        if (!filePwd) return
        const encryptedData = encryptPayload({ accounts, bookmarks }, filePwd)
        await uploadToWebDAV(webdavConfig, encryptedData)
        showToast(`已上传到 WebDAV：${accounts.length} 个账号，${bookmarks.length} 个书签`)
      } else {
        const rawData = await downloadFromWebDAV(webdavConfig)
        const filePwd = await promptForPassword("验证备份文件密码", "文件下载完成，请输入该备份文件绑定的密码以继续导入。")
        if (!filePwd) return
        const payload = normalizeSyncPayload(decryptPayload<unknown>(rawData, filePwd))
        if (await Dialog.confirm({ title: "确认覆盖本地数据", message: `已成功读取 WebDAV 备份，包含 ${payload.accounts.length} 个账号、${payload.bookmarks.length} 个书签。是否覆盖当前本地数据？` })) {
          setAccounts(payload.accounts); setBookmarks(payload.bookmarks); showToast(`已从 WebDAV 导入 ${payload.accounts.length} 个账号和 ${payload.bookmarks.length} 个书签`)
        }
      }
    } catch (error) { showToast("同步失败：可能是连接异常、密码错误或文件损坏", true) }
  }

  const handleIcloudToggle = async (value: boolean) => {
    if (value) {
      const pwd = await ensureICloudConfigPassword(currentIcloudConfig, "open")
      if (!pwd) return showToast("未完成文件密码验证，无法开启 iCloud 同步", true)
      try {
        const cloudPayload = await restoreAccountsFromICloud(pwd.trim(), currentIcloudConfig)
        if (cloudPayload && (cloudPayload.accounts.length > 0 || cloudPayload.bookmarks.length > 0)) {
          if (await Dialog.confirm({ title: "发现 iCloud 备份", message: `配置「${currentIcloudConfig.name}」已有 iCloud 备份，包含 ${cloudPayload.accounts.length} 个账号、${cloudPayload.bookmarks.length} 个书签。是否使用该备份覆盖当前本地数据？` })) {
            setAccounts(cloudPayload.accounts); setBookmarks(cloudPayload.bookmarks)
          } else await syncAccountsToICloud({ accounts, bookmarks }, pwd.trim(), currentIcloudConfig)
        } else await syncAccountsToICloud({ accounts, bookmarks }, pwd.trim(), currentIcloudConfig)
        Storage.set(ICLOUD_SYNC_ENABLED_KEY, true); setIcloudEnabled(true); setLastSyncTime(loadICloudConfigIndex().configs.find(item => item.id === currentIcloudConfig.id)?.lastSyncAt ?? null); showToast("iCloud 自动同步已开启")
      } catch (error) { showToast("iCloud 文件读取失败：密码错误或文件损坏", true) }
    } else { Storage.set(ICLOUD_SYNC_ENABLED_KEY, false); setIcloudEnabled(false); showToast("iCloud 自动同步已关闭") }
  }

  // --- 返回 ActionResponse，交由子页面自己处理 Toast ---
const handleCreateICloudConfig = async (): Promise<ActionResponse<ICloudConfigMeta>> => {
  const name = await Dialog.prompt({ title: "新增配置", message: "请输入新的 iCloud 配置名称" })
  if (!name?.trim()) return { success: false, canceled: true }

  let created: ICloudConfigMeta | null = null
  let capturedToast: { message: string; isError?: boolean } | undefined
  const toastCollector = (msg: string, isError = false) => { capturedToast = { message: msg, isError } }

  try {
    const currentPwd = getICloudFilePassword(currentIcloudConfigId)
    if (currentPwd && icloudEnabled) {
      await syncAccountsToICloud({ accounts, bookmarks }, currentPwd, currentIcloudConfig)
    }

    created = await createICloudConfig(name)
   
    const pwd = await ensureICloudConfigPassword(created, "create", toastCollector)
    if (!pwd) {
      await deleteICloudConfig(created.id)
      return { success: false, canceled: true, toast: capturedToast }
    }

    await syncAccountsToICloud({ accounts: [], bookmarks: [] }, pwd, created) 

    const index = await switchICloudConfig(created.id)
    
    setAccounts([]) 
    setBookmarks([])
    setCurrentIcloudConfigId(index.currentConfigId)
    setIcloudConfigs([...index.configs])

    showToast(`已新增配置「${created.name}」`)
    return { success: true, data: created }
  } catch (error) {
    return { success: false, error: String(error), toast: capturedToast }
  }
}

  const handleRenameICloudConfig = async (config: ICloudConfigMeta): Promise<ActionResponse<ICloudConfigMeta[]>> => {
    const nextName = await Dialog.prompt({ title: "重命名配置", message: `请输入「${config.name}」的新名称`, defaultValue: config.name })
    if (!nextName?.trim() || nextName.trim() === config.name) return { success: false, canceled: true }
    try {
      const index = await renameICloudConfig(config.id, nextName)
      setIcloudConfigs([...index.configs])
      return { success: true, data: index.configs }
    } catch (error) { return { success: false, error: String(error).replace(/^Error: /, "") } }
  }

  const handleDeleteICloudConfig = async (config: ICloudConfigMeta): Promise<ActionResponse<ICloudConfigMeta[]>> => {
    if (!(await Dialog.confirm({ title: "删除配置", message: `确定删除配置「${config.name}」吗？仅删除该配置对应的 iCloud 文件，不影响本地当前数据。` }))) return { success: false, canceled: true }
    try {
      const index = await deleteICloudConfig(config.id)
      setIcloudConfigs([...index.configs])
      setCurrentIcloudConfigId(index.currentConfigId)
      return { success: true, data: index.configs }
    } catch (error) { return { success: false, error: String(error).replace(/^Error: /, "") } }
  }

  const handleSwitchICloudConfig = async (config: ICloudConfigMeta): Promise<ActionResponse<void>> => {
    if (config.id === currentIcloudConfigId) return { success: false, error: "当前已在使用该配置" }
    let capturedToast: { message: string; isError?: boolean } | undefined
    const toastCollector = (msg: string, isError = false) => { capturedToast = { message: msg, isError } }
    const pwd = await ensureICloudConfigPassword(config, "switch", toastCollector)
    if (!pwd) return { success: false, error: "未完成配置密码验证", toast: capturedToast }
    try {
      const cloudPayload = await restoreAccountsFromICloud(pwd.trim(), config)
      const index = await switchICloudConfig(config.id)
      const nextCurrent = index.configs.find(item => item.id === index.currentConfigId)
      setIcloudConfigs([...index.configs])
      setCurrentIcloudConfigId(index.currentConfigId)
      setLastSyncTime(nextCurrent?.lastSyncAt ?? null)
      if (cloudPayload) { setAccounts(cloudPayload.accounts); setBookmarks(cloudPayload.bookmarks) } 
      else { setAccounts([]); setBookmarks([]) }
      showToast(`已切换到配置「${config.name}」`)
      return { success: true }
    } catch (error) { return { success: false, error: "配置读取失败：密码错误或文件损坏，无法切换", toast: capturedToast } }
  }

  const importFile = async () => {
    try {
      const files = await DocumentPicker.pickFiles({ allowsMultipleSelection: false })
      if (!files?.length) return
      const rawStr = await FileManager.readAsString(files[0])
      let importedData: unknown
      if (isEncryptedFormat(rawStr)) {
        const pwd = await Dialog.prompt({ title: "验证备份文件密码", message: "该导入文件已加密，请输入文件绑定密码。" })
        if (!pwd) return 
        importedData = decryptPayload<unknown>(rawStr, pwd) 
      } else importedData = JSON.parse(rawStr)
      const payload = normalizeSyncPayload(importedData)
      if (payload.accounts.length + payload.bookmarks.length > 0) {
        const mode = await Dialog.actionSheet({ title: "选择导入方式", actions: [ { label: "追加到当前列表" }, { label: "覆盖当前列表", destructive: true } ] })
        if (mode === 0) {
          setAccounts([...accounts, ...payload.accounts.map((acc: AccountItem) => ({ ...acc, id: generateId() }))])
          setBookmarks([...bookmarks, ...payload.bookmarks.map((bookmark: BookmarkItem) => ({ ...bookmark, id: generateId() }))])
          showToast(`已追加导入 ${payload.accounts.length} 个账号和 ${payload.bookmarks.length} 个书签`)
        } else if (mode === 1) {
          setAccounts(payload.accounts); setBookmarks(payload.bookmarks); showToast(`已覆盖导入 ${payload.accounts.length} 个账号和 ${payload.bookmarks.length} 个书签`)
        }
      } else throw new Error("格式错误")
    } catch (error) { showToast("导入失败：密码错误、文件损坏或格式不正确", true) } 
  }

  const exportFile = async () => {
    const verifiedPwd = await ensureICloudConfigPassword(currentIcloudConfig, "export")
    if (!verifiedPwd) return
    const exportPwd = await promptForPassword("设置导出文件密码", "请为本次导出的备份文件设置一个独立密码。")
    if (!exportPwd) return
    try {
      const encryptedData = encryptPayload({ accounts, bookmarks }, exportPwd)
      await DocumentPicker.exportFiles({ files: [ { data: Data.fromRawString(encryptedData)!, name: `Accounts_Backup_${Date.now()}.txt` } ] })
      showToast("本地加密备份已导出")
    } catch (error) { showToast(`导出失败：${error}`, true) } 
  }

  return (
    <NavigationStack>
      <List 
        navigationTitle="设置"
        navigationBarTitleDisplayMode="inline"
        toast={{ isPresented: toast.isPresented, onChanged: (v) => { if (!v) setToast(prev => ({ ...prev, isPresented: false })) }, message: toast.msg || " ", position: "top", textColor: toast.isError ? "#FF3B30" : undefined }}
        toolbar={{ topBarLeading: <Button action={() => Script.exit()}><Image systemName="xmark" foregroundStyle="#FF3B30" fontWeight="semibold" /></Button> }}
      >
        <Section header={<Text>云端备份</Text>}>
          <VStack alignment="leading" spacing={2} padding={{ vertical: 4 }}>
            <Toggle title="开启 iCloud 自动同步" value={icloudEnabled} onChanged={handleIcloudToggle} />
            {icloudEnabled && lastSyncTime ? <Text font="caption" foregroundStyle="#8E8E93">最新同步: {new Date(lastSyncTime).toLocaleString()}</Text> : undefined}
          </VStack>
          <Button action={() => Navigation.present(
            <ICloudConfigManagerPage 
              initialConfigs={icloudConfigs} 
              initialCurrentId={currentIcloudConfigId} 
              onCreate={handleCreateICloudConfig} 
              onRename={handleRenameICloudConfig} 
              onDelete={handleDeleteICloudConfig} 
              onSwitch={handleSwitchICloudConfig} 
            />
          )}>
            <HStack alignment="center">
              <Text foregroundStyle="label">iCloud 配置列表</Text>
              <Spacer />
              <Text lineLimit={1} foregroundStyle="secondaryLabel">{currentIcloudConfig.name}</Text>
              <Image systemName="chevron.right" foregroundStyle="#C7C7CC" font="footnote" />
            </HStack>
          </Button>
        </Section>
        <Section footer={<Text font="footnote" foregroundStyle="#8E8E93">配置您的云端服务以确保数据安全不丢失，所有数据均经过严格端到端加密。</Text>}>
          <HStack padding={{ vertical: 8 }} alignment="center">
            <VStack alignment="leading" spacing={4}>
              <Text>WebDAV 服务器</Text>
              <Text font="caption" foregroundStyle="#8E8E93">{webdavConfig ? `已连接: ${webdavConfig.url}` : "未配置"}</Text>
            </VStack>
            <Spacer />
            <HStack spacing={12} alignment="center">
              {webdavConfig && <Button action={clearWebDAVConfig}><Text foregroundStyle="#FF3B30" font="subheadline">断开</Text></Button>}
              <Button action={configureWebDAV} buttonStyle="borderedProminent" controlSize="small"><Text>{webdavConfig ? "修改" : "配置"}</Text></Button>
            </HStack>
          </HStack>
          {webdavConfig && (
            <>
              <Button action={() => handleWebDAVSync(true)}><Text foregroundStyle="#007AFF">强制上传到 WebDAV</Text></Button>
              <Button action={() => handleWebDAVSync(false)}><Text foregroundStyle="#007AFF">从 WebDAV 恢复 (覆盖本地)</Text></Button>
              <Button action={async () => { const ok = await testWebDAVConnection(webdavConfig!); showToast(ok ? "测试通过，连接正常" : "测试失败，无法连接", !ok) }}><Text>测试服务器连接</Text></Button>
            </>
          )}
        </Section>
        <Section header={<Text>文件与导出</Text>} footer={<Text font="footnote" foregroundStyle="#8E8E93">您可以手动导出或导入离线加密备份文件，务必牢记您的加密密码。</Text>}>
          <Button action={importFile}><Text>导入本地备份文件</Text></Button>
          <Button action={exportFile}><Text>导出本地备份文件</Text></Button>
        </Section>
      </List>
    </NavigationStack>
  )
}