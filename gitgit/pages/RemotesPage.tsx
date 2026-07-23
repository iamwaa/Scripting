/**
 * pages/RemotesPage.tsx - Remote / upstream 管理
 *
 * 查看、添加、修改 URL、删除 remote；为当前分支设置 upstream。
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
} from "scripting"
import { FormRow } from "../components/FormRow"
import type { RemoteInfo } from "../services/gitService"
import {
  listRemotes,
  addRemote,
  setRemoteUrl,
  deleteRemote,
  getBranchUpstream,
  setBranchUpstream,
  getBranches,
} from "../services/gitService"
import {
  type UpstreamConfig,
} from "../utils/remote"
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
  const [upstream, setUpstream] = useState<UpstreamConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [newName, setNewName] = useState("")
  const [newUrl, setNewUrl] = useState("")

  const [upstreamRemote, setUpstreamRemote] = useState("origin")
  const [upstreamMerge, setUpstreamMerge] = useState("")

  const [pendingDelete, setPendingDelete] = useState<RemoteInfo | null>(null)
  const [alertState, setAlertState] = useState<AlertState>(null)

  function showAlert(title: string, message: string) {
    setAlertState({ title, message })
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
      setUpstream(up)
      // 默认 upstream 表单：优先 origin，否则第一个 remote
      const defaultRemote =
        remoteList.find((r) => r.remote === "origin")?.remote ||
        remoteList[0]?.remote ||
        "origin"
      setUpstreamRemote(up?.remote || defaultRemote)
      const mergeShort = up?.merge?.replace(/^refs\/heads\//, "") || ""
      setUpstreamMerge(mergeShort || branches.current || "")
    } catch (e: any) {
      showAlert("加载失败", String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  function notifyParent() {
    try {
      onChanged?.()
    } catch (_e) {
      /* 父页刷新失败不阻断本页 */
    }
  }

  async function handleAdd() {
    if (busy) return
    setBusy(true)
    try {
      await addRemote(bookmarkName, newName, newUrl)
      setNewName("")
      setNewUrl("")
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
      onAppear={() => {
        loadAll()
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

      <Section
        header={<Text>添加远端</Text>}
        footer={
          <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
            URL 支持 https 与 git@host:path
          </Text>
        }
      >
        <FormRow
          label="名称"
          value={newName}
          onChanged={setNewName}
          prompt="origin / upstream"
        />
        <FormRow
          label="Git URL"
          value={newUrl}
          onChanged={setNewUrl}
          prompt="https://github.com/user/repo.git"
        />
        <Button
          title={busy ? "处理中…" : "添加远端"}
          systemImage="plus.circle"
          action={handleAdd}
          disabled={busy || loading || !newName.trim() || !newUrl.trim()}
        />
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
              onChanged={setUpstreamRemote}
            >
              {remotes.map((r) => (
                <Text key={r.remote} tag={r.remote}>
                  {r.remote}
                </Text>
              ))}
            </Picker>
            <FormRow
              label="分支"
              value={upstreamMerge}
              onChanged={setUpstreamMerge}
              prompt={currentBranch || "main"}
            />
            <Button
              title={busy ? "处理中…" : "设置 Upstream"}
              systemImage="arrow.triangle.branch"
              action={handleSetUpstream}
              disabled={busy || loading || !currentBranch}
            />
          </>
        )}
      </Section>
    </List>
  )
}
