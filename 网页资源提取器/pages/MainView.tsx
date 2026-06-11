import {
  Navigation,
  NavigationStack,
  List,
  Section,
  Text,
  Button,
  TextField,
  HStack,
  VStack,
  Image,
  ProgressView,
  ScrollView,
  Toggle,
  useEffect,
} from "scripting"
import type { ResourceItem } from "../types/resource"
import {
  pageURL,
  isLoading,
  statusText,
  resources,
  pageTitle,
  selectedCategory,
  toastMessage,
  toastVisible,
  filterInvalidResources,
  hideThumbnails,
  isFiltering,
  filterProgress,
  showToast,
  initialViewMode,
} from "../state/appState"
import { extractResources } from "../functions/resourceExtractor"
import { getCategoryStats, getFilteredResources } from "../functions/resourceInfo"
import { validateResources } from "../functions/resourceValidator"
import { ResourceItemRow } from "../components/ResourceItemRow"
import { DownloadManagerView } from "./DownloadManagerView"
import { hasDownloadManagerContent, getActiveDownloadCount } from "../state/downloadManager"

export function MainView() {
  const dismiss = Navigation.useDismiss()
  const filtered = getFilteredResources()
  const categoryStats = getCategoryStats()
  const listTitle = pageTitle.value || "资源列表"
  const hasResources = resources.value.length > 0
  const hasDownloads = hasDownloadManagerContent()
  const activeDownloadCount = getActiveDownloadCount()

  function openDownloadManager() {
    initialViewMode.setValue("main")
    Navigation.present(<DownloadManagerView />)
  }

  useEffect(() => {
    if (initialViewMode.value !== "downloads") return
    initialViewMode.setValue("main")
    setTimeout(openDownloadManager, 100)
  }, [])

  function resetToConfig() {
    resources.setValue([])
    pageTitle.setValue("")
    selectedCategory.setValue("all")
    statusText.setValue("输入网址后点击「提取资源」")
    isLoading.setValue(false)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="网页资源提取器"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: (
            <Button action={hasResources ? resetToConfig : dismiss}>
            <Image
            systemName={hasResources ? "chevron.left" : "xmark"}
            foregroundStyle={hasResources ? "#007AFF" : "red"}
            fontWeight="semibold" />
            </Button>
          ),
          primaryAction: hasDownloads ? (
            <Button action={openDownloadManager}>
              <HStack spacing={4}>
                <Image
                  systemName={activeDownloadCount > 0 ? "arrow.down.circle.fill" : "arrow.down.circle"}
                  foregroundStyle="#007AFF"
                  fontWeight="semibold"
                />
                {activeDownloadCount > 0 ? (
                  <Text font="subheadline" fontWeight="semibold">{activeDownloadCount}</Text>
                ) : null}
              </HStack>
            </Button>
          ) : undefined,
        }}
        toast={{
          message: toastMessage.value,
          position: "top",
          isPresented: toastVisible,
          duration: 2
        }}
      >
        {!hasResources ? (
        <Section title="目标网址">
          <HStack>
            <TextField
              title="URL"
              value={pageURL}
              prompt="输入网页地址..."
            />
            {pageURL.value ? (
              <Button
                buttonStyle="plain"
                action={() => pageURL.setValue("")}
              >
                <Image systemName="xmark.circle.fill" foregroundStyle="tertiaryLabel" />
              </Button>
            ) : null}
          </HStack>
          <Button
            action={() => {
              Keyboard.hide()
              extractResources().catch(err => {
                const message = `提取失败: ${err.message || "未知错误"}`
                statusText.setValue(message)
                showToast(message)
                isLoading.setValue(false)
              })
            }}
            disabled={isLoading.value}
          >
            {isLoading.value ? (
              <HStack spacing={8} padding={{ vertical: 2 }}>
                <ProgressView />
                <Text font="subheadline" lineLimit={1}>
                  {statusText.value}
                </Text>
              </HStack>
            ) : (
              <HStack spacing={6}>
                <Image systemName="magnifyingglass" />
                <Text>提取资源</Text>
              </HStack>
            )}
          </Button>
        </Section>
        ) : null}

        {hasResources ? (
          <Section title="显示选项">
            <Toggle
              title="过滤失效资源"
              value={filterInvalidResources.value}
              disabled={isFiltering.value || isLoading.value}
              onChanged={async (v: boolean) => {
                filterInvalidResources.setValue(v)
                if (v && resources.value.length > 0) {
                  // 执行过滤操作
                  isFiltering.setValue(true)
                  filterProgress.setValue({ completed: 0, total: resources.value.length })
                  try {
                    const referer = pageURL.value
                    const validResults = await validateResources(resources.value, referer, (completed, total) => {
                      filterProgress.setValue({ completed, total })
                    })
                    const filterCount = resources.value.length - validResults.length
                    resources.setValue(validResults)
                    if (filterCount > 0) {
                      showToast(`已过滤 ${filterCount} 个失效资源`)
                    } else {
                      showToast("所有资源均有效")
                    }
                  } catch (err: any) {
                    showToast(`过滤失败: ${err.message}`)
                    filterInvalidResources.setValue(false)
                  } finally {
                    isFiltering.setValue(false)
                    filterProgress.setValue({ completed: 0, total: 0 })
                  }
                } else if (!v && resources.value.length > 0) {
                  try {
                    await extractResources()
                  } catch (err: any) {
                    const message = `重新提取失败: ${err.message || "未知错误"}`
                    statusText.setValue(message)
                    showToast(message)
                    isLoading.setValue(false)
                  }
                }
              }}
            />
            {isFiltering.value ? (
              <HStack spacing={8} padding={{ vertical: 2 }}>
                <ProgressView />
                <Text font="subheadline" lineLimit={1} foregroundStyle="secondaryLabel">
                  正在过滤失效资源 ({filterProgress.value.completed}/{filterProgress.value.total})
                </Text>
              </HStack>
            ) : null}
            <Toggle
              title="隐藏疑似图标/缩略图"
              value={hideThumbnails.value}
              disabled={isFiltering.value}
              onChanged={(v: boolean) => {
                hideThumbnails.setValue(v)
                if (v) {
                  const count = resources.value.filter((r: ResourceItem) => r.likelyThumbnail).length
                  if (count > 0) {
                    showToast(`已隐藏 ${count} 个疑似图标/缩略图`)
                  } else {
                    showToast("当前没有疑似缩略图的资源")
                  }
                }
              }}
            />
          </Section>
        ) : null}

        {resources.value.length === 0 && !isLoading.value ? (
          <Section title="高级配置">
            <Toggle
              title="过滤失效资源"
              value={filterInvalidResources.value}
              onChanged={(v: boolean) => filterInvalidResources.setValue(v)}
            />
            {filterInvalidResources.value ? (
              <Text font="caption" foregroundStyle="secondaryLabel">
                开启后将对提取到的资源进行存活性检测，耗时会稍微增加。
              </Text>
            ) : null}
            <Toggle
              title="隐藏疑似图标/缩略图"
              value={hideThumbnails.value}
              onChanged={(v: boolean) => hideThumbnails.setValue(v)}
            />
            {hideThumbnails.value ? (
              <Text font="caption" foregroundStyle="secondaryLabel">
                开启后将根据 URL 模式自动隐藏小图标和缩略图资源。
              </Text>
            ) : null}
          </Section>
        ) : null}

        {resources.value.length === 0 && !isLoading.value ? (
          <Section title="使用说明">
            <VStack alignment="leading" spacing={6}>
              <Text font="caption" foregroundStyle="secondaryLabel">
                1. 输入网页地址后点击「提取资源」
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                2. 若先在 Safari 中打开过同一页面，会合并运行时捕获到的图片和视频
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                3. 使用资源列表顶部的分组栏筛选类型
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                4. 点击资源可查看详情、复制链接或保存资源
              </Text>
            </VStack>
          </Section>
        ) : null}

        {resources.value.length > 0 ? (
          <Section title={listTitle}>
            <ScrollView axes="horizontal" scrollIndicator="never">
              <HStack spacing={4} padding={{ vertical: 2 }}>
                <Button
                  action={() => selectedCategory.setValue("all")}
                  buttonStyle={selectedCategory.value === "all" ? "borderedProminent" : "bordered"}
                  controlSize="small"
                  clipShape={{ type: 'capsule', style: 'circular' }}
                >
                  <Text font="caption2">全部 ({resources.value.length})</Text>
                </Button>
                {categoryStats.map(cat => (
                  <Button
                    key={cat.type}
                    action={() => selectedCategory.setValue(cat.type)}
                    buttonStyle={selectedCategory.value === cat.type ? "borderedProminent" : "bordered"}
                    controlSize="small"
                    clipShape={{ type: 'capsule', style: 'circular' }}
                  >
                    <Text font="caption2">{cat.label} ({cat.count})</Text>
                  </Button>
                ))}
              </HStack>
            </ScrollView>

            {filtered.length > 0 ? (
              filtered.map((item: ResourceItem, index: number) => (
                <ResourceItemRow key={`${item.type}-${index}`} item={item} />
              ))
            ) : (
              <Text foregroundStyle="secondaryLabel" font="caption" padding={10}>
                当前分类没有资源。
              </Text>
            )}
          </Section>
        ) : null}

      </List>
    </NavigationStack>
  )
}
