import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLazyEncodingMode,
  shouldDeferEncodingForPolicy,
} from "./encodingPolicy";

test("lazy encoding defaults to Free only", () => {
  assert.equal(normalizeLazyEncodingMode(undefined), "free");
  assert.equal(
    shouldDeferEncodingForPolicy({ tier: "free", driveFirst: false }),
    true,
  );
  assert.equal(
    shouldDeferEncodingForPolicy({ tier: "basic", driveFirst: false }),
    false,
  );
  assert.equal(
    shouldDeferEncodingForPolicy({ tier: "pro", driveFirst: false }),
    false,
  );
});

test("drive-first and explicit overrides remain supported", () => {
  assert.equal(
    shouldDeferEncodingForPolicy({
      configuredMode: "never",
      tier: "pro",
      driveFirst: true,
    }),
    true,
  );
  assert.equal(
    shouldDeferEncodingForPolicy({
      configuredMode: "always",
      tier: "pro",
      driveFirst: false,
    }),
    true,
  );
});
