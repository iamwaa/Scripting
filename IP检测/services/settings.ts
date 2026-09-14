import { IPProvider } from "../types/ip";

export interface IPSettings {
  preferredProvider: IPProvider;
  fallbackEnabled: boolean;
}

const SETTINGS_KEY = "ipDetection.settings.v1";

export const DEFAULT_SETTINGS: IPSettings = {
  preferredProvider: "ippure",
  fallbackEnabled: true,
};

export function loadSettings(): IPSettings {
  try {
    const saved = Storage.get<Partial<IPSettings>>(SETTINGS_KEY);
    return {
      preferredProvider: saved?.preferredProvider === "ip-api" ? "ip-api" : "ippure",
      fallbackEnabled: typeof saved?.fallbackEnabled === "boolean"
        ? saved.fallbackEnabled
        : DEFAULT_SETTINGS.fallbackEnabled,
    };
  } catch (error) {
    console.error("[IP检测] 读取设置失败", error);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: IPSettings): boolean {
  return Storage.set(SETTINGS_KEY, {
    preferredProvider: settings.preferredProvider,
    fallbackEnabled: settings.fallbackEnabled,
  });
}
