import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY_MS,
  isTrashExpired,
  trashCutoffMs,
  TRASH_RECOVERY_DAYS,
} from "./trashPolicy";

test("Recently Deleted has a 30-day recovery window", () => {
  const now = 1_700_000_000_000;
  const cutoff = trashCutoffMs(now);
  assert.equal(TRASH_RECOVERY_DAYS, 30);
  assert.equal(cutoff, now - 30 * DAY_MS);
  assert.equal(isTrashExpired(cutoff, cutoff), true);
  assert.equal(isTrashExpired(cutoff + 1, cutoff), false);
  assert.equal(isTrashExpired(undefined, cutoff), false);
});
