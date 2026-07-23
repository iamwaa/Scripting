/**
 * pages/UploadGitHubPage.tsx - 本地仓库上传到 GitHub
 *
 * 输入行用 FormRow（左标签 + 右输入）。
 * Section：标题 + 备注 footer（title 与 footer 互斥，故用 header/footer）。
 */

import {
  List,
  Section,
  Text,
  Button,
  Toggle,
  useState,
  useEffect,
} from "scripting"
import { FormRow } from "../components/FormRow"
import type { RepoMeta } from "../types/git"
import { createRepo, getCurrentUser } from "../api/githubApi"
import { hasToken } from "../services/authStore"
import {
  setOriginAndPush,
  getBranches,
  getLog,
  isInitialized,
  initRepo,
} from "../services/gitService"
import { updateRepo, findRepo } from "../services/repoStore"
import { notifySync } from "../services/notifyService"
import { DEFAULT_BRANCH } from "../constants/git"
import { COLOR_SECONDARY_LABEL } from "../constants/colors"
import {
  buildUploadPendingPatch,
  buildUploadSuccessPatch,
  resolveUploadRemoteTarget,
} from "../utils/gitSync"

export function UploadGitHubPage({
  bookmarkName,
  defaultName,
  onUploaded,
}: {
  bookmarkName: string
  defaultName: string
  onUploaded: (repo: RepoMeta) => void
}) {
  const storedRepo = findRepo(bookmarkName)
  const [repoName, setRepoName] = useState(
    storedRepo?.pendingRemoteName || defaultName
  )
  const [pendingRemoteUrl, setPendingRemoteUrl] = useState(
    storedRepo?.pendingRemoteUrl || null
  )
  const [description, setDescription] = useState("")
  const [isPrivate, setIsPrivate] = useState(false)
  const [homepage, setHomepage] = useState("")
  const [owner, setOwner] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [alertState, setAlertState] = useState<{
    title: string
    message: string
  } | null>(null)

  useEffect(() => {
    if (hasToken()) {
      getCurrentUser()
        .then((u) => setOwner(u.login))
        .catch(() => setOwner(null))
    }
  }, [])

  function showAlert(title: string, message: string) {
    setAlertState({ title, message })
  }

  async function handleUpload() {
    const name = repoName.trim()
    if (!name) {
      showAlert("gitgit", "请填写仓库名称")
      return
    }
    if (!hasToken()) {
      showAlert("需要 Token", "请先在设置页配置 GitHub Token（需 repo 权限）")
      return
    }

    setUploading(true)
    try {
      if (!(await isInitialized(bookmarkName))) {
        await initRepo(bookmarkName)
      }
      const branches = await getBranches(bookmarkName)
      // 空仓 HEAD 可能已是 main，但无提交仍不能 push
      const log = await getLog(bookmarkName, 1)
      if (log.length === 0) {
        showAlert(
          "没有提交",
          `请先在「改动」页完成至少一次提交（默认分支 ${DEFAULT_BRANCH}），再上传到 GitHub。`
        )
        return
      }

      const pending = findRepo(bookmarkName)
      const target = resolveUploadRemoteTarget({
        pendingRemoteUrl: pending?.pendingRemoteUrl,
        pendingRemoteName: pending?.pendingRemoteName,
        requestedName: name,
      })
      let remoteUrl = target.remoteUrl
      let remoteName = target.remoteName
      let remoteDefaultBranch: string | undefined
      // 无 pending 才建仓，避免 Push 失败后重复创建同名远端
      if (target.shouldCreateRemote || !remoteUrl) {
        const remote = await createRepo({
          name,
          description,
          private: isPrivate,
          homepage,
        })
        remoteUrl = remote.url
        remoteName = remote.name
        remoteDefaultBranch = remote.defaultBranch
        updateRepo(bookmarkName, buildUploadPendingPatch(remote))
        setPendingRemoteUrl(remote.url)
      }

      const pushBranch =
        branches.current || remoteDefaultBranch || DEFAULT_BRANCH
      await setOriginAndPush(bookmarkName, remoteUrl, pushBranch)

      const updated = updateRepo(
        bookmarkName,
        buildUploadSuccessPatch({
          remoteName,
          remoteUrl,
          pushBranch,
        })
      )
      setPendingRemoteUrl(null)
      await notifySync("push", remoteName, remoteUrl)
      const finalRepo = updated || findRepo(bookmarkName)
      if (finalRepo) {
        // 由父页在关闭本页后显示成功提示，避免子页正在退出导致 alert 不可见
        onUploaded(finalRepo)
      }
    } catch (e: any) {
      showAlert("上传失败", String(e?.message || e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <List
      navigationTitle="上传到 GitHub"
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      alert={{
        title: alertState?.title ?? "",
        message: <Text>{alertState?.message ?? ""}</Text>,
        isPresented: alertState != null,
        onChanged: (presented: boolean) => {
          if (!presented) setAlertState(null)
        },
        actions: (
          <Button title="好" role="cancel" action={() => setAlertState(null)} />
        ),
      }}
    >
      <Section
        header={<Text>仓库信息</Text>}
        footer={
          <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
            新建 GitHub 仓库
            {owner ? ` · 所有者 @${owner}` : " · 需已配置 Token"}
          </Text>
        }
      >
        <FormRow label="名称" value={repoName} prompt="仓库名称" onChanged={setRepoName} />
        <FormRow label="描述" value={description} prompt="可选" onChanged={setDescription} />
        <FormRow label="主页" value={homepage} prompt="https://（可选）" onChanged={setHomepage} />
        <Toggle title="私有仓库" value={isPrivate} onChanged={setIsPrivate} />
      </Section>

      <Section
        header={<Text>上传</Text>}
        footer={
          <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
            {pendingRemoteUrl
              ? "远端已创建，将复用该远端重试推送。"
              : `将创建远端并推送当前分支（默认 ${DEFAULT_BRANCH}）；需至少一次本地提交。成功后标记为「克隆」`}
          </Text>
        }
      >
        <Button
          title={pendingRemoteUrl ? "重试推送" : uploading ? "上传中…" : "创建并上传"}
          systemImage="arrow.up.circle"
          action={handleUpload}
          disabled={uploading || !repoName.trim()}
        />
      </Section>
    </List>
  )
}
