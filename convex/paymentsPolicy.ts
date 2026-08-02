/**
 * Paywalled-delivery fee policy. Kept in a dependency-free module so the
 * Stripe action and unit tests use exactly the same calculation.
 */
export const DEFAULT_PLATFORM_FEE_BASIS_POINTS = 500;
export const DEFAULT_PLATFORM_FEE_FIXED_CENTS = 30;

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
  const normalizedAmount = Math.max(0, Math.floor(amountCents));
  const percentage = Math.floor(
    (normalizedAmount * platformFeeBasisPoints()) / 10_000,
  );
  return Math.min(
    normalizedAmount,
    Math.max(0, percentage + platformFeeFixedCents()),
  );
}
