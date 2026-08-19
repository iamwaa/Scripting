import { Button, Image } from "scripting"

export function CloseButton({ action }: { action: () => void }) {
  return (
    <Button action={action}>
      <Image systemName="xmark" foregroundStyle="red" fontWeight="semibold" />
    </Button>
  )
}

export function RefreshButton({ action }: { action: () => void }) {
  return (
    <Button action={action}>
      <Image systemName="arrow.clockwise" fontWeight="semibold" />
    </Button>
  )
}

export function IconButton({ systemName, action }: { systemName: string; action: () => void }) {
  return (
    <Button action={action}>
      <Image systemName={systemName} fontWeight="semibold" />
    </Button>
  )
}

// 删除类滑动操作按钮
export function DeleteSwipeButton({ action }: { action: () => void }) {
  return <Button title="删除" systemImage="trash" tint="#FF3B30" action={action} />
}
