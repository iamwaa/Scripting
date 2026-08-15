/**
 * pages/ClonePage.tsx - 克隆页面
 *
 * 流程：选择目标父目录 → 输入仓库 URL（或从 GitHub 列表选择）
 *      → 克隆到「父目录/仓库名/」→ 注册到仓库列表。
 * 目标目录路径保存到 Storage，并静默保留安全访问权限。
 */

import {
  List,
  Section,
  Text,
  HStack,
  Button,
  Image,
  useState,
  useEffect,
} from "scripting"
import { FormRow } from "../components/FormRow"
import { BusyOverlay } from "../components/BusyOverlay"
import { toastContent } from "../components/Toast"
import { useToast } from "../hooks/useToast"
import type { GitHubRepo, RepoMeta } from "../types/git"
import {
  pickDirectory,
  registerRepoByPath,
  createRepoId,
  cleanupCloneAttempt,
} from "../services/repoStore"
import {
  clone,
  isRemoteOperationCancelled,
  RemoteCancelToken,
} from "../services/gitService"
import { hasToken } from "../services/authStore"
import { notifySync, notifyError } from "../services/notifyService"
import { listMyRepos, getRepo } from "../api/githubApi"
import { repoNameFromUrl } from "../utils/format"
import {
  yieldForUi,
  type RemoteProgressInfo,
} from "../utils/remoteProgress"
import {
  COLOR_LABEL,
  COLOR_SECONDARY_LABEL,
  COLOR_GREEN,
} from "../constants/colors"

export function ClonePage({ onCloned }: { onCloned: (repo: RepoMeta) => void }) {
  const [url, setUrl] = useState("")
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [parentName, setParentName] = useState("")
  // 父目录安全书签：workdir 是其子目录，解析时先激活此书签
  const [parentAccessBookmark, setParentAccessBookmark] = useState<
    string | null
  >(null)
  const [cloning, setCloning] = useState(false)
  const [cloneBusyLabel, setCloneBusyLabel] = useState<string | null>(null)
  const [cloneCancelling, setCloneCancelling] = useState(false)
  const [cancelToken, setCancelToken] = useState<RemoteCancelToken | null>(null)
  const [myRepos, setMyRepos] = useState<GitHubRepo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const { toastState, showToast, handleToastChanged, toastPresented } = useToast()

  useEffect(() => {
    if (hasToken()) {
      loadMyRepos()
    }
  }, [])

  async function loadMyRepos() {
    setLoadingRepos(true)
    try {
      const repos = await listMyRepos(20)
      setMyRepos(repos)
    } catch (e: any) {
      showToast("在线仓库加载失败：" + String(e?.message || e), "error")
    } finally {
      setLoadingRepos(false)
    }
  }

  // 选择 clone 目标父目录（保留安全范围书签）
  async function handlePickDir() {
    try {
      const result = await pickDirectory()
      if (result) {
        setParentPath(result.path)
        setParentName(result.name)
        setParentAccessBookmark(result.accessBookmarkName)
      }
    } catch (e: any) {
      showToast("选择目录失败：" + String(e?.message || e), "error")
    }
  }

  // 执行 clone：落到「父目录/仓库名/」
  async function handleClone(cloneUrl?: string, githubRepo?: GitHubRepo) {
    const finalUrl = (cloneUrl || url).trim()
    if (!finalUrl) {
      showToast("请输入仓库 URL", "warning")
      return
    }
    if (!parentPath) {
      showToast("请先选择目标目录", "warning")
      return
    }

    const repoName = repoNameFromUrl(finalUrl)
    const workdir = parentPath.replace(/\/+$/, "") + "/" + repoName

    let upstream = undefined
    if (githubRepo) {
      try {
        const details = await getRepo(githubRepo.fullName)
        upstream = details.fork ? details.parent : undefined
        if (details.fork && !upstream) {
          showToast("无法读取源仓库：GitHub 未返回该 fork 的源仓库信息", "error")
          return
        }
      } catch (e: any) {
        showToast("无法读取仓库详情：" + String(e?.message || e), "error")
        return
      }
    }

    // 目标子目录已存在且非空时拒绝，避免覆盖用户文件
    if (await FileManager.exists(workdir)) {
      try {
        const items = await FileManager.readDirectory(workdir)
        if (items.length > 0) {
          showToast("目标已存在：目录「" + repoName + "」已存在且非空，请换父目录或先清空", "warning")
          return
        }
      } catch (_e) {
        // 读目录失败时仍尝试创建
      }
    }

    const existedBefore = await FileManager.exists(workdir)
    const token = new RemoteCancelToken()
    setCancelToken(token)
    setCloneCancelling(false)
    setCloneBusyLabel(null)
    setCloning(true)
    // 先分配 repoId，clone 的 gitdir 与注册元数据共用，避免路径当 gitdir 名
    const repoId = createRepoId()
    try {
      await FileManager.createDirectory(workdir, true)
      await clone(finalUrl, workdir, repoId, undefined, undefined, {
        cancelToken: token,
        upstream: upstream
          ? {
              url: upstream.url,
            }
          : undefined,
        onProgress: async (info: RemoteProgressInfo) => {
          setCloneBusyLabel(info.label)
          await yieldForUi()
        },
      })
      const repo = await registerRepoByPath(
        workdir,
        repoName,
        finalUrl,
        repoId,
        parentAccessBookmark
      )
      await notifySync("clone", repoName, finalUrl)
      onCloned(repo)
    } catch (e: any) {
      await cleanupCloneAttempt(
        repoId,
        workdir,
        existedBefore,
        parentAccessBookmark
      )
      setParentPath(null)
      setParentName("")
      setParentAccessBookmark(null)
      if (isRemoteOperationCancelled(e)) {
        showToast("已取消克隆，临时内容已清理", "warning")
      } else {
        showToast("克隆失败：" + String(e?.message || e) + "，临时内容已清理", "error")
        notifyError("clone", repoName, String(e?.message || e))
      }
    } finally {
      setCloning(false)
      setCloneBusyLabel(null)
      setCloneCancelling(false)
      setCancelToken(null)
    }
  }

  function handleCancelClone() {
    cancelToken?.cancel()
    setCloneCancelling(true)
    setCloneBusyLabel("取消中…")
  }

  const previewRepoName = url.trim() ? repoNameFromUrl(url) : null

  return (
    <List
      navigationTitle="克隆仓库"
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      overlay={
        cloning
          ? {
              alignment: "center",
              content: (
                <BusyOverlay
                  title="正在克隆"
                  message={cloneBusyLabel || undefined}
                  onCancel={handleCancelClone}
                  cancelling={cloneCancelling}
                />
              ),
            }
          : undefined
      }
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
    >
      {/* 步骤 1：目标父目录；Section title 与 footer 互斥，说明放 header */}
      <Section
        header={<Text>目标目录</Text>}
        footer={
          parentPath ? (
            <Text>
              将克隆到：{parentName}/{previewRepoName ? `${previewRepoName}/` : ""}
            </Text>
          ) : undefined
        }
      >
        {parentPath ? (
          <HStack alignment="center" spacing={6}>
            <Image systemName="folder.fill" foregroundStyle={COLOR_GREEN} />
            <Text font="body" foregroundStyle={COLOR_LABEL}>
              {parentName}
            </Text>
            <Button title="" action={handlePickDir} />
          </HStack>
        ) : (
          <Button
            title="选择目标目录"
            systemImage="folder.badge.plus"
            action={handlePickDir}
          />
        )}
      </Section>

      {/* 步骤 2：仓库 URL */}
      <Section header={<Text>仓库地址</Text>}>
        <FormRow
          label="Git URL"
          prompt="https://github.com/user/repo.git"
          value={url}
          onChanged={setUrl}
        />
        <Button
          title="克隆"
          systemImage="square.and.arrow.down"
          action={() => handleClone()}
          disabled={cloning || !parentPath || !url.trim()}
        />
      </Section>

      {/* 从我的 GitHub 仓库选择 */}
      {hasToken() && (
        <Section title="我的 GitHub 仓库">
          {loadingRepos ? (
            <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载中…</Text>
          ) : myRepos.length > 0 ? (
            myRepos.map((repo) => (
              <Button
                key={repo.fullName}
                title={repo.fullName}
                action={() => {
                  setUrl(repo.url)
                  handleClone(repo.url, repo)
                }}
                disabled={cloning || !parentPath}
              />
            ))
          ) : (
            <Button title="重新加载在线仓库" action={loadMyRepos} />
          )}
        </Section>
      )}
    </List>
  )
}
