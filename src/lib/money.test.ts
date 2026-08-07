import assert from "node:assert/strict";
import test from "node:test";
import {
  formatUsdCents,
  parseUsdDollarsToCents,
  usdCentsToInputValue,
} from "./money";

test("formats integer cents with two decimals", () => {
  assert.equal(formatUsdCents(123_450), "$1,234.50");
  assert.equal(formatUsdCents(100), "$1.00");
});

test("parses dollars without floating point arithmetic", () => {
  assert.equal(parseUsdDollarsToCents("$1,234.50"), 123_450);
  assert.equal(parseUsdDollarsToCents("100"), 10_000);
  assert.equal(parseUsdDollarsToCents("0.01"), 1);
  assert.equal(parseUsdDollarsToCents("-1.00"), -100);
  assert.equal(parseUsdDollarsToCents("1.001"), null);
});

test("creates stable amount input values", () => {
  assert.equal(usdCentsToInputValue(123_450), "1234.50");
  assert.equal(usdCentsToInputValue(1), "0.01");
});
