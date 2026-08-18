import type { SiteParseContext, SiteParseResult, SiteParser } from "./types"
import { bilibiliParser } from "./bilibili"
import { douyinParser } from "./douyin"
import { youtubeParser } from "./youtube"

const SITE_PARSERS: SiteParser[] = [bilibiliParser, douyinParser, youtubeParser]

export async function parseSiteResources(context: SiteParseContext): Promise<SiteParseResult> {
  const parser = SITE_PARSERS.find(item => item.matches(context.url))
  if (!parser) return { resources: [] }

  try {
    return await parser.parse(context)
  } catch {
    return { resources: [] }
  }
}
