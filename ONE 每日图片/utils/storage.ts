export class UnifiedStorage {
  private storageName: string

  constructor(storageName: string) {
    this.storageName = storageName
  }

  private getStorageData(): Record<string, any> {
    try {
      return Storage.get<Record<string, any>>(this.storageName) || {}
    } catch {
      return {}
    }
  }

  private setStorageData(data: Record<string, any>): void {
    try {
      Storage.set(this.storageName, data)
    } catch {
    }
  }

  get<T = any>(key: string): T | undefined {
    const data = this.getStorageData()
    return data[key] as T
  }

  set(key: string, value: any): void {
    const data = this.getStorageData()
    data[key] = value
    this.setStorageData(data)
  }

  remove(key: string): void {
    const data = this.getStorageData()
    delete data[key]
    this.setStorageData(data)
  }

  clear(): void {
    this.setStorageData({})
  }

  getAllKeys(): string[] {
    const data = this.getStorageData()
    return Object.keys(data)
  }

  getAllData(): Record<string, any> {
    return this.getStorageData()
  }

  batchSet(updates: Record<string, any>): void {
    const data = this.getStorageData()
    Object.assign(data, updates)
    this.setStorageData(data)
  }

  has(key: string): boolean {
    const data = this.getStorageData()
    return key in data
  }

  exportConfig(): string {
    const data = this.getStorageData()
    return JSON.stringify(data, null, 2)
  }

  importConfig(configJson: string, confirm: boolean = false): boolean {
    if (!confirm) {
      return false
    }

    try {
      const config = JSON.parse(configJson)
      this.clear()
      this.batchSet(config)
      return true
    } catch {
      return false
    }
  }

  getStorageName(): string {
    return this.storageName
  }
}

export class StorageManager {
  public storage: UnifiedStorage

  constructor(storage: UnifiedStorage) {
    this.storage = storage
  }

  getAllStorageData(): Record<string, any> {
    return this.storage.getAllData()
  }

  getAllStorageKeys(): string[] {
    return this.storage.getAllKeys()
  }

  clearAllStorageData(confirm: boolean = false): void {
    if (!confirm) {
      return
    }

    this.storage.clear()
  }

  batchUpdateStorage(updates: Record<string, any>): void {
    this.storage.batchSet(updates)
  }

  hasStorageKey(key: string): boolean {
    return this.storage.has(key)
  }

  removeStorageKey(key: string): void {
    this.storage.remove(key)
  }

  exportStorageConfig(): string {
    return this.storage.exportConfig()
  }

  importStorageConfig(configJson: string, confirm: boolean = false): boolean {
    return this.storage.importConfig(configJson, confirm)
  }
}

export const createUnifiedStorage = (storageName: string): UnifiedStorage => {
  return new UnifiedStorage(storageName)
}

export const createStorageManager = (storageName: string): StorageManager => {
  const storage = new UnifiedStorage(storageName)
  return new StorageManager(storage)
}
