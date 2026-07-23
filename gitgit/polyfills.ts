/**
 * polyfills.ts - 为 Scripting 环境补齐 isomorphic-git 依赖的 Web API
 *
 * 内容与 isomorphic-git 技能内的 polyfills.ts 一致：
 *  - TextEncoder / TextDecoder
 *  - Buffer（npm buffer@6 的 UMD bundle）
 */

// TextEncoder polyfill
if (typeof (globalThis as any).TextEncoder === "undefined") {
  ;(globalThis as any).TextEncoder = class TextEncoder {
    encode(input: string = ""): Uint8Array {
      const utf8: number[] = []
      for (let i = 0; i < input.length; i++) {
        let c = input.charCodeAt(i)
        if (c < 0x80) {
          utf8.push(c)
        } else if (c < 0x800) {
          utf8.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
        } else if (c < 0xd800 || c >= 0xe000) {
          utf8.push(
            0xe0 | (c >> 12),
            0x80 | ((c >> 6) & 0x3f),
            0x80 | (c & 0x3f)
          )
        } else {
          i++
          c =
            0x10000 +
            (((c & 0x3ff) << 10) | (input.charCodeAt(i) & 0x3ff))
          utf8.push(
            0xf0 | (c >> 18),
            0x80 | ((c >> 12) & 0x3f),
            0x80 | ((c >> 6) & 0x3f),
            0x80 | (c & 0x3f)
          )
        }
      }
      return new Uint8Array(utf8)
    }
  }
}

// TextDecoder polyfill
if (typeof (globalThis as any).TextDecoder === "undefined") {
  ;(globalThis as any).TextDecoder = class TextDecoder {
    decode(input?: Uint8Array | ArrayBuffer): string {
      if (!input) return ""
      const bytes =
        input instanceof Uint8Array ? input : new Uint8Array(input)
      let result = ""
      let i = 0
      while (i < bytes.length) {
        const b = bytes[i]
        if (b < 0x80) {
          result += String.fromCharCode(b)
          i++
        } else if ((b & 0xe0) === 0xc0 && i + 1 < bytes.length) {
          result += String.fromCharCode(
            ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)
          )
          i += 2
        } else if ((b & 0xf0) === 0xe0 && i + 2 < bytes.length) {
          result += String.fromCharCode(
            ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
          )
          i += 3
        } else if ((b & 0xf8) === 0xf0 && i + 3 < bytes.length) {
          const cp =
            ((b & 0x07) << 18) |
            ((bytes[i + 1] & 0x3f) << 12) |
            ((bytes[i + 2] & 0x3f) << 6) |
            (bytes[i + 3] & 0x3f)
          result += cp <= 0x10ffff ? String.fromCodePoint(cp) : "\ufffd"
          i += 4
        } else {
          result += "\ufffd"
          i++
        }
      }
      return result
    }
  }
}

/**
 * 加载 npm buffer polyfill 的 UMD bundle
 * bundle 设置 module.exports = { Buffer, ... }，映射到 globalThis.Buffer
 */
export async function loadBufferPolyfill(): Promise<void> {
  const bundlePath =
    FileManager.scriptsDirectory + "/gitgit/vendor/buffer-bundle.js"

  if (!(await FileManager.exists(bundlePath))) {
    throw new Error("buffer-bundle.js 未找到: " + bundlePath)
  }

  const code = await FileManager.readAsString(bundlePath, "utf8")

  // 包装为 CommonJS 环境，提取 module.exports
  const wrappedCode =
    "(function() {\n" +
    "var self = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});\n" +
    "var window = undefined;\n" +
    "var module = { exports: {} };\n" +
    "var exports = module.exports;\n" +
    code +
    "\n" +
    "return module.exports;\n" +
    "})()"

  const bufExports = eval(wrappedCode)

  if (bufExports && bufExports.Buffer) {
    ;(globalThis as any).Buffer = bufExports.Buffer
  } else {
    throw new Error("Buffer polyfill 加载失败")
  }
}
