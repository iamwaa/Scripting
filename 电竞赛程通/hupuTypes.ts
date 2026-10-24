// ---- 虎扑赛程 ----

// 赛程里携带的「当场最热评分条目」摘要，同时是进入评分页的入口
// 实测按评分人数最多挑出（不一定是最高分），bizType / bizNo 是虎扑评分树的业务键
export interface HupuRatingEntry {
  bizType: string
  bizNo: string
  name: string
  score: number | null
  countText: string
  hotComment: string
}

export interface HupuMatch {
  matchId: string
  gameId: string
  status: string
  statusDesc: string
  // 毫秒时间戳
  startTime: number
  intro: string
  homeName: string
  awayName: string
  homeScore: number | null
  awayScore: number | null
  homeLogo: string
  awayLogo: string
  // 整场比赛的评分人数文案,如「1.6万人评分」;无评分时为空
  scoreCountText: string
  // 无评分的比赛为 null
  rating: HupuRatingEntry | null
}

// ---- 评分页 ----

export interface HupuTeam {
  id: string
  name: string
  logo: string
  // 系列赛比分,无数据时为 null
  score: number | null
}

// 评分树里的「局」，单局制比赛只有一个占位项
export interface HupuPeriod {
  bizType: string
  bizNo: string
  name: string
  order: number
}

export interface HupuScoreBoard {
  // 赛事名称(赛事类型 · 阶段),头部首行
  competitionLabel: string
  // 比赛开始时间(毫秒),0 表示未知
  matchTime: number
  teams: HupuTeam[]
  // 胜方队伍 id（取自比赛节点 winTeamId），未结束/平局/未知时为空
  winnerTeamId: string
  periods: HupuPeriod[]
  defaultPeriodBizNo: string
}

export interface HupuScoreCard {
  bizType: string
  bizNo: string
  name: string
  avatar: string
  // 本局使用的英雄/角色头像；教练、解说、无畏契约等无该数据时为空
  heroPic: string
  score: number | null
  scoreCount: number
  commentCount: number
  // 如 K/D/A:9/2/6，教练/解说为空
  desc: string
  // 归属队伍的 teamId，解说等无队伍时为空
  teamId: string
  hotComment: string
  hotCommentUser: string
  hotCommentAvatar: string
}

// ---- 评论 ----

export interface HupuComment {
  id: string
  user: string
  avatar: string
  content: string
  date: string
  ip: string
  // 该用户给此对象打的分，0 表示没打分
  score: number
  lightCount: number
  replyTo: string
}
