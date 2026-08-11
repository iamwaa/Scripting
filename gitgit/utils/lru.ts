export function setLruEntry<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  limit: number
): void {
  cache.delete(key)
  cache.set(key, value)
  const safeLimit = Math.max(1, Math.trunc(limit))
  while (cache.size > safeLimit) {
    const oldest = cache.keys().next().value as K | undefined
    if (oldest == null) break
    cache.delete(oldest)
  }
}
