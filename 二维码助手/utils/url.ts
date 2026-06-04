export function isProbablyURL(value: string) {
  const trimmed = value.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(trimmed)) return true;
  if (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/i.test(trimmed) && !/\s/.test(trimmed)) return true;
  return false;
}

export function getValidURL(value: string) {
  const trimmed = value.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}
