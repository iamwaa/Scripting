import { Intent, Script, Widget } from 'scripting'
import {
  getDisplayWallpaper,
  addRefreshLog,
  isLaunchedByNotification,
  scheduleDailyRefreshNotification,
} from './utils/one-service'
import { ImageCacheManager } from './utils/image-cache'

async function run(): Promise<void> {
  // 检测是否由通知点击触发
  const fromNotification = isLaunchedByNotification()
  const triggerSource = fromNotification ? '通知点击' : '快捷指令'

  addRefreshLog({
    status: 'start',
    message: `${triggerSource}触发强制刷新`,
    forceRefresh: true,
  })

  try {
    // 强制拉取最新内容，绕过缓存
    const wallpaperData = await getDisplayWallpaper(true)

    // 预缓存图片到本地，确保小组件能读到离线文件
    const localImagePath: string | null =
      await ImageCacheManager.getCachedImagePath(wallpaperData.imageUrl)

    addRefreshLog({
      status: 'success',
      message: `${triggerSource}刷新成功：${wallpaperData.date}`,
      forceRefresh: true,
      displayDate: wallpaperData.date,
    })

    // 通知所有小组件重新加载时间线
    Widget.reloadAll()

    // 由通知触发时，重新调度下一次通知
    if (fromNotification) {
      await scheduleDailyRefreshNotification()
    }

    Script.exit(Intent.json({
      success: true,
      title: wallpaperData.title,
      date: wallpaperData.date,
      imageUrl: wallpaperData.imageUrl,
      localImagePath: localImagePath || '',
    }))
  } catch (error: unknown) {
    const errorMessage: string =
      error instanceof Error ? error.message : String(error)

    addRefreshLog({
      status: 'error',
      message: `${triggerSource}刷新失败：${errorMessage}`,
      forceRefresh: true,
    })

    Script.exit(Intent.json({
      success: false,
      error: errorMessage,
    }))
  }
}

run()
