import {
  Navigation,
  NavigationStack,
  List,
  Section,
  Text,
  Button,
  HStack,
  VStack,
  Image,
  ProgressView,
  Spacer,
  LabeledContent,
  useEffect,
  useState,
} from "scripting"
import {
  installYtDlp,
  refreshYtDlpState,
  removeYtDlp,
  ytDlpState,
  ytDlpTargetVersion,
  isSabrInstalled,
  installSabrComponents,
} from "../services/ytDlpManager"
import { showToast, toastMessage, toastVisible } from "../state/appState"

declare const Dialog: any

export function SettingsView() {
  const dismiss = Navigation.useDismiss()
  const state = ytDlpState.value
  const isBusy = state.status === "checking" || state.status === "installing"
  const isInstalled = state.status === "installed"
  const [sabrInstalled, setSabrInstalled] = useState(false)

  useEffect(() => {
    refreshYtDlpState().catch(() => { })
  }, [])

  useEffect(() => {
    if (isInstalled) {
      isSabrInstalled().then(setSabrInstalled).catch(() => { })
    }
  }, [isInstalled])

  async function handleInstall() {
    try {
      await installYtDlp()
      showToast("YouTube 解析组件安装完成")
    } catch (error: any) {
      await Dialog.alert({
        title: "安装失败",
        message: error?.message || "无法安装 YouTube 解析组件",
        buttonLabel: "好",
      })
    }
  }

  async function handleRemove() {
    const confirmed = await Dialog.confirm({
      title: "删除解析组件",
      message: "删除后将无法解析或下载 YouTube 视频，其他平台不受影响。再次使用时可以重新安装。",
      cancelLabel: "取消",
      confirmLabel: "删除",
    })
    if (confirmed !== true) return

    try {
      await removeYtDlp()
      setSabrInstalled(false)
      showToast("YouTube 解析组件已删除")
    } catch (error: any) {
      await Dialog.alert({
        title: "删除失败",
        message: error?.message || "无法删除 YouTube 解析组件",
        buttonLabel: "好",
      })
    }
  }

  async function handleReinstallSabr() {
    try {
      await installSabrComponents()
      setSabrInstalled(true)
      showToast("SABR 下载组件安装完成")
    } catch (error: any) {
      await Dialog.alert({
        title: "安装失败",
        message: error?.message || "无法安装 SABR 下载组件",
        buttonLabel: "好",
      })
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="设置"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: (
            <Button action={dismiss}>
              <Image systemName="chevron.left" foregroundStyle="accentColor" fontWeight="semibold" />
            </Button>
          ),
        }}
        toast={{
          message: toastMessage.value,
          position: "top",
          isPresented: toastVisible,
          duration: 2,
        }}
      >
        <Section title="YouTube 解析组件">
          <LabeledContent title="状态">
            <HStack spacing={6}>
              {isBusy ? <ProgressView controlSize="small" /> : null}
              <Text foregroundStyle={state.status === "failed" ? "red" : "secondaryLabel"}>
                {state.status === "checking" ? "正在检查" : state.status === "installing" ? "正在安装" : isInstalled ? "已安装" : state.status === "failed" ? "安装失败" : "未安装"}
              </Text>
            </HStack>
          </LabeledContent>
          <LabeledContent title="目标版本" value={ytDlpTargetVersion} />
          {state.version ? <LabeledContent title="已安装版本" value={state.version} /> : null}
          {isInstalled ? (
            <LabeledContent title="下载组件 (SABR)">
              <HStack spacing={6}>
                <Text foregroundStyle={sabrInstalled ? "secondaryLabel" : "orange"}>
                  {sabrInstalled ? "已安装" : "未安装"}
                </Text>
              </HStack>
            </LabeledContent>
          ) : null}
          {state.message && state.status === "failed" ? (
            <Text font={13} foregroundStyle="red" lineLimit={4}>{state.message}</Text>
          ) : null}
        </Section>

        <Section>
          <Button disabled={isBusy} action={handleInstall}>
            <HStack>
              <Image systemName={isInstalled ? "arrow.clockwise" : "arrow.down.circle"} />
              <Text>{isInstalled ? "重新安装 / 更新" : "下载安装"}</Text>
              <Spacer />
            </HStack>
          </Button>
          {isInstalled && !sabrInstalled ? (
            <Button disabled={isBusy} action={handleReinstallSabr}>
              <HStack>
                <Image systemName="arrow.down.circle" />
                <Text>安装 SABR 下载组件</Text>
                <Spacer />
              </HStack>
            </Button>
          ) : null}
          {isInstalled && sabrInstalled ? (
            <Button disabled={isBusy} action={handleReinstallSabr}>
              <HStack>
                <Image systemName="arrow.clockwise" />
                <Text>重装 SABR 下载组件</Text>
                <Spacer />
              </HStack>
            </Button>
          ) : null}
          {isInstalled ? (
            <Button disabled={isBusy} role="destructive" action={handleRemove}>
              <HStack>
                <Image systemName="trash" />
                <Text>删除解析组件</Text>
                <Spacer />
              </HStack>
            </Button>
          ) : null}
        </Section>

        <Section title="存储说明">
          <VStack alignment="leading" spacing={6}>
            <Text font={13} foregroundStyle="secondaryLabel">
              解析组件约 25 MB，SABR 下载组件约 3 MB，合计约 28 MB。
            </Text>
            <Text font={13} foregroundStyle="secondaryLabel">
              组件保存在应用数据目录，不会随脚本项目和 iCloud 源码同步。
            </Text>
          </VStack>
        </Section>
      </List>
    </NavigationStack>
  )
}
