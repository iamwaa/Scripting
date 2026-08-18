import { Script } from "scripting"

const YT_DLP_TARGET_VERSION = "2026.07.04"
const COMPONENT_ROOT = `${FileManager.appGroupDocumentsDirectory}/WebResourceExtractor/components/yt-dlp`
const INSTALL_PATH = `${COMPONENT_ROOT}/current`
const VERSION_FILE = `${INSTALL_PATH}/yt_dlp/version.py`
// SABR 组件标记文件：存在则表示 SABR 包和 UMP vendor 已安装
const SABR_MARKER = `${INSTALL_PATH}/.sabr-installed`
// Yoinks 仓库 Python 目录的 tarball URL（包含 yt_sabr2、ump-vendor 等）
const YOINKS_TARBALL_URL = "https://codeload.github.com/ckldy/Yoinks/tar.gz/refs/heads/master"

type YtDlpState = {
  status: "checking" | "notInstalled" | "installing" | "installed" | "failed"
  version?: string
  message?: string
}

declare const Dialog: any

function createObservable<T>(initialValue: T): Observable<T> {
  const ObservableRuntime = Observable as any
  return new ObservableRuntime(initialValue) as Observable<T>
}

export const ytDlpState = createObservable<YtDlpState>({ status: "checking" })
export const ytDlpTargetVersion = YT_DLP_TARGET_VERSION
export const ytDlpInstallPath = INSTALL_PATH

let installPromise: Promise<void> | null = null

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await FileManager.stat(path)
    return true
  } catch {
    return false
  }
}

async function readInstalledVersion(path: string): Promise<string | null> {
  if (!await pathExists(`${path}/yt_dlp/version.py`)) return null
  const code = `import sys;sys.path.insert(0,${JSON.stringify(path)});from yt_dlp.version import __version__;print(__version__)`
  const result = await Shell.run(`python -c ${quoteShellArg(code)}`, { timeout: 30 })
  if (result.timedOut || result.exitCode !== 0) return null
  return result.output.trim().split("\n").filter(Boolean).pop() || null
}

export async function refreshYtDlpState(): Promise<YtDlpState> {
  if (ytDlpState.value.status === "installing") return ytDlpState.value
  ytDlpState.setValue({ status: "checking" })
  const version = await readInstalledVersion(INSTALL_PATH)
  const state: YtDlpState = version
    ? { status: "installed", version }
    : { status: "notInstalled" }
  ytDlpState.setValue(state)
  return state
}

export async function installYtDlp(): Promise<void> {
  if (installPromise) return installPromise

  installPromise = (async () => {
    ytDlpState.setValue({ status: "installing", message: "正在下载并安装解析组件..." })
    await FileManager.createDirectory(COMPONENT_ROOT, true)
    const temporaryPath = `${COMPONENT_ROOT}/.installing-${Date.now()}`
    const backupPath = `${COMPONENT_ROOT}/.previous`
    await FileManager.createDirectory(temporaryPath, true)

    try {
      const command = `pip install --disable-pip-version-check --no-cache-dir --target ${quoteShellArg(temporaryPath)} ${quoteShellArg(`yt-dlp==${YT_DLP_TARGET_VERSION}`)}`
      const result = await Shell.run(command, { cwd: Script.directory, timeout: 600 })
      if (result.timedOut || result.exitCode !== 0) {
        const detail = result.output.trim().split("\n").slice(-4).join("\n")
        throw new Error(detail || "解析组件安装失败")
      }

      const version = await readInstalledVersion(temporaryPath)
      if (version !== YT_DLP_TARGET_VERSION) {
        throw new Error(`组件校验失败，期望 ${YT_DLP_TARGET_VERSION}，实际 ${version || "未知"}`)
      }

      if (await pathExists(backupPath)) await FileManager.remove(backupPath)
      if (await pathExists(INSTALL_PATH)) {
        const backup = await Shell.run(`mv ${quoteShellArg(INSTALL_PATH)} ${quoteShellArg(backupPath)}`, { timeout: 60 })
        if (backup.timedOut || backup.exitCode !== 0) {
          throw new Error(backup.output.trim() || "旧解析组件备份失败")
        }
      }

      const move = await Shell.run(`mv ${quoteShellArg(temporaryPath)} ${quoteShellArg(INSTALL_PATH)}`, { timeout: 60 })
      if (move.timedOut || move.exitCode !== 0 || !await pathExists(VERSION_FILE)) {
        if (await pathExists(INSTALL_PATH)) await FileManager.remove(INSTALL_PATH)
        if (await pathExists(backupPath)) {
          await Shell.run(`mv ${quoteShellArg(backupPath)} ${quoteShellArg(INSTALL_PATH)}`, { timeout: 60 })
        }
        throw new Error(move.output.trim() || "解析组件启用失败")
      }
      if (await pathExists(backupPath)) await FileManager.remove(backupPath)
      ytDlpState.setValue({ status: "installed", version })
      // yt-dlp 安装成功后自动安装 SABR 组件
      try {
        await installSabrComponents()
      } catch {
        // SABR 安装失败不阻塞 yt-dlp 安装完成；解析仍可用，下载时再提示
      }
    } catch (error: any) {
      if (await pathExists(temporaryPath)) await FileManager.remove(temporaryPath)
      const message = error?.message || "解析组件安装失败"
      ytDlpState.setValue({ status: "failed", message })
      throw new Error(message)
    }
  })().finally(() => {
    installPromise = null
  })

  return installPromise
}

export async function removeYtDlp(): Promise<void> {
  if (installPromise) throw new Error("解析组件正在安装，请稍后再试")
  if (await pathExists(INSTALL_PATH)) await FileManager.remove(INSTALL_PATH)
  const backupPath = `${COMPONENT_ROOT}/.previous`
  if (await pathExists(backupPath)) await FileManager.remove(backupPath)
  ytDlpState.setValue({ status: "notInstalled" })
}

/** 检查 SABR 组件是否已安装。 */
export async function isSabrInstalled(): Promise<boolean> {
  return pathExistsAsync(SABR_MARKER)
}

async function pathExistsAsync(path: string): Promise<boolean> {
  try {
    await FileManager.stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * 下载并安装 SABR 协议客户端和 UMP 组件到 yt-dlp 安装目录。
 * 包含：yt_sabr2 包、yt_sabr_download_v2.py、patch_ytse.py、ffmpeg_run.py、ump-vendor（protobug + yt_dlp_plugins）。
 */
export async function installSabrComponents(): Promise<void> {
  // 已安装则跳过
  if (await pathExistsAsync(SABR_MARKER)) return
  if (!await pathExistsAsync(INSTALL_PATH)) {
    throw new Error("yt-dlp 组件尚未安装，无法安装 SABR 组件")
  }

  ytDlpState.setValue({ status: "installing", message: "正在安装 SABR 下载组件..." })

  // 下载 Yoinks 仓库 tarball 并提取 Python 目录
  const tarballPath = `${COMPONENT_ROOT}/.yoinks-tarball-${Date.now()}.tar.gz`
  const extractDir = `${COMPONENT_ROOT}/.yoinks-extract-${Date.now()}`
  await FileManager.createDirectory(extractDir, true)

  try {
    // 下载 tarball（用 curl 避免 fetch 类型问题）
    const downloadResult = await Shell.run(
      `curl -sL -o ${quoteShellArg(tarballPath)} ${quoteShellArg(YOINKS_TARBALL_URL)}`,
      { timeout: 120 }
    )
    if (downloadResult.timedOut || downloadResult.exitCode !== 0) {
      throw new Error("下载 SABR 组件失败")
    }
    // 验证文件大小（tarball 应该 > 1MB）
    const stat = await FileManager.stat(tarballPath)
    if (!stat || stat.size < 100000) {
      throw new Error("下载的 SABR 组件文件不完整")
    }

    // 解压
    const extractResult = await Shell.run(
      `tar xzf ${quoteShellArg(tarballPath)} -C ${quoteShellArg(extractDir)}`,
      { timeout: 120 }
    )
    if (extractResult.timedOut || extractResult.exitCode !== 0) {
      throw new Error("解压 SABR 组件失败")
    }

    // 找到解压后的 python 目录（Yoinks-master/python/）
    const pythonDir = `${extractDir}/Yoinks-master/python`
    if (!await pathExistsAsync(pythonDir)) {
      throw new Error("SABR 组件目录结构异常")
    }

    // 用 Python shutil 复制文件（iOS cp -R 可能不可靠）
    const pythonDirVar = pythonDir
    const installPathVar = INSTALL_PATH
    // 用 JSON.stringify 生成安全的 Python 字符串字面量
    const copyScript = `import shutil, os\nsrc = ${JSON.stringify(pythonDirVar)}\ndst = ${JSON.stringify(installPathVar)}\nshutil.copytree(os.path.join(src, 'yt_sabr2'), os.path.join(dst, 'yt_sabr2'), dirs_exist_ok=True)\nfor f in ['yt_sabr_download_v2.py', 'patch_ytse.py', 'ffmpeg_run.py']:\n    shutil.copy2(os.path.join(src, f), os.path.join(dst, f))\nvendor = os.path.join(src, 'ump-vendor')\nfor item in ['protobug', 'protobug-1.0.0.dist-info', 'yt_dlp_ytse-0.4.3.dist-info']:\n    p = os.path.join(vendor, item)\n    if os.path.isdir(p):\n        shutil.copytree(p, os.path.join(dst, item), dirs_exist_ok=True)\nplugins_src = os.path.join(vendor, 'yt_dlp_plugins')\nif os.path.isdir(plugins_src):\n    shutil.copytree(plugins_src, os.path.join(dst, 'yt_dlp_plugins'), dirs_exist_ok=True)\nprint('copy ok')`
    const copyResult = await Shell.run(`python -c ${quoteShellArg(copyScript)}`, { timeout: 60 })
    if (copyResult.timedOut || copyResult.exitCode !== 0) {
      throw new Error(`复制 SABR 组件失败: ${copyResult.output?.slice(-200) || ""}`)
    }

    // 应用 UMP 补丁
    const patchResult = await Shell.run(
      `python ${quoteShellArg(`${INSTALL_PATH}/patch_ytse.py`)} patch`,
      { timeout: 30 }
    )
    if (patchResult.timedOut || patchResult.exitCode !== 0) {
      // 补丁失败不阻塞，因为 yt_sabr2 包不依赖补丁
    }

    // 写入标记文件
    await Shell.run(`echo installed > ${quoteShellArg(SABR_MARKER)}`, { timeout: 10 })
    ytDlpState.setValue({ status: "installed", version: (await readInstalledVersion(INSTALL_PATH)) || undefined })
  } catch (error: any) {
    ytDlpState.setValue({ status: "installed", message: error?.message || "SABR 组件安装失败", version: (await readInstalledVersion(INSTALL_PATH)) || undefined })
    throw error
  } finally {
    // 清理临时文件
    if (await pathExistsAsync(tarballPath)) await FileManager.remove(tarballPath)
    if (await pathExistsAsync(extractDir)) await FileManager.remove(extractDir)
  }
}

/** 确保 SABR 组件已安装，未安装时可选安装。 */
export async function ensureSabrComponents(promptUser: boolean): Promise<boolean> {
  if (await pathExistsAsync(SABR_MARKER)) return true
  if (!promptUser) return false
  const confirmed = await Dialog.confirm({
    title: "安装 SABR 下载组件",
    message: "YouTube 下载需要 SABR 协议组件（约 3 MB），用于绕过签名限制。组件将保存到应用数据目录，可随时在设置中删除。",
    cancelLabel: "暂不安装",
    confirmLabel: "下载安装",
  })
  if (confirmed !== true) return false
  try {
    await installSabrComponents()
    return true
  } catch (error: any) {
    await Dialog.alert({
      title: "安装失败",
      message: error?.message || "无法安装 SABR 组件",
      buttonLabel: "好",
    })
    return false
  }
}

export async function ensureYtDlpInstalled(promptUser: boolean): Promise<boolean> {
  const current = await refreshYtDlpState()
  if (current.status === "installed") return true
  if (!promptUser) return false

  const confirmed = await Dialog.confirm({
    title: "安装 YouTube 解析组件",
    message: `首次解析 YouTube 需要下载 yt-dlp ${YT_DLP_TARGET_VERSION}（约 25 MB）和 SABR 下载组件（约 3 MB）。组件将保存到应用数据目录，可随时在设置中删除。`,
    cancelLabel: "暂不安装",
    confirmLabel: "下载安装",
  })
  if (confirmed !== true) return false
  try {
    await installYtDlp()
    return true
  } catch (error: any) {
    await Dialog.alert({
      title: "安装失败",
      message: error?.message || "无法安装 YouTube 解析组件",
      buttonLabel: "好",
    })
    return false
  }
}
