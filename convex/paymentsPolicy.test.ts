import test from "node:test";
import assert from "node:assert/strict";
import {
  computeBuyerTotal,
  computeApplicationFee,
  platformFeeBasisPoints,
  platformFeeFixedCents,
} from "./paymentsPolicy";

function withFeeEnv(
  basisPoints: string | undefined,
  fixedCents: string | undefined,
  run: () => void,
) {
  const oldBasisPoints = process.env.VIDEOINFRA_PLATFORM_FEE_BASIS_POINTS;
  const oldFixedCents = process.env.VIDEOINFRA_PLATFORM_FEE_FIXED_CENTS;
  if (basisPoints === undefined) {
    delete process.env.VIDEOINFRA_PLATFORM_FEE_BASIS_POINTS;
  } else {
    process.env.VIDEOINFRA_PLATFORM_FEE_BASIS_POINTS = basisPoints;
  }
  if (fixedCents === undefined) {
    delete process.env.VIDEOINFRA_PLATFORM_FEE_FIXED_CENTS;
  } else {
    process.env.VIDEOINFRA_PLATFORM_FEE_FIXED_CENTS = fixedCents;
  }
  try {
    run();
  } finally {
    if (oldBasisPoints === undefined) {
      delete process.env.VIDEOINFRA_PLATFORM_FEE_BASIS_POINTS;
    } else {
      process.env.VIDEOINFRA_PLATFORM_FEE_BASIS_POINTS = oldBasisPoints;
    }
    if (oldFixedCents === undefined) {
      delete process.env.VIDEOINFRA_PLATFORM_FEE_FIXED_CENTS;
    } else {
      process.env.VIDEOINFRA_PLATFORM_FEE_FIXED_CENTS = oldFixedCents;
    }
  }
}

test("delivery fee defaults to 5% plus 30 cents", () => {
  withFeeEnv(undefined, undefined, () => {
    assert.equal(platformFeeBasisPoints(), 500);
    assert.equal(platformFeeFixedCents(), 30);
    assert.equal(computeApplicationFee(10_000), 530);
    assert.equal(computeBuyerTotal(10_000), 10_530);
  });
});

test("delivery fee respects valid overrides and rejects unsafe values", () => {
  withFeeEnv("250", "10", () => assert.equal(computeApplicationFee(10_000), 260));
  withFeeEnv("garbage", "-1", () => assert.equal(computeApplicationFee(10_000), 530));
});

test("buyer-paid fee keeps the 30 cent floor for tiny positive amounts", () => {
  withFeeEnv(undefined, undefined, () => {
    assert.equal(computeApplicationFee(1), 30);
    assert.equal(computeBuyerTotal(1), 31);
    assert.equal(computeApplicationFee(20), 31);
    assert.equal(computeBuyerTotal(20), 51);
    assert.equal(computeApplicationFee(0), 0);
    assert.equal(computeBuyerTotal(0), 0);
  });
});

test("percentage arithmetic floors to integer USD cents", () => {
  withFeeEnv(undefined, undefined, () => {
    assert.equal(computeApplicationFee(19), 30);
    assert.equal(computeApplicationFee(20), 31);
    assert.equal(computeApplicationFee(21), 31);
    assert.equal(computeBuyerTotal(21), 52);
  });
});

test("money policy rejects floats, negative cents, and unsafe integers", () => {
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => computeApplicationFee(invalid), /integer/);
    assert.throws(() => computeBuyerTotal(invalid), /integer/);
  }
});
