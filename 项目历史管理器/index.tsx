import {
  Button,
  ContentUnavailableView,
  ForEach,
  HStack,
  Image,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Path,
  Script,
  Section,
  Spacer,
  Text,
  TextField,
  Toolbar,
  ToolbarItem,
  ToolbarSpacer,
  VStack,
  useMemo,
  useObservable,
  useState,
} from "scripting"

declare const Dialog: any

const configStorageKey = "project-history-manager-config"
const defaultBackupRoot = Path.join(FileManager.iCloudDocumentsDirectory, "backup")
const defaultProjectRoot = FileManager.scriptsDirectory
const managerProjectName = "项目历史管理器"
const managerProjectPath = Path.join(defaultProjectRoot, managerProjectName)

type Snapshot = {
  id: string
  name: string
  path: string
  projectName: string
  description: string
  timestamp: number
  timestampLabel: string
  fileCount: number
  byteSize: number
}

type ProjectHistory = {
  id: string
  name: string
  path: string
  projectPath: string
  snapshots: Snapshot[]
  latest?: Snapshot
  totalBytes: number
}

type AppConfig = {
  backupRoot: string
  projectRoot: string
  backupBookmarkName: string | null
  projectBookmarkName: string | null
}

type ProjectCandidate = {
  id: string
  name: string
  path: string
}

type DirectorySummary = {
  fileCount: number
  byteSize: number
}

function pathExists(path: string) {
  try {
    return FileManager.existsSync(path)
  } catch {
    return false
  }
}

function listChildren(path: string): string[] {
  if (!pathExists(path)) {
    return []
  }

  return FileManager.readDirectorySync(path).map((item) => {
    return Path.isAbsolute(item) ? item : Path.join(path, item)
  })
}

function isDirectory(path: string) {
  try {
    return FileManager.isDirectorySync(path)
  } catch {
    return false
  }
}

function statTime(path: string) {
  try {
    const stat = FileManager.statSync(path)
    return stat.modificationDate || stat.creationDate || Date.now()
  } catch {
    return Date.now()
  }
}

function summarizeDirectory(path: string): DirectorySummary {
  let fileCount = 0
  let byteSize = 0

  for (const item of listChildren(path)) {
    if (isDirectory(item)) {
      const child = summarizeDirectory(item)
      fileCount += child.fileCount
      byteSize += child.byteSize
    } else {
      try {
        const stat = FileManager.statSync(item)
        fileCount += 1
        byteSize += stat.size || 0
      } catch {
        fileCount += 1
      }
    }
  }

  return { fileCount, byteSize }
}

function collectFiles(path: string, root = path, limit = 80): string[] {
  const files: string[] = []

  function walk(current: string) {
    if (files.length >= limit) {
      return
    }

    for (const item of listChildren(current)) {
      if (files.length >= limit) {
        return
      }

      if (isDirectory(item)) {
        walk(item)
      } else {
        files.push(item.replace(`${root}/`, ""))
      }
    }
  }

  walk(path)
  return files
}

function safeName(name: string) {
  const cleaned = name
    .trim()
    .split("")
    .map((char) => {
      if (/^[A-Za-z0-9_.-]$/.test(char) || /[\u4e00-\u9fff]/.test(char)) {
        return char
      }
      return "_"
    })
    .join("")
    .replace(/^[._]+|[._]+$/g, "")

  return cleaned || "project"
}

function displayProjectName(backupFolderName: string, projectRoot: string) {
  const directPath = Path.join(projectRoot, backupFolderName)
  if (pathExists(directPath)) {
    return backupFolderName
  }

  const spacedName = backupFolderName.replace(/_/g, " ")
  const spacedPath = Path.join(projectRoot, spacedName)
  if (pathExists(spacedPath)) {
    return spacedName
  }

  return backupFolderName
}

function parseSnapshot(projectName: string, snapshotPath: string): Snapshot {
  const name = Path.basename(snapshotPath)
  const prefix = `${projectName}_`
  const body = name.startsWith(prefix) ? name.slice(prefix.length) : name
  const match = body.match(/^(.*?)(?:_)?(\d{8})_(\d{6})$/)
  const fallbackTime = statTime(snapshotPath)
  const timestamp = match ? parseTimestamp(match[2], match[3]) : fallbackTime
  const description = match?.[1] ? match[1].replace(/_/g, " ") : "无描述"
  const summary = summarizeDirectory(snapshotPath)

  return {
    id: snapshotPath,
    name,
    path: snapshotPath,
    projectName,
    description,
    timestamp,
    timestampLabel: formatDate(timestamp),
    fileCount: summary.fileCount,
    byteSize: summary.byteSize,
  }
}

function parseTimestamp(date: string, time: string) {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(4, 6)) - 1
  const day = Number(date.slice(6, 8))
  const hour = Number(time.slice(0, 2))
  const minute = Number(time.slice(2, 4))
  const second = Number(time.slice(4, 6))
  return new Date(year, month, day, hour, minute, second).getTime()
}

function timestampForName() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function formatDate(value: number) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`
}

function shortPath(path: string) {
  return path
}

function normalizeComparablePath(path: string) {
  const normalized = path.trim().replace(/\/+$/g, "")
  return normalized.startsWith("/private/var/") ? normalized.slice("/private".length) : normalized
}

function isSamePath(left: string, right: string) {
  return normalizeComparablePath(left) === normalizeComparablePath(right)
}

function isSelfProject(project: ProjectHistory) {
  return isSamePath(project.projectPath, managerProjectPath)
}

function normalizeConfig(config: Partial<AppConfig> | null | undefined): AppConfig {
  return {
    backupRoot: config?.backupRoot || defaultBackupRoot,
    projectRoot: config?.projectRoot || defaultProjectRoot,
    backupBookmarkName: config?.backupBookmarkName || null,
    projectBookmarkName: config?.projectBookmarkName || null,
  }
}

function resolveConfig(): AppConfig {
  return normalizeConfig(Storage.get<Partial<AppConfig>>(configStorageKey))
}

function saveConfig(config: AppConfig) {
  const nextConfig = normalizeConfig(config)
  const saved = Storage.set(configStorageKey, nextConfig)
  if (!saved) {
    throw new Error("保存路径配置失败")
  }
}

function validateDirectory(path: string, setStatus: (status: string) => void) {
  if (!path.trim()) {
    setStatus("路径不能为空")
    return false
  }

  if (!pathExists(path) || !isDirectory(path)) {
    setStatus("路径不存在或不是文件夹")
    return false
  }

  return true
}

async function pickDirectory(initialDirectory: string) {
  return DocumentPicker.pickDirectory(pathExists(initialDirectory) ? initialDirectory : FileManager.iCloudDocumentsDirectory)
}

function scanSnapshots(backupProjectPath: string): Snapshot[] {
  const backupFolderName = Path.basename(backupProjectPath)
  return listChildren(backupProjectPath)
    .filter(isDirectory)
    .map((snapshotPath) => parseSnapshot(backupFolderName, snapshotPath))
    .sort((a, b) => b.timestamp - a.timestamp)
}

function buildProjectHistory(backupProjectPath: string, config: AppConfig): ProjectHistory {
  const backupFolderName = Path.basename(backupProjectPath)
  const projectName = displayProjectName(backupFolderName, config.projectRoot)
  const snapshots = scanSnapshots(backupProjectPath)

  return {
    id: backupProjectPath,
    name: projectName,
    path: backupProjectPath,
    projectPath: Path.join(config.projectRoot, projectName),
    snapshots,
    latest: snapshots[0],
    totalBytes: snapshots.reduce((total, item) => total + item.byteSize, 0),
  }
}

function scanHistories(config: AppConfig): ProjectHistory[] {
  if (!pathExists(config.backupRoot)) {
    return []
  }

  return listChildren(config.backupRoot)
    .filter(isDirectory)
    .map((backupProjectPath) => buildProjectHistory(backupProjectPath, config))
    .filter((project) => project.snapshots.length > 0)
    .sort((a, b) => (b.latest?.timestamp || 0) - (a.latest?.timestamp || 0))
}

function scanProjectDirectories(projectRoot: string): ProjectCandidate[] {
  if (!pathExists(projectRoot)) {
    return []
  }

  return listChildren(projectRoot)
    .filter(isDirectory)
    .map((path) => ({
      id: path,
      name: Path.basename(path),
      path,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
}

function filterProjects(projects: ProjectHistory[], query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) {
    return projects
  }

  return projects.filter((project) => project.name.toLowerCase().includes(keyword))
}

function removeExistingPath(path: string) {
  if (!pathExists(path)) {
    return
  }

  FileManager.removeSync(path)
  if (pathExists(path)) {
    throw new Error(`删除失败：${path}`)
  }
}

function refreshProjectHistory(project: ProjectHistory): ProjectHistory {
  const snapshots = scanSnapshots(project.path)

  return {
    ...project,
    snapshots,
    latest: snapshots[0],
    totalBytes: snapshots.reduce((total, item) => total + item.byteSize, 0),
  }
}

function copyDirectory(source: string, destination: string) {
  FileManager.createDirectorySync(destination, true)

  for (const item of listChildren(source)) {
    const target = Path.join(destination, Path.basename(item))
    if (isDirectory(item)) {
      copyDirectory(item, target)
    } else {
      FileManager.copyFileSync(item, target)
    }
  }
}

function createProjectBackup(projectPath: string, backupRoot: string, description: string) {
  if (!pathExists(projectPath) || !isDirectory(projectPath)) {
    throw new Error(`项目目录不存在或不是文件夹：${projectPath}`)
  }

  if (!pathExists(backupRoot)) {
    FileManager.createDirectorySync(backupRoot, true)
  }

  const projectName = Path.basename(projectPath)
  const backupProjectPath = Path.join(backupRoot, projectName)
  const folderName = `${projectName}_${safeName(description || "主动备份")}_${timestampForName()}`
  const destination = Path.join(backupProjectPath, folderName)

  if (pathExists(destination)) {
    throw new Error(`备份目录已存在：${destination}`)
  }

  copyDirectory(projectPath, destination)
  return parseSnapshot(projectName, destination)
}

function createRestoreSafetyBackup(project: ProjectHistory, snapshot: Snapshot) {
  const folderName = `${Path.basename(project.path)}_${safeName(snapshot.description)}_还原前备份_${timestampForName()}`
  const destination = Path.join(project.path, folderName)
  copyDirectory(project.projectPath, destination)
  return destination
}

async function restoreSnapshot(project: ProjectHistory, snapshot: Snapshot) {
  if (isSelfProject(project)) {
    throw new Error("不能在运行时还原历史管理器自身")
  }

  if (!pathExists(project.projectPath)) {
    throw new Error(`项目目录不存在：${project.projectPath}`)
  }

  if (!pathExists(snapshot.path)) {
    throw new Error(`快照目录不存在：${snapshot.path}`)
  }

  const actionIndex = await Dialog.actionSheet({
    title: "还原项目",
    message: `将 ${project.name} 还原到 ${snapshot.timestampLabel} 的快照「${snapshot.description}」。\n当前状态会先保存为“还原前”备份，文件夹名会包含被还原的快照信息。`,
    actions: [
      { label: "取消" },
      { label: "还原", destructive: true },
    ],
    cancelButton: false,
  })

  if (actionIndex !== 1) {
    return false
  }

  const safetyBackup = createRestoreSafetyBackup(project, snapshot)
  const stamp = timestampForName()
  const projectRoot = Path.dirname(project.projectPath)
  const restoreTemp = Path.join(projectRoot, `.${safeName(project.name)}.restore-${stamp}`)
  const oldTemp = Path.join(projectRoot, `.${safeName(project.name)}.before-restore-${stamp}`)

  if (pathExists(restoreTemp)) {
    FileManager.removeSync(restoreTemp)
  }
  if (pathExists(oldTemp)) {
    FileManager.removeSync(oldTemp)
  }

  try {
    copyDirectory(snapshot.path, restoreTemp)
    FileManager.renameSync(project.projectPath, oldTemp)
    FileManager.renameSync(restoreTemp, project.projectPath)
    FileManager.removeSync(oldTemp)
  } catch (error) {
    if (!pathExists(project.projectPath) && pathExists(oldTemp)) {
      FileManager.renameSync(oldTemp, project.projectPath)
    }
    if (pathExists(restoreTemp)) {
      FileManager.removeSync(restoreTemp)
    }
    throw error
  }

  return true
}

function Metric({ title, value }: { title: string; value: string | number }) {
  return (
    <VStack alignment="leading" spacing={2}>
      <Text font="caption" foregroundStyle="secondaryLabel">
        {title}
      </Text>
      <Text font="body">{value}</Text>
    </VStack>
  )
}

function PathMetric({ title, value }: { title: string; value: string }) {
  return (
    <VStack alignment="leading" spacing={4}>
      <Text font="caption" foregroundStyle="secondaryLabel">
        {title}
      </Text>
      <Text font="caption" foregroundStyle="label">
        {shortPath(value)}
      </Text>
    </VStack>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <VStack alignment="center" spacing={12}>
      <Image systemName="tray" foregroundStyle="secondaryLabel" />
      <Text foregroundStyle="secondaryLabel">{message}</Text>
    </VStack>
  )
}

function ProjectRow({ project }: { project: ProjectHistory }) {
  return (
    <VStack alignment="leading" spacing={6}>
      <HStack spacing={10}>
        <Image systemName="folder" foregroundStyle="tintColor" />
        <Text font="headline">{project.name}</Text>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel">
          {project.snapshots.length} 个
        </Text>
      </HStack>
      <HStack spacing={8}>
        <Text font="caption" foregroundStyle="secondaryLabel">
          {project.latest?.timestampLabel || "无备份时间"}
        </Text>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel">
          {formatBytes(project.totalBytes)}
        </Text>
      </HStack>
    </VStack>
  )
}

function ProjectCandidateRow({ project }: { project: ProjectCandidate }) {
  return (
    <VStack alignment="leading" spacing={6}>
      <HStack spacing={10}>
        <Image systemName="folder" foregroundStyle="tintColor" />
        <Text font="headline" foregroundStyle="label">{project.name}</Text>
      </HStack>
      <Text font="caption" foregroundStyle="secondaryLabel">
        {shortPath(project.path)}
      </Text>
    </VStack>
  )
}

function SnapshotRow({ snapshot }: { snapshot: Snapshot }) {
  return (
    <VStack alignment="leading" spacing={6}>
      <HStack spacing={10}>
        <Image systemName="clock.arrow.circlepath" foregroundStyle="tintColor" />
        <Text font="headline">{snapshot.description}</Text>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel">
          {formatBytes(snapshot.byteSize)}
        </Text>
      </HStack>
      <Text font="caption" foregroundStyle="secondaryLabel">
        {snapshot.timestampLabel} · {snapshot.fileCount} 个文件
      </Text>
    </VStack>
  )
}

function CloseButton({ action }: { action: () => void }) {
  return (
    <Button action={action}>
      <Image systemName="xmark" foregroundStyle="red" fontWeight="semibold" />
    </Button>
  )
}

function RefreshButton({ action }: { action: () => void }) {
  return (
    <Button action={action}>
      <Image systemName="arrow.clockwise" fontWeight="semibold" />
    </Button>
  )
}

function SettingsButton({ config, onConfigChanged }: { config: AppConfig; onConfigChanged: (config: AppConfig) => void }) {
  return (
    <NavigationLink destination={<SettingsPage config={config} onConfigChanged={onConfigChanged} />}>
      <Image systemName="gearshape" fontWeight="semibold" />
    </NavigationLink>
  )
}

function ProjectListPage() {
  const dismiss = Navigation.useDismiss()
  const [config, setConfigState] = useState<AppConfig>(resolveConfig())
  const [projects, setProjectsState] = useState<ProjectHistory[]>(scanHistories(config))
  const [visibleProjects, setVisibleProjects] = useState<ProjectHistory[]>(projects)
  const [query, setQuery] = useState("")
  const [searchPresented, setSearchPresented] = useState(false)
  const [toast, setToast] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false })
  const showToast = (msg: string, isError = false) => setToast({ msg, isError })

  function updateVisible(list: ProjectHistory[]) {
    setVisibleProjects(list)
  }

  function setProjectList(nextProjects: ProjectHistory[], nextQuery = query) {
    setProjectsState(nextProjects)
    updateVisible(filterProjects(nextProjects, nextQuery))
  }

  function applyConfig(nextConfig: AppConfig) {
    saveConfig(nextConfig)
    setConfigState(nextConfig)
    setProjectList(scanHistories(nextConfig))
  }

  function refreshProjects() {
    const nextConfig = resolveConfig()
    setConfigState(nextConfig)
    setProjectList(scanHistories(nextConfig))
  }

  function handleQueryChanged(nextQuery: string) {
    setQuery(nextQuery)
    updateVisible(filterProjects(projects, nextQuery))
  }

  function handleSearchPresentedChanged(presented: boolean) {
    setSearchPresented(presented)
    if (!presented) {
      // 搜索关闭时重置查询并刷新列表
      setQuery("")
      updateVisible(projects)
    }
  }

  async function deleteProject(project: ProjectHistory) {
    const index = await Dialog.actionSheet({
      title: "删除确认",
      message: `确定删除 ${project.name} 的全部备份？此操作不可恢复。`,
      actions: [{ label: "取消" }, { label: "删除", destructive: true }],
      cancelButton: false,
    })

    if (index !== 1) {
      return
    }

    try {
      removeExistingPath(project.path)
      showToast("已删除")
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true)
    }
    refreshProjects()
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="项目历史"
        navigationBarTitleDisplayMode="inline"
        searchable={{ value: query, onChanged: handleQueryChanged, prompt: "搜索项目", presented: { value: searchPresented, onChanged: handleSearchPresentedChanged } }}
        toast={{ isPresented: toast.msg !== "", onChanged: (v) => { if (!v) setToast({ msg: "", isError: false }) }, content: <Text foregroundStyle={toast.isError ? "#FF3B30" : "label"}>{toast.msg}</Text>, position: "top" }}
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <CloseButton action={dismiss} />
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              <RefreshButton action={refreshProjects} />
            </ToolbarItem>
            <ToolbarSpacer placement="topBarTrailing" />
            <ToolbarItem placement="topBarTrailing">
              <SettingsButton config={config} onConfigChanged={applyConfig} />
            </ToolbarItem>
          </Toolbar>
        }
      >
        <Section title="主动备份">
          <NavigationLink destination={<ManualBackupPage config={config} onBackupComplete={refreshProjects} />}>
            <HStack spacing={10}>
              <Image systemName="plus.circle" foregroundStyle="tintColor" />
              <Text>选择项目并备份</Text>
            </HStack>
          </NavigationLink>
          <Text font="caption" foregroundStyle="secondaryLabel">选择项目并输入描述后立即保存到当前备份目录。</Text>
        </Section>
        {visibleProjects.length === 0 ? (
          <ContentUnavailableView title={query.trim() ? "没有匹配的项目" : "暂无备份"} systemImage="tray" description={query.trim() ? "请尝试更换搜索关键词" : "当前路径下没有可显示的项目备份"} frame={{ maxWidth: "infinity", minHeight: 300 }} listRowBackground={<VStack />} listRowSeparator="hidden" />
        ) : (
          <Section title={`项目（${visibleProjects.length}）`}>
            {visibleProjects.map((project) => (
              <NavigationLink
                key={project.id}
                destination={<HistoryPage project={project} onProjectChange={refreshProjects} />}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button
                      title="删除"
                      systemImage="trash"
                      tint="#FF3B30"
                      action={() => deleteProject(project)}
                    />
                  ],
                }}
              >
                <ProjectRow project={project} />
              </NavigationLink>
            ))}
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

type PathSettingType = "backup" | "project"

function SettingsPage({ config, onConfigChanged }: { config: AppConfig; onConfigChanged: (config: AppConfig) => void }) {
  const [currentConfig, setCurrentConfig] = useState<AppConfig>(config)

  function applyConfig(nextConfig: AppConfig) {
    setCurrentConfig(nextConfig)
    onConfigChanged(nextConfig)
  }

  return (
    <List navigationTitle="设置" navigationBarTitleDisplayMode="inline">
      <Section title="路径设置">
        <NavigationLink destination={<PathSettingPage type="backup" config={currentConfig} onConfigChanged={applyConfig} />}>
          <HStack spacing={10}>
            <Image systemName="externaldrive" foregroundStyle="tintColor" />
            <PathMetric title="备份目录" value={currentConfig.backupRoot} />
          </HStack>
        </NavigationLink>
        <NavigationLink destination={<PathSettingPage type="project" config={currentConfig} onConfigChanged={applyConfig} />}>
          <HStack spacing={10}>
            <Image systemName="folder" foregroundStyle="tintColor" />
            <PathMetric title="项目目录" value={currentConfig.projectRoot} />
          </HStack>
        </NavigationLink>
      </Section>
    </List>
  )
}

function filterCandidates(candidates: ProjectCandidate[], query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) {
    return candidates
  }

  return candidates.filter((item) => item.name.toLowerCase().includes(keyword))
}

function ManualBackupPage({ config, onBackupComplete }: { config: AppConfig; onBackupComplete?: () => void }) {
  const [candidates, setCandidates] = useState<ProjectCandidate[]>(scanProjectDirectories(config.projectRoot))
  const [visibleCandidates, setVisibleCandidates] = useState<ProjectCandidate[]>(candidates)
  const [query, setQuery] = useState("")
  const [searchPresented, setSearchPresented] = useState(false)
  const [toast, setToast] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false })
  const showToast = (msg: string, isError = false) => setToast({ msg, isError })

  function updateVisible(list: ProjectCandidate[]) {
    setVisibleCandidates(list)
  }

  function refreshCandidates() {
    const next = scanProjectDirectories(config.projectRoot)
    setCandidates(next)
    updateVisible(filterCandidates(next, query))
  }

  function handleQueryChanged(nextQuery: string) {
    setQuery(nextQuery)
    updateVisible(filterCandidates(candidates, nextQuery))
  }

  function handleSearchPresentedChanged(presented: boolean) {
    setSearchPresented(presented)
    if (!presented) {
      // 搜索关闭时重置查询并刷新列表
      setQuery("")
      updateVisible(candidates)
    }
  }

  async function createManualBackup(project: ProjectCandidate) {
    try {
      const description = await Dialog.prompt({
        title: "备份描述",
        message: `为项目「${project.name}」创建备份`,
        defaultValue: "主动备份",
        placeholder: "例如：发布前备份",
        cancelLabel: "取消",
        confirmLabel: "开始备份",
      })
      if (description == null) {
        showToast("已取消备份")
        return
      }

      createProjectBackup(project.path, config.backupRoot, description)
      showToast("备份已创建")
      onBackupComplete?.()
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true)
    }
  }

  return (
    <List
      navigationTitle="选择项目"
      navigationBarTitleDisplayMode="inline"
      searchable={{ value: query, onChanged: handleQueryChanged, prompt: "搜索项目", presented: { value: searchPresented, onChanged: handleSearchPresentedChanged } }}
      toast={{ isPresented: toast.msg !== "", onChanged: (v) => { if (!v) setToast({ msg: "", isError: false }) }, content: <Text foregroundStyle={toast.isError ? "#FF3B30" : "label"}>{toast.msg}</Text>, position: "top" }}
      toolbar={{ primaryAction: <RefreshButton action={refreshCandidates} /> }}
    >
      {visibleCandidates.length === 0 ? (
        <ContentUnavailableView title={query.trim() ? "没有匹配的项目" : "暂无项目"} systemImage="folder" description={query.trim() ? "请尝试更换搜索关键词" : "当前项目目录下没有可备份的项目文件夹"} frame={{ maxWidth: "infinity", minHeight: 300 }} listRowBackground={<VStack />} listRowSeparator="hidden" />
      ) : (
        <Section title={`项目列表（${visibleCandidates.length}）`}>
          {visibleCandidates.map((project) => (
            <Button key={project.id} action={() => createManualBackup(project)}>
              <ProjectCandidateRow project={project} />
            </Button>
          ))}
        </Section>
      )}
    </List>
  )
}

function PathSettingPage({ type, config, onConfigChanged }: { type: PathSettingType; config: AppConfig; onConfigChanged: (config: AppConfig) => void }) {
  const isBackup = type === "backup"
  const currentPath = isBackup ? config.backupRoot : config.projectRoot
  const defaultPath = isBackup ? defaultBackupRoot : defaultProjectRoot
  const title = isBackup ? "备份目录" : "项目目录"
  const [draftPath, setDraftPath] = useState(currentPath)
  const [toast, setToast] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false })
  const showToast = (msg: string, isError = false) => setToast({ msg, isError })

  function applyPath(path: string, nextBookmarkName: string | null) {
    if (isBackup) {
      onConfigChanged({ ...config, backupRoot: path, backupBookmarkName: nextBookmarkName })
    } else {
      onConfigChanged({ ...config, projectRoot: path, projectBookmarkName: nextBookmarkName })
    }
  }

  function savePath() {
    const nextPath = draftPath.trim()
    if (!validateDirectory(nextPath, (msg) => showToast(msg, true))) {
      return
    }

    applyPath(nextPath, null)
    showToast(`${title}已保存`)
  }

  async function chooseDirectory() {
    const path = await pickDirectory(draftPath)
    if (!path) {
      showToast("已取消选择")
      return
    }

    setDraftPath(path)
    applyPath(path, null)
    showToast(`${title}已选择并保存`)
  }

  function resetDefaultPath() {
    setDraftPath(defaultPath)
    applyPath(defaultPath, null)
    showToast(`${title}已恢复默认`)
  }

  return (
    <List
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      toast={{ isPresented: toast.msg !== "", onChanged: (v) => { if (!v) setToast({ msg: "", isError: false }) }, content: <Text foregroundStyle={toast.isError ? "#FF3B30" : "label"}>{toast.msg}</Text>, position: "top" }}
    >
      <Section>
        <PathMetric title="当前路径" value={currentPath} />
        <Metric title="目录状态" value={pathExists(currentPath) ? "可读取" : "不存在"} />
      </Section>
      <Section title="选择目录">
        <Button title={`选择${title}`} systemImage={isBackup ? "externaldrive" : "folder"} action={chooseDirectory} />
        <Button title="恢复默认" systemImage="arrow.counterclockwise" action={resetDefaultPath} />
      </Section>
      <Section title="手动路径">
        <TextField title="路径" value={draftPath} onChanged={setDraftPath} axis="vertical" />
        <Button title="保存路径" systemImage="checkmark.circle" action={savePath} />
      </Section>
    </List>
  )
}

function HistoryPage({ project, onProjectChange }: { project: ProjectHistory; onProjectChange?: () => void }) {
  const currentProject = useObservable<ProjectHistory>(() => refreshProjectHistory(project))
  const snapshots = useObservable<Snapshot[]>(() => currentProject.value.snapshots)
  const [toast, setToast] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false })
  const showToast = (msg: string, isError = false) => setToast({ msg, isError })

  function refreshSnapshots() {
    const nextProject = refreshProjectHistory(currentProject.value)
    currentProject.setValue(nextProject)
    snapshots.setValue(nextProject.snapshots)
  }

  async function deleteSnapshot(snapshot: Snapshot) {
    const index = await Dialog.actionSheet({
      title: "删除确认",
      message: `确定删除快照「${snapshot.description}」？此操作不可恢复。`,
      actions: [{ label: "取消" }, { label: "删除", destructive: true }],
      cancelButton: false,
    })

    if (index !== 1) {
      return
    }

    try {
      removeExistingPath(snapshot.path)
      showToast("已删除")
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true)
    }
    refreshSnapshots()
    onProjectChange?.()
  }

  return (
    <List
      navigationTitle={currentProject.value.name}
      navigationBarTitleDisplayMode="inline"
      toast={{ isPresented: toast.msg !== "", onChanged: (v) => { if (!v) setToast({ msg: "", isError: false }) }, content: <Text foregroundStyle={toast.isError ? "#FF3B30" : "label"}>{toast.msg}</Text>, position: "top" }}
    >
      <Section
        header={<Text>{`历史记录（${snapshots.value.length}）`}</Text>}
        footer={<Text>描述表示创建该备份时将要进行的修改，备份内容是修改前的项目状态。</Text>}
      >
        {snapshots.value.length === 0 ? (
          <EmptyState message="当前项目没有历史记录" />
        ) : (
          <ForEach
            data={snapshots}
            builder={(snapshot) => (
              <NavigationLink
                key={snapshot.id}
                destination={<SnapshotDetailPage project={currentProject.value} snapshot={snapshot} onRestoreComplete={() => { refreshSnapshots(); showToast("已还原，如未生效请手动构建项目") }} />}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button
                      title="删除"
                      systemImage="trash"
                      tint="#FF3B30"
                      action={() => deleteSnapshot(snapshot)}
                    />
                  ],
                }}
              >
                <SnapshotRow snapshot={snapshot} />
              </NavigationLink>
            )}
          />
        )}
      </Section>
    </List>
  )
}

function SnapshotDetailPage({ project, snapshot, onRestoreComplete }: { project: ProjectHistory; snapshot: Snapshot; onRestoreComplete?: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [toast, setToast] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false })
  const showToast = (msg: string, isError = false) => setToast({ msg, isError })
  const [isRestoring, setIsRestoring] = useState(false)
  const files = useMemo(() => collectFiles(snapshot.path), [snapshot.path])
  const canRestore = !isSelfProject(project) && pathExists(project.projectPath)

  function handleRestore() {
    if (isRestoring) {
      return
    }

    setIsRestoring(true)
    restoreSnapshot(project, snapshot)
      .then((restored) => {
        if (!restored) {
          return
        }

        dismiss()
        onRestoreComplete?.()
      })
      .catch((error) => showToast(error instanceof Error ? error.message : String(error), true))
      .finally(() => setIsRestoring(false))
  }

  return (
    <List
      navigationTitle="快照详情"
      navigationBarTitleDisplayMode="inline"
      toast={{ isPresented: toast.msg !== "", onChanged: (v) => { if (!v) setToast({ msg: "", isError: false }) }, content: <Text foregroundStyle={toast.isError ? "#FF3B30" : "label"}>{toast.msg}</Text>, position: "top" }}
    >
      <Section>
        <Metric title="项目" value={project.name} />
        <Metric title="描述" value={snapshot.description} />
        <Metric title="时间" value={snapshot.timestampLabel} />
        <Metric title="文件" value={`${snapshot.fileCount} 个 · ${formatBytes(snapshot.byteSize)}`} />
      </Section>
      <Section title="操作">
        {canRestore ? (
          <Button title={isRestoring ? "正在还原" : "还原到此快照"} systemImage="arrow.uturn.backward.circle" role="destructive" action={handleRestore} />
        ) : (
          <Text foregroundStyle="secondaryLabel">当前项目不可还原</Text>
        )}
      </Section>
      <Section title={`文件预览（${snapshot.fileCount}）`}>
        {files.map((file) => (
          <HStack spacing={10}>
            <Image systemName="doc" foregroundStyle="secondaryLabel" />
            <Text font="caption">{file}</Text>
          </HStack>
        ))}
        {snapshot.fileCount > files.length ? (
          <Text foregroundStyle="secondaryLabel">还有 {snapshot.fileCount - files.length} 个文件未显示</Text>
        ) : null}
      </Section>
    </List>
  )
}

async function run() {
  await Navigation.present({
    element: <ProjectListPage />,
    modalPresentationStyle: "fullScreen",
  })
  Script.exit()
}

run()
