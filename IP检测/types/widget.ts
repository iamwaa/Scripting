import type { DynamicImageSource } from "scripting";
import type { IPInfo } from "./ip";

export interface WidgetProps {
  ipInfo: IPInfo | null;
  riskValue: number | null;
  riskSource: string;
  isHomeBroadband: string;
  isNative: string;
  vpnStatus: string;
  countryFlagPath?: string;
  mapImages?: DynamicImageSource<UIImage>;
}
