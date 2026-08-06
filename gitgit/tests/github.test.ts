import { Script } from "scripting"
import {
  avatarUrlForGitAuthor,
  githubMarkdownForDisplay,
  githubRepoFromRemoteUrl,
} from "../utils/github"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

function main(): void {
  assert(
    githubRepoFromRemoteUrl("https://github.com/octo/demo.git") === "octo/demo",
    "解析 HTTPS remote"
  )
  assert(
    githubRepoFromRemoteUrl("git@github.com:octo/demo.git") === "octo/demo",
    "解析 scp-like SSH remote"
  )
  assert(
    githubRepoFromRemoteUrl("ssh://git@github.com/octo/demo.git") === "octo/demo",
    "解析 SSH URL"
  )
  assert(
    githubRepoFromRemoteUrl("https://gitlab.com/octo/demo.git") === null,
    "拒绝非 GitHub remote"
  )
  assert(githubRepoFromRemoteUrl("invalid") === null, "拒绝无效 remote")
  assert(
    githubRepoFromRemoteUrl("https://github.com/octo/group/demo.git") === null,
    "拒绝多级仓库路径"
  )

  const markdown = githubMarkdownForDisplay(
    "Type: <b>Bug</b>\n\nSee #12 and @octocat.\n\n[doc](docs/help.md) ![logo](images/logo.png)\n\n`<b>code</b>`",
    "octo/demo"
  )
  assert(markdown.includes("Type: **Bug**"), "转换 GitHub 内嵌 HTML")
  assert(
    markdown.includes("[#12](https://github.com/octo/demo/issues/12)"),
    "转换 Issue 引用链接"
  )
  assert(
    markdown.includes("[@octocat](https://github.com/octocat)"),
    "转换用户提及链接"
  )
  assert(
    markdown.includes("[doc](https://github.com/octo/demo/blob/HEAD/docs/help.md)"),
    "解析仓库内相对链接"
  )
  assert(
    markdown.includes("![logo](https://raw.githubusercontent.com/octo/demo/HEAD/images/logo.png)"),
    "解析仓库内相对图片"
  )
  assert(markdown.includes("`<b>code</b>`"), "不转换行内代码中的 HTML")

  assert(
    avatarUrlForGitAuthor("12345+octocat@users.noreply.github.com") ===
      "https://github.com/octocat.png",
    "解析带 ID 的 GitHub noreply 邮箱"
  )
  assert(
    avatarUrlForGitAuthor("octocat@users.noreply.github.com") ===
      "https://github.com/octocat.png",
    "解析无 ID 的 GitHub noreply 邮箱"
  )
  assert(
    avatarUrlForGitAuthor(" Bob@Example.COM ") ===
      "https://www.gravatar.com/avatar/4b9bb80620f03eb3719e0a061c14283d?s=64&d=https%3A%2F%2Fgithub.githubassets.com%2Fimages%2Fgravatars%2Fgravatar-user-420.png",
    "普通邮箱走 Gravatar（去空格并小写后取 MD5），无账号回 GitHub 默认头像"
  )
  assert(avatarUrlForGitAuthor("") === "", "空邮箱不生成头像 URL")
}

try {
  main()
  console.log("github tests passed")
  Script.exit("github tests passed")
} catch (error) {
  console.error(error)
  throw error
}
