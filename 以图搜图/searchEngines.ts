export type SearchEngineKind = "web" | "tracemoe" | "saucenao" | "baidu"

export type SearchEngine = {
  name: string
  displayName: string
  subtitle: string
  template: string
  systemImage: string
  kind: SearchEngineKind
}

export const uploadServerURL = "https://sbi.ccloli.com/img/upload.php"

export const searchEngines: SearchEngine[] = [
  {
    name: "3D IQDB",
    displayName: "3D IQDB（3D）",
    subtitle: "网页结果：真实/3D 图片搜索",
    template: "https://3d.iqdb.org/?url={url}",
    systemImage: "cube.transparent.fill",
    kind: "web",
  },
  {
    name: "AnimeTrace",
    displayName: "AnimeTrace（动漫）",
    subtitle: "网页入口：PicImageSearch 用 API POST，当前网页不一定自动带图搜索",
    template: "https://www.animetrace.com/?url={url}",
    systemImage: "person.crop.rectangle.stack.fill",
    kind: "web",
  },
  {
    name: "IQDB",
    displayName: "IQDB（动漫）",
    subtitle: "网页结果：二次元图源搜索",
    template: "https://iqdb.org/?url={url}",
    systemImage: "rectangle.stack.badge.person.crop.fill",
    kind: "web",
  },
  {
    name: "SauceNAO",
    displayName: "SauceNAO（动漫）",
    subtitle: "原生结果：动漫、插画来源",
    template: "https://saucenao.com/search.php?db=999&url={url}",
    systemImage: "paintpalette.fill",
    kind: "saucenao",
  },
  {
    name: "TraceMoe",
    displayName: "TraceMoe（动漫）",
    subtitle: "原生结果：动画截图来源",
    template: "https://trace.moe/?url={url}",
    systemImage: "film.fill",
    kind: "tracemoe",
  },
  {
    name: "Ascii2D",
    displayName: "Ascii2D（插画）",
    subtitle: "网页结果：插画相似图检索；站点可能有 Cloudflare 验证",
    template: "https://ascii2d.net/search/url/{url}",
    systemImage: "sparkles.rectangle.stack.fill",
    kind: "web",
  },
  {
    name: "Copyseeker",
    displayName: "Copyseeker（来源）",
    subtitle: "网页入口：PicImageSearch 需 Next Action API，当前网页不一定自动带图搜索",
    template: "https://copyseeker.net/?url={url}",
    systemImage: "doc.text.magnifyingglass",
    kind: "web",
  },
  {
    name: "TinEye",
    displayName: "TinEye（来源）",
    subtitle: "网页结果：反向查找图片来源；站点可能有 Cloudflare 验证",
    template: "https://www.tineye.com/search?url={url}",
    systemImage: "eye.fill",
    kind: "web",
  },
  {
    name: "Bing",
    displayName: "Bing（综合）",
    subtitle: "当前网页直连容易失效，建议改用 Google/Yandex；待后续接入 Bing 原生 API",
    template:
      "https://www.bing.com/images/search?view=detailv2&iss=sbi&FORM=SBIHMP&sbisrc=UrlPaste&q=imgurl:{url}&idpbck=1",
    systemImage: "magnifyingglass.circle.fill",
    kind: "web",
  },
  {
    name: "Google Lens",
    displayName: "Google（综合）",
    subtitle: "网页结果：综合识图、商品、相似图片",
    template: "https://lens.google.com/uploadbyurl?url={url}",
    systemImage: "camera.viewfinder",
    kind: "web",
  },
  {
    name: "Yandex",
    displayName: "Yandex（综合）",
    subtitle: "网页结果：图片来源和相似图；与 PicImageSearch URL 流程一致",
    template: "https://yandex.com/images/search?rpt=imageview&cbir_page=sites&url={url}",
    systemImage: "photo.stack",
    kind: "web",
  },
  {
    name: "百度识图",
    displayName: "百度（综合）",
    subtitle: "真实上传到百度识图后显示网页结果",
    template: "",
    systemImage: "b.circle.fill",
    kind: "baidu",
  },
]

export function buildSearchURL(template: string, imageURL: string) {
  return template.replace("{url}", encodeURIComponent(imageURL))
}
