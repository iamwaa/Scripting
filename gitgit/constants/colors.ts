/**
 * constants/colors.ts - 语义色常量
 *
 * Scripting 的 Color 是字符串联合类型（非对象），
 * 这里集中定义项目用到的语义色，确保组件统一、且自动适配暗黑模式。
 */

// 文本语义色（自动随系统外观切换）
export const COLOR_LABEL = "label"
export const COLOR_SECONDARY_LABEL = "secondaryLabel"
export const COLOR_TERTIARY_LABEL = "tertiaryLabel"
export const COLOR_GRAY = "systemGray" // 头像占位/回退

// 背景语义色
export const COLOR_BG = "systemBackground"
export const COLOR_SECONDARY_BG = "secondarySystemBackground"
export const COLOR_TERTIARY_BG = "tertiarySystemBackground"

// 分隔线
export const COLOR_SEPARATOR = "separator"

// 强调 / 状态语义色
export const COLOR_ACCENT = "systemBlue"
export const COLOR_GREEN = "systemGreen" // 已提交 / 同步成功
export const COLOR_ORANGE = "systemOrange" // 未暂存 / 本地改动
export const COLOR_RED = "systemRed" // 删除 / 错误 / 落后远端
export const COLOR_PURPLE = "systemPurple" // 新增
