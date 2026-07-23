/**
 * components/HistorySearchBar.tsx - 历史搜索框
 *
 * 标题始终保留；点击右侧搜索图标后，搜索框向左展开到标题边缘并自动聚焦。
 * 点击关闭后搜索框立即隐藏，不播放收回动画。
 * 显式搜索由键盘 return 提交（submitLabel=search，回车键显示「搜索」）；
 * 清空 ✕ 即重置筛选、恢复默认分页。
 * 仅填充底色、无描边，随系统外观自动适配明暗。
 */

import {
  Button,
  HStack,
  Image,
  Spacer,
  Text,
  TextField,
  useState,
} from "scripting"
import { COLOR_SECONDARY_LABEL } from "../constants/colors"

export function HistorySearchBar({
  searching,
  onSearch,
}: {
  /** 搜索进行中：禁用清空按钮，避免搜索中途被重置 */
  searching: boolean
  /** 显式搜索；传空串表示清除筛选、恢复默认分页 */
  onSearch: (query: string) => void
}) {
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState(false)

  function expand() {
    withAnimation(Animation.easeOut(0.1), () => setExpanded(true))
  }

  function collapse() {
    setQuery("")
    onSearch("")
    setExpanded(false)
  }

  function submit() {
    onSearch(query)
  }

  function clear() {
    setQuery("")
    onSearch("")
  }

  return (
    <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
      <Text>提交历史</Text>
      <Spacer />
      {expanded ? (
        <HStack
          alignment="center"
          spacing={6}
          padding={{ horizontal: 8 }}
          frame={{ maxWidth: "infinity", minHeight: 36 }}
          background={{
            light: "rgba(118, 118, 128, 0.16)",
            dark: "rgba(118, 118, 128, 0.28)",
          }}
          clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" }}
          transition={Transition.move("trailing").combined(Transition.opacity())}
        >
          <Image
            systemName="magnifyingglass"
            font={15}
            foregroundStyle={COLOR_SECONDARY_LABEL}
          />
          <TextField
            title="提交信息、作者或 OID"
            font={16}
            value={query}
            onChanged={setQuery}
            onSubmit={submit}
            submitLabel="search"
            autofocus
            frame={{ maxWidth: "infinity" }}
          />
          {query.length > 0 ? (
            <Button buttonStyle="plain" action={clear} disabled={searching}>
              <Image
                systemName="xmark.circle.fill"
                font={14}
                foregroundStyle={COLOR_SECONDARY_LABEL}
              />
            </Button>
          ) : null}
        </HStack>
      ) : (
        <Button buttonStyle="plain" action={expand}>
          <Image
            systemName="magnifyingglass"
            font={16}
            foregroundStyle={COLOR_SECONDARY_LABEL}
          />
        </Button>
      )}
      {expanded ? (
        <Button buttonStyle="plain" action={collapse} disabled={searching}>
          <Image
            systemName="xmark"
            font={15}
            foregroundStyle={COLOR_SECONDARY_LABEL}
          />
        </Button>
      ) : null}
    </HStack>
  )
}
