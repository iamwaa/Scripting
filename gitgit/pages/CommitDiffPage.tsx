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
import { ImageViewer } from "../components/ImageViewer"
import { getCommitFileDiff } from "../services/diffService"
import type { FileDiff } from "../services/diffService"
import { truncatePath } from "../utils/format"
import { COLOR_SECONDARY_LABEL } from "../constants/colors"

export function CommitDiffPage({
  bookmarkName,
  oid,
  parentOid,
  filepath,
}: {
  bookmarkName: string
  oid: string
  parentOid: string | null
  filepath: string
}) {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 图片预览全屏查看（data URL）
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // 随提交/路径变化重载，避免导航复用时仍显示上一次 diff
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setDiff(null)
    setError(null)
    getCommitFileDiff(bookmarkName, oid, parentOid, filepath)
      .then((next) => {
        if (!cancelled) setDiff(next)
      })
      .catch((e: any) => {
        if (!cancelled) setError(String(e?.message || e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [bookmarkName, oid, parentOid, filepath])

  let added = 0
  let deleted = 0
  for (const line of diff?.lines || []) {
    if (line.type === "add") added++
    if (line.type === "del") deleted++
  }

  return (
    <List
      navigationTitle={truncatePath(filepath, 36)}
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      listStyle="plain"
      fullScreenCover={{
        isPresented: previewUrl != null,
        onChanged: (isPresented) => {
          if (!isPresented) setPreviewUrl(null)
        },
        content: previewUrl ? (
          <ImageViewer
            key={previewUrl}
            url={previewUrl}
            onClose={() => setPreviewUrl(null)}
          />
        ) : <></>,
      }}
      safeAreaInset={
        diff
          ? {
              top: {
                spacing: 0,
                content: (
                  <DiffStatsBar
                    added={added}
                    deleted={deleted}
                    binary={diff.binary}
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
            <Text foregroundStyle={COLOR_SECONDARY_LABEL}>计算差异中…</Text>
          </HStack>
        </Section>
      ) : error ? (
        <Section>
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载失败：{error}</Text>
        </Section>
      ) : diff ? (
        <Section>
          <DiffViewer diff={diff} onOpenImage={setPreviewUrl} />
        </Section>
      ) : null}
    </List>
  )
}
