/**
 * pages/RepoListPage.tsx - 仓库列表页
 *
 * 展示仓库来源（本地/克隆）与改动/待推送/待拉取/合并冲突摘要。
 * 待处理仓库置顶，待处理组与普通组内分别按名称 A→Z 展示。
 * 状态优先显示上次快照，再由实时查询逐行覆盖；未有快照的行显示加载图标。
 * 移除仓库时会清理 gitdir 缓存与访问书签（见 repoStore.removeRepo）。
 */

import {
  List,
  Section,
  Text,
  HStack,
  VStack,
  Spacer,
  Image,
  Navigation,
  NavigationLink,
  Toolbar,
  ToolbarItem,
  Button,
  Menu,
  ProgressView,
  useState,
} from "scripting"
import type {
  RepoListStatus,
  RepoMeta,
  RepoSnapshot,
} from "../types/git"
import {
  listRepos,
  addRepoByPicker,
  removeRepo,
  readSnapshots,
  sourceLabel,
} from "../services/repoStore"
import { getRepoListStatus, initRepo } from "../services/gitService"
import { BusyOverlay } from "../components/BusyOverlay"
import { RepoDetailPage } from "./RepoDetailPage"
import { ClonePage } from "./ClonePage"
import {
  COLOR_LABEL,
  COLOR_SECONDARY_LABEL,
  COLOR_ACCENT,
  COLOR_ORANGE,
  COLOR_GREEN,
  COLOR_RED,
} from "../constants/colors"
import { formatRepoListMergeSummary } from "../utils/mergeConflict"
import { yieldForUi } from "../utils/remoteProgress"
import { sortReposForList } from "../utils/repoSort"
import {
  buildRepoSetSignature,
  shouldRefreshRepoStatuses,
} from "../utils/statusFreshness"

let statusRefreshCompletedAt = 0
let statusRefreshRepoSignature = ""
let statusRefreshPromise: Promise<void> | null = null
let cachedStatusMap: Record<string, RepoListStatus> = {}

export function RepoListPage() {
  // 关闭 present 的根界面（设置已独立为 Tab）
  const dismiss = Navigation.useDismiss()
  const [repos, setRepos] = useState<RepoMeta[]>(listRepos())
  const [showClone, setShowClone] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<RepoMeta | null>(null)
  const [alertState, setAlertState] = useState<{
    title: string
    message: string
  } | null>(null)
  // bookmarkName → 列表状态；快照只补首屏占位，实时查询逐行覆盖
  const [statusMap, setStatusMap] = useState<Record<string, RepoListStatus>>(
    cachedStatusMap
  )
  const [snapshotMap, setSnapshotMap] = useState<Record<string, RepoSnapshot>>({})
  // 移除仓库忙态：删 gitdir 缓存对大仓库可能耗时，用全屏遮罩
  const [removingName, setRemovingName] = useState<string | null>(null)

  function refreshAll(force = false): Promise<void> {
    if (statusRefreshPromise) {
      return statusRefreshPromise.then(() => {
        setRepos(listRepos())
        setStatusMap(cachedStatusMap)
      })
    }
    const pending = refreshAllInternal(force).finally(() => {
      if (statusRefreshPromise === pending) statusRefreshPromise = null
    })
    statusRefreshPromise = pending
    return pending
  }

  async function refreshAllInternal(force: boolean) {
    const latest = listRepos()
    setRepos(latest)
    let snapshots: Record<string, RepoSnapshot> = {}
    try {
      snapshots = await readSnapshots()
      setSnapshotMap(snapshots)
    } catch (_e) {
      // 快照只用于首屏占位，读取失败仍继续实时刷新
    }
    const latestSnapshotAt = Object.values(snapshots).reduce(
      (latestAt, snapshot) => Math.max(latestAt, snapshot.updatedAt),
      0
    )
    const repoSignature = buildRepoSetSignature(
      latest.map((repo) => repo.bookmarkName)
    )
    if (!shouldRefreshRepoStatuses({
      now: Date.now(),
      lastCompletedAt: statusRefreshCompletedAt,
      repoSignature,
      lastRepoSignature: statusRefreshRepoSignature,
      latestSnapshotAt,
      force,
    })) {
      return
    }
    await refreshStatuses(latest, snapshots)
    statusRefreshCompletedAt = Date.now()
    statusRefreshRepoSignature = repoSignature
  }

  function showAlert(title: string, message: string) {
    setAlertState({ title, message })
  }

  function appendRepo(repo: RepoMeta) {
    setRepos((current) =>
      current.some((item) => item.bookmarkName === repo.bookmarkName)
        ? current
        : [...current, repo]
    )
    refreshStatuses([repo])
  }

  async function refreshStatuses(
    list: RepoMeta[],
    snapshots: Record<string, RepoSnapshot> = snapshotMap
  ) {
    // 尚无状态的行由 RepoRow 显示加载图标；串行逐个刷新，避免大仓库并行打爆 FS。
    // 待处理仓库先刷新，组内顺序与列表展示一致。
    for (const repo of sortReposForList(list, statusMap, snapshots)) {
      const status = await getRepoListStatus(repo.bookmarkName)
      cachedStatusMap = {
        ...cachedStatusMap,
        [repo.bookmarkName]: status,
      }
      setStatusMap(cachedStatusMap)
    }
  }

  async function handleAddLocal() {
    try {
      const repo = await addRepoByPicker()
      if (!repo) return
      // 添加后立刻 init，默认分支 main，避免上传 GitHub 时无分支
      try {
        await initRepo(repo.bookmarkName)
      } catch (initErr: any) {
        // init 失败仍保留列表项，进入详情可再试
        showAlert(
          "已添加，但初始化失败",
          String(initErr?.message || initErr)
        )
      }
      appendRepo(repo)
    } catch (e: any) {
      showAlert("添加失败", String(e?.message || e))
    }
  }

  async function doDelete() {
    const repo = pendingDelete
    setPendingDelete(null)
    if (!repo) return
    setRemovingName(repo.name)
    // 让出一帧，先渲染遮罩再执行可能耗时的缓存清理
    await yieldForUi()
    try {
      // removeRepo 会清元数据 + gitdir 缓存 + 访问书签 + 快照
      await removeRepo(repo.bookmarkName)
      setRepos((current) => {
        const next = current.filter(
          (item) => item.bookmarkName !== repo.bookmarkName
        )
        return next
      })
      const nextStatuses = { ...cachedStatusMap }
      delete nextStatuses[repo.bookmarkName]
      cachedStatusMap = nextStatuses
      setStatusMap(nextStatuses)
    } catch (e: any) {
      showAlert("删除失败", String(e?.message || e))
    } finally {
      setRemovingName(null)
    }
  }

  const activeAlert =
    pendingDelete != null
      ? {
          title: "移除仓库？",
          message: `将从列表移除「${pendingDelete.name}」，并清除本地 Git 缓存；不会删除工作区文件。`,
          isConfirm: true as const,
        }
      : alertState
        ? {
            title: alertState.title,
            message: alertState.message,
            isConfirm: false as const,
          }
        : null

  const showRemovingOverlay = removingName != null
  // 仅影响展示顺序，持久化的仓库数组仍保持添加顺序
  const sortedRepos = sortReposForList(repos, statusMap, snapshotMap)

  return (
    <List
      navigationTitle="仓库"
      navigationBarTitleDisplayMode="large"
      overlay={
        showRemovingOverlay
          ? {
              alignment: "center",
              content: (
                <BusyOverlay
                  title="正在移除仓库"
                  message={`清理「${removingName}」的 Git 缓存…`}
                />
              ),
            }
          : undefined
      }
      onAppear={() => {
        refreshAll()
      }}
      refreshable={() => refreshAll(true)}
      navigationDestination={{
        isPresented: showClone,
        onChanged: setShowClone,
        content: (
          <ClonePage
            onCloned={(repo) => {
              appendRepo(repo)
              setShowClone(false)
            }}
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
            <Button title="移除" role="destructive" action={doDelete} />
          </>
        ) : (
          <Button title="好" role="cancel" action={() => setAlertState(null)} />
        ),
      }}
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarLeading">
            <Button action={dismiss}>
              <Image systemName="xmark" fontWeight="semibold" foregroundStyle="red" />
            </Button>
          </ToolbarItem>
          <ToolbarItem placement="primaryAction">
            <Menu title="添加" fontWeight="semibold" systemImage="plus">
              <Button
                title="添加本地仓库"
                systemImage="folder.badge.plus"
                action={handleAddLocal}
              />
              <Button
                title="克隆仓库"
                systemImage="square.and.arrow.down"
                action={() => setShowClone(true)}
              />
            </Menu>
          </ToolbarItem>
        </Toolbar>
      }
    >
      {repos.length === 0 ? (
        <Section>
          <Text font="callout" foregroundStyle={COLOR_SECONDARY_LABEL}>
            还没有仓库，点击右上角「+」添加本地目录或克隆远端。
          </Text>
        </Section>
      ) : (
        <Section>
          {sortedRepos.map((repo) => (
            <HStack
              key={repo.bookmarkName}
              alignment="center"
              trailingSwipeActions={{
                allowsFullSwipe: true,
                actions: [
                  <Button
                    title="移除"
                    tint="systemRed"
                    systemImage="trash"
                    action={() => setPendingDelete(repo)}
                  />,
                ],
              }}
            >
              <NavigationLink
                destination={
                  <RepoDetailPage
                    bookmarkName={repo.bookmarkName}
                    name={repo.name}
                  />
                }
              >
                <RepoRow
                  repo={repo}
                  status={statusMap[repo.bookmarkName]}
                  snapshot={snapshotMap[repo.bookmarkName]}
                />
              </NavigationLink>
            </HStack>
          ))}
        </Section>
      )}
    </List>
  )
}

/** 单行：左侧名称/来源，右侧（> 左边）加载图标或改动标识上下居中 */
function RepoRow({
  repo,
  status,
  snapshot,
}: {
  repo: RepoMeta
  status?: RepoListStatus
  snapshot?: RepoSnapshot
}) {
  const source = sourceLabel(repo)
  const isClone = source === "克隆"
  const uncommitted = status?.uncommitted ?? snapshot?.uncommitted ?? 0
  const ahead = status?.ahead ?? snapshot?.ahead ?? 0
  const branch = status?.branch ?? snapshot?.branch

  // 状态就绪后才得出摘要；未就绪时行尾显示加载图标
  let trailing: { text: string; color: string } | null = null
  if (status != null) {
    if (status.workdirOk === false) {
      trailing = { text: "路径失效", color: COLOR_RED }
    } else {
      // 合并冲突优先于普通改动/待推送摘要
      const mergeSummary = formatRepoListMergeSummary({
        conflictCount: status.conflictCount ?? 0,
        mergeInProgress: status.mergeInProgress ?? false,
      })
      if (mergeSummary) {
        trailing = {
          text: mergeSummary,
          color: (status.conflictCount ?? 0) > 0 ? COLOR_RED : COLOR_ORANGE,
        }
      } else if (uncommitted > 0 || ahead > 0 || status.behind > 0) {
        const parts: string[] = []
        if (uncommitted > 0) parts.push(`${uncommitted} 改动`)
        if (ahead > 0) parts.push(`${ahead}推送`)
        if (status.behind > 0) parts.push(`${status.behind}拉取`)
        // 本地改动与同步待处理状态均用橙色。
        trailing = {
          text: parts.join(" · "),
          color: COLOR_ORANGE,
        }
      } else {
        trailing = { text: "无改动", color: COLOR_SECONDARY_LABEL }
      }
    }
  }

  return (
    <HStack alignment="center" spacing={10}>
      <Image
        systemName={isClone ? "cloud.fill" : "folder.fill"}
        foregroundStyle={isClone ? COLOR_ACCENT : COLOR_GREEN}
      />
      <VStack alignment="leading" spacing={2}>
        <Text font="headline" foregroundStyle={COLOR_LABEL}>
          {repo.name}
        </Text>
        <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
          {source}
          {branch ? ` · ${branch}` : ""}
        </Text>
      </VStack>
      <Spacer />
      {/* 放在 NavigationLink 自带 > 的左侧，整行垂直居中 */}
      {status == null ? (
        <HStack spacing={8}>
          {snapshot &&
          (uncommitted > 0 || ahead > 0 || snapshot.behind > 0) ? (
            <Text font={12} foregroundStyle={COLOR_ORANGE}>
              {[
                uncommitted > 0 ? `${uncommitted} 改动` : "",
                ahead > 0 ? `${ahead}推送` : "",
                snapshot.behind > 0 ? `${snapshot.behind}拉取` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
          <ProgressView />
        </HStack>
      ) : trailing ? (
        <Text font="caption" foregroundStyle={trailing.color as any}>
          {trailing.text}
        </Text>
      ) : null}
    </HStack>
  )
}
