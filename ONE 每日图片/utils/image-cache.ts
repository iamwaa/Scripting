import { fetch, Path } from 'scripting'
import { createStorageManager } from './storage'

const CACHE_STORAGE_NAME = 'ScriptPie.ImageCache'
const CACHE_STORAGE_KEYS = {
  IMAGE_METADATA: 'imageMetadata',
}

// 桌面小组件内存上限约 30MB，v2 缓存会把落盘图片缩到小组件可承受的尺寸。
const CACHE_VERSION = 2

const CACHE_CONFIG = {
  cacheDirectory: Path.join(FileManager.appGroupDocumentsDirectory, 'ImageCache'),
  maxCacheSize: 50 * 1024 * 1024,
  cleanupThreshold: 0.8,
  maxImageEdge: 1600,
  jpegQuality: 0.85,
}

const cacheStorageManager = createStorageManager(CACHE_STORAGE_NAME)

interface ImageCacheMetadata {
  url: string
  localPath: string
  cachedAt: number
  fileSize: number
  mimeType: string
  etag?: string
  version?: number
}

export class ImageCacheManager {
  private static initCacheDirectory(): void {
    try {
      if (!FileManager.existsSync(CACHE_CONFIG.cacheDirectory)) {
        FileManager.createDirectorySync(CACHE_CONFIG.cacheDirectory, true)
      }
    } catch {
    }
  }

  private static getImageMetadata(): Record<string, ImageCacheMetadata> {
    return cacheStorageManager.storage.get<Record<string, ImageCacheMetadata>>(
      CACHE_STORAGE_KEYS.IMAGE_METADATA,
    ) || {}
  }

  private static saveImageMetadata(metadata: Record<string, ImageCacheMetadata>): void {
    cacheStorageManager.storage.set(CACHE_STORAGE_KEYS.IMAGE_METADATA, metadata)
  }

  private static generateCacheFileName(url: string): string {
    const hash = url.split('').reduce((a: number, b: string) => {
      const next: number = (a << 5) - a + b.charCodeAt(0)
      return next & next
    }, 0)
    const extensionMatch: RegExpMatchArray | null = url
      .toLowerCase()
      .match(/\.(jpg|jpeg|png|webp|gif)(?:[?&]|$)/)
    const extension: string = extensionMatch ? extensionMatch[1] : 'jpg'

    return `${Math.abs(hash)}.${extension}`
  }

  private static isCacheValid(metadata: ImageCacheMetadata, currentUrl: string): boolean {
    return metadata.url === currentUrl && (metadata.version ?? 1) >= CACHE_VERSION
  }

  private static async getCacheSize(): Promise<number> {
    try {
      const metadata = this.getImageMetadata()
      return Object.values(metadata).reduce((total, item) => total + item.fileSize, 0)
    } catch {
      return 0
    }
  }

  private static async cleanupInvalidCache(): Promise<void> {
    try {
      const metadata = this.getImageMetadata()
      const updatedMetadata: Record<string, ImageCacheMetadata> = {}

      for (const [key, item] of Object.entries(metadata)) {
        try {
          await FileManager.stat(item.localPath)
          updatedMetadata[key] = item
        } catch {
        }
      }

      this.saveImageMetadata(updatedMetadata)
    } catch {
    }
  }

  private static async cleanupOldestCache(targetSize: number): Promise<void> {
    try {
      const metadata = this.getImageMetadata()
      const sortedItems = Object.entries(metadata).sort(([, a], [, b]) => a.cachedAt - b.cachedAt)
      const updatedMetadata = { ...metadata }
      let currentSize = await this.getCacheSize()

      for (const [key, item] of sortedItems) {
        if (currentSize <= targetSize) {
          break
        }

        try {
          await FileManager.remove(item.localPath)
          delete updatedMetadata[key]
          currentSize -= item.fileSize
        } catch {
        }
      }

      this.saveImageMetadata(updatedMetadata)
    } catch {
    }
  }

  private static downscaleImageBytes(originalBytes: Uint8Array): Uint8Array {
    try {
      const data = Data.fromUint8Array(originalBytes)
      if (!data) {
        return originalBytes
      }

      const image = UIImage.fromData(data)
      if (!image || !image.width || !image.height) {
        return originalBytes
      }

      const longestEdge = Math.max(image.width, image.height)
      if (longestEdge <= CACHE_CONFIG.maxImageEdge) {
        return originalBytes
      }

      const ratio = CACHE_CONFIG.maxImageEdge / longestEdge
      const thumbnail = image.preparingThumbnail({
        width: Math.round(image.width * ratio),
        height: Math.round(image.height * ratio),
      })
      if (!thumbnail) {
        return originalBytes
      }

      const jpegData = Data.fromJPEG(thumbnail, CACHE_CONFIG.jpegQuality)
      return jpegData?.toUint8Array() || originalBytes
    } catch {
      return originalBytes
    }
  }

  private static async downloadAndCacheImage(
    url: string,
    localPath: string,
  ): Promise<ImageCacheMetadata | null> {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const imageData = await response.arrayBuffer()
      const bytesToWrite = this.downscaleImageBytes(new Uint8Array(imageData))

      // 确保父目录存在后用同步 API 写入，避免异步目录创建未完成导致写入失败
      const parentDir = localPath.substring(0, localPath.lastIndexOf('/'))
      if (!FileManager.existsSync(parentDir)) {
        FileManager.createDirectorySync(parentDir, true)
      }
      FileManager.writeAsBytesSync(localPath, bytesToWrite)

      const stat = await FileManager.stat(localPath)
      const mimeType = FileManager.mimeType(localPath)
      const etag = response.headers.get('etag') || undefined

      return {
        url,
        localPath,
        cachedAt: Date.now(),
        fileSize: stat.size,
        mimeType,
        etag,
        version: CACHE_VERSION,
      }
    } catch {
      return null
    }
  }

  static async getCachedImagePath(url: string): Promise<string | null> {
    if (!url) {
      return null
    }

    try {
      this.initCacheDirectory()
      await this.cleanupInvalidCache()

      const metadata = this.getImageMetadata()
      const cachedItem = metadata[url]

      if (cachedItem && this.isCacheValid(cachedItem, url)) {
        try {
          await FileManager.stat(cachedItem.localPath)
          return cachedItem.localPath
        } catch {
          delete metadata[url]
          this.saveImageMetadata(metadata)
        }
      } else if (cachedItem) {
        try {
          await FileManager.remove(cachedItem.localPath)
        } catch {
        }
        delete metadata[url]
        this.saveImageMetadata(metadata)
      }

      const currentCacheSize = await this.getCacheSize()
      if (currentCacheSize > CACHE_CONFIG.maxCacheSize * CACHE_CONFIG.cleanupThreshold) {
        await this.cleanupOldestCache(CACHE_CONFIG.maxCacheSize * 0.5)
      }

      const fileName = this.generateCacheFileName(url)
      const localPath = Path.join(CACHE_CONFIG.cacheDirectory, fileName)
      const newMetadata = await this.downloadAndCacheImage(url, localPath)

      if (!newMetadata) {
        return null
      }

      metadata[url] = newMetadata
      this.saveImageMetadata(metadata)
      return localPath
    } catch {
      return null
    }
  }

  static async clearAllCache(): Promise<void> {
    try {
      const metadata = this.getImageMetadata()

      for (const item of Object.values(metadata)) {
        try {
          await FileManager.remove(item.localPath)
        } catch {
        }
      }

      this.saveImageMetadata({})
    } catch {
    }
  }

  static async getCacheStats(): Promise<{
    totalFiles: number
    totalSize: number
    oldestCache: number
    newestCache: number
  }> {
    try {
      const metadata = this.getImageMetadata()
      const items = Object.values(metadata)

      if (items.length === 0) {
        return { totalFiles: 0, totalSize: 0, oldestCache: 0, newestCache: 0 }
      }

      const totalFiles = items.length
      const totalSize = items.reduce((sum, item) => sum + item.fileSize, 0)
      const cacheTimes = items.map(item => item.cachedAt)

      return {
        totalFiles,
        totalSize,
        oldestCache: Math.min(...cacheTimes),
        newestCache: Math.max(...cacheTimes),
      }
    } catch {
      return { totalFiles: 0, totalSize: 0, oldestCache: 0, newestCache: 0 }
    }
  }
}
