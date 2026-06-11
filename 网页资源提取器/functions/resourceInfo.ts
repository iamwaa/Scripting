import { CATEGORY_ORDER, type ResourceItem } from "../types/resource"
import { resources, selectedCategory, hideThumbnails } from "../state/appState"

// 分类统计
export function getCategoryStats(): { type: string; icon: string; label: string; count: number }[] {
  const counts: Record<string, number> = {}
  resources.value.forEach((r: ResourceItem) => {
    counts[r.type] = (counts[r.type] || 0) + 1
  })
  return CATEGORY_ORDER.map(type => {
    const info = getTypeInfo(type)
    return { type, ...info, count: counts[type] || 0 }
  }).filter(item => item.count > 0)
}

// 过滤后的资源列表
export function getFilteredResources(): ResourceItem[] {
  let list = resources.value
  if (hideThumbnails.value) {
    list = list.filter((r: ResourceItem) => !r.likelyThumbnail)
  }
  if (selectedCategory.value === "all") return list
  return list.filter((r: ResourceItem) => r.type === selectedCategory.value)
}

// 类型图标与标签
export function getTypeInfo(type: string): { icon: string; label: string; color: any } {
  switch (type) {
    case "image": return { icon: "photo", label: "图片", color: "#007AFF" }
    case "video": return { icon: "film", label: "视频", color: "#AF52DE" }
    case "audio": return { icon: "waveform", label: "音频", color: "#FF9500" }
    case "document": return { icon: "doc.text", label: "文档", color: "#34C759" }
    case "archive": return { icon: "doc.zipper", label: "压缩包", color: "#A2845E" }
    case "css": return { icon: "paintbrush", label: "样式", color: "#FF2D55" }
    case "js": return { icon: "chevron.left.forwardslash.chevron.right", label: "脚本", color: "#FFD60A" }
    case "font": return { icon: "textformat", label: "字体", color: "#5AC8FA" }
    default: return { icon: "paperclip", label: "其他", color: "#8E8E93" }
  }
}
