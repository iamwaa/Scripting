/**
 * services/gitCore.ts - Git 引擎加载器 + fs 适配器
 *
 * 从 isomorphic-git 技能移植并精简：
 *  - loadGitEngine(): 加载 Buffer polyfill + isomorphic-git UMD bundle
 *  - createFS(gitdir, workdir): 适配 FileManager 的 fs，实现 .git 分离存储
 *
 * 关键设计：gitdir（.git 内部文件）统一存于 App Group 的 git-repos/<repoName>/，
 *          workdir（工作区）指向用户通过 DocumentPicker 书签授权的真实目录。
 *          这样既保持 iCloud 项目目录干净，又支持自定义仓库存储位置。
 */

import { loadBufferPolyfill } from "../polyfills"

declare const Buffer: any

declare const fetch: any

declare const Data: any

const BUNDLE_PATH =
  FileManager.scriptsDirectory + "/gitgit/vendor/index.umd.min.js"

/** .git 内部文件名（必须精确匹配，禁止 startsWith 误伤工作区 index.ts/config.json） */
const GIT_INTERNAL_FILES = new Set([
  "HEAD",
  "config",
  "index",
  "COMMIT_EDITMSG",
  "MERGE_HEAD",
  "FETCH_HEAD",
  "ORIG_HEAD",
  "packed-refs",
  "description",
  "shallow",
  "deepen",
])

/**
 * .git 内部目录名（不含尾斜杠）。
 * 必须同时匹配裸名 `refs`/`objects` 与子路径 `refs/heads/main`：
 * isomorphic-git 会 mkdir("refs") / readdir("refs")，若只匹配 `refs/` 会落到工作区，
 * 导致分支列表为空、clone/checkout 结构错乱。
 */
const GIT_INTERNAL_DIR_NAMES = [
  "objects",
  "refs",
  "info",
  "hooks",
  "logs",
]

/** 判断路径是否属于 .git 内部文件 */
function isGitInternal(filepath: string): boolean {
  if (filepath.startsWith(".git/") || filepath === ".git") return true
  // 精确文件名，或同名 lock 文件（如 index.lock）
  if (GIT_INTERNAL_FILES.has(filepath)) return true
  if (filepath.endsWith(".lock")) {
    const unlocked = filepath.slice(0, -5)
    if (GIT_INTERNAL_FILES.has(unlocked)) return true
  }
  for (const dir of GIT_INTERNAL_DIR_NAMES) {
    if (filepath === dir || filepath.startsWith(dir + "/")) return true
  }
  return false
}

/** 去掉路径末尾斜杠 */
function stripTrailingSlash(p: string): string {
  return p.replace(/\/+$/, "")
}

function isMissingError(error: any): boolean {
  const code = error?.code
  const normalizedCode = String(code || "").toUpperCase()
  if (
    normalizedCode === "ENOENT" ||
    normalizedCode === "ENOTDIR" ||
    normalizedCode.includes("NOSUCHFILE")
  ) {
    return true
  }
  // NSFileNoSuchFileError / NSFileReadNoSuchFileError
  if (code === 4 || code === 260) return true
  // 中英文系统文案：FileManager 在 iOS 中文环境下会返回“不存在/未能打开…因为它不存在”
  const message = String(error?.message || error || "").toLowerCase()
  const looksMissingEnglish =
    message.includes("no such file") ||
    message.includes("file not found") ||
    message.includes("does not exist") ||
    message.includes("doesn't exist") ||
    (message.includes("could not be opened") && message.includes("no such")) ||
    (message.includes("couldn't be opened") && message.includes("no such"))
  // 中文系统常见：未能打开文件“config”，因为它不存在。
  const looksMissingChinese =
    message.includes("因为它不存在") ||
    message.includes("文件不存在") ||
    message.includes("目录不存在") ||
    message.includes("路径不存在") ||
    message.includes("找不到文件") ||
    message.includes("找不到该文件") ||
    message.includes("无此文件") ||
    (message.includes("未能打开") && message.includes("不存在"))
  return looksMissingEnglish || looksMissingChinese
}

function isAlreadyExistsError(error: any): boolean {
  const code = String(error?.code || "").toUpperCase()
  if (code === "EEXIST" || code.includes("FILEEXISTS")) return true
  return String(error?.message || error || "").toLowerCase().includes("already exists")
}

function dateToMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return numeric < 100000000000 ? numeric * 1000 : numeric
}

function createMissingError(operation: string, filepath: string): Error {
  const err = new Error(
    `ENOENT: no such file or directory, ${operation} '${filepath}'`
  )
  ;(err as any).code = "ENOENT"
  return err
}

/** 将 FileManager 的“路径不存在”错误转换为 Node fs 语义，其它错误原样传播。 */
function rethrowFsError(error: any, operation: string, filepath: string): never {
  if (isMissingError(error)) throw createMissingError(operation, filepath)
  throw error
}

/** 创建 fs 适配器：把 isomorphic-git 访问的相对路径解析到真实磁盘路径 */
export function createFS(
  gitdir: string,
  workdir: string,
  fileManager: typeof FileManager = FileManager
) {
  const wd = stripTrailingSlash(workdir)
  const gd = stripTrailingSlash(gitdir)

  function resolvePath(filepath: string): string {
    if (!filepath || filepath === ".") return wd

    // 绝对路径：仅当已在 workdir/gitdir 树下时直通
    if (filepath.startsWith("/")) {
      const abs = stripTrailingSlash(filepath)
      if (abs === wd || abs.startsWith(wd + "/")) return filepath
      if (abs === gd || abs.startsWith(gd + "/")) return filepath
      // 其它绝对路径不在仓库范围内：仍直通（FileManager 可能传入）
      return filepath
    }

    const cleanPath = filepath.startsWith(".git/")
      ? filepath.substring(5)
      : filepath
    if (isGitInternal(cleanPath)) {
      return gd + "/" + cleanPath
    }
    return wd + "/" + filepath
  }

  // 删除应幂等：clean clone 会删不存在的 shallow；中文系统可能只报“未能移除”
  async function removePathIfPresent(filepath: string): Promise<boolean> {
    const resolved = resolvePath(filepath)
    try {
      await fileManager.remove(resolved)
      return true
    } catch (e: any) {
      if (isMissingError(e)) return false
      // 文案未标明缺失时，再确认路径是否已不存在
      try {
        if (!(await fileManager.exists(resolved))) return false
      } catch (existsError: any) {
        if (isMissingError(existsError)) return false
        throw e
      }
      throw e
    }
  }

  const emptyWorkdirParentCandidates = new Set<string>()

  function rememberEmptyWorkdirParent(filepath: string): void {
    const resolved = stripTrailingSlash(resolvePath(filepath))
    if (resolved === wd || !resolved.startsWith(wd + "/")) return
    const parent = resolved.substring(0, resolved.lastIndexOf("/"))
    if (parent !== wd && parent.startsWith(wd + "/")) {
      emptyWorkdirParentCandidates.add(parent)
    }
  }

  async function pruneEmptyWorkdirParents(): Promise<void> {
    const candidates = Array.from(emptyWorkdirParentCandidates).sort(
      (a, b) => b.length - a.length
    )
    emptyWorkdirParentCandidates.clear()

    for (const candidate of candidates) {
      let parent = candidate
      while (parent !== wd && parent.startsWith(wd + "/")) {
        let entries: string[]
        try {
          entries = await fileManager.readDirectory(parent)
        } catch (e: any) {
          if (isMissingError(e)) break
          throw e
        }
        if (entries.length > 0) break
        await removePathIfPresent(parent)
        parent = parent.substring(0, parent.lastIndexOf("/"))
      }
    }
  }

  return {
    async readFile(filepath: string, opts?: any): Promise<any> {
      const resolved = resolvePath(filepath)
      try {
        const encoding = typeof opts === "string" ? opts : opts?.encoding
        if (encoding === "utf8") {
          return await fileManager.readAsString(resolved, "utf8")
        }
        const bytes = await fileManager.readAsBytes(resolved)
        return Buffer.from(bytes)
      } catch (e: any) {
        rethrowFsError(e, "open", filepath)
      }
    },

    async writeFile(filepath: string, data: any, _opts?: any): Promise<void> {
      const resolved = resolvePath(filepath)
      const parentDir = resolved.substring(0, resolved.lastIndexOf("/"))
      try {
        if (!(await fileManager.exists(parentDir))) {
          await fileManager.createDirectory(parentDir, true)
        }
      } catch (e: any) {
        if (!isAlreadyExistsError(e)) throw e
      }
      if (typeof data === "string") {
        await fileManager.writeAsString(resolved, data, "utf8")
        return
      }
      // 规范化二进制为准确范围的 Uint8Array
      let bytes: Uint8Array
      if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(data)) {
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data)
      } else if (data instanceof Uint8Array) {
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      } else {
        bytes = new Uint8Array(data)
      }
      await fileManager.writeAsBytes(resolved, bytes)
    },

    async mkdir(filepath: string, _opts?: any): Promise<void> {
      const resolved = resolvePath(filepath)
      try {
        await fileManager.createDirectory(resolved, true)
      } catch (e: any) {
        if (!isAlreadyExistsError(e)) throw e
      }
    },

    async rmdir(filepath: string): Promise<void> {
      await removePathIfPresent(filepath)
    },

    async unlink(filepath: string): Promise<void> {
      const removed = await removePathIfPresent(filepath)
      if (removed) rememberEmptyWorkdirParent(filepath)
    },

    async pruneEmptyWorkdirParents(): Promise<void> {
      await pruneEmptyWorkdirParents()
    },

    clearEmptyWorkdirParentCandidates(): void {
      emptyWorkdirParentCandidates.clear()
    },

    async exists(filepath: string): Promise<boolean> {
      try {
        return await fileManager.exists(resolvePath(filepath))
      } catch (e: any) {
        if (isMissingError(e)) return false
        throw e
      }
    },

    async readdir(filepath: string): Promise<string[]> {
      const dirPath = resolvePath(filepath)
      const entries = await fileManager.readDirectory(dirPath)
      // FileManager 可能返回绝对路径或相对名；
      // isomorphic-git 要求 readdir 只返回 basename，否则 statusMatrix 会把工作区误判为全部删除
      return entries.map((entry) => {
        const raw = String(entry || "")
        if (!raw) return raw
        // 去掉末尾斜杠
        const trimmed = raw.replace(/\/+$/, "")
        if (!trimmed.includes("/")) return trimmed
        const parts = trimmed.split("/").filter(Boolean)
        return parts[parts.length - 1] || trimmed
      })
    },

    async stat(filepath: string): Promise<any> {
      const resolved = resolvePath(filepath)
      try {
        // FileStat.type 在部分路径上不可靠（目录也可能报 file），必须用 isDirectory。
        // 与 isFile 串行三连相比：并行 stat+isDirectory，少一轮往返、少一次 isFile。
        // statusMatrix 会扫全工作区，这是大仓库状态慢的主要 FS 开销之一。
        const [st, isDir] = await Promise.all([
          fileManager.stat(resolved),
          fileManager.isDirectory(resolved),
        ])
        const kind = String(st?.type || "").toLowerCase()
        const isLink =
          !isDir && (kind === "link" || kind === "symlink")
        const isFile = !isDir && !isLink
        return {
          type: isDir ? "dir" : isLink ? "symlink" : "file",
          mode: isDir ? 0o40000 : isLink ? 0o120000 : 0o100644,
          size: st.size || 0,
          ino: 0,
          mtimeMs: dateToMillis(st.modificationDate),
          ctimeMs: dateToMillis(st.creationDate),
          isFile: () => isFile,
          isDirectory: () => isDir,
          isSymbolicLink: () => isLink,
        }
      } catch (e: any) {
        rethrowFsError(e, "stat", filepath)
      }
    },

    async lstat(filepath: string): Promise<any> {
      return this.stat(filepath)
    },

    async readlink(filepath: string): Promise<string> {
      return fileManager.destinationOfSymbolicLink(resolvePath(filepath))
    },

    async symlink(target: string, filepath: string): Promise<void> {
      await fileManager.createLink(resolvePath(filepath), target)
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      await fileManager.rename(resolvePath(oldPath), resolvePath(newPath))
    },
  }
}

/** 加载 isomorphic-git UMD bundle（eval 包装提取 module.exports） */
async function loadGitBundle(): Promise<any> {
  if (!(await FileManager.exists(BUNDLE_PATH))) {
    throw new Error("isomorphic-git bundle 未找到: " + BUNDLE_PATH)
  }
  const bundleCode = await FileManager.readAsString(BUNDLE_PATH, "utf8")
  const wrappedCode =
    "(function() {\n" +
    "var self = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});\n" +
    "var module = { exports: {} };\n" +
    "var exports = module.exports;\n" +
    bundleCode +
    "\n" +
    "return module.exports;\n" +
    "})()"
  const git = eval(wrappedCode)
  if (!git || typeof git.init !== "function") {
    throw new Error("加载 isomorphic-git 失败")
  }
  return git
}

/** git 引擎单例（懒加载，全局复用） */
let _gitEngine: any = null

/** 向 isomorphic-git 转发 HTTP 阶段进度（可 async；取消错误原样抛出） */
async function reportHttpProgress(
  onProgress: any,
  phase: string,
  loaded = 0,
  total = 0
): Promise<void> {
  if (typeof onProgress !== "function") return
  await onProgress({ phase, loaded, total })
}

/**
 * HTTP 传输适配器（用于 push/pull/clone）
 * 移植自 isomorphic-git 技能的 createHttpTransport：
 * 用 Scripting 的 fetch + Data 处理 git 协议的二进制流式请求。
 * 关键修复：toUint8Array() 可能返回只读视图，必须复制为可写副本。
 * 进度：透传 request.onProgress，在上传/等待响应/读响应时上报阶段。
 */
export function createHttpTransport(username?: string, password?: string) {
  return {
    async request({ url, method, headers, body, onProgress }: any) {
      const fetchHeaders: any = { ...headers }
      if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString("base64")
        fetchHeaders["Authorization"] = `Basic ${auth}`
      }

      // 请求体：把异步可读流转为单个 Data 对象，边收集边上报上传进度
      let fetchBody: any = undefined
      if (body) {
        await reportHttpProgress(onProgress, "Uploading", 0, 0)
        const chunks: Uint8Array[] = []
        let loaded = 0
        for await (const chunk of body) {
          const u8 =
            chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
          chunks.push(u8)
          loaded += u8.length
          await reportHttpProgress(onProgress, "Uploading", loaded, 0)
        }
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
        const allBytes = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          allBytes.set(chunk, offset)
          offset += chunk.length
        }
        fetchBody = Data.fromUint8Array(allBytes)
        if (totalLength > 0) {
          await reportHttpProgress(
            onProgress,
            "Uploading",
            totalLength,
            totalLength
          )
        }
      }

      await reportHttpProgress(onProgress, "Downloading", 0, 0)
      const response = await fetch(url, {
        method: method || "GET",
        headers: fetchHeaders,
        body: fetchBody,
      })

      // 响应体：优先用 response.data()，备用 arrayBuffer；均复制为可写副本
      let result: any
      try {
        const dataObj = await response.data()
        if (dataObj && typeof dataObj.toUint8Array === "function") {
          const uint8Data = dataObj.toUint8Array()
          const mutableCopy = new Uint8Array(uint8Data.length)
          mutableCopy.set(uint8Data)
          result = Buffer.from(mutableCopy)
        } else {
          result = Buffer.alloc(0)
        }
      } catch (e1) {
        try {
          const responseData = await response.arrayBuffer()
          const mutableCopy = new Uint8Array(responseData)
          result = Buffer.from(mutableCopy)
        } catch (e2) {
          result = Buffer.alloc(0)
        }
      }

      const byteLength =
        result && typeof result.length === "number" ? result.length : 0
      if (byteLength > 0) {
        await reportHttpProgress(
          onProgress,
          "Downloading",
          byteLength,
          byteLength
        )
      }

      const responseHeaders: any = {}
      response.headers.forEach((value: string, key: string) => {
        responseHeaders[key.toLowerCase()] = value
      })

      // isomorphic-git 要求 body 是可迭代的异步生成器
      const bodyIterable = (async function* () {
        yield result
      })()

      return {
        url: response.url || url,
        statusCode: response.status,
        headers: responseHeaders,
        body: bodyIterable,
      }
    },
  }
}

/**
 * 加载并返回 git 引擎 + fs 工厂
 * 首次调用会加载 Buffer polyfill 与 UMD bundle，后续直接返回缓存
 */
export async function loadGitEngine(): Promise<{ git: any; createFS: typeof createFS }> {
  if (!_gitEngine) {
    await loadBufferPolyfill()
    const git = await loadGitBundle()
    _gitEngine = { git, createFS }
  }
  return _gitEngine
}
