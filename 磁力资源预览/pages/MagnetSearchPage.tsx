// 磁力搜索页：关键词搜索 xcili 资源，支持取磁力与查看文件列表

import {
  Button,
  HStack,
  Image,
  LazyVStack,
  Navigation,
  NavigationStack,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  TextField,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting";

import { fetchXciliDetail, fetchXciliMagnet, searchXcili } from "../api/xcili";
import { CompactInputCard } from "../components/common";
import { GlassButtonContent, glassSurface, plainSurface } from "../components/glass";
import { SearchResultRow } from "../components/SearchResultRow";
import { BLUE, SEARCH_PAGE_SIZE } from "../constants";
import { useToast } from "../hooks/useToast";
import type { XciliSearchItem } from "../types";
import { XciliDetailPage } from "./XciliDetailPage";

export function MagnetSearchPage({
  onSelectMagnet,
  initialKeyword = "",
  onDismissAfterSelect,
}: {
  onSelectMagnet: (magnet: string) => void;
  initialKeyword?: string;
  /** 关闭本页后继续关闭上层（如以图搜片） */
  onDismissAfterSelect?: () => void;
}) {
  const dismiss = Navigation.useDismiss();
  const { notify, toastProps } = useToast();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [items, setItems] = useState<XciliSearchItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(SEARCH_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [loadingMagnetUrl, setLoadingMagnetUrl] = useState("");
  const [loadingDetailUrl, setLoadingDetailUrl] = useState("");
  const [searchBoxExpanded, setSearchBoxExpanded] = useState(true);
  const [autoSearched, setAutoSearched] = useState(false);

  const handleSearch = async () => {
    Keyboard.hide();
    const q = keyword.trim();
    if (!q) return notify("请输入搜索关键词");
    setLoading(true);
    setSearchBoxExpanded(false);
    try {
      const results = await searchXcili(q);
      setItems(results);
      setVisibleCount(SEARCH_PAGE_SIZE);
      if (!results.length) await notify("没有搜索到相关资源");
    } catch (error: any) {
      await notify(error?.message ?? String(error), "搜索失败");
    } finally {
      setLoading(false);
    }
  };

  const handleUseMagnet = async (item: XciliSearchItem) => {
    setLoadingMagnetUrl(item.detailUrl);
    try {
      const magnet = await fetchXciliMagnet(item.detailUrl);
      onSelectMagnet(magnet);
      await Pasteboard.setString(magnet);
      await notify("已填入预览页，并复制到剪贴板");
      dismiss();
      // 从以图搜片进入时需再关一层，避免停在以图搜片页
      onDismissAfterSelect?.();
    } catch (error: any) {
      await notify(error?.message ?? String(error), "获取失败");
    } finally {
      setLoadingMagnetUrl("");
    }
  };

  const handleShowDetail = async (item: XciliSearchItem) => {
    setLoadingDetailUrl(item.detailUrl);
    try {
      const detail = await fetchXciliDetail(item.detailUrl);
      await Navigation.present({
        element: (
          <NavigationStack>
            <XciliDetailPage detail={detail} />
          </NavigationStack>
        ),
      });
    } catch (error: any) {
      await notify(error?.message ?? String(error), "提取失败");
    } finally {
      setLoadingDetailUrl("");
    }
  };

  useEffect(() => {
    setItems([]);
  }, []);

  // 带初始关键词进入时自动搜索一次
  useEffect(() => {
    if (autoSearched) return;
    const q = initialKeyword.trim();
    if (!q) return;
    setAutoSearched(true);
    void handleSearch();
  }, [autoSearched, initialKeyword]);

  const visibleItems = items.slice(0, visibleCount);
  const hasMoreItems = visibleCount < items.length;
  const loadMoreItems = () => {
    setVisibleCount((count) => Math.min(items.length, count + SEARCH_PAGE_SIZE));
  };

  return (
    <ScrollView navigationTitle="磁力搜索" navigationBarTitleDisplayMode="inline" toast={toastProps}>
      <VStack alignment="leading" spacing={16} padding={18} frame={{ maxWidth: "infinity" }}>
        <VStack
          alignment="leading"
          spacing={14}
          padding={searchBoxExpanded ? 18 : 0}
          frame={{ maxWidth: "infinity" }}
          {...(searchBoxExpanded ? glassSurface(28, "card") : plainSurface)}
        >
          {searchBoxExpanded ? (
            <>
              <HStack spacing={8}>
                <Image systemName="magnifyingglass" frame={{ width: 18, height: 18 }} foregroundStyle={BLUE} />
                <Text font={15} fontWeight="semibold" foregroundStyle="secondaryLabel">磁力搜索</Text>
              </HStack>
              <TextField
                title=""
                prompt="输入电影、剧集或资源关键词"
                value={keyword}
                onChanged={setKeyword}
                padding={14}
                {...glassSurface(18, "input")}
              />
              <Button action={handleSearch} buttonStyle="plain">
                <GlassButtonContent systemName="magnifyingglass" title={loading ? "搜索中…" : "搜索资源"} prominent />
              </Button>
            </>
          ) : (
            <CompactInputCard
              icon="magnifyingglass"
              title="磁力搜索"
              value={keyword.trim()}
              placeholder="点击展开搜索框"
              action={() => setSearchBoxExpanded(true)}
              centerValue
            />
          )}
        </VStack>

        {loading ? (
          <VStack spacing={14} padding={32} frame={{ maxWidth: "infinity", minHeight: 540 }} {...glassSurface(28, "card", false)}>
            <ProgressView />
            <Text foregroundStyle="secondaryLabel">正在搜索磁力资源…</Text>
          </VStack>
        ) : items.length > 0 ? (
          <LazyVStack alignment="leading" spacing={12}>
            <HStack padding={{ horizontal: 4 }} frame={{ maxWidth: "infinity" }}>
              <Text font={20} fontWeight="bold">搜索结果</Text>
              <Spacer />
              <Text font={13} foregroundStyle="secondaryLabel">已显示 {visibleItems.length} / {items.length} 条</Text>
            </HStack>
            {visibleItems.map((item) => (
              <SearchResultRow
                key={item.id}
                item={item}
                loading={loadingMagnetUrl === item.detailUrl}
                loadingDetail={loadingDetailUrl === item.detailUrl}
                onUseMagnet={() => void handleUseMagnet(item)}
                onShowDetail={() => void handleShowDetail(item)}
              />
            ))}
            {hasMoreItems ? (
              <Button action={loadMoreItems} buttonStyle="plain">
                <HStack
                  spacing={8}
                  padding={{ vertical: 14, horizontal: 16 }}
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  {...glassSurface(20, "card")}
                  onAppear={loadMoreItems}
                >
                  <Image systemName="arrow.down.circle" frame={{ width: 18, height: 18 }} foregroundStyle={BLUE} />
                  <Text font={15} fontWeight="semibold" foregroundStyle={BLUE}>继续加载更多</Text>
                </HStack>
              </Button>
            ) : undefined}
          </LazyVStack>
        ) : (
          <VStack spacing={14} padding={32} frame={{ maxWidth: "infinity", minHeight: 540 }} {...glassSurface(28, "card")}>
            <ZStack frame={{ width: 66, height: 66 }} {...glassSurface(24, "icon", false, false)}>
              <Image systemName="magnifyingglass.circle" resizable frame={{ width: 38, height: 38 }} foregroundStyle={BLUE} />
            </ZStack>
            <Text font={20} fontWeight="bold">搜索磁力资源</Text>
            <Text foregroundStyle="secondaryLabel" multilineTextAlignment="center">
              输入电影、剧集或资源名称后点击「搜索资源」，从 xcili.net 查找可用磁力。
            </Text>
          </VStack>
        )}
      </VStack>
    </ScrollView>
  );
}
