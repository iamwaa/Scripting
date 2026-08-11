export type GitHubItemState = "open" | "closed"
export type GitHubIssueFilter = "open" | "closed" | "all"

export interface GitHubLabel {
  name: string
  color: string
}

export interface GitHubActor {
  login: string
  avatarUrl: string
}

export interface GitHubIssueItem {
  number: number
  title: string
  body: string
  state: GitHubItemState
  author: GitHubActor
  labels: GitHubLabel[]
  comments: number
  createdAt: string
  updatedAt: string
  closedAt: string | null
  htmlUrl: string
  isPullRequest: boolean
  draft: boolean
  merged: boolean
}

export interface GitHubComment {
  id: number
  body: string
  author: GitHubActor
  createdAt: string
  updatedAt: string
  htmlUrl: string
}

export interface GitHubIssuePage {
  items: GitHubIssueItem[]
  hasMore: boolean
}

export type GitHubCommitAvatarMap = Record<string, string>

export interface CreateGitHubIssueInput {
  title: string
  body?: string
}
