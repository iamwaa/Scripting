/**
 * components/FormSheet.tsx - 半屏表单弹窗外壳
 *
 * 统一 sheet 的呈现参数：可拖拽 detents（避免固定 medium 下收起键盘后输入框失效）、
 * 半透明材质背景（输入时保持通透）、左取消右确认工具栏。
 * 表单内容由调用方传入，草稿建议用 useObservable 在内容组件里自持。
 * 校验/提交失败信息用 error 在表单内展示：父页 toast 会被 sheet 遮住。
 */

import { NavigationStack, List, Button, Text, Section, type VirtualNode } from "scripting"
import { COLOR_RED } from "../constants/colors"

export function FormSheet({
  navigationTitle,
  confirmTitle,
  confirmDisabled = false,
  error = null,
  onCancel,
  onConfirm,
  children,
}: {
  navigationTitle: string
  confirmTitle: string
  confirmDisabled?: boolean
  /** 表单内错误文案（校验失败或提交失败），为空时不占位 */
  error?: string | null
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
        presentationBackground="systemGroupedBackground"
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
        {error ? (
          <Section>
            <Text font={13} foregroundStyle={COLOR_RED}>
              {error}
            </Text>
          </Section>
        ) : null}
        {children}
      </List>
    </NavigationStack>
  )
}
