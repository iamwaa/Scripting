import {
  Button,
  HStack,
  Image,
  LazyVStack,
  Navigation,
  NavigationLink,
  ProgressView,
  RoundedRectangle,
  ScrollView,
  Spacer,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  ZStack,
  useObservable,
  useState,
} from "scripting";

import {
  loadWhosCookie,
  loginWhosAndCaptureCookie,
  saveWhosCookie,
  searchWhosByImage,
  WHOS_BASE,
  type WhosMatch,
} from "../api/whosTv";

const BLUE = "#0A84FF";
const SEARCH_PAGE_SIZE = 20;
const GLASS_TINT = "rgba(255,255,255,0.18)";
const GLASS_STROKE = { light: "rgba(255,255,255,0.58)", dark: "rgba(255,255,255,0.16)" };
const GLASS_FILL = { light: "rgba(255,255,255,0.36)", dark: "rgba(44,44,46,0.52)" };
const INPUT_GLASS_FILL = { light: "rgba(255,255,255,0.28)", dark: "rgba(28,28,30,0.50)" };

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
  const glass = interactive
    ? UIGlass.clear().interactive().tint(glassTintFor(variant))
    : UIGlass.clear().interactive(false).tint(glassTintFor(variant));
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

function GlassButtonContent({
  systemName,
  title,
  prominent = false,
}: {
  systemName: string;
  title: string;
  prominent?: boolean;
}) {
  return (
    <HStack
      spacing={8}
      frame={{ maxWidth: "infinity" }}
      padding={{ vertical: 13, horizontal: 14 }}
      {...glassSurface(18, prominent ? "prominent" : "control")}
    >
      <Image systemName={systemName} frame={{ width: 20, height: 20 }} foregroundStyle={prominent ? "white" : BLUE} />
      <Text font={16} fontWeight="semibold" foregroundStyle={prominent ? "white" : "label"}>
        {title}
      </Text>
    </HStack>
  );
}

function MatchRow({
  item,
  magnetDestination,
  onCopyCode,
  onOpenWeb,
}: {
  item: WhosMatch;
  magnetDestination: any;
  onCopyCode: () => void;
  onOpenWeb: () => void;
}) {
  return (
    <VStack alignment="leading" spacing={10} padding={14} frame={{ maxWidth: "infinity" }} {...glassSurface(22, "card")}>
      <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {item.cover ? (
          <Image
            imageUrl={item.cover}
            resizable
            frame={{ width: 92, height: 68 }}
            clipShape={{ type: "rect", cornerRadius: 14 }}
          />
        ) : (
          <ZStack frame={{ width: 92, height: 68 }} {...glassSurface(14, "icon", false, false)}>
            <Image systemName="photo" foregroundStyle="secondaryLabel" />
          </ZStack>
        )}
        <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
          <Text font={17} fontWeight="bold" textSelection>
            {item.code}
          </Text>
          <Text font={13} foregroundStyle="secondaryLabel" lineLimit={2} textSelection>
            {item.title}
          </Text>
          <HStack spacing={8}>
            {item.score ? (
              <Text font={12} foregroundStyle="secondaryLabel">
                相似 {item.score}
              </Text>
            ) : undefined}
            {item.time ? (
              <Text font={12} foregroundStyle="secondaryLabel">
                时间 {item.time}
              </Text>
            ) : undefined}
          </HStack>
        </VStack>
      </HStack>
      <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
        <Button action={onCopyCode} buttonStyle="plain">
          <Text font={13} fontWeight="semibold" padding={{ vertical: 7, horizontal: 10 }} {...glassSurface(14, "control", true, false)}>
            复制番号
          </Text>
        </Button>
        <Button action={onOpenWeb} buttonStyle="plain">
          <Text font={13} fontWeight="semibold" padding={{ vertical: 7, horizontal: 10 }} {...glassSurface(14, "control", true, false)}>
            打开网页
          </Text>
        </Button>
        <Spacer />
        <NavigationLink destination={magnetDestination}>
          <Text font={13} fontWeight="semibold" padding={{ vertical: 7, horizontal: 10 }} {...glassSurface(14, "prominent", true, false)} foregroundStyle="white">
            搜磁力
          </Text>
        </NavigationLink>
      </HStack>
    </VStack>
  );
}

export function ImageSearchPage({
  renderMagnetSearch,
}: {
  /** keyword + 关闭以图搜片页的回调，供使用磁力后一并返回主页 */
  renderMagnetSearch: (keyword: string, closeImageSearch: () => void) => any;
}) {
  const dismiss = Navigation.useDismiss();
  const [image, setImage] = useState<UIImage | null>(null);
  const [cookie, setCookie] = useState(() => loadWhosCookie());
  const [showLogin, setShowLogin] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<WhosMatch[]>([]);
  const [visibleCount, setVisibleCount] = useState(SEARCH_PAGE_SIZE);
  const [resultUrl, setResultUrl] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const toastPresented = useObservable(false);
  const hasCookie = Boolean(cookie.trim());
  const visibleMatches = matches.slice(0, visibleCount);
  const hasMoreMatches = visibleCount < matches.length;
  const loadMoreMatches = () => {
    setVisibleCount((count) => Math.min(matches.length, count + SEARCH_PAGE_SIZE));
  };

  const notify = async (message: string, title = "提示") => {
    setToastMessage(title === "提示" ? message : `${title}：${message}`);
    toastPresented.setValue(false);
    setTimeout(() => toastPresented.setValue(true), 10);
  };

  const handlePick = async () => {
    try {
      const results = await Photos.pick({
        filter: PHPickerFilter.images(),
        limit: 1,
        mode: "default",
      });
      const picked = await results[0]?.uiImage();
      if (!picked) return;
      setImage(picked);
      setMatches([]);
      setVisibleCount(SEARCH_PAGE_SIZE);
      setResultUrl("");
    } catch (error: any) {
      await notify(error?.message ?? String(error), "选图失败");
    }
  };

  const handleCapture = async () => {
    try {
      const captured = await Photos.takePhoto();
      if (!captured) return;
      setImage(captured);
      setMatches([]);
      setVisibleCount(SEARCH_PAGE_SIZE);
      setResultUrl("");
    } catch (error: any) {
      await notify(error?.message ?? String(error), "拍照失败");
    }
  };

  const handleLogin = async () => {
    setLoggingIn(true);
    try {
      const next = await loginWhosAndCaptureCookie(cookie);
      setCookie(next);
      if (next) {
        setShowLogin(false);
        await notify("已自动获取并保存登录状态");
      } else {
        await notify("未检测到登录 Cookie，请确认已在网页中完成登录后再关闭");
      }
    } catch (error: any) {
      await notify(error?.message ?? String(error), "登录失败");
    } finally {
      setLoggingIn(false);
    }
  };

  const handleClearLogin = async () => {
    setCookie("");
    saveWhosCookie("");
    await notify("已清除登录状态");
  };

  const handleSearch = async () => {
    if (!image) return notify("请先选择图片");
    setLoading(true);
    setMatches([]);
    setVisibleCount(SEARCH_PAGE_SIZE);
    try {
      const currentCookie = cookie.trim() || loadWhosCookie();
      if (currentCookie && currentCookie !== cookie) setCookie(currentCookie);
      const result = await searchWhosByImage(image, currentCookie);
      setResultUrl(result.resultUrl);
      setMatches(result.matches);
      setVisibleCount(SEARCH_PAGE_SIZE);
      if (!result.matches.length) {
        await notify("未解析到匹配结果，可打开网页查看");
      } else {
        await notify(`识别完成，共 ${result.matches.length} 条`);
      }
    } catch (error: any) {
      const message = error?.message ?? String(error);
      await notify(message, "搜片失败");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    await Pasteboard.setString(code);
    await notify(`已复制 ${code}`);
  };

  return (
    <ScrollView
      navigationTitle="以图搜片"
      navigationBarTitleDisplayMode="inline"
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarTrailing">
            <Button title="登录" fontWeight="semibold" action={() => setShowLogin((v) => !v)} />
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
        <VStack alignment="leading" spacing={14} padding={18} frame={{ maxWidth: "infinity" }} {...glassSurface(28, "card")}>
          <HStack spacing={8}>
            <Image systemName="photo.on.rectangle.angled" frame={{ width: 18, height: 18 }} foregroundStyle={BLUE} />
            <Text font={15} fontWeight="semibold" foregroundStyle="secondaryLabel">
              以图搜片
            </Text>
          </HStack>

          {image ? (
            <Image image={image} resizable scaleToFit frame={{ maxWidth: "infinity", maxHeight: 280 }} clipShape={{ type: "rect", cornerRadius: 18 }} />
          ) : (
            <VStack spacing={10} padding={28} frame={{ maxWidth: "infinity" }} {...glassSurface(20, "input", false)}>
              <Image systemName="photo.badge.plus" frame={{ width: 42, height: 42 }} foregroundStyle={BLUE} />
              <Text foregroundStyle="secondaryLabel" multilineTextAlignment="center">
                选择或拍摄影片截图，识别番号后再去搜磁力
              </Text>
            </VStack>
          )}

          <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
            <Button action={() => void handlePick()} buttonStyle="plain">
              <GlassButtonContent systemName="photo.on.rectangle" title="相册选图" />
            </Button>
            <Button action={() => void handleCapture()} buttonStyle="plain">
              <GlassButtonContent systemName="camera" title="拍照" />
            </Button>
          </HStack>

          <Button action={() => void handleSearch()} buttonStyle="plain">
            <GlassButtonContent systemName="sparkle.magnifyingglass" title={loading ? "识别中…" : "开始搜片"} prominent />
          </Button>
        </VStack>

        {showLogin ? (
          <VStack alignment="leading" spacing={12} padding={18} frame={{ maxWidth: "infinity" }} {...glassSurface(28, "card")}>
            <Text font={15} fontWeight="semibold">登录状态</Text>
            <Text font={13} foregroundStyle="secondaryLabel">
              网站开启登录/积分限制时需要。点击下方按钮打开网页完成登录，关闭页面后会自动获取 Cookie。
            </Text>
            <HStack spacing={8}>
              <Image
                systemName={hasCookie ? "checkmark.seal.fill" : "exclamationmark.triangle.fill"}
                frame={{ width: 16, height: 16 }}
                foregroundStyle={hasCookie ? BLUE : "secondaryLabel"}
              />
              <Text font={13} foregroundStyle={hasCookie ? "label" : "secondaryLabel"}>
                {hasCookie ? "已保存登录状态，可直接搜片" : "尚未登录，搜片可能被要求登录"}
              </Text>
            </HStack>
            <Button action={() => void handleLogin()} buttonStyle="plain">
              <GlassButtonContent
                systemName="person.crop.circle.badge.checkmark"
                title={loggingIn ? "登录中…" : hasCookie ? "重新登录获取" : "打开网页登录"}
                prominent
              />
            </Button>
            {hasCookie ? (
              <Button action={() => void handleClearLogin()} buttonStyle="plain">
                <GlassButtonContent systemName="trash" title="清除登录" />
              </Button>
            ) : undefined}
          </VStack>
        ) : undefined}

        {loading ? (
          <VStack spacing={14} padding={28} frame={{ maxWidth: "infinity", minHeight: 380 }} {...glassSurface(28, "card", false)}>
            <ProgressView />
            <Text foregroundStyle="secondaryLabel">正在上传截图并识别番号…</Text>
          </VStack>
        ) : matches.length > 0 ? (
          <LazyVStack alignment="leading" spacing={12}>
            <HStack padding={{ horizontal: 4 }} frame={{ maxWidth: "infinity" }}>
              <Text font={20} fontWeight="bold">匹配结果</Text>
              <Spacer />
              <Text font={13} foregroundStyle="secondaryLabel">
                已显示 {visibleMatches.length} / {matches.length} 条
              </Text>
            </HStack>
            {visibleMatches.map((item) => (
              <MatchRow
                key={item.id}
                item={item}
                magnetDestination={renderMagnetSearch(item.code, dismiss)}
                onCopyCode={() => void handleCopyCode(item.code)}
                onOpenWeb={() => void Safari.present(item.videoUrl || resultUrl || WHOS_BASE, true)}
              />
            ))}
            {hasMoreMatches ? (
              <Button action={loadMoreMatches} buttonStyle="plain">
                <HStack
                  spacing={8}
                  padding={{ vertical: 14, horizontal: 16 }}
                  frame={{ maxWidth: "infinity", alignment: "center" }}
                  {...glassSurface(20, "card")}
                  onAppear={loadMoreMatches}
                >
                  <Image systemName="arrow.down.circle" frame={{ width: 18, height: 18 }} foregroundStyle={BLUE} />
                  <Text font={15} fontWeight="semibold" foregroundStyle={BLUE}>继续加载更多</Text>
                </HStack>
              </Button>
            ) : undefined}
            {resultUrl ? (
              <Button action={() => void Safari.present(resultUrl, true)} buttonStyle="plain">
                <GlassButtonContent systemName="arrow.up.right.square" title="在网页中查看完整结果" />
              </Button>
            ) : undefined}
          </LazyVStack>
        ) : (
          <VStack spacing={14} padding={28} frame={{ maxWidth: "infinity", minHeight: 380 }} {...glassSurface(28, "card")}>
            <Spacer />
            <ZStack frame={{ width: 66, height: 66 }} {...glassSurface(24, "icon", false, false)}>
              <Image systemName="viewfinder" resizable frame={{ width: 34, height: 34 }} foregroundStyle={BLUE} />
            </ZStack>
            <Text font={20} fontWeight="bold">识图找番号</Text>
            <Text foregroundStyle="secondaryLabel" multilineTextAlignment="center">
              基于 whos.tv 识图。识别成功后可一键复制番号，或跳转磁力搜索。
            </Text>
            <Spacer />
          </VStack>
        )}
      </VStack>
    </ScrollView>
  );
}
