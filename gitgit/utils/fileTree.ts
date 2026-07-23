export interface FileTreeNode {
  name: string
  path: string
  type: "directory" | "file"
  children: FileTreeNode[]
}

interface MutableTreeNode extends FileTreeNode {
  childMap: Map<string, MutableTreeNode>
}

function sortNodes(nodes: MutableTreeNode[]): FileTreeNode[] {
  return nodes
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    .map((node) => ({
      name: node.name,
      path: node.path,
      type: node.type,
      children: sortNodes(Array.from(node.childMap.values())),
    }))
}

/** 把已跟踪文件路径转换为目录优先、同层按名称排序的树 */
export function buildFileTree(filepaths: string[]): FileTreeNode[] {
  const roots = new Map<string, MutableTreeNode>()

  for (const filepath of filepaths) {
    const parts = String(filepath)
      .split("/")
      .filter(Boolean)
    if (parts.length === 0) continue

    let siblings = roots
    let currentPath = ""
    for (let index = 0; index < parts.length; index++) {
      const name = parts[index]
      currentPath = currentPath ? currentPath + "/" + name : name
      const isFile = index === parts.length - 1
      let node = siblings.get(name)
      if (!node) {
        node = {
          name,
          path: currentPath,
          type: isFile ? "file" : "directory",
          children: [],
          childMap: new Map(),
        }
        siblings.set(name, node)
      }
      siblings = node.childMap
    }
  }

  return sortNodes(Array.from(roots.values()))
}
