import { ReadableStream } from "scripting"

// SSE 流读取：按字节缓冲切行，再整行解码
// 不能对每个分片直接解码，多字节字符可能被分片切断而变成乱码；换行字节不会出现在 UTF-8 多字节序列中，因此按行切分是安全的
export async function readSSEStream(stream: ReadableStream<Data>, onLine: (line: string) => void): Promise<string> {
  const reader = stream.getReader()
  let lineBytes: number[] = []
  let raw = ""

  function flushLine() {
    if (lineBytes.length === 0) return
    const text = Data.fromIntArray(lineBytes)?.toRawString() ?? ""
    lineBytes = []
    raw += `${text}\n`
    const line = text.trim()
    if (line) onLine(line)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const bytes = value?.toIntArray() ?? []
      for (const byte of bytes) {
        // 10 = \n 行结束，13 = \r 直接丢弃
        if (byte === 10) flushLine()
        else if (byte !== 13) lineBytes.push(byte)
      }
    }
    flushLine()
  } finally {
    reader.releaseLock()
  }
  return raw
}
