export type CacheEntryRecord = {
  key: string;
  size: number;
  lastAccess: number;
};

export function chooseCacheEvictions(
  entries: CacheEntryRecord[],
  incomingBytes: number,
  budgetBytes: number,
  protectedKey?: string,
): string[] {
  const safeIncoming = Math.max(0, incomingBytes);
  const safeBudget = Math.max(0, budgetBytes);
  let total = entries.reduce((sum, entry) => sum + Math.max(0, entry.size), 0);
  if (total + safeIncoming <= safeBudget) return [];

  const candidates = entries
    .filter((entry) => entry.key !== protectedKey)
    .sort(
      (a, b) =>
        a.lastAccess - b.lastAccess || a.key.localeCompare(b.key),
    );
  const evictions: string[] = [];
  for (const entry of candidates) {
    evictions.push(entry.key);
    total -= Math.max(0, entry.size);
    if (total + safeIncoming <= safeBudget) break;
  }
  return evictions;
}

