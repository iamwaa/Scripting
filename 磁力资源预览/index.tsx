declare const fetch: any;
declare const Dialog: { actionSheet: (options: { title: string; message?: string; cancelButton?: boolean; actions: { label: string; destructive?: boolean }[] }) => Promise<number | null> };

import {
  Script,
  Navigation,
  NavigationStack,
  ScrollView,
  LazyVStack,
  VStack,
  HStack,
  ZStack,
  Text,
  TextField,
  Button,
  Image,
  RoundedRectangle,
  ProgressView,
  Spacer,
  Link,
  NavigationLink,
  MagnifyGesture,
  TabView,
  Toolbar,
  ToolbarItem,
  useEffect,
  useObservable,
  useState,
} from "scripting";

type WhatsLinkScreenshot = {
  time?: number;
  screenshot: string;
};

type WhatsLinkResponse = {
  error?: string;
  type?: string;
  file_type?: string;
  name?: string;
  size?: number;
  count?: number;
  screenshots?: WhatsLinkScreenshot[];
};

type FavoriteItem = {
  id: string;
  url: string;
  name: string;
  size: number;
  count: number;
  type: string;
  fileType: string;
  cover?: string;
  createdAt: number;
};

type XciliSearchItem = {
  id: string;
  title: string;
  sample: string;
  size: string;
  detailUrl: string;
};

type XciliDetailFile = {
  name: string;
  size: string;
};

type XciliDetailInfo = {
  title: string;
  magnet: string;
  files: XciliDetailFile[];
};

const API_ENDPOINT = "https://whatslink.info/api/v1/link";
const XCILI_BASE = "https://xcili.net";
const FAVORITES_KEY = "magnet-preview-favorites-v1";
const BLUE = "#0A84FF";
const GLASS_TINT = "rgba(255,255,255,0.18)";
const GLASS_STROKE = { light: "rgba(255,255,255,0.58)", dark: "rgba(255,255,255,0.16)" };
const GLASS_FILL = { light: "rgba(255,255,255,0.36)", dark: "rgba(44,44,46,0.52)" };
const INPUT_GLASS_FILL = { light: "rgba(255,255,255,0.28)", dark: "rgba(28,28,30,0.50)" };
const SEARCH_PAGE_SIZE = 20;

function loadFavorites(): FavoriteItem[] {
  return Storage.get<FavoriteItem[]>(FAVORITES_KEY) ?? [];
}

function persistFavorites(items: FavoriteItem[]) {
  Storage.set(FAVORITES_KEY, items);
}

function normalizeInput(input: string) {
  return input.trim().replace(/^\s+|\s+$/g, "");
}

function extractSupportedLink(input: string) {
  const text = normalizeInput(input);
  if (!text) return "";

  const magnet = text.match(/magnet:\?[^\s\u4e00-\u9fff，。；、！？）)】\]]+/i)?.[0];
  if (magnet) return magnet;

  const ed2k = text.match(/ed2k:\/\/[^\s\u4e00-\u9fff，。；、！？）)】\]]+/i)?.[0];
  if (ed2k) return ed2k;

  const http = text.match(/https?:\/\/[^\s\u4e00-\u9fff，。；、！？）)】\]]+/i)?.[0];
  if (http) return http;

  return text;
}

function isSupportedLink(input: string) {
  const text = extractSupportedLink(input).toLowerCase();
  return text.startsWith("magnet:?") || text.startsWith("ed2k://") || text.startsWith("http://") || text.startsWith("https://");
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "未知";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 2)} ${units[index]}`;
}

function shortLink(url: string) {
  if (url.length <= 72) return url;
  return `${url.slice(0, 44)}…${url.slice(-24)}`;
}

function displayFileType(result?: WhatsLinkResponse | null) {
  if (!result) return "-";
  return (result.file_type || result.type || "unknown").toUpperCase();
}

function getCover(result?: WhatsLinkResponse | null, index = 0) {
  const shots = result?.screenshots ?? [];
  return shots[index]?.screenshot || shots[0]?.screenshot || "";
}

async function queryWhatsLink(url: string): Promise<WhatsLinkResponse> {
  const res = await fetch(`${API_ENDPOINT}?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`接口请求失败：HTTP ${res.status}`);
  const json = (await res.json()) as WhatsLinkResponse;
  if (json.error) throw new Error(json.error);
  return json;
}

function decodeHtml(input: string) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(input: string) {
  return decodeHtml(input.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function absoluteXciliUrl(href: string) {
  if (/^https?:\/\//i.test(href)) return href;
  return `${XCILI_BASE}${href.startsWith("/") ? href : `/${href}`}`;
}

function parseXciliSearchResults(html: string): XciliSearchItem[] {
  const rows = [...html.matchAll(/<tr>[\s\S]*?<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class=["'][^"']*td-size[^"']*["'][^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi)];
  return rows.map((match, index) => {
    const body = match[2] ?? "";
    const sampleMatch = body.match(/<p[^>]*class=["'][^"']*sample[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    const titleHtml = sampleMatch ? body.replace(sampleMatch[0], "") : body;
    const detailUrl = absoluteXciliUrl(match[1] ?? "");
    return {
      id: `${index}-${detailUrl}`,
      title: stripHtml(titleHtml) || "未命名资源",
      sample: stripHtml(sampleMatch?.[1] ?? ""),
      size: stripHtml(match[3] ?? "未知"),
      detailUrl,
    };
  });
}

async function searchXcili(keyword: string): Promise<XciliSearchItem[]> {
  const q = keyword.trim();
  if (!q) return [];
  const res = await fetch(`${XCILI_BASE}/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`搜索失败：HTTP ${res.status}`);
  return parseXciliSearchResults(await res.text());
}

function extractPureMagnetLink(input: string) {
  const text = decodeHtml(input).trim();
  const candidates = [text];
  try {
    candidates.push(decodeURIComponent(text));
  } catch {
    // Ignore malformed percent-encoding.
  }

  for (const candidate of candidates) {
    const btih = candidate.match(/magnet:\?xt=urn:btih:[0-9A-Za-z]{32,40}/i)?.[0] ?? "";
    if (btih) return btih;
  }
  return "";
}

async function fetchXciliMagnet(detailUrl: string) {
  const detail = await fetchXciliDetail(detailUrl);
  if (!detail.magnet) throw new Error("详情页未找到磁力链接");
  return detail.magnet;
}

function parseXciliDetail(html: string): XciliDetailInfo {
  const title = stripHtml(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "资源详情") || "资源详情";
  const magnet = extractPureMagnetLink(html);
  const fileSection = html.split(/<h4[^>]*>\s*相关资源\s*:/i)[0] ?? html;
  const files = [...fileSection.matchAll(/<tr>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi)]
    .map((match) => ({ name: stripHtml(match[1] ?? ""), size: stripHtml(match[2] ?? "") }))
    .filter((file) => file.name && file.size);
  return { title, magnet, files };
}

async function fetchXciliDetail(detailUrl: string): Promise<XciliDetailInfo> {
  const res = await fetch(detailUrl);
  if (!res.ok) throw new Error(`获取详情失败：HTTP ${res.status}`);
  return parseXciliDetail(await res.text());
}

function BackButton({ action }: { action: () => void }) {
  return (
    <Button action={action} buttonStyle="plain">
      <Image systemName="chevron.left" fontWeight="semibold" foregroundStyle="#007AFF" />
    </Button>
  );
}

function CloseButton({ action }: { action: () => void }) {
  return (
    <Button action={action} buttonStyle="plain">
      <Image systemName="xmark" foregroundStyle="#FF3B30" fontWeight="semibold" />
    </Button>
  );
}

type GlassVariant = "card" | "input" | "control" | "prominent" | "icon";

function glassFillFor(variant: GlassVariant = "card") {
  if (variant === "input") return INPUT_GLASS_FILL;
  if (variant === "prominent") return "rgba(10,132,255,0.68)";
  if (variant === "icon") return { light: "rgba(10,132,255,0.10)", dark: "rgba(10,132,255,0.18)" };
  return GLASS_FILL;
}

function glassTintFor(variant: GlassVariant = "card") {
  if (variant === "prominent" || variant === "icon") return "rgba(110,198,255,0.32)";
  return GLASS_TINT;
}

function glassShadowFor(variant: GlassVariant = "card") {
  if (variant === "prominent") return { color: "rgba(10,132,255,0.24)", radius: 12, x: 0, y: 6 };
  if (variant === "input") return { color: "rgba(30,88,160,0.08)", radius: 8, x: 0, y: 4 };
  if (variant === "control") return { color: "rgba(30,88,160,0.10)", radius: 12, x: 0, y: 6 };
  return { color: "rgba(30,88,160,0.10)", radius: 14, x: 0, y: 7 };
}

function glassEffectFor(cornerRadius: number, variant: GlassVariant = "card", interactive = true) {
  const glass = interactive ? UIGlass.clear().interactive().tint(glassTintFor(variant)) : UIGlass.clear().interactive(false).tint(glassTintFor(variant));
  return { glass, shape: { type: "rect", cornerRadius } };
}

function glassSurface(cornerRadius = 28, variant: GlassVariant = "card", interactive = true, withShadow = true): any {
  const props: any = {
    background: <GlassShape cornerRadius={cornerRadius} fill={glassFillFor(variant)} />,
    glassEffect: glassEffectFor(cornerRadius, variant, interactive),
  };
  if (withShadow) props.shadow = glassShadowFor(variant) as any;
  return props;
}

function GlassShape({ cornerRadius = 28, fill = GLASS_FILL }: { cornerRadius?: number; fill?: any }) {
  return <RoundedRectangle cornerRadius={cornerRadius} fill={fill as any} stroke={GLASS_STROKE as any} />;
}

function GlassButtonContent({ systemName, title, prominent = false }: { systemName: string; title: string; prominent?: boolean }) {
  return (
    <HStack
      spacing={8}
      frame={{ maxWidth: "infinity" }}
      padding={{ vertical: 13, horizontal: 14 }}
      {...glassSurface(18, prominent ? "prominent" : "control")}
    >
      <Image systemName={systemName} frame={{ width: 20, height: 20 }} foregroundStyle={prominent ? "white" : BLUE} />
      <Text font={16} fontWeight="semibold" foregroundStyle={prominent ? "white" : "label"}>{title}</Text>
    </HStack>
  );
}

function MetaLine({ label, value }: { label: string; value: string | number }) {
  return (
    <HStack spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text foregroundStyle="secondaryLabel" font={15}>{label}：</Text>
      <Text foregroundStyle="secondaryLabel" font={15} textSelection frame={{ maxWidth: "infinity", alignment: "leading" }}>{String(value)}</Text>
    </HStack>
  );
}

function BlueButton({ title, icon, action }: { title: string; icon: string; action: () => void }) {
  return (
    <Button action={action}>
      <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
        <Text font={22}>{icon}</Text>
        <Text font={18} fontWeight="semibold" foregroundStyle="white">{title}</Text>
      </HStack>
      <Spacer />
    </Button>
  );
}

function ScreenshotPager({ result, index, onChange }: { result: WhatsLinkResponse; index: number; onChange: (n: number) => void }) {
  const shots = result.screenshots ?? [];
  if (shots.length <= 1) return <VStack />;

  return (
    <HStack spacing={8} padding={{ top: 6 }}>
      <Button title="上一张" action={() => onChange(Math.max(0, index - 1))} />
      <Spacer />
      <Text foregroundStyle="secondaryLabel" font={13}>{index + 1} / {shots.length}</Text>
      <Spacer />
      <Button title="下一张" action={() => onChange(Math.min(shots.length - 1, index + 1))} />
    </HStack>
  );
}

function getPreviewHeight(width?: number, height?: number, exportMode = false) {
  if (exportMode) return 206;
  if (!width || !height) return 220;
  const estimatedWidth = 340;
  const ratio = height / width;
  return Math.round(Math.min(380, Math.max(150, estimatedWidth * ratio)));
}

async function loadPreviewHeight(imageUrl?: string, exportMode = false) {
  if (exportMode) return 206;
  if (!imageUrl) return getPreviewHeight(undefined, undefined, exportMode);
  try {
    const image = await UIImage.fromURL(imageUrl);
    return getPreviewHeight(image?.width, image?.height, exportMode);
  } catch {
    return getPreviewHeight(undefined, undefined, exportMode);
  }
}

function PreviewCard({
  result,
  url,
  screenshotSelection,
  onCopyUrl,
  onPreviewImage,
  initialImageHeight,
  exportMode = false,
}: {
  result: WhatsLinkResponse;
  url: string;
  screenshotSelection: Observable<number>;
  onCopyUrl?: () => void;
  onPreviewImage?: (index: number) => void;
  initialImageHeight?: number;
  exportMode?: boolean;
}) {
  const shots = result.screenshots ?? [];
  const screenshotIndex = Math.min(Math.max(screenshotSelection.value, 0), Math.max(0, shots.length - 1));
  const cover = getCover(result, screenshotIndex);
  const title = result.name || "未知资源";
  const titleFont = title.length > 90 ? 17 : title.length > 56 ? 19 : title.length > 32 ? 21 : 23;
  const [imageHeight, setImageHeight] = useState(() => initialImageHeight ?? getPreviewHeight(undefined, undefined, exportMode));

  useEffect(() => {
    if (exportMode) {
      setImageHeight(206);
      return;
    }
    if (!cover) {
      setImageHeight(getPreviewHeight(undefined, undefined, exportMode));
      return;
    }

    let cancelled = false;
    loadPreviewHeight(cover, exportMode).then((height) => {
      if (!cancelled) setImageHeight(height);
    });

    return () => {
      cancelled = true;
    };
  }, [cover, exportMode]);

  return (
    <VStack
      alignment="leading"
      spacing={16}
      padding={exportMode ? 18 : 18}
      frame={exportMode ? { width: 370 } : { maxWidth: "infinity" }}
      {...glassSurface(30, "card")}
    >
      {cover ? (
        <ZStack alignment="topTrailing" frame={{ maxWidth: "infinity" }}>
          {exportMode || shots.length <= 1 ? (
            <ZStack
              frame={{ maxWidth: "infinity", height: imageHeight }}
              background={<GlassShape cornerRadius={20} />}
              onTapGesture={() => onPreviewImage?.(screenshotIndex)}
            >
              <Image
                imageUrl={cover}
                resizable
                scaleToFit
                frame={{ maxWidth: "infinity", height: imageHeight }}
                clipShape={{ type: "rect", cornerRadius: 20 }}
                placeholder={
                  <ZStack frame={{ maxWidth: "infinity", height: imageHeight }} background={<GlassShape cornerRadius={20} />}>
                    <ProgressView />
                  </ZStack>
                }
              />
            </ZStack>
          ) : (
            <TabView
              selection={screenshotSelection}
              tabViewStyle="pageAutomaticDisplayIndex"
              indexViewStyle="pageBackgroundInteractiveDisplay"
              frame={{ maxWidth: "infinity", height: imageHeight }}
            >
              {shots.map((shot, idx) => (
                <ZStack
                  tag={idx}
                  key={`${idx}-${shot.screenshot}`}
                  frame={{ maxWidth: "infinity", height: imageHeight }}
                  background={<GlassShape cornerRadius={20} />}
                  onTapGesture={() => onPreviewImage?.(idx)}
                >
                  <Image
                    imageUrl={shot.screenshot}
                    resizable
                    scaleToFit
                    frame={{ maxWidth: "infinity", height: imageHeight }}
                    clipShape={{ type: "rect", cornerRadius: 20 }}
                    placeholder={
                      <ZStack frame={{ maxWidth: "infinity", height: imageHeight }} background={<GlassShape cornerRadius={20} />}>
                        <ProgressView />
                      </ZStack>
                    }
                  />
                </ZStack>
              ))}
            </TabView>
          )}
        </ZStack>
      ) : (
        <HStack frame={{ maxWidth: "infinity", height: imageHeight }}>
          <Spacer />
          <VStack spacing={8} frame={{ alignment: "center" }}>
            <Image systemName="doc.text.magnifyingglass" resizable frame={{ width:38, height: 44 }} foregroundStyle={BLUE} />
            <Text foregroundStyle="secondaryLabel">暂无预览图</Text>
          </VStack>
          <Spacer />
        </HStack>
      )}

      <Text
        font={titleFont}
        fontWeight="bold"
        allowsTightening
        fixedSize={{ horizontal: false, vertical: true }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        textSelection
      >
        {title}
      </Text>

      <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
        <MetaLine label="大小" value={formatBytes(result.size)} />
        <MetaLine label="文件数量" value={result.count ?? 0} />
        <MetaLine label="文件类型" value={displayFileType(result)} />
      </VStack>

      <Button action={() => onCopyUrl?.()} buttonStyle="plain">
        <Text
          textSelection
          font={14}
          padding={14}
          fixedSize={{ horizontal: false, vertical: true }}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          {...glassSurface(18, "input")}
        >
          {url}
        </Text>
      </Button>

      {exportMode ? (
        <Text foregroundStyle="secondaryLabel" font={12} frame={{ maxWidth: "infinity", alignment: "center" }}>
          File information by whatslink.info
        </Text>
      ) : null}
    </VStack>
  );
}

function ImagePreviewPage({ screenshots, initialIndex }: { screenshots: WhatsLinkScreenshot[]; initialIndex: number }) {
  const dismiss = Navigation.useDismiss();
  const previewSelection = useObservable(Math.min(Math.max(initialIndex, 0), Math.max(0, screenshots.length - 1)));
  const [baseScale, setBaseScale] = useState(1);
  const [pinchScale, setPinchScale] = useState(1);
  const [scaleAnchor, setScaleAnchor] = useState<any>("center");
  const imageScale = Math.min(4, Math.max(1, baseScale * pinchScale));

  useEffect(() => {
    const resetScale = () => {
      setBaseScale(1);
      setPinchScale(1);
      setScaleAnchor("center");
    };
    previewSelection.subscribe(resetScale);
    return () => previewSelection.unsubscribe(resetScale);
  }, []);

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="black"
      ignoresSafeArea
      onTapGesture={dismiss}
    >
      <TabView
        selection={previewSelection}
        tabViewStyle="pageAutomaticDisplayIndex"
        indexViewStyle="pageBackgroundInteractiveDisplay"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        padding={{ bottom: 28 }}
      >
        {screenshots.map((shot, idx) => (
          <ZStack
            tag={idx}
            key={`fullscreen-${idx}-${shot.screenshot}`}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            background="black"
            onTapGesture={dismiss}
          >
            <Image
              imageUrl={shot.screenshot}
              resizable
              scaleToFit
              scaleEffect={idx === previewSelection.value ? { x: imageScale, y: imageScale, anchor: scaleAnchor } : 1}
              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
              onTapGesture={dismiss}
              gesture={
                MagnifyGesture()
                  .onChanged((value) => {
                    setScaleAnchor(value.startAnchor);
                    setPinchScale(value.magnification);
                  })
                  .onEnded((value) => {
                    const nextScale = Math.min(4, Math.max(1, baseScale * value.magnification));
                    setBaseScale(nextScale);
                    setPinchScale(1);
                    if (nextScale <= 1) {
                      setScaleAnchor("center");
                    }
                  })
              }
              placeholder={
                <VStack spacing={12} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
                  <ProgressView />
                  <Text foregroundStyle="secondaryLabel">正在加载图片…</Text>
                </VStack>
              }
            />
          </ZStack>
        ))}
      </TabView>
    </ZStack>
  );
}

function EmptyState() {
  return (
    <VStack
      spacing={14}
      padding={32}
      frame={{ maxWidth: "infinity", minHeight: 410 }}
      {...glassSurface(28, "card")}
    >
      <ZStack
        frame={{ width: 66, height: 66 }}
        {...glassSurface(24, "icon", false, false)}
      >
        <Image systemName="link.badge.plus" resizable frame={{ width: 34, height: 34 }} foregroundStyle={BLUE} />
      </ZStack>
      <Text font={20} fontWeight="bold">粘贴磁力 / ED2K / 下载链接</Text>
      <Text foregroundStyle="secondaryLabel" multilineTextAlignment="center">
        输入链接后点击「查询预览」，获取资源名称、大小、类型和截图信息。
      </Text>
    </VStack>
  );
}

function XciliDetailPage({ detail }: { detail: XciliDetailInfo }) {
  const dismiss = Navigation.useDismiss();
  const files = detail.files.slice(0, 30);
  const [toastMessage, setToastMessage] = useState("");
  const toastPresented = useObservable(false);

  const notify = async (message: string, title = "提示") => {
    setToastMessage(title === "提示" ? message : `${title}：${message}`);
    toastPresented.setValue(false);
    setTimeout(() => toastPresented.setValue(true), 10);
  };

  const handleCopyMagnet = async () => {
    if (!detail.magnet) return;
    await Pasteboard.setString(detail.magnet);
    await notify("磁力链接已复制到剪贴板");
  };

  return (
    <ScrollView
      navigationTitle="文件列表"
      navigationBarTitleDisplayMode="inline"
      navigationBarBackButtonHidden
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarLeading">
            <BackButton action={dismiss} />
          </ToolbarItem>
        </Toolbar>
      }
      toast={{
        message: toastMessage,
        isPresented: toastPresented,
        position: "top",
        duration: 2,
        cornerRadius: 16,
        shadowRadius: 8,
      }}
    >
      <VStack alignment="leading" spacing={16} padding={18} frame={{ maxWidth: "infinity" }}>
        <VStack
          alignment="leading"
          spacing={14}
          padding={18}
          frame={{ maxWidth: "infinity" }}
          {...glassSurface(28, "card")}
        >
          <HStack spacing={8}>
            <Image systemName="doc.text.magnifyingglass" frame={{ width: 18, height: 18 }} foregroundStyle={BLUE} />
            <Text font={15} fontWeight="semibold" foregroundStyle="secondaryLabel">磁力信息</Text>
          </HStack>
          <Text font={20} fontWeight="bold" fixedSize={{ horizontal: false, vertical: true }} textSelection>{detail.title}</Text>
          {detail.magnet ? (
            <Button action={() => void handleCopyMagnet()} buttonStyle="plain">
              <Text
                textSelection
                font={14}
                padding={14}
                fixedSize={{ horizontal: false, vertical: true }}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
                {...glassSurface(18, "input")}
              >
                {detail.magnet}
              </Text>
            </Button>
          ) : <MetaLine label="磁力" value="未找到" />}
        </VStack>

        <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity" }}>
          <HStack padding={{ horizontal: 4 }}>
            <Text font={20} fontWeight="bold">文件列表</Text>
            <Spacer />
            <Text font={13} foregroundStyle="secondaryLabel">{detail.files.length} 个</Text>
          </HStack>
          {files.length > 0 ? files.map((file, index) => (
            <VStack
              key={`${index}-${file.name}`}
              alignment="leading"
              spacing={6}
              padding={14}
              frame={{ maxWidth: "infinity" }}
              {...glassSurface(20, "card")}
            >
              <Text font={14} fontWeight="semibold" fixedSize={{ horizontal: false, vertical: true }} textSelection>{file.name}</Text>
              <Text font={13} foregroundStyle="secondaryLabel">{file.size}</Text>
            </VStack>
          )) : (
            <VStack
              spacing={10}
              padding={24}
              frame={{ maxWidth: "infinity" }}
              {...glassSurface(20, "card")}
            >
              <Text foregroundStyle="secondaryLabel">未提取到文件列表</Text>
            </VStack>
          )}
          {detail.files.length > files.length ? (
            <Text font={12} foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "center" }}>
              仅显示前 {files.length} 个文件
            </Text>
          ) : undefined}
        </VStack>
      </VStack>
    </ScrollView>
  );
}

function SmallResultButton({ title, action }: { title: string; action: () => void }) {
  return (
    <Button action={action} buttonStyle="plain">
      <Text
        font={13}
        fontWeight="semibold"
        padding={{ vertical: 7, horizontal: 10 }}
        {...glassSurface(14, "control", true, false)}
      >
        {title}
      </Text>
    </Button>
  );
}

function CompactInputCard({ icon, title, value, placeholder, action, centerValue = false }: { icon: string; title: string; value: string; placeholder: string; action: () => void; centerValue?: boolean }) {
  return (
    <Button action={action} buttonStyle="plain">
      <HStack
        spacing={10}
        padding={{ vertical: 12, horizontal: 14 }}
        frame={{ maxWidth: "infinity" }}
        {...glassSurface(20, "control")}
      >
        <Image systemName={icon} frame={{ width: 18, height: 18 }} foregroundStyle={BLUE} />
        <VStack alignment={centerValue ? "center" : "leading"} spacing={2} frame={{ maxWidth: "infinity" }}>
          <Text font={13} fontWeight="semibold" foregroundStyle="secondaryLabel">{title}</Text>
          <Text
            font={15}
            lineLimit={1}
            truncationMode="middle"
            foregroundStyle={value ? "label" : "secondaryLabel"}
            frame={centerValue ? { maxWidth: "infinity", alignment: "center" } : undefined}
          >
            {value || placeholder}
          </Text>
        </VStack>
        <Image systemName="chevron.down" frame={{ width: 13, height: 13 }} foregroundStyle={BLUE} fontWeight="semibold" />
      </HStack>
    </Button>
  );
}

function SearchResultRow({ item, loading, loadingDetail, onUseMagnet, onShowDetail }: { item: XciliSearchItem; loading: boolean; loadingDetail: boolean; onUseMagnet: () => void; onShowDetail: () => void }) {
  return (
    <VStack
      alignment="leading"
      spacing={10}
      padding={14}
      frame={{ maxWidth: "infinity" }}
      {...glassSurface(22, "card")}
    >
      <Text font={16} fontWeight="semibold" fixedSize={{ horizontal: false, vertical: true }} textSelection>{item.title}</Text>
      {item.sample ? <Text font={13} foregroundStyle="secondaryLabel" lineLimit={2} textSelection>{item.sample}</Text> : undefined}
      <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
        <Text font={13} foregroundStyle="secondaryLabel">{item.size}</Text>
        <Spacer />
        <SmallResultButton title={loadingDetail ? "加载中…" : "文件列表"} action={onShowDetail} />
        <SmallResultButton title={loading ? "获取中…" : "使用磁力"} action={onUseMagnet} />
      </HStack>
    </VStack>
  );
}

function MagnetSearchPage({ onSelectMagnet }: { onSelectMagnet: (magnet: string) => void }) {
  const dismiss = Navigation.useDismiss();
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<XciliSearchItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(SEARCH_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [loadingMagnetUrl, setLoadingMagnetUrl] = useState("");
  const [loadingDetailUrl, setLoadingDetailUrl] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [searchBoxExpanded, setSearchBoxExpanded] = useState(true);
  const toastPresented = useObservable(false);

  const notify = async (message: string, title = "提示") => {
    setToastMessage(title === "提示" ? message : `${title}：${message}`);
    toastPresented.setValue(false);
    setTimeout(() => toastPresented.setValue(true), 10);
  };

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

  const visibleItems = items.slice(0, visibleCount);
  const hasMoreItems = visibleCount < items.length;
  const loadMoreItems = () => {
    setVisibleCount((count) => Math.min(items.length, count + SEARCH_PAGE_SIZE));
  };

  return (
    <ScrollView
      navigationTitle="磁力搜索"
      navigationBarTitleDisplayMode="inline"
      navigationBarBackButtonHidden
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarLeading">
            <BackButton action={dismiss} />
          </ToolbarItem>
        </Toolbar>
      }
      toast={{
        message: toastMessage,
        isPresented: toastPresented,
        position: "top",
        duration: 2,
        cornerRadius: 16,
        shadowRadius: 8,
      }}
    >
      <VStack alignment="leading" spacing={16} padding={18} frame={{ maxWidth: "infinity" }}>
        <VStack
          alignment="leading"
          spacing={14}
          padding={searchBoxExpanded ? 18 : 0}
          frame={{ maxWidth: "infinity" }}
          {...(searchBoxExpanded ? glassSurface(28, "card") : { background: undefined, glassEffect: undefined, shadow: undefined })}
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
          <VStack
            spacing={14}
            padding={32}
            frame={{ maxWidth: "infinity", minHeight: 480 }}
            {...glassSurface(28, "card", false)}
          >
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
          <VStack
            spacing={14}
            padding={32}
            frame={{ maxWidth: "infinity", minHeight: 480 }}
            {...glassSurface(28, "card")}
          >
            <ZStack
              frame={{ width: 66, height: 66 }}
              {...glassSurface(24, "icon", false, false)}
            >
              <Image systemName="magnifyingglass.circle" resizable frame={{ width: 38, height: 38 }} foregroundStyle={BLUE} />
            </ZStack>
            <Text font={20} fontWeight="bold">搜索磁力资源</Text>
            <Text foregroundStyle="secondaryLabel" multilineTextAlignment="center">
              输入电影、剧集或资源名称后点击「搜索资源」，从 xcili.net 查找可用磁力。
            </Text>
          </VStack>
        )}

        <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "center" }}>
          <Text font={12} foregroundStyle="secondaryLabel" multilineTextAlignment="center" frame={{ maxWidth: "infinity", alignment: "center" }}>
            Search information by xcili.net
          </Text>
          <Link url="https://xcili.net/">
            <Text font={12} foregroundStyle={BLUE}>查看接口与服务说明</Text>
          </Link>
        </VStack>
      </VStack>
    </ScrollView>
  );
}

function FavoriteRow({ item, onOpen, onDelete }: { item: FavoriteItem; onOpen: () => void; onDelete: () => void }) {
  return (
    <HStack
      spacing={12}
      padding={12}
      {...glassSurface(20, "card")}
    >
      {item.cover ? (
        <Image imageUrl={item.cover} resizable frame={{ width: 68, height: 50 }} clipShape={{ type: "rect", cornerRadius: 14 }} />
      ) : (
        <ZStack frame={{ width: 68, height: 50 }} background={<GlassShape cornerRadius={14} fill={INPUT_GLASS_FILL} />}>
          <Image systemName="doc" foregroundStyle="secondaryLabel" />
        </ZStack>
      )}
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
        <Text font={14} fontWeight="semibold" lineLimit={1} truncationMode="middle">{item.name}</Text>
        <Text font={12} foregroundStyle="secondaryLabel">{formatBytes(item.size)} · {item.count} 个文件 · {item.fileType.toUpperCase()}</Text>
      </VStack>
      <Button title="打开" action={onOpen} buttonStyle="glass" />
      <Button title="删除" role="destructive" action={onDelete} buttonStyle="glass" foregroundStyle="red"/>
    </HStack>
  );
}

function MainApp() {
  const dismiss = Navigation.useDismiss();
  const [input, setInput] = useState("");
  const [result, setResult] = useState<WhatsLinkResponse | null>(null);
  const [queriedUrl, setQueriedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState("");
  const [previewImageHeight, setPreviewImageHeight] = useState(() => getPreviewHeight());
  const [toastMessage, setToastMessage] = useState("");
  const toastPresented = useObservable(false);
  const screenshotSelection = useObservable(0);
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => loadFavorites());
  const [inputBoxExpanded, setInputBoxExpanded] = useState(true);

  useEffect(() => {
    Pasteboard.getString().then((text) => {
      const pasted = extractSupportedLink(text ?? "");
      if (pasted && isSupportedLink(pasted)) setInput(pasted);
    });
  }, []);

  const currentUrl = queriedUrl || extractSupportedLink(input);
  const isFav = favorites.some((item) => item.url === currentUrl);

  const notify = async (message: string, title = "提示") => {
    setToastMessage(title === "提示" ? message : `${title}：${message}`);
    toastPresented.setValue(false);
    setTimeout(() => toastPresented.setValue(true), 10);
  };

  const handlePaste = async () => {
    const text = extractSupportedLink((await Pasteboard.getString()) ?? "");
    if (!text) return notify("剪贴板没有文本内容");
    setInput(text);
  };

  const runQuery = async (rawInput: string) => {
    Keyboard.hide();
    const url = extractSupportedLink(rawInput);
    if (!url) return notify("请先输入链接");
    if (!isSupportedLink(url)) return notify("未识别到 magnet:?、ed2k://、http:// 或 https:// 开头的链接");
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

  return (
    <NavigationStack>
      <ScrollView
        navigationTitle="磁力资源预览"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ cancellationAction: <CloseButton action={dismiss} /> }}
      >
        <ZStack
          frame={{ maxWidth: "infinity" }}
          toast={{
            message: toastMessage,
            isPresented: toastPresented,
            position: "top",
            duration: 2,
            cornerRadius: 16,
            shadowRadius: 8,
          }}
        >
          <VStack alignment="leading" spacing={20} padding={18} frame={{ maxWidth: "infinity" }}>
            <VStack
              alignment="leading"
              spacing={14}
              padding={inputBoxExpanded ? 18 : 0}
              frame={{ maxWidth: "infinity" }}
              {...(inputBoxExpanded ? glassSurface(28, "card") : { background: undefined, glassEffect: undefined, shadow: undefined })}
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
                  <NavigationLink destination={<MagnetSearchPage onSelectMagnet={(magnet) => { setInput(magnet); setInputBoxExpanded(false); void runQuery(magnet); }} />}>
                    <HStack
                      spacing={8}
                      padding={{ vertical: 12, horizontal: 14 }}
                      frame={{ maxWidth: "infinity" }}
                      {...glassSurface(18, "control")}
                    >
                      <Image systemName="magnifyingglass.circle" frame={{ width: 20, height: 20 }} foregroundStyle={BLUE} />
                      <Text font={16} fontWeight="semibold">去 xcili.net 搜索磁力资源</Text>
                      <Spacer />
                      <Image systemName="chevron.right" frame={{ width: 12, height: 12 }} foregroundStyle="secondaryLabel" />
                    </HStack>
                  </NavigationLink>
                </>
              ) : (
                <CompactInputCard
                  icon="link"
                  title="资源链接"
                  value={currentUrl || extractSupportedLink(input)}
                  placeholder="点击展开输入框"
                  action={() => setInputBoxExpanded(true)}
                />
              )}
            </VStack>

            {loading ? (
              <VStack
                spacing={14}
                padding={32}
                frame={{ maxWidth: "infinity", minHeight: 410 }}
                {...glassSurface(28, "card", false)}
              >
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
                      <GlassButtonContent systemName="arrow.down.circle" title={savingImage ? `下载中 ${downloadProgress}` : "保存预览图"} prominent />
                    </Button>
                  </HStack>
                ) : undefined}
              </VStack>
            ) : (
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

            <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
              <Text foregroundStyle="secondaryLabel" font={13}>Magnet information by whatslink.info</Text>
              <Link url="https://whatslink.info/">
                <Text foregroundStyle={BLUE} font={13}>查看接口与服务说明</Text>
              </Link>
            </VStack>
          </VStack>
        </ZStack>
      </ScrollView>
    </NavigationStack>
  );
}

async function run() {
  await Navigation.present({ element: <MainApp />, modalPresentationStyle: "fullScreen" });
  Script.exit();
}

run();
