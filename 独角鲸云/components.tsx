import { HStack, VStack, Text, TextField, SecureField, Button, Image, Spacer, useState, useRef } from 'scripting'

export function FormRow({ label, value, prompt, onChanged, secure = false }: {
  label: string
  value: string
  prompt?: string
  onChanged: (value: string) => void
  secure?: boolean
}) {
  // 保留无障碍标签，空占位符避免字段重复显示左侧标题。
  const props = { label: <Text>{label}</Text>, value, prompt: prompt ?? ' ', onChanged }
  return <HStack alignment="center" spacing={12} frame={{ maxWidth: Infinity }}>
    <Text font={16} frame={{ width: 72, alignment: 'leading' }}>{label}</Text>
    {secure ? <SecureField {...props} /> : <TextField {...props} />}
    {value.length > 0 ? <Button action={() => onChanged('')} buttonStyle="plain">
      <Image systemName="xmark.circle.fill" font={16} foregroundStyle="tertiaryLabel" />
    </Button> : null}
  </HStack>
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return <HStack spacing={16} alignment="top">
    <Text font={15} foregroundStyle="secondaryLabel">{label}</Text>
    <Spacer />
    {/* 值可能较长（多行 IP 或组合说明），允许换行而不是压缩截断。 */}
    <Text font={15} multilineTextAlignment="trailing" textSelection={true} fixedSize={{ horizontal: false, vertical: true }}>{value}</Text>
  </HStack>
}

export function Notice({ message }: { message: string }) {
  return <Text font={14} foregroundStyle="secondaryLabel" fixedSize={{ horizontal: false, vertical: true }}>{message}</Text>
}

// 识别文本中的 URL 并用 markdown 渲染，样式由系统自动变蓝可点击。
export function LinkNotice({ message }: { message: string }) {
  return <Text font={14} fixedSize={{ horizontal: false, vertical: true }} attributedString={linkify(message)} />
}

const URL_PATTERN = /(https?:\/\/[^\s，。；、）】》"'<>]+)/g

export function linkify(text: string): string {
  if (!/https?:\/\//.test(text)) return text
  // 已是 markdown 链接的片段不重复包一层。
  return text.replace(URL_PATTERN, url => `[${url}](${url})`)
}

// 操作提示统一用顶部 toast；sticky 用于“正在处理”这类需要手动收起的提示。
export function useTopToast() {
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [duration, setDuration] = useState<number | null>(2)
  // 标记当前是否处于常驻的“处理中”状态，供 finish 判断是否需要收起。
  const pending = useRef(false)

  function show(text: string, sticky = false) {
    pending.current = sticky
    setMessage(text)
    setDuration(sticky ? null : 2)
    setVisible(true)
  }

  function hide() {
    pending.current = false
    setVisible(false)
  }

  // 任务结束时调用：已经用 show 给出结果就不再干预，否则收起常驻提示。
  function finish() {
    if (pending.current) hide()
  }

  return {
    show,
    hide,
    finish,
    props: { isPresented: visible, onChanged: setVisible, message, position: 'top' as const, duration },
  }
}
