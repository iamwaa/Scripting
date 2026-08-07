/**
 * pages/RemotesPage.tsx - Remote / upstream 管理
 *
 * 查看、添加、修改 URL、删除 remote；为当前分支设置 upstream。
 * 添加入口在右上角 toolbar，点击弹出半屏表单。
 * 写操作走 gitService 仓库级互斥与失败回滚。
 */

import {
  List,
  Section,
  Text,
  HStack,
  VStack,
  Button,
  Picker,
  useState,
  useEffect,
  useRef,
} from "scripting"
import { AddRemoteSheet } from "../components/AddRemoteSheet"
import type { RemoteInfo } from "../services/gitService"
import {
  listRemotes,
  addRemote,
  setRemoteUrl,
  deleteRemote,
  getBranchUpstream,
  setBranchUpstream,
  getBranches,
  getRemoteBranches,
  fetchRemote,
} from "../services/gitService"
import { COLOR_SECONDARY_LABEL } from "../constants/colors"

type AlertState = { title: string; message: string } | null

export function RemotesPage({
  bookmarkName,
  onChanged,
}: {
  bookmarkName: string
  /** 远端或 upstream 变更后通知父页刷新 */
  onChanged?: () => void
}) {
  const [remotes, setRemotes] = useState<RemoteInfo[]>([])
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [upstreamRemote, setUpstreamRemote] = useState("origin")
  const [upstreamMerge, setUpstreamMerge] = useState("")
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  // 添加远端半屏弹窗；草稿由弹窗自持，本页只管开关
  const [showAddSheet, setShowAddSheet] = useState(false)

  const [branchLoading, setBranchLoading] = useState(false)
  const [branchLoadWarning, setBranchLoadWarning] = useState<string | null>(null)
  const branchRequestRef = useRef(0)

  const [pendingDelete, setPendingDelete] = useState<RemoteInfo | null>(null)
  const [alertState, setAlertState] = useState<AlertState>(null)

  function showAlert(title: string, message: string) {
    setAlertState({ title, message })
  }

  async function refreshRemoteBranches(remote: string): Promise<void> {
    const request = ++branchRequestRef.current
    setBranchLoading(true)
    setBranchLoadWarning(null)
    try {
      await fetchRemote(bookmarkName, remote, undefined, true)
    } catch (e: any) {
      if (request === branchRequestRef.current) {
        setBranchLoadWarning(`自动获取失败，当前显示本地缓存：${String(e?.message || e)}`)
      }
    }
    try {
      const branches = await getRemoteBranches(bookmarkName, remote)
      if (request === branchRequestRef.current) setRemoteBranches(branches)
    } finally {
      if (request === branchRequestRef.current) setBranchLoading(false)
    }
  }

  async function loadAll() {
    setLoading(true)
    try {
      const [remoteList, branches, up] = await Promise.all([
        listRemotes(bookmarkName),
        getBranches(bookmarkName),
        getBranchUpstream(bookmarkName),
      ])
      setRemotes(remoteList)
      setCurrentBranch(branches.current)
      // 默认 upstream 表单：优先 origin，否则第一个 remote
      const defaultRemote =
        remoteList.find((r) => r.remote === "origin")?.remote ||
        remoteList[0]?.remote ||
        "origin"
      const selectedRemote = remoteList.some((remote) => remote.remote === up?.remote)
        ? up!.remote
        : defaultRemote
      setUpstreamRemote(selectedRemote)
      const mergeShort = up?.merge?.replace(/^refs\/heads\//, "") || ""
      setUpstreamMerge(mergeShort || branches.current || "")
      if (remoteList.length > 0) {
        await refreshRemoteBranches(selectedRemote)
      } else {
        setRemoteBranches([])
        setBranchLoadWarning(null)
      }
    } catch (e: any) {
      showAlert("加载失败", String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  async function handleRemoteChanged(remote: string) {
    if (busy || loading || branchLoading) return
    setUpstreamRemote(remote)
    setUpstreamMerge(currentBranch || "")
    await refreshRemoteBranches(remote)
  }

  function notifyParent() {
    try {
      onChanged?.()
    } catch (_e) {
      /* 父页刷新失败不阻断本页 */
    }
  }

  async function handleAdd(name: string, url: string) {
    if (busy) return
    setBusy(true)
    try {
      await addRemote(bookmarkName, name, url)
      setShowAddSheet(false)
      await loadAll()
      notifyParent()
      showAlert("已添加", "远端已写入仓库配置")
    } catch (e: any) {
      showAlert("添加失败", String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function handleEditUrl(remote: RemoteInfo) {
    if (busy) return
    try {
      const next = await Dialog.prompt({
        title: `修改 ${remote.remote} 的 URL`,
        message: "将替换该远端地址；失败时会尝试回滚",
        defaultValue: remote.url,
        cancelLabel: "取消",
        confirmLabel: "保存",
      })
      if (next == null) return
      setBusy(true)
      await setRemoteUrl(bookmarkName, remote.remote, next)
      await loadAll()
      notifyParent()
      showAlert("已更新", `${remote.remote} 的 URL 已修改`)
    } catch (e: any) {
      showAlert("修改失败", String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  function requestDelete(remote: RemoteInfo) {
    if (busy) return
    setPendingDelete(remote)
  }

  async function confirmDelete() {
    const remote = pendingDelete
    setPendingDelete(null)
    if (!remote || busy) return
    setBusy(true)
    try {
      await deleteRemote(bookmarkName, remote.remote)
      await loadAll()
      notifyParent()
      showAlert("已删除", `远端 ${remote.remote} 已移除`)
    } catch (e: any) {
      showAlert("删除失败", String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function handleSetUpstream() {
    if (busy) return
    if (!currentBranch) {
      showAlert("无法设置", "当前没有本地分支")
      return
    }
    setBusy(true)
    try {
      await setBranchUpstream(
        bookmarkName,
        currentBranch,
        upstreamRemote,
        upstreamMerge.trim() || currentBranch
      )
      await loadAll()
      notifyParent()
      const track =
        `${upstreamRemote}/${(upstreamMerge.trim() || currentBranch)}`
      showAlert("已设置", `${currentBranch} ← ${track}`)
    } catch (e: any) {
      showAlert("设置失败", String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  // 文本输入已移除，把当前跟踪分支并入选项，避免 Picker 选中值不在列表中
  const branchOptions = Array.from(
    new Set([
      ...remoteBranches,
      ...(upstreamMerge.trim() ? [upstreamMerge.trim()] : []),
    ])
  ).sort((left, right) => left.localeCompare(right))

  const activeAlert = pendingDelete
    ? {
        title: `删除远端 ${pendingDelete.remote}？`,
        message:
          pendingDelete.remote === "origin"
            ? "删除 origin 后将无法直接 Push/Pull，上传状态也会清除。可稍后重新添加。"
            : `将移除 ${pendingDelete.remote}（${pendingDelete.url}）。分支 upstream 配置不会自动清理。`,
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
      navigationTitle="远端管理"
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      toolbar={{
        topBarTrailing: (
          <Button
            title="添加远端"
            systemImage="plus"
            action={() => setShowAddSheet(true)}
            disabled={busy || loading}
          />
        ),
      }}
      sheet={{
        isPresented: showAddSheet,
        onChanged: (presented: boolean) => {
          if (!presented) setShowAddSheet(false)
        },
        content: (
          <AddRemoteSheet
            busy={busy}
            onCancel={() => setShowAddSheet(false)}
            onConfirm={handleAdd}
          />
        ),
      }}
      alert={{
        title: activeAlert?.title ?? "",
        message: <Text>{activeAlert?.message ?? ""}</Text>,
        isPresented: activeAlert != null,
        onChanged: (presented: boolean) => {
          if (!presented) {
            setPendingDelete(null)
            setAlertState(null)
          }
        },
        actions: activeAlert?.isConfirm ? (
          <>
            <Button
              title="取消"
              role="cancel"
              action={() => setPendingDelete(null)}
            />
            <Button
              title="删除"
              role="destructive"
              action={confirmDelete}
            />
          </>
        ) : (
          <Button title="好" role="cancel" action={() => setAlertState(null)} />
        ),
      }}
    >
      <Section
        header={<Text>已配置远端</Text>}
        footer={
          <Text font={13} foregroundStyle={COLOR_SECONDARY_LABEL}>
            左滑行可修改或删除；右上角 + 添加新远端
          </Text>
        }
      >
        {loading ? (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载中…</Text>
        ) : remotes.length === 0 ? (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>尚未配置远端</Text>
        ) : (
          remotes.map((remote) => (
            <HStack
              key={remote.remote}
              alignment="center"
              trailingSwipeActions={{
                allowsFullSwipe: false,
                actions: [
                  <Button
                    title="修改"
                    systemImage="pencil"
                    tint="systemBlue"
                    action={() => handleEditUrl(remote)}
                    disabled={busy}
                  />,
                  <Button
                    title="删除"
                    systemImage="trash"
                    tint="systemRed"
                    action={() => requestDelete(remote)}
                    disabled={busy}
                  />,
                ],
              }}
            >
              <VStack alignment="leading" spacing={2}>
                <Text>{remote.remote}</Text>
                <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
                  {remote.url}
                </Text>
              </VStack>
            </HStack>
          ))
        )}
      </Section>

      <Section header={<Text>当前分支 Upstream</Text>}>
        {remotes.length === 0 ? (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>
            请先添加至少一个 remote
          </Text>
        ) : (
          <>
            <Picker
              title="跟踪远端"
              value={upstreamRemote}
              onChanged={handleRemoteChanged}
              disabled={branchLoading}
            >
              {remotes.map((r) => (
                <Text key={r.remote} tag={r.remote}>
                  {r.remote}
                </Text>
              ))}
            </Picker>
            {branchOptions.length > 0 ? (
              <Picker
                title={branchLoading ? "正在获取分支…" : "远端分支"}
                value={upstreamMerge}
                onChanged={setUpstreamMerge}
                disabled={branchLoading}
              >
                {branchOptions.map((branch) => (
                  <Text key={branch} tag={branch}>
                    {branch}
                  </Text>
                ))}
              </Picker>
            ) : null}
            {branchLoadWarning ? (
              <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>
                {branchLoadWarning}
              </Text>
            ) : null}
            <Button
              title={busy ? "处理中…" : "设置 Upstream"}
              systemImage="arrow.triangle.branch"
              action={handleSetUpstream}
              disabled={busy || loading || branchLoading || !currentBranch}
            />
          </>
        )}
      </Section>
    </List>
  )
}
