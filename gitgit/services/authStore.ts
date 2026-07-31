/**
 * services/authStore.ts - GitHub token + Git 身份管理
 *
 * 职责：
 *  1. GitHub PAT 的 Keychain 存取（敏感凭据仍走系统 Keychain）
 *  2. Git 提交身份（user.name / user.email）的持久化（Storage private 域，旧实现为 JSON 文件）
 *  3. 构造 isomorphic-git 认证对象（{ username, password }）
 *  4. Token 验证状态（GitHub 用户名）持久化到 Storage private 域，token 变更/清除时作废
 */

import {
  KC_TOKEN_KEY,
  KC_USERNAME_KEY,
  GITHUB_DEFAULT_USERNAME,
  DEFAULT_GIT_IDENTITY,
} from "../constants/auth"
import {
  readIdentity,
  writeIdentity,
  readGithubUser,
  writeGithubUser,
} from "./storage"
import type { GitIdentity } from "../types/git"

// 重新导出类型，保持调用处 `import type { GitIdentity } from authStore` 可用
export type { GitIdentity }
export { DEFAULT_GIT_IDENTITY }

// === GitHub PAT ===

/** 是否已配置 token */
export function hasToken(): boolean {
  return Keychain.contains(KC_TOKEN_KEY)
}

/** 读取 token（未配置返回 null） */
export function getToken(): string | null {
  return Keychain.get(KC_TOKEN_KEY)
}

/** 保存 token（用户名默认 x-access-token，可覆盖） */
export function setToken(token: string, username?: string): void {
  const tokenSaved = Keychain.set(KC_TOKEN_KEY, token)
  const usernameSaved = Keychain.set(
    KC_USERNAME_KEY,
    username || GITHUB_DEFAULT_USERNAME
  )
  if (!tokenSaved || !usernameSaved) {
    if (tokenSaved) Keychain.remove(KC_TOKEN_KEY)
    if (usernameSaved) Keychain.remove(KC_USERNAME_KEY)
    throw new Error("GitHub Token 保存到 Keychain 失败")
  }
  // 凭据已更换，旧的验证结果作废
  writeGithubUser(null)
}

/** 清除 token */
export function clearToken(): void {
  const tokenRemoved =
    !Keychain.contains(KC_TOKEN_KEY) || Keychain.remove(KC_TOKEN_KEY)
  const usernameRemoved =
    !Keychain.contains(KC_USERNAME_KEY) || Keychain.remove(KC_USERNAME_KEY)
  if (!tokenRemoved || !usernameRemoved) {
    throw new Error("GitHub Token 从 Keychain 清除失败")
  }
  writeGithubUser(null)
}

/** 读取 Token 上次验证成功的 GitHub 用户名（未验证/已作废返回 null） */
export function getVerifiedUser(): string | null {
  return readGithubUser()
}

/** 保存 Token 验证成功的 GitHub 用户名，供设置页重进时恢复验证状态 */
export function saveVerifiedUser(login: string): void {
  writeGithubUser(login)
}

/**
 * 构造 isomorphic-git 认证对象
 * 未配置 token 时返回 null（由调用方决定是否中止 / 提示配置）
 */
export function getAuth(): { username: string; password: string } | null {
  const token = getToken()
  if (!token) return null
  const username = Keychain.get(KC_USERNAME_KEY) || GITHUB_DEFAULT_USERNAME
  return { username, password: token }
}

// === Git 提交身份 ===

/** 读取已保存的 Git 身份（未配置返回 null） */
export async function getIdentity(): Promise<GitIdentity | null> {
  return readIdentity()
}

/** 保存 Git 身份 */
export async function setIdentity(identity: GitIdentity): Promise<void> {
  writeIdentity(identity)
}

/**
 * 解析提交/拉取用作者。
 * 优先级：传入 override → 设置页已保存身份 → 默认 gitgit。
 * 空字符串视为未填写。
 */
export async function resolveAuthor(
  override?: { name?: string; email?: string } | null
): Promise<GitIdentity> {
  const oName = override?.name?.trim()
  const oEmail = override?.email?.trim()
  if (oName && oEmail) return { name: oName, email: oEmail }

  const saved = await getIdentity()
  const sName = saved?.name?.trim()
  const sEmail = saved?.email?.trim()
  if (sName && sEmail) return { name: sName, email: sEmail }

  return {
    name: DEFAULT_GIT_IDENTITY.name,
    email: DEFAULT_GIT_IDENTITY.email,
  }
}
