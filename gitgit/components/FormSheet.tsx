/**
 * components/FormSheet.tsx - 半屏表单弹窗外壳
 *
 * 统一 sheet 的呈现参数：可拖拽 detents（避免固定 medium 下收起键盘后输入框失效）、
 * 半透明材质背景（输入时保持通透）、左取消右确认工具栏。
 * 表单内容由调用方传入，草稿建议用 useObservable 在内容组件里自持。
 */

import { NavigationStack, List, Button, type VirtualNode } from "scripting"

export function FormSheet({
  navigationTitle,
  confirmTitle,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  children,
}: {
  navigationTitle: string
  confirmTitle: string
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
  children: (VirtualNode | null)[] | VirtualNode
}) {
  return (
    <NavigationStack>
      <List
        navigationTitle={navigationTitle}
        navigationBarTitleDisplayMode="inline"
        presentationDetents={["medium", "large"]}
        presentationDragIndicator="visible"
        presentationBackground="thinMaterial"
        scrollContentBackground="hidden"
        scrollDismissesKeyboard="interactively"
        toolbar={{
          cancellationAction: <Button title="取消" action={onCancel} />,
          confirmationAction: (
            <Button
              title={confirmTitle}
              action={onConfirm}
              disabled={confirmDisabled}
            />
          ),
        }}
      >
        {children}
      </List>
    </NavigationStack>
  )
}
