import { AppSettings, QrRecord } from "./types";
import { DEFAULT_REDIRECT_RULES, DEFAULT_SETTINGS, SETTINGS_KEY, STORAGE_KEY } from "./constants";

export function loadRecords(): QrRecord[] {
  const stored = Storage.get<QrRecord[]>(STORAGE_KEY);
  return Array.isArray(stored) ? stored : [];
}

export function persistRecords(records: QrRecord[]) {
  Storage.set(STORAGE_KEY, records);
}

export function loadSettings(): AppSettings {
  const stored = Storage.get<AppSettings>(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored ?? {}),
    redirectRules: stored?.redirectRules ?? DEFAULT_REDIRECT_RULES,
  };
}

export function persistSettings(settings: AppSettings) {
  Storage.set(SETTINGS_KEY, settings);
}
