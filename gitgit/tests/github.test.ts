import { Script } from "scripting"
import { githubRepoFromRemoteUrl } from "../utils/github"

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
}

try {
  main()
  console.log("github tests passed")
  Script.exit("github tests passed")
} catch (error) {
  console.error(error)
  throw error
}
