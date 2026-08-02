/** Recently Deleted is recoverable for exactly 30 days. */
export const TRASH_RECOVERY_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function trashCutoffMs(now = Date.now()): number {
  return now - TRASH_RECOVERY_DAYS * DAY_MS;
}

export function isTrashExpired(
  deletedAt: number | undefined,
  cutoffMs: number,
): boolean {
  return typeof deletedAt === "number" && deletedAt <= cutoffMs;
}
