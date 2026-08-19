// 全局共享的数据类型定义

export type WhatsLinkScreenshot = {
  time?: number;
  screenshot: string;
};

export type WhatsLinkResponse = {
  error?: string;
  type?: string;
  file_type?: string;
  name?: string;
  size?: number;
  count?: number;
  screenshots?: WhatsLinkScreenshot[];
};

export type FavoriteItem = {
  id: string;
  url: string;
  name: string;
  size: number;
  count: number;
  type: string;
  fileType: string;
  cover?: string;
  createdAt: number;
};

export type XciliSearchItem = {
  id: string;
  title: string;
  /** 收录日期，来自搜索结果的 result-date */
  date: string;
  size: string;
  detailUrl: string;
};

export type XciliDetailFile = {
  name: string;
  size: string;
};

export type XciliDetailInfo = {
  title: string;
  magnet: string;
  files: XciliDetailFile[];
};

export type GlassVariant = "card" | "input" | "control" | "prominent" | "icon";
