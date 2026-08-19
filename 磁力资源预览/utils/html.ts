// HTML 实体解码与标签清理

export function decodeHtml(input: string) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// 去掉搜索结果里的 <mark> 高亮标签，直接拼接避免关键词被空格切断
export function stripMarks(input: string) {
  return input.replace(/<\/?mark[^>]*>/gi, "");
}

export function stripHtml(input: string) {
  return decodeHtml(input.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
