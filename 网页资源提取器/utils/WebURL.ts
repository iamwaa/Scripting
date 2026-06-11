// 简易 URL 解析器，替代浏览器原生的 URL 对象
export class WebURL {
  href: string = ""
  host: string = ""
  hostname: string = ""
  pathname: string = ""

  constructor(url: string, base?: string) {
    let finalUrl = url
    // 如果存在 base 且当前 url 不是绝对路径，则进行相对路径拼接
    if (base && !/^(https?:\/\/|data:)/i.test(url)) {
      if (url.startsWith("//")) {
        const proto = base.match(/^https?:/i)?.[0] || "https:"
        finalUrl = proto + url
      } else if (url.startsWith("/")) {
        const origin = base.match(/^(https?:\/\/[^\/]+)/i)?.[1] || ""
        finalUrl = origin + url
      } else {
        const basePath = base.split("?")[0].split("#")[0].replace(/\/[^\/]*$/, "")
        finalUrl = basePath + "/" + url
      }
    }
    
    this.href = finalUrl
    
    const hostMatch = finalUrl.match(/^https?:\/\/([^\/]+)/i)
    if (hostMatch) {
      this.host = hostMatch[1]
      this.hostname = hostMatch[1].split(":")[0]
    }
    
    const pathMatch = finalUrl.match(/^https?:\/\/[^\/]+(\/[^?#]*)/i)
    this.pathname = pathMatch ? pathMatch[1] : "/"
  }
}
