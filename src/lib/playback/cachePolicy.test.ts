import test from "node:test";
import assert from "node:assert/strict";

import { chooseCacheEvictions } from "./cachePolicy";

test("chooseCacheEvictions removes least-recently-used entries first", () => {
  const evictions = chooseCacheEvictions(
    [
      { key: "warm", size: 40, lastAccess: 20 },
      { key: "cold", size: 40, lastAccess: 10 },
      { key: "hot", size: 40, lastAccess: 30 },
    ],
    30,
    100,
  );
  assert.deepEqual(evictions, ["cold", "warm"]);
});

test("chooseCacheEvictions preserves the active entry", () => {
  const evictions = chooseCacheEvictions(
    [
      { key: "active", size: 80, lastAccess: 1 },
      { key: "other", size: 20, lastAccess: 2 },
    ],
    40,
    100,
    "active",
  );
  assert.deepEqual(evictions, ["other"]);
});

test("chooseCacheEvictions does nothing while under budget", () => {
  assert.deepEqual(
    chooseCacheEvictions(
      [{ key: "one", size: 20, lastAccess: 1 }],
      30,
      100,
    ),
    [],
  );
});

