import { Button, ContentUnavailableView, List, Section, VStack, useState } from "scripting"
import { AppConfig, ProjectCandidate } from "../types"
import { RefreshButton } from "../components/buttons"
import { ProjectCandidateRow } from "../components/rows"
import { useToast } from "../hooks/useToast"
import { filterCandidates, scanProjectDirectories } from "../services/history"
import { createProjectBackup } from "../services/backup"

export function ManualBackupPage({
  config,
  onBackupComplete,
}: {
  config: AppConfig
  onBackupComplete?: () => void
}) {
  const [candidates, setCandidates] = useState<ProjectCandidate[]>(scanProjectDirectories(config.projectRoot))
  const [visibleCandidates, setVisibleCandidates] = useState<ProjectCandidate[]>(candidates)
  const [query, setQuery] = useState("")
  const [searchPresented, setSearchPresented] = useState(false)
  const { showToast, toastProps } = useToast()

  function refreshCandidates() {
    const next = scanProjectDirectories(config.projectRoot)
    setCandidates(next)
    setVisibleCandidates(filterCandidates(next, query))
  }

  function handleQueryChanged(nextQuery: string) {
    setQuery(nextQuery)
    setVisibleCandidates(filterCandidates(candidates, nextQuery))
  }

  function handleSearchPresentedChanged(presented: boolean) {
    setSearchPresented(presented)
    if (!presented) {
      // 搜索关闭时重置查询并恢复完整列表
      setQuery("")
      setVisibleCandidates(candidates)
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
      searchable={{
        value: query,
        onChanged: handleQueryChanged,
        prompt: "搜索项目",
        presented: { value: searchPresented, onChanged: handleSearchPresentedChanged },
      }}
      toast={toastProps}
      toolbar={{ primaryAction: <RefreshButton action={refreshCandidates} /> }}
    >
      {visibleCandidates.length === 0 ? (
        <ContentUnavailableView
          title={query.trim() ? "没有匹配的项目" : "暂无项目"}
          systemImage="folder"
          description={query.trim() ? "请尝试更换搜索关键词" : "当前项目目录下没有可备份的项目文件夹"}
          frame={{ maxWidth: "infinity", minHeight: 300 }}
          listRowBackground={<VStack />}
          listRowSeparator="hidden"
        />
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
