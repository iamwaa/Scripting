// whatslink.info 磁力信息查询

import { fetch } from "scripting";

import { API_ENDPOINT } from "../constants";
import type { WhatsLinkResponse } from "../types";

export async function queryWhatsLink(url: string): Promise<WhatsLinkResponse> {
  const res = await fetch(`${API_ENDPOINT}?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`接口请求失败：HTTP ${res.status}`);
  const json = (await res.json()) as WhatsLinkResponse;
  if (json.error) throw new Error(json.error);
  return json;
}
