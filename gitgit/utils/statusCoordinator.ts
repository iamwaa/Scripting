export type ScanRun = {
  sources: Set<string>
  queuedAt: number
  startedAt: number
  activeScans: number
  onSource?: (source: string) => void
}

type ScanJob<T> = {
  run: ScanRun
  task: (run: ScanRun) => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
  promise: Promise<T>
}

// 状态读取可并发共享矩阵；写操作先挡住新读取，再等待已有读取安全收尾。
export class StatusCoordinator<T> {
  private readers = new Map<string, Set<Promise<unknown>>>()
  private writers = new Map<string, Promise<void>>()
  private revisions = new Map<string, number>()
  private scans = new Map<string, ScanJob<T>>()
  private queue: ScanJob<T>[] = []
  private scanning = false

  revision(key: string): number {
    return this.revisions.get(key) ?? 0
  }

  isWriting(key: string): boolean {
    return this.writers.has(key)
  }

  read<R>(key: string, task: () => Promise<R>): Promise<R> {
    const writer = this.writers.get(key)
    if (writer) return writer.then(() => this.read(key, task))
    let readers = this.readers.get(key)
    if (!readers) this.readers.set(key, readers = new Set())
    const pending = Promise.resolve().then(task).finally(() => {
      readers!.delete(pending)
      if (readers!.size === 0) this.readers.delete(key)
    })
    readers.add(pending)
    return pending
  }

  async mutate<R>(key: string, task: () => Promise<R>): Promise<R> {
    if (this.writers.has(key)) {
      throw new Error("该仓库正在执行其它写操作，请稍后再试")
    }
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    this.writers.set(key, barrier)
    this.revisions.set(key, this.revision(key) + 1)
    try {
      // 失败的旧读取也必须收尾，但不能阻断用户的写操作。
      await Promise.all(Array.from(this.readers.get(key) ?? []).map(
        (pending) => pending.catch(() => undefined)
      ))
      return await task()
    } finally {
      this.revisions.set(key, this.revision(key) + 1)
      this.writers.delete(key)
      release()
    }
  }

  scan(key: string, source: string, task: (run: ScanRun) => Promise<T>): Promise<T> {
    const existing = this.scans.get(key)
    if (existing) {
      existing.run.sources.add(source)
      existing.run.onSource?.(source)
      return existing.promise
    }
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    const job: ScanJob<T> = {
      run: { sources: new Set([source]), queuedAt: Date.now(), startedAt: 0, activeScans: 1 },
      task, resolve, reject, promise,
    }
    this.scans.set(key, job)
    this.queue.push(job)
    // 同一轮微任务内允许详情请求加入并提升尚未开始的列表扫描。
    Promise.resolve().then(() => this.drain())
    return promise.finally(() => {
      if (this.scans.get(key) === job) this.scans.delete(key)
    })
  }

  private async drain(): Promise<void> {
    if (this.scanning || this.queue.length === 0) return
    this.scanning = true
    const foreground = this.queue.findIndex((job) =>
      Array.from(job.run.sources).some((source) => !source.startsWith("列表"))
    )
    const [job] = this.queue.splice(foreground < 0 ? 0 : foreground, 1)
    job.run.startedAt = Date.now()
    try {
      job.resolve(await job.task(job.run))
    } catch (error) {
      job.reject(error)
    } finally {
      this.scanning = false
      // 给完成回调让出时机，避免下一项抢在当前页面状态更新之前启动。
      Promise.resolve().then(() => this.drain())
    }
  }
}
