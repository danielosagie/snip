/**
 * Paywalled-delivery fee policy. Kept in a dependency-free module so the
 * Stripe action and unit tests use exactly the same calculation.
 */
export const DEFAULT_PLATFORM_FEE_BASIS_POINTS = 500;
export const DEFAULT_PLATFORM_FEE_FIXED_CENTS = 30;
export const MAX_LINE_ITEM_AMOUNT_CENTS = 5_000_000;

// Flip this single policy value if Snip ever returns to seller-paid fees.
export const BUYER_PAYS_PLATFORM_FEE = true;

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max
    ? parsed
    : fallback;
}

export function platformFeeBasisPoints(): number {
  return boundedInteger(
    process.env.VIDEOINFRA_PLATFORM_FEE_BASIS_POINTS,
    DEFAULT_PLATFORM_FEE_BASIS_POINTS,
    5000,
  );
}

export function platformFeeFixedCents(): number {
  return boundedInteger(
    process.env.VIDEOINFRA_PLATFORM_FEE_FIXED_CENTS,
    DEFAULT_PLATFORM_FEE_FIXED_CENTS,
    1000,
  );
}

/** Stripe application_fee_amount for a destination charge, in cents. */
export function computeApplicationFee(amountCents: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new Error("amountCents must be a non-negative integer number of cents");
  }
  if (amountCents === 0) return 0;
  const percentage = Math.floor(
    (amountCents * platformFeeBasisPoints()) / 10_000,
  );
  return Math.max(0, percentage + platformFeeFixedCents());
}

/** Buyer charge total. Currency remains USD integer cents at every caller. */
export function computeBuyerTotal(subtotalCents: number): number {
  const feeCents = computeApplicationFee(subtotalCents);
  const totalCents =
    subtotalCents + (BUYER_PAYS_PLATFORM_FEE ? feeCents : 0);
  if (!Number.isSafeInteger(totalCents)) {
    throw new Error("buyer total exceeds the safe integer range");
  }
  return totalCents;
}
