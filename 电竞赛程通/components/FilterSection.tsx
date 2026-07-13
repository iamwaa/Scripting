import { DisclosureGroup, Text, Picker, VStack, Button, useObservable } from "scripting"
import {
  DEFAULT_FILTERS,
  FILTER_LABELS,
  FILTER_ORDER,
  extractCascadingOptions,
  normalizeFilters,
  updateCascadingFilters,
} from "../utils/filter"
import type { Match, MatchFilters, FilterKey } from "../types"

interface FilterSectionProps {
  optionSource: Match[]
  filters: MatchFilters
  onFiltersChange: (filters: MatchFilters) => void
}

function summarize(optionSource: Match[], filters: MatchFilters): string {
  const normalized = normalizeFilters(optionSource, filters)
  const parts: string[] = []

  for (const key of FILTER_ORDER) {
    const value = normalized[key]
    if (value === "all") continue
    const options = extractCascadingOptions(optionSource, normalized, key)
    const option = options.find((item) => item.value === value)
    parts.push(option?.label ?? FILTER_LABELS[key])
  }

  return parts.length > 0 ? parts.join(" · ") : "全部"
}

// 可折叠筛选面板,折叠时在标题下展示当前筛选摘要
export function FilterSection(props: FilterSectionProps) {
  const { optionSource, filters, onFiltersChange } = props
  const isExpanded = useObservable(false)
  const normalized = normalizeFilters(optionSource, filters)
  const summary = summarize(optionSource, filters)

  const renderFilterPicker = (key: FilterKey) => {
    const options = extractCascadingOptions(optionSource, normalized, key)
    const current = normalized[key]

    return (
      <Picker
        title={FILTER_LABELS[key]}
        value={current}
        onChanged={(value: string) => onFiltersChange(updateCascadingFilters(normalized, key, value))}
      >
        <Text tag="all">全部</Text>
        {options.map((option) => (
          <Text key={`${option.value}-${option.label}`} tag={option.value}>
            {option.label}
          </Text>
        ))}
      </Picker>
    )
  }

  const hasActiveFilter = FILTER_ORDER.some((key) => normalized[key] !== "all")

  return (
    <DisclosureGroup
      isExpanded={isExpanded}
      label={
        <VStack
          alignment="leading"
          spacing={2}
          frame={{ maxWidth: "infinity" }}
          overlay={
            hasActiveFilter
              ? {
                  alignment: "trailing",
                  content: (
                    <Button action={() => onFiltersChange({ ...DEFAULT_FILTERS })}>
                      <Text font="caption" foregroundStyle="red" fontWeight="medium">
                        清除
                      </Text>
                    </Button>
                  ),
                }
              : undefined
          }
        >
          <Text frame={{ maxWidth: "infinity", alignment: "leading" }}>赛事筛选</Text>
          {summary !== "全部" ? (
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              {summary}
            </Text>
          ) : null}
        </VStack>
      }
    >
      {FILTER_ORDER.map((key) => renderFilterPicker(key))}
    </DisclosureGroup>
  )
}