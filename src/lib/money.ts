const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsdCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error("cents must be a safe integer");
  }
  return usdFormatter.format(cents / 100);
}

export function parseUsdDollarsToCents(value: string): number | null {
  const normalized = value.trim().replace(/^\$/, "").replaceAll(",", "");
  const match = /^(-?)(\d+)(?:\.(\d{0,2}))?$/.exec(normalized);
  if (!match) return null;

  const dollars = Number(match[2]);
  const cents = Number((match[3] ?? "").padEnd(2, "0") || "0");
  const absoluteCents = dollars * 100 + cents;
  if (!Number.isSafeInteger(absoluteCents)) return null;
  return match[1] === "-" ? -absoluteCents : absoluteCents;
}

export function usdCentsToInputValue(cents: number): string {
  const absoluteCents = Math.abs(cents);
  const dollars = Math.floor(absoluteCents / 100);
  const remainder = String(absoluteCents % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${dollars}.${remainder}`;
}
