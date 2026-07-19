// 收件箱列表中的邮件摘要
export type MessageSummary = {
  id: string
  subject?: string
  from?: {
    name?: string
    address?: string
  } | string
  to?: any
  intro?: string
  text?: string
  html?: string[] | string
  createdAt?: string | number
  created_at?: string
  date?: number
  seen?: boolean
  [key: string]: any
}

// 邮件详情
export type MessageDetail = MessageSummary & {
  text?: string
  html?: string[] | string
  body?: string
}
