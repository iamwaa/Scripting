/**
 * pages/ConflictsPage.tsx - 合并冲突列表与解决
 *
 * 展示 pull/merge 产生的冲突文件；支持保留我方/对方、标记已解决、
 * 全部解决后完成合并提交，或中止合并。
 */

import {
  List,
  Section,
  Text,
  HStack,
  VStack,
  Button,
  useState,
  useEffect,
} from "scripting"
import type { ConflictFile, MergeConflictState } from "../types/git"
import {
  getMergeConflictState,
  resolveConflictFile,
  completeMerge,
  abortMerge,
} from "../services/gitService"
import { conflictKindLabel } from "../utils/mergeConflict"
import { COLOR_SECONDARY_LABEL, COLOR_ORANGE } from "../constants/colors"

type AlertState = { title: string; message: string } | null

export function ConflictsPage({
  bookmarkName,
  onChanged,
}: {
  bookmarkName: string
  onChanged?: () => void
}) {
  const [state, setState] = useState<MergeConflictState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pendingAbort, setPendingAbort] = useState(false)
  const [alertState, setAlertState] = useState<AlertState>(null)

  function showAlert(title: string, message: string) {
    setAlertState({ title, message })
  }

  async function loadState() {
    setLoading(true)
    try {
      const next = await getMergeConflictState(bookmarkName)
      setState(next)
    } catch (e: any) {
      showAlert("加载失败", String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadState()
  }, [])

  function notifyParent() {
    try {
      onChanged?.()
    } catch (_e) {
      /* 忽略 */
    }
  }

  async function handleResolve(
    file: ConflictFile,
    resolution: "ours" | "theirs" | "manual"
  ) {
    if (busy) return
    setBusy(true)
    try {
      await resolveConflictFile(bookmarkName, file.filepath, resolution)
      await loadState()
      notifyParent()
      const label =
        resolution === "ours"
          ? "已保留我方"
          : resolution === "theirs"
            ? "已保留对方"
            : "已标记解决"
      showAlert(label, file.filepath)
    } catch (e: any) {
      showAlert("解决失败", String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function handleComplete() {
    if (busy) return
    setBusy(true)
    try {
      const oid = await completeMerge(bookmarkName)
      await loadState()
      notifyParent()
      showAlert("合并完成", `已创建合并提交 ${String(oid).slice(0, 7)}`)
    } catch (e: any) {
      showAlert("完成合并失败", String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function handleAbort() {
    setPendingAbort(false)
    if (busy) return
    setBusy(true)
    try {
      await abortMerge(bookmarkName)
      await loadState()
      notifyParent()
      showAlert("已中止合并", "工作区已尝试恢复到合并前状态")
    } catch (e: any) {
      showAlert("中止失败", String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const conflicts = state?.conflicts || []
  const canComplete = !!state && conflicts.length === 0
  const activeAlert = pendingAbort
    ? {
        title: "中止合并？",
        message:
          "将丢弃本次合并产生的冲突解决进度，并尝试恢复工作区。未提交的合并结果会丢失。",
        isConfirm: true as const,
      }
    : alertState
      ? {
          title: alertState.title,
          message: alertState.message,
          isConfirm: false as const,
        }
      : null

  return (
    <List
      navigationTitle="合并冲突"
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      onAppear={() => {
        loadState()
      }}
      alert={{
        title: activeAlert?.title ?? "",
        message: <Text>{activeAlert?.message ?? ""}</Text>,
        isPresented: activeAlert != null,
        onChanged: (presented: boolean) => {
          if (!presented) {
            setPendingAbort(false)
            setAlertState(null)
          }
        },
        actions: activeAlert?.isConfirm ? (
          <>
            <Button
              title="取消"
              role="cancel"
              action={() => setPendingAbort(false)}
            />
            <Button
              title="中止合并"
              role="destructive"
              action={handleAbort}
            />
          </>
        ) : (
          <Button title="好" role="cancel" action={() => setAlertState(null)} />
        ),
      }}
    >
      <Section
        header={<Text>状态</Text>}
        footer={
          <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
            {state
              ? `合并 ${state.theirsLabel} → ${state.oursLabel}`
              : "当前没有进行中的合并"}
          </Text>
        }
      >
        {loading ? (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载中…</Text>
        ) : !state ? (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>
            无冲突。可返回后继续 Pull / Push。
          </Text>
        ) : conflicts.length > 0 ? (
          <Text foregroundStyle={COLOR_ORANGE as any}>
            仍有 {conflicts.length} 个文件待解决
          </Text>
        ) : (
          <Text>冲突已全部解决，可完成合并提交</Text>
        )}
      </Section>

      {state ? (
        <Section
          header={<Text>操作</Text>}
          footer={
            <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
              完成合并会创建双亲合并提交；中止则放弃本次合并。
            </Text>
          }
        >
          <Button
            title={busy ? "处理中…" : "完成合并提交"}
            systemImage="checkmark.circle"
            action={handleComplete}
            disabled={busy || !canComplete}
          />
          <Button
            title="中止合并"
            systemImage="xmark.circle"
            role="destructive"
            action={() => setPendingAbort(true)}
            disabled={busy}
          />
        </Section>
      ) : null}

      {state && conflicts.length > 0 ? (
        <Section
          header={<Text>冲突文件</Text>}
          footer={
            <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
              左滑：保留我方 / 保留对方 / 标记已解决（工作区已是最终内容时）。
            </Text>
          }
        >
          {conflicts.map((file) => (
            <HStack
              key={file.filepath}
              alignment="center"
              trailingSwipeActions={{
                allowsFullSwipe: false,
                actions: [
                  <Button
                    title="我方"
                    systemImage="person"
                    tint="systemBlue"
                    action={() => handleResolve(file, "ours")}
                    disabled={busy}
                  />,
                  <Button
                    title="对方"
                    systemImage="person.2"
                    tint="systemIndigo"
                    action={() => handleResolve(file, "theirs")}
                    disabled={busy}
                  />,
                  <Button
                    title="已解决"
                    systemImage="checkmark"
                    tint="systemGreen"
                    action={() => handleResolve(file, "manual")}
                    disabled={busy}
                  />,
                ],
              }}
            >
              <VStack alignment="leading" spacing={2}>
                <Text>{file.filepath}</Text>
                <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
                  {conflictKindLabel(file.kind)}
                </Text>
              </VStack>
            </HStack>
          ))}
        </Section>
      ) : null}

      {state && conflicts.length === 0 ? (
        <Section>
          <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
            所有冲突文件已标记解决。确认工作区内容无误后点击「完成合并提交」。
          </Text>
        </Section>
      ) : null}
    </List>
  )
}
