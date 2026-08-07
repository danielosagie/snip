import test from "node:test";
import assert from "node:assert/strict";
import {
  GIBIBYTE,
  STORAGE_STOPS,
  describeChange,
  formatBytes,
  formatCentsPerGb,
  formatStorage,
  formatUsd,
  indexOfPlan,
  smallestStopFor,
  stopAtIndex,
  stopForPlan,
  wouldOverflow,
} from "./storagePricing";

test("stops match the advertised pricing ladder", () => {
  assert.deepEqual(
    STORAGE_STOPS.map((s) => [s.plan, s.gb, s.monthlyCents]),
    [
      ["free", 100, 0],
      ["basic", 1024, 4900],
      ["pro", 5120, 14900],
    ],
  );
});

test("every advertised stop includes unlimited collaborators", () => {
  assert.equal(stopForPlan("free")?.seatCap, null);
  assert.equal(stopForPlan("basic")?.seatCap, null);
  assert.equal(stopForPlan("pro")?.seatCap, null);
});

test("stored studio key maps onto the stable basic checkout key", () => {
  assert.equal(stopForPlan("studio")?.plan, "basic");
  assert.equal(indexOfPlan("studio"), 1);
});

test("smallestStopFor picks the cheapest stop that fits", () => {
  assert.equal(smallestStopFor(10)?.plan, "free");
  assert.equal(smallestStopFor(100)?.plan, "free");
  assert.equal(smallestStopFor(101)?.plan, "basic");
  assert.equal(smallestStopFor(1024)?.plan, "basic");
  assert.equal(smallestStopFor(1025)?.plan, "pro");
  assert.equal(smallestStopFor(5120)?.plan, "pro");
});

test("smallestStopFor returns null past the largest stop", () => {
  // Clamping down here would quietly sell someone a plan too small for
  // their files; the caller routes this to Enterprise instead.
  assert.equal(smallestStopFor(6000), null);
});

test("smallestStopFor treats garbage input as the smallest stop", () => {
  assert.equal(smallestStopFor(Number.NaN)?.plan, "free");
  assert.equal(smallestStopFor(-5)?.plan, "free");
});

test("wouldOverflow blocks a downgrade that cannot hold what is stored", () => {
  assert.equal(wouldOverflow(stopForPlan("free")!, 133.5 * GIBIBYTE), true);
  assert.equal(wouldOverflow(stopForPlan("basic")!, 133.5 * GIBIBYTE), false);
});

test("wouldOverflow treats exactly-full as fitting", () => {
  assert.equal(wouldOverflow(stopForPlan("free")!, 100 * GIBIBYTE), false);
});

test("stopAtIndex clamps out-of-range slider positions", () => {
  assert.equal(stopAtIndex(-3).plan, "free");
  assert.equal(stopAtIndex(99).plan, "pro");
});

test("formatStorage switches to TB above 1024 GB", () => {
  assert.equal(formatStorage(100), "100 GB");
  assert.equal(formatStorage(1024), "1 TB");
  assert.equal(formatStorage(5120), "5 TB");
});

test("formatBytes renders the usage line", () => {
  assert.equal(formatBytes(0), "0 GB");
  assert.equal(formatBytes(33.5 * GIBIBYTE), "33.5 GB");
  assert.equal(formatBytes(5120 * GIBIBYTE), "5.00 TB");
});

test("formatUsd drops cents when the price is whole dollars", () => {
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(4900), "$49");
  assert.equal(formatUsd(2550), "$25.50");
});

test("formatCentsPerGb shows the rate that makes the ladder legible", () => {
  assert.equal(formatCentsPerGb(stopForPlan("free")!), "free");
  assert.equal(formatCentsPerGb(stopForPlan("basic")!), "4.8¢ per GB");
  assert.equal(formatCentsPerGb(stopForPlan("pro")!), "2.9¢ per GB");
});

test("describeChange reports direction and delta", () => {
  const basic = stopForPlan("basic")!;
  const pro = stopForPlan("pro")!;
  assert.deepEqual(describeChange(basic, pro), {
    direction: "upgrade",
    deltaCents: 10000,
  });
  assert.deepEqual(describeChange(pro, basic), {
    direction: "downgrade",
    deltaCents: -10000,
  });
  assert.deepEqual(describeChange(basic, basic), {
    direction: "same",
    deltaCents: 0,
  });
});
