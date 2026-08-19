import {
  ContentUnavailableView,
  HStack,
  Image,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Section,
  Text,
  Toolbar,
  ToolbarItem,
  ToolbarSpacer,
  VStack,
  useState,
} from "scripting"
import { AppConfig, ProjectHistory } from "../types"
import { CloseButton, DeleteSwipeButton, RefreshButton } from "../components/buttons"
import { ProjectRow } from "../components/rows"
import { useToast } from "../hooks/useToast"
import { removeExistingPath } from "../utils/fs"
import { resolveConfig, saveConfig } from "../services/config"
import { filterProjects, scanHistories } from "../services/history"
import { HistoryPage } from "./HistoryPage"
import { ManualBackupPage } from "./ManualBackupPage"
import { SettingsPage } from "./SettingsPage"

export function ProjectListPage() {
  const dismiss = Navigation.useDismiss()
  const [config, setConfigState] = useState<AppConfig>(resolveConfig())
  const [projects, setProjectsState] = useState<ProjectHistory[]>(scanHistories(config))
  const [visibleProjects, setVisibleProjects] = useState<ProjectHistory[]>(projects)
  const [query, setQuery] = useState("")
  const [searchPresented, setSearchPresented] = useState(false)
  const { showToast, toastProps } = useToast()

  function setProjectList(nextProjects: ProjectHistory[], nextQuery = query) {
    setProjectsState(nextProjects)
    setVisibleProjects(filterProjects(nextProjects, nextQuery))
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
    setVisibleProjects(filterProjects(projects, nextQuery))
  }

  function handleSearchPresentedChanged(presented: boolean) {
    setSearchPresented(presented)
    if (!presented) {
      // 搜索关闭时重置查询并恢复完整列表
      setQuery("")
      setVisibleProjects(projects)
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
        searchable={{
          value: query,
          onChanged: handleQueryChanged,
          prompt: "搜索项目",
          presented: { value: searchPresented, onChanged: handleSearchPresentedChanged },
        }}
        toast={toastProps}
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
              <NavigationLink destination={<SettingsPage config={config} onConfigChanged={applyConfig} />}>
                <Image systemName="gearshape" fontWeight="semibold" />
              </NavigationLink>
            </ToolbarItem>
          </Toolbar>
        }
      >
        <Section title="主动备份">
          <NavigationLink
            destination={<ManualBackupPage config={config} onBackupComplete={refreshProjects} />}
          >
            <HStack spacing={10}>
              <Image systemName="plus.circle" foregroundStyle="tintColor" />
              <Text>选择项目并备份</Text>
            </HStack>
          </NavigationLink>
          <Text font={13} foregroundStyle="secondaryLabel">
            选择项目并输入描述后立即保存到当前备份目录。
          </Text>
        </Section>
        {visibleProjects.length === 0 ? (
          <ContentUnavailableView
            title={query.trim() ? "没有匹配的项目" : "暂无备份"}
            systemImage="tray"
            description={query.trim() ? "请尝试更换搜索关键词" : "当前路径下没有可显示的项目备份"}
            frame={{ maxWidth: "infinity", minHeight: 300 }}
            listRowBackground={<VStack />}
            listRowSeparator="hidden"
          />
        ) : (
          <Section title={`项目（${visibleProjects.length}）`}>
            {visibleProjects.map((project) => (
              <NavigationLink
                key={project.id}
                destination={<HistoryPage project={project} onProjectChange={refreshProjects} />}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [<DeleteSwipeButton action={() => deleteProject(project)} />],
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
