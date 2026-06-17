// 人物档案
export interface Person {
  id: string
  name: string
  avatarPath: string | null
  relationship?: string // 人物关系
  notes: string
  isPinned?: boolean // 是否置顶
  createdAt: number
}

// 纪念日类型
export type EventType =
  | 'birthday'     // 生日
  | 'meet'         // 相识
  | 'love'         // 恋爱
  | 'wedding'      // 结婚
  | 'enrollment'   // 入学
  | 'graduation'   // 毕业
  | 'join'         // 入职
  | 'custom'       // 其他自定义

// 单条纪念日/提醒事件
export interface AnniversaryEvent {
  id: string
  personId: string
  title: string
  type: EventType
  isLunar: boolean
  // 公历日期（ISO 字符串 yyyy-MM-dd），作为基准日期
  gregorianDate: string
  // 农历字段（当 isLunar 为 true 时有效）
  lunarYear: number | null
  lunarMonth: number | null
  lunarDay: number | null
  isLeapMonth: boolean
  // 提醒设置
  reminderDays: number[]
  remindOnDay: boolean
  repeatYearly: boolean
  repeatMonthly: boolean // 每月重复
  isPinned?: boolean // 是否置顶
  showYearsAndDays?: boolean // 倒数日是否显示年+天格式
  createdAt: number
}

// 应用全局设置
export interface AppSettings {
  defaultReminderDays: number[]
  defaultRemindOnDay: boolean
  notificationsEnabled: boolean
  groupPastEvents: boolean // 是否将已过的纪念日归入「纪念日」分组
  notificationHour: number // 通知时间（小时，0-23），默认9
  notificationMinute: number // 通知时间（分钟，0-59），默认0
}

// 完整持久化数据
export interface AppData {
  persons: Person[]
  events: AnniversaryEvent[]
  settings: AppSettings
  version: number
}

// 计算后的下次纪念日信息
export interface OccurrenceInfo {
  event: AnniversaryEvent
  person: Person
  nextDate: Date
  daysLeft: number
  age?: number
  yearsPassed?: number
}
