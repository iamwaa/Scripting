---
name: formrow
description: List / 设置页文本输入统一用的 FormRow 组件实现与用法（技能里没有该组件）
metadata:
  type: reference
---

# FormRow（List 表单文本输入）

技能里没有该组件，实现固定为下面这份。默认左标签 + 右输入 + 有内容可清空，不用 `TextField title="..."` 内置行；搜索胶囊、工具栏搜索等非表单布局除外。落到 `components/FormRow.tsx`（小项目可写在 `components.tsx`）：

```tsx
import { HStack, Text, TextField, SecureField, Button, Image } from "scripting"

export function FormRow({
  label,
  value,
  prompt,
  onChanged,
  secure = false,
  labelWidth = 72,
}: {
  label: string
  value: string
  prompt?: string
  onChanged: (value: string) => void
  secure?: boolean
  labelWidth?: number
}) {
  // label 保留给无障碍朗读；prompt 兜底一个空格，避免字段把 label 当占位符导致标签显示两次
  const fieldProps = {
    label: <Text>{label}</Text>,
    value,
    prompt: prompt ?? " ",
    onChanged,
  }
  const field = secure ? <SecureField {...fieldProps} /> : <TextField {...fieldProps} />
  return (
    <HStack alignment="center" spacing={12} frame={{ maxWidth: Infinity }}>
      <Text frame={{ width: labelWidth, alignment: "leading" }}>{label}</Text>
      {field}
      {value.length > 0 ? (
        <Button action={() => onChanged("")} buttonStyle="plain">
          <Image systemName="xmark.circle.fill" font={16} foregroundStyle="tertiaryLabel" />
        </Button>
      ) : null}
    </HStack>
  )
}
```

调用：`<FormRow label="姓名" value={name} prompt="可选提示" onChanged={setName} />`；Token 等加 `secure`；标签宜短，过长调 `labelWidth`。

玻璃风格页面的表单不用本组件，改用 `liquid-glass-ui` 的 `GlassInput` / `glassControlProps`。
