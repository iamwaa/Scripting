export type QrRecord = {
  id: string;
  content: string;
  timestamp: number;
  type: "SCAN" | "GENERATE";
};

export type ScanMode = "single" | "continuous";

export type RedirectRule = {
  keyword: string;
  urlScheme: string;
  appName: string;
  iconUrl?: string;
  source?: "local" | "remote";
};

export type AppSettings = {
  autoScanOnOpen: boolean;
  autoRedirect: boolean;
  redirectRules: RedirectRule[];
  fallbackEnabled: boolean;
  fallbackUrlScheme: string;
  subscriptionUrl: string;
};
