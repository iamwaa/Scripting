// 中转账号管理 - 常量定义
import { Path, Script } from "scripting"
import type { AccountPlatform } from "./types"

// 数据存储路径
export const DATA_DIR = Path.join(Path.dirname(Path.dirname(Script.directory)), 'configs', '中转账号管理数据')
export const ACCOUNTS_FILE = Path.join(DATA_DIR, 'accounts.json')
export const SORT_FILE = Path.join(DATA_DIR, 'sort.json')
export const SECRETS_FILE = Path.join(DATA_DIR, 'secrets.json')
export const SECRET_PREFIX = "newapi.secret."

// 每美元对应配额值
export const QUOTA_PER_USD = 500000

// 连通性自动检测间隔（秒）
export const SITE_STATUS_AUTO_CHECK_INTERVAL = 360 * 60

// 平台协议族：newapi 系走 /api/user/* + { success, data } 信封，sub2api 走 /api/v1/* + { code, data } 信封
export type PlatformFamily = "newapi" | "sub2api"

// 平台签到端点（sub2api 由 services/api.ts 的专用实现处理，不走此配置）
export type PlatformCheckin = {
  statusPath: (month: string) => string
  doPath: string
}

export type PlatformCapability = {
  label: string
  family: PlatformFamily
  // 需要随请求发送的用户 ID 头，各分支命名不同；空数组表示该平台只认 Authorization / Cookie
  userIdHeaders: string[]
  checkin?: PlatformCheckin
  // 签到状态接口是否返回当月签到历史（Veloera 只返回 can_check_in，需本地补历史）
  checkinHistory: boolean
}

// NewAPI 系通用签到端点：GET 带 month 查当月状态，POST 执行签到
const NEWAPI_CHECKIN: PlatformCheckin = {
  statusPath: month => `/api/user/checkin?month=${encodeURIComponent(month)}`,
  doPath: "/api/user/checkin",
}

// 平台能力表：OneAPI / OneHub / DoneHub 上游没有签到接口，仍按 NewAPI 端点探测，
// 路由不存在时由调用方降级为“签到功能未启用”，以兼容二开加装签到的站点
export const PLATFORMS: Record<AccountPlatform, PlatformCapability> = {
  newapi: {
    label: "NewAPI",
    family: "newapi",
    userIdHeaders: ["New-Api-User"],
    checkin: NEWAPI_CHECKIN,
    checkinHistory: true,
  },
  oneapi: {
    label: "OneAPI",
    family: "newapi",
    userIdHeaders: [],
    checkin: NEWAPI_CHECKIN,
    checkinHistory: true,
  },
  onehub: {
    label: "OneHub",
    family: "newapi",
    userIdHeaders: [],
    checkin: NEWAPI_CHECKIN,
    checkinHistory: true,
  },
  donehub: {
    label: "DoneHub",
    family: "newapi",
    userIdHeaders: [],
    checkin: NEWAPI_CHECKIN,
    checkinHistory: true,
  },
  veloera: {
    label: "Veloera",
    family: "newapi",
    userIdHeaders: ["Veloera-User", "New-Api-User"],
    // Veloera 的签到路径带下划线，状态接口只返回 can_check_in
    checkin: { statusPath: () => "/api/user/check_in_status", doPath: "/api/user/check_in" },
    checkinHistory: false,
  },
  sub2api: {
    label: "Sub2API",
    family: "sub2api",
    userIdHeaders: [],
    checkinHistory: false,
  },
}

// 平台选择器展示顺序，同时作为平台标识白名单
export const PLATFORM_KEYS: AccountPlatform[] = ["newapi", "oneapi", "onehub", "donehub", "veloera", "sub2api"]
