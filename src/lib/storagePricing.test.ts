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

test("stops mirror the Convex tiers", () => {
  assert.deepEqual(
    STORAGE_STOPS.map((s) => [s.plan, s.gb, s.monthlyCents]),
    [
      ["free", 25, 0],
      ["basic", 500, 2500],
      ["pro", 2048, 5000],
    ],
  );
});

test("free is the only stop that caps collaborators", () => {
  assert.equal(stopForPlan("free")?.seatCap, 2);
  assert.equal(stopForPlan("basic")?.seatCap, null);
  assert.equal(stopForPlan("pro")?.seatCap, null);
});

test("legacy studio key maps onto basic", () => {
  assert.equal(stopForPlan("studio")?.plan, "basic");
  assert.equal(indexOfPlan("studio"), 1);
});

test("smallestStopFor picks the cheapest stop that fits", () => {
  assert.equal(smallestStopFor(10)?.plan, "free");
  assert.equal(smallestStopFor(25)?.plan, "free");
  assert.equal(smallestStopFor(26)?.plan, "basic");
  assert.equal(smallestStopFor(500)?.plan, "basic");
  assert.equal(smallestStopFor(501)?.plan, "pro");
  assert.equal(smallestStopFor(2048)?.plan, "pro");
});

test("smallestStopFor returns null past the largest stop", () => {
  // Clamping down here would quietly sell someone a plan too small for
  // their files; the caller routes this to Enterprise instead.
  assert.equal(smallestStopFor(4000), null);
});

test("smallestStopFor treats garbage input as the smallest stop", () => {
  assert.equal(smallestStopFor(Number.NaN)?.plan, "free");
  assert.equal(smallestStopFor(-5)?.plan, "free");
});

test("wouldOverflow blocks a downgrade that cannot hold what is stored", () => {
  assert.equal(wouldOverflow(stopForPlan("free")!, 33.5 * GIBIBYTE), true);
  assert.equal(wouldOverflow(stopForPlan("basic")!, 33.5 * GIBIBYTE), false);
});

test("wouldOverflow treats exactly-full as fitting", () => {
  assert.equal(wouldOverflow(stopForPlan("free")!, 25 * GIBIBYTE), false);
});

test("stopAtIndex clamps out-of-range slider positions", () => {
  assert.equal(stopAtIndex(-3).plan, "free");
  assert.equal(stopAtIndex(99).plan, "pro");
});

test("formatStorage switches to TB above 1024 GB", () => {
  assert.equal(formatStorage(25), "25 GB");
  assert.equal(formatStorage(500), "500 GB");
  assert.equal(formatStorage(2048), "2 TB");
});

test("formatBytes renders the usage line", () => {
  assert.equal(formatBytes(0), "0 GB");
  assert.equal(formatBytes(33.5 * GIBIBYTE), "33.5 GB");
  assert.equal(formatBytes(2048 * GIBIBYTE), "2.00 TB");
});

test("formatUsd drops cents when the price is whole dollars", () => {
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(2500), "$25");
  assert.equal(formatUsd(2550), "$25.50");
});

test("formatCentsPerGb shows the rate that makes the ladder legible", () => {
  assert.equal(formatCentsPerGb(stopForPlan("free")!), "free");
  assert.equal(formatCentsPerGb(stopForPlan("basic")!), "5.0¢ per GB");
  assert.equal(formatCentsPerGb(stopForPlan("pro")!), "2.4¢ per GB");
});

test("describeChange reports direction and delta", () => {
  const basic = stopForPlan("basic")!;
  const pro = stopForPlan("pro")!;
  assert.deepEqual(describeChange(basic, pro), {
    direction: "upgrade",
    deltaCents: 2500,
  });
  assert.deepEqual(describeChange(pro, basic), {
    direction: "downgrade",
    deltaCents: -2500,
  });
  assert.deepEqual(describeChange(basic, basic), {
    direction: "same",
    deltaCents: 0,
  });
});
