export type IPProvider = "ippure" | "ip-api";

export interface IPInfo {
  query: string;
  country: string;
  countryCode: string;
  regionName: string;
  city: string;
  isp: string;
  org: string;
  as: string;
  status: string;
  source: IPProvider;
  isFallback: boolean;
  // 经纬度均来自当前数据来源，不用 GPS，也不补查其他出口。
  latitude?: number;
  longitude?: number;
  fraudScore?: number;
  isResidential?: boolean;
  isBroadcast?: boolean;
}
