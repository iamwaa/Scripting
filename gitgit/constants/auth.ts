/**
 * constants/auth.ts - 认证相关常量
 *
 * Keychain key 复用 isomorphic-git 技能的约定值，
 * 用户在技能里配置过的 token 可直接在 gitgit 中复用。
 */

// Keychain 键名（token 等敏感凭据走系统 Keychain）
export const KC_TOKEN_KEY = "isomorphic_git_token"
export const KC_USERNAME_KEY = "isomorphic_git_username"

// GitHub PAT 用户名约定（细粒度 token 用仓库 owner，经典 token 用 x-access-token）
export const GITHUB_DEFAULT_USERNAME = "x-access-token"

/** 未配置 user.name / user.email 时的默认提交身份 */
export const DEFAULT_GIT_IDENTITY = {
  name: "gitgit",
  email: "gitgit@local",
} as const
