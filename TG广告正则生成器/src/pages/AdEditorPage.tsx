import {
  Script,
  Navigation,
  NavigationStack,
  List,
  Section,
  TextField,
  Button,
  Text,
  useState,
} from "scripting"

// 广告文本编辑页（新增/编辑单条广告）
export function AdEditorPage({
  title,
  initialText,
  onSave,
}: {
  title: string
  initialText: string
  onSave: (text: string) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [text, setText] = useState(initialText)

  const save = () => {
    onSave(text)
    dismiss()
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={title}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="取消" action={dismiss} />,
          confirmationAction: (
            <Button title="保存" action={save} disabled={text.trim().length === 0} />
          ),
        }}
      >
        <Section
          footer={<Text>粘贴一条完整的广告推文，保存后可用于生成正则。</Text>}
        >
          <TextField
            label={<Text>广告内容</Text>}
            value={text}
            prompt="在此粘贴广告推文…"
            axis="vertical"
            onChanged={setText}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}

// 以独立页面方式呈现编辑器，返回用户保存的文本（取消返回 null）
export async function presentAdEditor(
  title: string,
  initialText: string
): Promise<string | null> {
  let result: string | null = null
  await Navigation.present(
    <AdEditorPage
      title={title}
      initialText={initialText}
      onSave={t => {
        result = t
      }}
    />
  )
  return result
}
