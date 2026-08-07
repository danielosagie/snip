import test from "node:test";
import assert from "node:assert/strict";
import { deriveInvoiceStatus } from "./invoicePolicy";

test("invoice status follows send and milestone payment coverage", () => {
  const unpaid = [{}, {}];
  assert.equal(deriveInvoiceStatus({ milestones: unpaid }), "draft");
  assert.equal(
    deriveInvoiceStatus({ milestones: unpaid, sentAt: 1 }),
    "sent",
  );
  assert.equal(
    deriveInvoiceStatus({ milestones: [{ paidAt: 2 }, {}], sentAt: 1 }),
    "partially_paid",
  );
  assert.equal(
    deriveInvoiceStatus({
      milestones: [{ paidAt: 2 }, { paidAt: 3 }],
      sentAt: 1,
    }),
    "paid",
  );
});

test("void is explicit and wins over payment coverage", () => {
  assert.equal(
    deriveInvoiceStatus({
      milestones: [{ paidAt: 2 }],
      sentAt: 1,
      voidedAt: 3,
    }),
    "void",
  );
});

test("an empty invoice never derives paid", () => {
  assert.equal(deriveInvoiceStatus({ milestones: [], sentAt: 1 }), "sent");
});
