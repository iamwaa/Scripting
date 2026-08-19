import { Button, List, Section, useState } from "scripting"
import { AppConfig, PathSettingType } from "../types"
import { defaultBackupRoot, defaultProjectRoot } from "../constants"
import { Metric, PathMetric } from "../components/rows"
import { FormRow } from "../components/FormRow"
import { useToast } from "../hooks/useToast"
import { pathExists } from "../utils/fs"
import { pickDirectory, validateDirectory } from "../services/config"

export function PathSettingPage({
  type,
  config,
  onConfigChanged,
}: {
  type: PathSettingType
  config: AppConfig
  onConfigChanged: (config: AppConfig) => void
}) {
  const isBackup = type === "backup"
  const currentPath = isBackup ? config.backupRoot : config.projectRoot
  const defaultPath = isBackup ? defaultBackupRoot : defaultProjectRoot
  const title = isBackup ? "备份目录" : "项目目录"
  const [draftPath, setDraftPath] = useState(currentPath)
  const { showToast, toastProps } = useToast()

  // 书签名当前统一置空，路径直接以字符串保存
  function applyPath(path: string) {
    if (isBackup) {
      onConfigChanged({ ...config, backupRoot: path, backupBookmarkName: null })
    } else {
      onConfigChanged({ ...config, projectRoot: path, projectBookmarkName: null })
    }
  }

  function savePath() {
    const nextPath = draftPath.trim()
    if (!validateDirectory(nextPath, (msg) => showToast(msg, true))) {
      return
    }

    applyPath(nextPath)
    showToast(`${title}已保存`)
  }

  async function chooseDirectory() {
    const path = await pickDirectory(draftPath)
    if (!path) {
      showToast("已取消选择")
      return
    }

    setDraftPath(path)
    applyPath(path)
    showToast(`${title}已选择并保存`)
  }

  function resetDefaultPath() {
    setDraftPath(defaultPath)
    applyPath(defaultPath)
    showToast(`${title}已恢复默认`)
  }

  return (
    <List navigationTitle={title} navigationBarTitleDisplayMode="inline" toast={toastProps}>
      <Section>
        <PathMetric title="当前路径" value={currentPath} />
        <Metric title="目录状态" value={pathExists(currentPath) ? "可读取" : "不存在"} />
      </Section>
      <Section title="选择目录">
        <Button
          title={`选择${title}`}
          systemImage={isBackup ? "externaldrive" : "folder"}
          action={chooseDirectory}
        />
        <Button title="恢复默认" systemImage="arrow.counterclockwise" action={resetDefaultPath} />
      </Section>
      <Section title="手动路径">
        <FormRow label="路径" value={draftPath} onChanged={setDraftPath} />
        <Button title="保存路径" systemImage="checkmark.circle" action={savePath} />
      </Section>
    </List>
  )
}
