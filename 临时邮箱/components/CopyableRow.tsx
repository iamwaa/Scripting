import { Button, Group, HStack, Text } from "scripting"

export type CopyableRowProps = {
  label: string
  value: string
  onCopy: (label: string, value: string) => void
}

// 长按整行弹出复制菜单；contentShape 让空白区域也能响应长按
export function CopyableRow({ label, value, onCopy }: CopyableRowProps) {
  return (
    <HStack
      frame={{ maxWidth: Infinity, alignment: "leading" }}
      contentShape="rect"
      contextMenu={{
        menuItems: (
          <Group>
            <Button
              title={`复制${label}`}
              systemImage="doc.on.doc"
              action={() => onCopy(label, value)}
            />
          </Group>
        ),
      }}
    >
      <Text>{value}</Text>
    </HStack>
  )
}
