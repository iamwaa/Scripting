export function runSingleFlight<K, V>(
  inFlight: Map<K, Promise<V>>,
  key: K,
  task: () => Promise<V>
): Promise<V> {
  const existing = inFlight.get(key)
  if (existing) return existing
  const pending = task().finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key)
  })
  inFlight.set(key, pending)
  return pending
}
