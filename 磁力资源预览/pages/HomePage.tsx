// 主页面：磁力链接输入、预览结果、收藏列表与二级入口

import {
  Button,
  HStack,
  Image,
  Navigation,
  NavigationLink,
  NavigationStack,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  TextField,
  VStack,
  ZStack,
  fetch,
  useEffect,
  useObservable,
  useState,
} from "scripting";

import { queryWhatsLink } from "../api/whatsLink";
import { CloseButton, CompactInputCard } from "../components/common";
import { EmptyState } from "../components/EmptyState";
import { FavoriteRow } from "../components/FavoriteRow";
import { GlassButtonContent, glassSurface, plainSurface } from "../components/glass";
import { PreviewCard } from "../components/PreviewCard";
import { BLUE } from "../constants";
import { useToast } from "../hooks/useToast";
import { loadFavorites, persistFavorites } from "../services/favorites";
import type { FavoriteItem, WhatsLinkResponse } from "../types";
import { getCover, getPreviewHeight, loadPreviewHeight } from "../utils/format";
import { extractMagnetLink, isMagnetLink } from "../utils/magnet";
import { AboutPage } from "./AboutPage";
import { ImagePreviewPage } from "./ImagePreviewPage";
import { ImageSearchPage } from "./ImageSearchPage";
import { MagnetSearchPage } from "./MagnetSearchPage";

declare const Dialog: {
  actionSheet: (options: {
    title: string;
    message?: string;
    cancelButton?: boolean;
    actions: { label: string; destructive?: boolean }[];
  }) => Promise<number | null>;
};

export function HomePage() {
  const dismiss = Navigation.useDismiss();
  const { notify, toastProps } = useToast();
  const [input, setInput] = useState("");
  const [result, setResult] = useState<WhatsLinkResponse | null>(null);
  const [queriedUrl, setQueriedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState("");
  const [previewImageHeight, setPreviewImageHeight] = useState(() => getPreviewHeight());
  const screenshotSelection = useObservable(0);
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => loadFavorites());
  const [inputBoxExpanded, setInputBoxExpanded] = useState(true);

  // 进入页面时自动读取剪贴板中的磁力链接
  useEffect(() => {
    Pasteboard.getString().then((text) => {
      const pasted = extractMagnetLink(text ?? "");
      if (pasted && isMagnetLink(pasted)) setInput(pasted);
    });
  }, []);

  const currentUrl = queriedUrl || extractMagnetLink(input);
  const isFav = favorites.some((item) => item.url === currentUrl);

  const runQuery = async (rawInput: string) => {
    Keyboard.hide();
    const url = extractMagnetLink(rawInput);
    if (!url) return notify("请先输入链接");
    if (!isMagnetLink(url)) return notify("未识别到 magnet:? 开头的磁力链接");
    if (url !== input) setInput(url);

    setLoading(true);
    setInputBoxExpanded(false);
    setResult(null);
    setPreviewImageHeight(getPreviewHeight());
    screenshotSelection.setValue(0);
    try {
      const data = await queryWhatsLink(url);
      const firstImageHeight = await loadPreviewHeight(getCover(data, 0));
      setPreviewImageHeight(firstImageHeight);
      setResult(data);
      setQueriedUrl(url);
    } catch (error: any) {
      await notify(error?.message ?? String(error), "查询失败");
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async () => {
    await runQuery(input);
  };

  const handleCopy = async () => {
    const url = currentUrl;
    if (!url) return;
    await Pasteboard.setString(url);
    await notify("链接已复制到剪贴板");
  };

  const handleFavorite = async () => {
    if (!result || !currentUrl) return;
    const exists = favorites.some((item) => item.url === currentUrl);
    const next = exists
      ? favorites.filter((item) => item.url !== currentUrl)
      : [
          {
            id: `${Date.now()}`,
            url: currentUrl,
            name: result.name || "未知资源",
            size: result.size ?? 0,
            count: result.count ?? 0,
            type: result.type || "unknown",
            fileType: result.file_type || "unknown",
            cover: getCover(result, screenshotSelection.value),
            createdAt: Date.now(),
          },
          ...favorites,
        ];
    setFavorites(next);
    persistFavorites(next);
    await notify(exists ? "已取消收藏" : "已收藏");
  };

  const handleDownloadAllScreenshots = async () => {
    const shots = result?.screenshots ?? [];
    if (!shots.length) return notify("当前资源没有可下载的预览图");

    setSavingImage(true);
    let savedCount = 0;
    try {
      for (let i = 0; i < shots.length; i += 1) {
        setDownloadProgress(`${i + 1}/${shots.length}`);
        const imageUrl = shots[i]?.screenshot;
        if (!imageUrl) continue;
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`第 ${i + 1} 张预览图下载失败：HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        const data = Data.fromArrayBuffer(buffer);
        if (!data) throw new Error(`第 ${i + 1} 张预览图数据无效`);
        const ok = await Photos.savePhoto(data, { fileName: `magnet-preview-${Date.now()}-${i + 1}.jpg` });
        if (!ok) throw new Error(`第 ${i + 1} 张预览图保存失败或权限被拒绝`);
        savedCount += 1;
      }
      await notify(`已保存 ${savedCount} 张预览图到相册`, "下载完成");
    } catch (error: any) {
      await notify(error?.message ?? String(error), "下载失败");
    } finally {
      setSavingImage(false);
      setDownloadProgress("");
    }
  };

  const handlePreviewImage = async (index: number) => {
    const screenshots = result?.screenshots ?? [];
    if (!screenshots.length) return;
    await Navigation.present({
      element: <ImagePreviewPage screenshots={screenshots} initialIndex={index} />,
      modalPresentationStyle: "overFullScreen",
    });
  };

  const handleOpenFavorite = async (item: FavoriteItem) => {
    setInput(item.url);
    setLoading(true);
    setInputBoxExpanded(false);
    setPreviewImageHeight(getPreviewHeight());
    screenshotSelection.setValue(0);
    try {
      const data = await queryWhatsLink(item.url);
      const firstImageHeight = await loadPreviewHeight(getCover(data, 0));
      setPreviewImageHeight(firstImageHeight);
      setResult(data);
      setQueriedUrl(item.url);
    } catch (error: any) {
      await notify(error?.message ?? String(error), "查询失败");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFavorite = async (id: string) => {
    const item = favorites.find((f) => f.id === id);
    const index = await Dialog.actionSheet({
      title: `确定要删除收藏「${item?.name ?? "未知资源"}」吗？`,
      cancelButton: true,
      actions: [{ label: "删除", destructive: true }],
    });
    if (index !== 0) return;
    const next = favorites.filter((f) => f.id !== id);
    setFavorites(next);
    persistFavorites(next);
    await notify("已删除收藏");
  };

  // 搜索页选中磁力后回填并立即查询
  const applySelectedMagnet = (magnet: string) => {
    setInput(magnet);
    setInputBoxExpanded(false);
    void runQuery(magnet);
  };

  return (
    <NavigationStack>
      <ScrollView
        navigationTitle="磁力资源预览"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <CloseButton action={dismiss} />,
          topBarTrailing: (
            <NavigationLink destination={<AboutPage />}>
              <Image systemName="info.circle" frame={{ width: 22, height: 22 }} foregroundStyle={BLUE} />
            </NavigationLink>
          ),
        }}
      >
        <ZStack frame={{ maxWidth: "infinity" }} toast={toastProps}>
          <VStack alignment="leading" spacing={20} padding={18} frame={{ maxWidth: "infinity" }}>
            <VStack
              alignment="leading"
              spacing={14}
              padding={inputBoxExpanded ? 18 : 0}
              frame={{ maxWidth: "infinity" }}
              {...(inputBoxExpanded ? glassSurface(28, "card") : plainSurface)}
            >
              {inputBoxExpanded ? (
                <>
                  <HStack spacing={8}>
                    <Image systemName="link" frame={{ width: 18, height: 18 }} foregroundStyle={BLUE} />
                    <Text font={15} fontWeight="semibold" foregroundStyle="secondaryLabel">资源链接</Text>
                  </HStack>
                  <TextField
                    title=""
                    prompt="magnet:?xt=urn:btih:..."
                    axis="vertical"
                    value={input}
                    onChanged={setInput}
                    padding={14}
                    {...glassSurface(18, "input")}
                  />
                  <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "center" }}>
                    <Button action={handleQuery} buttonStyle="plain">
                      <GlassButtonContent systemName="magnifyingglass" title={loading ? "查询中…" : "查询预览"} prominent />
                    </Button>
                  </HStack>
                  <NavigationLink destination={<MagnetSearchPage onSelectMagnet={applySelectedMagnet} />}>
                    <HStack
                      spacing={8}
                      padding={{ vertical: 12, horizontal: 14 }}
                      frame={{ maxWidth: "infinity" }}
                      {...glassSurface(18, "control")}
                    >
                      <Image systemName="magnifyingglass.circle" frame={{ width: 20, height: 20 }} foregroundStyle={BLUE} />
                      <Text font={16} fontWeight="semibold">搜索磁力资源</Text>
                      <Spacer />
                      <Image systemName="chevron.right" frame={{ width: 12, height: 12 }} foregroundStyle="secondaryLabel" />
                    </HStack>
                  </NavigationLink>
                  <NavigationLink
                    destination={
                      <ImageSearchPage
                        renderMagnetSearch={(code, closeImageSearch) => (
                          <MagnetSearchPage
                            initialKeyword={code}
                            onSelectMagnet={applySelectedMagnet}
                            onDismissAfterSelect={closeImageSearch}
                          />
                        )}
                      />
                    }
                  >
                    <HStack
                      spacing={8}
                      padding={{ vertical: 12, horizontal: 14 }}
                      frame={{ maxWidth: "infinity" }}
                      {...glassSurface(18, "control")}
                    >
                      <Image systemName="viewfinder" frame={{ width: 20, height: 20 }} foregroundStyle={BLUE} />
                      <Text font={16} fontWeight="semibold">以图搜片</Text>
                      <Spacer />
                      <Image systemName="chevron.right" frame={{ width: 12, height: 12 }} foregroundStyle="secondaryLabel" />
                    </HStack>
                  </NavigationLink>
                </>
              ) : (
                <CompactInputCard
                  icon="link"
                  title="资源链接"
                  value={currentUrl || extractMagnetLink(input)}
                  placeholder="点击展开输入框"
                  action={() => setInputBoxExpanded(true)}
                />
              )}
            </VStack>

            {loading ? (
              <VStack spacing={14} padding={32} frame={{ maxWidth: "infinity", minHeight: 410 }} {...glassSurface(28, "card", false)}>
                <ProgressView />
                <Text foregroundStyle="secondaryLabel">正在解析资源信息…</Text>
              </VStack>
            ) : result ? (
              <VStack alignment="leading" spacing={14} frame={{ maxWidth: "infinity" }}>
                <PreviewCard
                  key={currentUrl}
                  result={result}
                  url={currentUrl}
                  screenshotSelection={screenshotSelection}
                  initialImageHeight={previewImageHeight}
                  onCopyUrl={() => void handleCopy()}
                  onPreviewImage={(index) => void handlePreviewImage(index)}
                />

                {(result.screenshots?.length ?? 0) > 0 ? (
                  <HStack spacing={14} frame={{ maxWidth: "infinity" }}>
                    <Button action={handleFavorite} buttonStyle="plain">
                      <GlassButtonContent systemName={isFav ? "star.fill" : "star"} title={isFav ? "已收藏" : "收藏"} />
                    </Button>
                    <Button action={handleDownloadAllScreenshots} buttonStyle="plain">
                      <GlassButtonContent
                        systemName="arrow.down.circle"
                        title={savingImage ? `下载中 ${downloadProgress}` : "保存预览图"}
                        prominent
                      />
                    </Button>
                  </HStack>
                ) : undefined}
              </VStack>
            ) : favorites.length > 0 ? undefined : (
              <EmptyState />
            )}

            {favorites.length > 0 ? (
              <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity" }}>
                <HStack padding={{ horizontal: 4 }}>
                  <Text font={20} fontWeight="bold">收藏</Text>
                  <Spacer />
                  <Text font={13} foregroundStyle="secondaryLabel">{favorites.length} 条</Text>
                </HStack>
                {favorites.map((item) => (
                  <FavoriteRow
                    key={item.id}
                    item={item}
                    onOpen={() => void handleOpenFavorite(item)}
                    onDelete={() => void handleDeleteFavorite(item.id)}
                  />
                ))}
              </VStack>
            ) : undefined}
          </VStack>
        </ZStack>
      </ScrollView>
    </NavigationStack>
  );
}
