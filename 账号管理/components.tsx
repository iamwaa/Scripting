import { useState, useMemo, VStack, HStack, Text, Button, Spacer, Image, TextField, Link } from "scripting"

import { AccountItem, BookmarkItem, maskPassword, maskApiKey, processUrl } from "./utils"

declare const Pasteboard: any;
declare const Dialog: any;

export const LetterIcon = ({ name, size = 36 }: { name: string, size?: number }) => {
  const letter = name?.trim() ? name.trim().charAt(0).toUpperCase() : "?"
  const colors = ["#FF3B30", "#FF9500", "#FFCC00", "#4CD964", "#5AC8FA", "#007AFF", "#5856D6", "#FF2D55"]
  const charCode = letter.charCodeAt(0) || 0
  const color = colors[charCode % colors.length]
  const ShapeVStack = VStack as any

  return (
    <ShapeVStack frame={{ width: size, height: size }} alignment="center" background={color} clipShape={{ type: "rect", cornerRadius: size / 3 }}>
      <Text foregroundStyle="white" font={size > 40 ? "title" : "headline"} fontWeight="bold">{letter}</Text>
    </ShapeVStack>
  )
}

export const AvatarIcon = ({ url, name, size = 36 }: { url?: string; name: string, size?: number }) => {
  const [hasError, setHasError] = useState<boolean>(false)
  if (!url?.trim() || hasError) return <LetterIcon name={name} size={size} />
  const ShapeVStack = VStack as any

  return (
    <ShapeVStack frame={{ width: size, height: size }} clipShape={{ type: "rect", cornerRadius: size / 3 }}>
      <Image imageUrl={url} resizable={true} scaleToFill={true} placeholder={<LetterIcon name={name} size={size} />} onError={() => setHasError(true)} />
    </ShapeVStack>
  )
}

export const FormRow = ({ label, value, onChanged, prompt, autofocus = false }: { label: string, value: string, onChanged: (v: string) => void, prompt?: string, autofocus?: boolean }) => (
  <HStack alignment="center" spacing={12} padding={{ vertical: 4 }}>
    <Text frame={{ width: 75, alignment: "leading" }} foregroundStyle="#333333">{label}</Text>
    <TextField label={<Text>{"l"}</Text>} value={value} onChanged={onChanged} prompt={prompt} autofocus={autofocus} />
    {value.length > 0 ? (
      <Button action={() => onChanged("")} buttonStyle="plain">
        <Image systemName="xmark.circle.fill" foregroundStyle="#C7C7CC" font="subheadline" />
      </Button>
    ) : undefined}
  </HStack>
)

export type AccountRowProps = {
  account: AccountItem
  isSelecting?: boolean
  isSelected?: boolean
  onSelectToggle?: () => void
  onClick?: () => void
  onDelete?: () => void
  onPinToggle?: () => void
  showToast: (msg: string, isError?: boolean) => void
}

export const AccountRow = ({ account, isSelecting, isSelected, onSelectToggle, onClick, onDelete, onPinToggle, showToast }: AccountRowProps) => {
  const ShapeVStack = VStack as any 
  const displaySubTitle = account.username || account.email || ""

  return (
    <Button 
      action={() => {
        if (isSelecting && onSelectToggle) onSelectToggle()
        else if (onClick) onClick()
      }}
      contextMenu={{
        menuItems: (
          <>
            {onPinToggle ? (
              <Button action={() => onPinToggle()}>
                <Text>{account.isPinned ? "取消置顶" : "置顶"}</Text>
                <Image systemName={account.isPinned ? "pin.slash" : "pin"} />
              </Button>
            ) : undefined}
            {account.username ? <Button action={() => { Pasteboard.setString(account.username!); showToast("用户名已复制") }}><Text>复制用户名</Text><Image systemName="person.fill" /></Button> : undefined}
            {account.email ? <Button action={() => { Pasteboard.setString(account.email!); showToast("邮箱已复制") }}><Text>复制邮箱</Text><Image systemName="envelope.fill" /></Button> : undefined}
            {account.password ? <Button action={() => { Pasteboard.setString(account.password!); showToast("密码已复制") }}><Text>复制密码</Text><Image systemName="lock.fill" /></Button> : undefined}
            {account.apiKey ? <Button action={() => { Pasteboard.setString(account.apiKey!); showToast("API Key 已复制") }}><Text>复制 API Key</Text><Image systemName="key.fill" /></Button> : undefined}
            <Button action={() => {
              const parts = [`标题: ${account.name}`]
              if (account.username) parts.push(`用户名: ${account.username}`)
              if (account.email) parts.push(`邮箱: ${account.email}`)
              if (account.password) parts.push(`密码: ${account.password}`)
              if (account.apiKey) parts.push(`API Key: ${account.apiKey}`)
              if (account.url) parts.push(`网址: ${account.url}`)
              if (account.notes) parts.push(`备注: ${account.notes}`)
              if (account.customFields) account.customFields.forEach(f => { if (f.key && f.value) parts.push(`${f.key}: ${f.value}`) })
              Pasteboard.setString(parts.join('\n'))
              showToast("全部信息已复制")
            }}><Text>复制全部信息</Text><Image systemName="doc.on.doc" /></Button>
            {onDelete ? <Button action={async () => { if (await Dialog.confirm({ title: "确认删除", message: `确定要删除「${account.name}」吗？` })) onDelete() }} role="destructive"><Text>删除</Text><Image systemName="trash" foregroundStyle="#FF3B30" /></Button> : undefined}
          </>
        )
      }}
    >
      <HStack spacing={12} alignment="center" padding={{ vertical: 4 }}>
        {isSelecting ? <Image systemName={isSelected ? "checkmark.circle.fill" : "circle"} foregroundStyle={isSelected ? "#007AFF" : "#C7C7CC"} font="title3" /> : undefined}
        <AvatarIcon url={account.avatarUrl} name={account.name} />
        <VStack alignment="leading" spacing={4}>
          <HStack alignment="center" spacing={6}>
            {account.isPinned ? <Image systemName="pin.fill" font="caption2" foregroundStyle="#FF9500" /> : undefined}
            <Text font="headline">{account.name}</Text>
            {account.tags && account.tags.length > 0 ? (
              <HStack spacing={4}>
                {account.tags.map((tag, index) => <ShapeVStack key={index} background="quaternarySystemFill" clipShape={{ type: "rect", cornerRadius: 4 }}><Text font="caption2" foregroundStyle="#007AFF" fontWeight="medium" padding={{ horizontal: 4, vertical: 1 }}>{tag}</Text></ShapeVStack>)}
              </HStack>
            ) : undefined}
          </HStack>
          {displaySubTitle ? <HStack spacing={4} alignment="center"><Image systemName="person.fill" font="caption2" foregroundStyle="#8E8E93" /><Text font="caption" foregroundStyle="#8E8E93">{displaySubTitle}</Text></HStack> : undefined}
          {account.password ? <HStack spacing={4} alignment="center"><Image systemName="lock.fill" font="caption2" foregroundStyle="#8E8E93" /><Text font="caption" foregroundStyle="#8E8E93">{maskPassword(account.password)}</Text></HStack> : undefined}
          {account.apiKey ? <HStack spacing={4} alignment="center"><Image systemName="key.fill" font="caption2" foregroundStyle="#8E8E93" /><Text font="caption" foregroundStyle="#8E8E93">{maskApiKey(account.apiKey)}</Text></HStack> : undefined}
        </VStack>
        <Spacer />
        {!isSelecting ? <Image systemName="chevron.right" foregroundStyle="#C7C7CC" font="caption" /> : undefined}
      </HStack>
    </Button>
  )
}

export type BookmarkRowProps = {
  bookmark: BookmarkItem
  isSelecting?: boolean
  isSelected?: boolean
  onSelectToggle?: () => void
  onClick?: () => void
  onDelete?: () => void
  onPinToggle?: () => void
  showToast: (msg: string, isError?: boolean) => void
}

export const BookmarkRow = ({ bookmark, isSelecting, isSelected, onSelectToggle, onClick, onDelete, onPinToggle, showToast }: BookmarkRowProps) => {
  const ShapeVStack = VStack as any
  const validUrl = useMemo(() => processUrl(bookmark.url), [bookmark.url])

  return (
    <Button
      action={() => {
        if (isSelecting && onSelectToggle) onSelectToggle()
        else if (onClick) onClick()
      }}
      contextMenu={{
        menuItems: (
          <>
            {onPinToggle ? (
              <Button action={() => onPinToggle()}>
                <Text>{bookmark.isPinned ? "取消置顶" : "置顶"}</Text>
                <Image systemName={bookmark.isPinned ? "pin.slash" : "pin"} />
              </Button>
            ) : undefined}
            {bookmark.url ? (validUrl ? <Link url={validUrl}>{(<HStack spacing={4} alignment="center"><Text>打开链接</Text><Image systemName="safari" /></HStack>) as any}</Link> : <Button action={() => showToast("此书签链接格式无效，无法打开", true)}><Text>打开链接</Text><Image systemName="safari" foregroundStyle="#FF3B30" /></Button>) : undefined}
            <Button action={() => { Pasteboard.setString(bookmark.url); showToast("链接已复制") }}><Text>复制链接</Text><Image systemName="link" /></Button>
            <Button action={() => {
              const parts = [`标题: ${bookmark.title}`, `链接: ${bookmark.url}`]
              if (bookmark.notes) parts.push(`备注: ${bookmark.notes}`)
              if (bookmark.tags?.length) parts.push(`标签: ${bookmark.tags.join(', ')}`)
              if (bookmark.customFields && bookmark.customFields.length > 0) bookmark.customFields.forEach(f => { if (f.key && f.value) parts.push(`${f.key}: ${f.value}`) })
              Pasteboard.setString(parts.join('\n'))
              showToast("书签信息已复制")
            }}><Text>复制全部信息</Text><Image systemName="doc.on.doc" /></Button>
            {onDelete ? <Button action={async () => { if (await Dialog.confirm({ title: "确认删除", message: `确定要删除书签「${bookmark.title}」吗？` })) onDelete() }} role="destructive"><Text>删除</Text><Image systemName="trash" foregroundStyle="#FF3B30" /></Button> : undefined}
          </>
        )
      }}
    >
      <HStack spacing={12} alignment="center" padding={{ vertical: 4 }}>
        {isSelecting ? <Image systemName={isSelected ? "checkmark.circle.fill" : "circle"} foregroundStyle={isSelected ? "#007AFF" : "#C7C7CC"} font="title3" /> : undefined}
        <AvatarIcon url={bookmark.iconUrl} name={bookmark.title} />
        <VStack alignment="leading" spacing={4}>
          <HStack alignment="center" spacing={6}>
            {bookmark.isPinned ? <Image systemName="pin.fill" font="caption2" foregroundStyle="#FF9500" /> : undefined}
            <Text font="headline">{bookmark.title}</Text>
            {bookmark.tags?.length ? (
              <HStack spacing={4}>
                {bookmark.tags.map((tag, index) => <ShapeVStack key={index} background="quaternarySystemFill" clipShape={{ type: "rect", cornerRadius: 4 }}><Text font="caption2" foregroundStyle="#007AFF" fontWeight="medium" padding={{ horizontal: 4, vertical: 1 }}>{tag}</Text></ShapeVStack>)}
              </HStack>
            ) : undefined}
          </HStack>
          <HStack spacing={4} alignment="center"><Image systemName="link" font="caption2" foregroundStyle="#8E8E93" /><Text font="caption" foregroundStyle="#8E8E93" lineLimit={1}>{bookmark.url}</Text></HStack>
          {bookmark.notes ? <HStack spacing={4} alignment="center"><Image systemName="note.text" font="caption2" foregroundStyle="#8E8E93" /><Text font="caption" foregroundStyle="#8E8E93" lineLimit={1}>{bookmark.notes}</Text></HStack> : undefined}
        </VStack>
        <Spacer />
        {!isSelecting ? <Image systemName="chevron.right" foregroundStyle="#C7C7CC" font="caption" /> : undefined}
      </HStack>
    </Button>
  )
}
