declare const Crypto: any
declare const Data: any

// 计算字符串的 SHA-256 十六进制摘要（与浏览器 crypto.subtle.digest("SHA-256") 结果一致）
// 用于二开 new-api 站点的签到 PoW 签名：signature = sha256Hex(`${userId}:${ts}:${nonce}`)
export function sha256Hex(text: string): string {
  const data = Data.fromString(text)
  return Crypto.sha256(data).toHexString()
}
