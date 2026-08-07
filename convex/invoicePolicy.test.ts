import test from "node:test";
import assert from "node:assert/strict";
import { deriveInvoiceStatus } from "./invoicePolicy";
import { projectInvoiceForPayToken } from "./invoices";
import {
  computeApplicationFee,
  computeBuyerTotal,
} from "./paymentsPolicy";

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

const clientPayInvoice = {
  payToken: "pay-token",
  teamId: "team-secret",
  projectId: "project-secret",
  shareLinkId: "share-secret",
  createdByClerkId: "user-secret",
  createdByName: "Creator Secret",
  clientEmail: "client@example.com",
  clientLabel: "Northwind",
  title: "Launch film",
  note: "Thanks.",
  currency: "usd",
  status: "partially_paid" as const,
  sentAt: 10,
  milestones: [
    {
      id: "deposit",
      label: "Deposit",
      amountCents: 10_000,
      paidAt: 20,
      stripeCheckoutSessionId: "cs_secret_paid",
      stripePaymentIntentId: "pi_secret_paid",
    },
    {
      id: "delivery",
      label: "Delivery",
      amountCents: 10_000,
      dueAt: 30,
      stripeCheckoutSessionId: "cs_secret_unpaid",
    },
  ],
};

test("draft invoices are not readable by pay token", () => {
  assert.equal(
    projectInvoiceForPayToken(
      { ...clientPayInvoice, status: "draft", sentAt: undefined },
      "pay-token",
    ),
    null,
  );
});

test("void invoices are not readable by pay token", () => {
  assert.equal(
    projectInvoiceForPayToken(
      { ...clientPayInvoice, status: "void", voidedAt: 40 },
      "pay-token",
    ),
    null,
  );
});

test("a revoked pay token stops resolving", () => {
  assert.equal(
    projectInvoiceForPayToken(
      { ...clientPayInvoice, payToken: undefined },
      "pay-token",
    ),
    null,
  );
});

test("the pay token projection contains only client-safe fields", () => {
  const projected = projectInvoiceForPayToken(clientPayInvoice, "pay-token");
  assert.ok(projected);

  const serialized = JSON.stringify(projected);
  for (const field of [
    "teamId",
    "projectId",
    "shareLinkId",
    "createdByClerkId",
    "createdByName",
    "clientEmail",
    "stripeCheckoutSessionId",
    "stripePaymentIntentId",
  ]) {
    assert.equal(serialized.includes(field), false, `${field} leaked`);
  }

  const [paid, unpaid] = projected.milestones;
  assert.equal("feeCents" in paid, false);
  assert.equal("buyerTotalCents" in paid, false);
  assert.equal(unpaid.feeCents, computeApplicationFee(unpaid.amountCents));
  assert.equal(unpaid.buyerTotalCents, computeBuyerTotal(unpaid.amountCents));
});
