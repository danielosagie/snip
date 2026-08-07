export type InvoiceStatus =
  | "draft"
  | "sent"
  | "partially_paid"
  | "paid"
  | "void";

export type InvoiceStatusInput = {
  milestones: ReadonlyArray<{ paidAt?: number }>;
  sentAt?: number;
  voidedAt?: number;
};

/** Dependency-free source of truth for every stored and returned invoice status. */
export function deriveInvoiceStatus(input: InvoiceStatusInput): InvoiceStatus {
  if (input.voidedAt !== undefined) return "void";

  const paidCount = input.milestones.reduce(
    (count, milestone) => count + (milestone.paidAt !== undefined ? 1 : 0),
    0,
  );
  if (input.milestones.length > 0 && paidCount === input.milestones.length) {
    return "paid";
  }
  if (paidCount > 0) return "partially_paid";
  return input.sentAt !== undefined ? "sent" : "draft";
}
