/**
 * pages/DiffPage.tsx - 单文件 diff 展示页
 *
 * 导航栏仅显示文件名；增删统计用顶部悬浮胶囊展示。
 */

import {
  List,
  Section,
  Text,
  HStack,
  ProgressView,
  useState,
  useEffect,
} from "scripting"
import { DiffViewer } from "../components/DiffViewer"
import { DiffStatsBar } from "../components/DiffStatsBar"
import { getFileDiff } from "../services/diffService"
import type { FileDiff } from "../services/diffService"
import { truncatePath } from "../utils/format"
import { COLOR_SECONDARY_LABEL } from "../constants/colors"

/** 统计 diff 的增删行数 */
function countDiffLines(diff: FileDiff): { added: number; deleted: number } {
  let added = 0
  let deleted = 0
  for (const line of diff.lines) {
    if (line.type === "add") added++
    else if (line.type === "del") deleted++
  }
  return { added, deleted }
}

export function DiffPage({
  bookmarkName,
  filepath,
}: {
  bookmarkName: string
  filepath: string
}) {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadDiff()
  }, [])

  async function loadDiff() {
    setLoading(true)
    setError(null)
    try {
      const d = await getFileDiff(bookmarkName, filepath)
      setDiff(d)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  const title = truncatePath(filepath, 36)
  const stats = diff ? countDiffLines(diff) : null

  return (
    <List
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      listStyle="plain"
      safeAreaInset={
        diff && stats
          ? {
              top: {
                spacing: 0,
                content: (
                  <DiffStatsBar
                    added={stats.added}
                    deleted={stats.deleted}
                    binary={diff.binary}
                    isNewFile={diff.added}
                    isDeletedFile={diff.deleted}
                  />
                ),
              },
            }
          : undefined
      }
    >
      {loading ? (
        <Section>
          <HStack spacing={10} alignment="center">
            <ProgressView />
            <Text font="callout" foregroundStyle={COLOR_SECONDARY_LABEL}>
              计算差异中…
            </Text>
          </HStack>
        </Section>
      ) : error ? (
        <Section>
          <Text font="callout" foregroundStyle={COLOR_SECONDARY_LABEL}>
            加载失败：{error}
          </Text>
        </Section>
      ) : diff ? (
        <Section>
          <DiffViewer diff={diff} />
        </Section>
      ) : null}
    </List>
  )
}
