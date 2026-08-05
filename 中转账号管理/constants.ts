// 中转账号管理 - 常量定义
import { Path, Script } from "scripting"

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
