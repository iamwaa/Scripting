import { fetch } from "scripting"
import {
  detectDirectResourceType,
  getResourceFileName,
  parseHtmlResources,
  TYPE_LABELS,
} from "./resourceParsing"
import {
  mergeResourceLists,
  parseRuntimeSnapshotResources,
  readRuntimeSnapshot,
} from "./resourceRuntime"
import { validateResources } from "./resourceValidator"
import { extractURLFromText } from "../utils/url"
import { parseSiteResources } from "../services/parsers"
import {
  pageURL,
  isLoading,
  statusText,
  resources,
  pageTitle,
  selectedCategory,
  filterInvalidResources,
  hideThumbnails,
  showToast,
} from "../state/appState"

export async function extractResources() {
  const input = pageURL.value.trim()
  if (!input) {
    showToast("请输入有效的网址")
    return
  }

  const url = extractURLFromText(input)
  if (!url) {
    showToast("未找到有效的链接")
    return
  }
  pageURL.setValue(url)

  const targetURL = url
  isLoading.setValue(true)
  statusText.setValue("正在获取页面内容...")
  resources.setValue([])
  pageTitle.setValue("")
  selectedCategory.setValue("all")

  try {
    const directType = detectDirectResourceType(targetURL)
    if (directType) {
      const fileName = getResourceFileName(targetURL)
      const directItem = { type: directType, url: targetURL, name: fileName }

      if (filterInvalidResources.value) {
        statusText.setValue("正在验证直接资源有效性...")
        const validDirect = await validateResources([directItem], targetURL)
        if (validDirect.length === 0) {
          const message = "该直接资源链接无效或不是可预览的真实资源"
          resources.setValue([])
          pageTitle.setValue(fileName)
          statusText.setValue(message)
          showToast(message)
          return
        }
      }

      resources.setValue([directItem])
      pageTitle.setValue(fileName)
      const message = `已识别为直接${TYPE_LABELS[directType]}链接`
      statusText.setValue(message)
      showToast(message)
      return
    }

    let response = await fetch(targetURL)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    let pageTargetURL = response.url || targetURL
    let html = await response.text()

    statusText.setValue("正在解析资源...")

    let titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    pageTitle.setValue(titleMatch ? titleMatch[1].trim() : pageTargetURL)

    statusText.setValue("正在解析站点资源...")
    let siteResult = await parseSiteResources({ url: pageTargetURL, html })
    const nextPageURL = siteResult.pageUrl
    if (nextPageURL && nextPageURL.split("#")[0] !== pageTargetURL.split("#")[0]) {
      statusText.setValue("正在获取作品页面...")
      response = await fetch(nextPageURL)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      pageTargetURL = response.url || nextPageURL
      pageURL.setValue(pageTargetURL)
      html = await response.text()
      titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
      pageTitle.setValue(titleMatch ? titleMatch[1].trim() : pageTargetURL)
      statusText.setValue("正在解析作品资源...")
      siteResult = await parseSiteResources({ url: pageTargetURL, html })
    }
    if (siteResult.title) pageTitle.setValue(siteResult.title)

    statusText.setValue("正在解析通用资源...")
    const htmlResults = parseHtmlResources(html, pageTargetURL, (message) => statusText.setValue(message))

    statusText.setValue("正在读取 Safari 运行时快照...")
    const runtimeSnapshot = await readRuntimeSnapshot(pageTargetURL)
    const runtimeResults = runtimeSnapshot
      ? parseRuntimeSnapshotResources(runtimeSnapshot, pageTargetURL)
      : []

    const results = mergeResourceLists(siteResult.resources, runtimeResults, htmlResults)
    if (runtimeSnapshot?.title && (!pageTitle.value || pageTitle.value === pageTargetURL)) {
      pageTitle.setValue(runtimeSnapshot.title)
    }

    if (filterInvalidResources.value && results.length > 0) {
      statusText.setValue(`正在验证资源有效性 (0/${results.length})...`)
      const validResults = await validateResources(results, pageTargetURL, (completed, total) => {
        statusText.setValue(`正在验证有效性 (${completed}/${total})...`)
      })

      resources.setValue(validResults)
      const finalCount = validResults.length
      const filterCount = results.length - finalCount
      const thumbCount = hideThumbnails.value ? validResults.filter(r => r.likelyThumbnail).length : 0
      let message: string
      if (finalCount === 0) {
        message = "未发现有效的资源"
      } else if (filterCount > 0 && thumbCount > 0) {
        message = runtimeResults.length > 0
          ? `提取完成: ${finalCount - thumbCount} 个资源 (运行时捕获 ${runtimeResults.length} 个，过滤了 ${filterCount} 个失效项，隐藏了 ${thumbCount} 个疑似缩略图)`
          : `提取完成: ${finalCount - thumbCount} 个资源 (过滤了 ${filterCount} 个失效项，隐藏了 ${thumbCount} 个疑似缩略图)`
      } else if (filterCount > 0) {
        message = runtimeResults.length > 0
          ? `提取完成: ${finalCount} 个有效资源 (运行时捕获 ${runtimeResults.length} 个，过滤了 ${filterCount} 个失效项)`
          : `提取完成: ${finalCount} 个有效资源 (过滤了 ${filterCount} 个失效项)`
      } else if (thumbCount > 0) {
        message = runtimeResults.length > 0
          ? `提取完成，共发现 ${finalCount - thumbCount} 个资源 (运行时捕获 ${runtimeResults.length} 个，隐藏了 ${thumbCount} 个疑似缩略图)`
          : `提取完成，共发现 ${finalCount - thumbCount} 个资源 (隐藏了 ${thumbCount} 个疑似缩略图)`
      } else {
        message = runtimeResults.length > 0
          ? `提取完成，共发现 ${finalCount} 个资源 (运行时捕获 ${runtimeResults.length} 个)`
          : `提取完成，共发现 ${finalCount} 个资源`
      }

      statusText.setValue(message)
      showToast(message)
      return
    }

    resources.setValue(results)
    const count = results.length
    const thumbCount = hideThumbnails.value ? results.filter(r => r.likelyThumbnail).length : 0
    const displayedCount = count - thumbCount
    const message = count > 0
      ? thumbCount > 0
        ? runtimeResults.length > 0
          ? `提取完成，共发现 ${displayedCount} 个资源 (运行时捕获 ${runtimeResults.length} 个，隐藏了 ${thumbCount} 个疑似缩略图)`
          : `提取完成，共发现 ${displayedCount} 个资源 (隐藏了 ${thumbCount} 个疑似缩略图)`
        : runtimeResults.length > 0
          ? `提取完成，共发现 ${count} 个资源 (运行时捕获 ${runtimeResults.length} 个)`
          : `提取完成，共发现 ${count} 个资源`
      : "未发现可提取的资源"
    statusText.setValue(message)
    showToast(message)
  } catch (error: any) {
    const message = `提取失败: ${error.message || "未知错误"}`
    statusText.setValue(message)
    showToast(message)
  } finally {
    isLoading.setValue(false)
  }
}
