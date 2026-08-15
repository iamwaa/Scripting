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
  Spacer,
  Button,
  Image,
  useState,
  useEffect,
} from "scripting"
import type { ConflictFile, MergeConflictState } from "../types/git"
import {
  getMergeConflictState,
  resolveConflictFile,
  autoMarkResolvedConflicts,
  completeMerge,
  abortMerge,
} from "../services/gitService"
import { findRepo, resolveWorkdir } from "../services/repoStore"
import {
  conflictKindLabel,
  buildConflictReport,
  formatAutoMarkSummary,
} from "../utils/mergeConflict"
import { toastContent } from "../components/Toast"
import { useToast } from "../hooks/useToast"
import {
  COLOR_SECONDARY_LABEL,
  COLOR_ORANGE,
  COLOR_ACCENT,
  COLOR_GREEN,
} from "../constants/colors"

type AlertState = { title: string; message: string } | null

export function ConflictsPage({
  bookmarkName,
  onChanged,
}: {
  bookmarkName: string
  onChanged?: (reason?: "updated" | "completed") => void
}) {
  const [state, setState] = useState<MergeConflictState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pendingAbort, setPendingAbort] = useState(false)
  const [alertState, setAlertState] = useState<AlertState>(null)
  const { toastState, showToast, handleToastChanged, toastPresented } = useToast()

  function showAlert(title: string, message: string) {
    setAlertState({ title, message })
  }

  async function loadState() {
    setLoading(true)
    try {
      const next = await getMergeConflictState(bookmarkName)
      setState(next)
    } catch (e: any) {
      showToast("加载失败：" + String(e?.message || e), "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadState()
  }, [])

  function notifyParent(reason: "updated" | "completed" = "updated") {
    try {
      onChanged?.(reason)
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
      showToast(label + ": " + file.filepath, "success")
    } catch (e: any) {
      showToast("解决失败：" + String(e?.message || e), "error")
    } finally {
      setBusy(false)
    }
  }

  // 检测工作区冲突文件：无残留冲突标记（或已删除）的批量标记为已解决
  async function handleAutoMark() {
    if (!state || busy || conflicts.length === 0) return
    setBusy(true)
    try {
      const result = await autoMarkResolvedConflicts(bookmarkName)
      await loadState()
      notifyParent()
      const summary = formatAutoMarkSummary(result)
      showToast(summary.title + ": " + summary.message, summary.title.includes("失败") ? "error" : "success")
    } catch (e: any) {
      showToast("检测失败：" + String(e?.message || e), "error")
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
      notifyParent("completed")
      showToast("合并完成：已创建提交 " + String(oid).slice(0, 7), "success")
    } catch (e: any) {
      showToast("完成合并失败：" + String(e?.message || e), "error")
    } finally {
      setBusy(false)
    }
  }

  // 复制面向 Agent 的冲突清单（仓库/目录/合并双方/冲突文件），便于外部处理冲突
  async function handleCopyReport() {
    if (!state || busy) return
    setBusy(true)
    try {
      let workdir: string | null = null
      try {
        workdir = resolveWorkdir(bookmarkName)
      } catch (_e) {
        // 书签失效等情况不阻断复制，清单中标注无法解析
        workdir = null
      }
      const report = buildConflictReport({
        repoName: findRepo(bookmarkName)?.name || bookmarkName,
        workdir,
        oursLabel: state.oursLabel,
        theirsLabel: state.theirsLabel,
        oursOid: state.oursOid,
        theirsOid: state.theirsOid,
        conflicts,
      })
      await Pasteboard.setString(report)
      showToast("已复制：冲突清单已复制到剪贴板", "success")
    } catch (e: any) {
      showToast("复制失败：" + String(e?.message || e), "error")
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
      showToast("已中止合并：工作区已尝试恢复到合并前状态", "warning")
    } catch (e: any) {
      showToast("中止失败：" + String(e?.message || e), "error")
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
      toast={
        toastState
          ? {
              isPresented: toastPresented,
              onChanged: handleToastChanged,
              content: toastContent(toastState.message, toastState.type),
              duration: toastState.duration,
              position: "top",
            }
          : undefined
      }
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
          <HStack alignment="center" spacing={8}>
            <Image
              systemName="arrow.triangle.2.circlepath"
              foregroundStyle={COLOR_SECONDARY_LABEL}
            />
            <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载中…</Text>
          </HStack>
        ) : !state ? (
          <HStack alignment="center" spacing={8}>
            <Image
              systemName="checkmark.circle.fill"
              foregroundStyle={COLOR_GREEN}
            />
            <Text foregroundStyle={COLOR_SECONDARY_LABEL}>
              无冲突。可返回后继续 Pull / Push。
            </Text>
          </HStack>
        ) : conflicts.length > 0 ? (
          <HStack alignment="center" spacing={8}>
            <Image
              systemName="exclamationmark.triangle.fill"
              foregroundStyle={COLOR_ORANGE as any}
            />
            <Text foregroundStyle={COLOR_ORANGE as any}>
              仍有 {conflicts.length} 个文件待解决
            </Text>
          </HStack>
        ) : (
          <HStack alignment="center" spacing={8}>
            <Image
              systemName="checkmark.circle.fill"
              foregroundStyle={COLOR_GREEN}
            />
            <Text>冲突已全部解决，可完成合并提交</Text>
          </HStack>
        )}
      </Section>

      {state ? (
        <Section
          header={<Text>操作</Text>}
          footer={
            <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
              {conflicts.length > 0
                ? "检测冲突状态：扫描工作区冲突文件，无残留冲突标记的自动标记为已解决（含已删除文件）。完成合并会创建双亲合并提交；中止则放弃本次合并。"
                : "完成合并会创建双亲合并提交；中止则放弃本次合并。"}
            </Text>
          }
        >
          {conflicts.length > 0 ? (
            <Button
              title={busy ? "处理中…" : "检测冲突状态"}
              systemImage="doc.text.magnifyingglass"
              action={handleAutoMark}
              disabled={busy}
            />
          ) : null}
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
          header={
            <HStack alignment="center">
              <Text>冲突文件</Text>
              <Spacer />
              <Button
                action={handleCopyReport}
                disabled={busy}
                tint={busy ? COLOR_SECONDARY_LABEL : COLOR_ACCENT}
              >
                <HStack alignment="center" spacing={4}>
                  <Image
                    systemName="doc.on.doc"
                    font="caption"
                    foregroundStyle={
                      busy ? COLOR_SECONDARY_LABEL : COLOR_ACCENT
                    }
                  />
                  <Text
                    font="caption"
                    foregroundStyle={
                      busy ? COLOR_SECONDARY_LABEL : COLOR_ACCENT
                    }
                  >
                    复制清单
                  </Text>
                </HStack>
              </Button>
            </HStack>
          }
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
