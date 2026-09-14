export function isIPv4(value: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)
    && value.split(".").every(part => Number(part) <= 255);
}

export function isIPAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (isIPv4(value)) return true;

  // IPv6 可压缩零段，也可带 IPv4 尾段。
  let address = value;
  if (address.includes(".")) {
    const tailIndex = address.lastIndexOf(":") + 1;
    if (tailIndex === 0 || !isIPv4(address.slice(tailIndex))) return false;
    address = `${address.slice(0, tailIndex)}0:0`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap(half => half ? half.split(":") : []);
  if (!groups.every(group => /^[\da-f]{1,4}$/i.test(group))) return false;
  return halves.length === 2 ? groups.length < 8 : groups.length === 8;
}

export function isPublicIPv4(value: string): boolean {
  if (!isIPv4(value)) return false;
  const [first, second] = value.split(".").map(Number);
  return first !== 0 && first !== 10 && first !== 127 && first < 224
    && !(first === 172 && second >= 16 && second <= 31)
    && !(first === 192 && second === 168)
    && !(first === 169 && second === 254)
    && !(first === 100 && second >= 64 && second <= 127);
}
