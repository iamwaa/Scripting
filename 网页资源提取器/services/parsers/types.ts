import type { ResourceItem } from "../../types/resource"

export type SiteParseContext = {
  url: string
  html: string
}

export type SiteParseResult = {
  resources: ResourceItem[]
  title?: string
  pageUrl?: string
}

export interface SiteParser {
  id: string
  matches(url: string): boolean
  parse(context: SiteParseContext): Promise<SiteParseResult>
}
