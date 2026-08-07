import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRequirementList,
  derivePayoutState,
  describePayoutState,
  humanizeRequirement,
} from "./stripeRequirements";

test("known Stripe keys get plain-English labels", () => {
  assert.equal(
    humanizeRequirement("individual.verification.document"),
    "A photo of your ID",
  );
  assert.equal(humanizeRequirement("external_account"), "A bank account to pay into");
});

test("unknown keys degrade to something readable, never dropped", () => {
  // A requirement we can't name still blocks payouts. Hiding it would
  // make the list claim setup is complete when it isn't.
  assert.equal(humanizeRequirement("company.address.state"), "Company address state");
  assert.equal(humanizeRequirement(""), "Something else Stripe needs");
});

test("past-due items sort first and are flagged", () => {
  const list = buildRequirementList({
    currentlyDue: ["external_account"],
    pastDue: ["individual.verification.document"],
  });
  assert.equal(list.length, 2);
  assert.equal(list[0].label, "A photo of your ID");
  assert.equal(list[0].pastDue, true);
  assert.equal(list[1].label, "A bank account to pay into");
  assert.equal(list[1].pastDue, false);
});

test("keys that share a human label collapse to one row", () => {
  const list = buildRequirementList({
    currentlyDue: ["individual.dob.day", "individual.dob.month", "individual.dob.year"],
    pastDue: [],
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].label, "Your date of birth");
});

test("null requirements yield an empty list", () => {
  // null means "never refreshed", which the caller must not render as
  // "nothing outstanding".
  assert.deepEqual(buildRequirementList(null), []);
});

const base = {
  stripeAccountId: "acct_1",
  status: "active" as const,
  chargesEnabled: true,
  payoutsEnabled: true,
};

test("no account reads as not connected", () => {
  assert.equal(
    derivePayoutState({ ...base, stripeAccountId: null, chargesEnabled: false, payoutsEnabled: false }),
    "notConnected",
  );
});

test("charges on with payouts off is the held state", () => {
  // The case the old UI could not express: selling works, money is stuck.
  assert.equal(
    derivePayoutState({ ...base, status: "restricted", payoutsEnabled: false }),
    "held",
  );
  assert.equal(describePayoutState("held").tone, "bad");
});

test("both capabilities on reads as ready", () => {
  assert.equal(derivePayoutState(base), "ready");
  assert.equal(describePayoutState("ready").label, "Paying out");
});

test("restricted survives even when both capabilities are on", () => {
  assert.equal(derivePayoutState({ ...base, status: "restricted" }), "restricted");
});

test("neither capability yet reads as verifying", () => {
  assert.equal(
    derivePayoutState({ ...base, status: "pending", chargesEnabled: false, payoutsEnabled: false }),
    "verifying",
  );
});

test("disabled beats everything else", () => {
  assert.equal(derivePayoutState({ ...base, status: "disabled" }), "disabled");
});
