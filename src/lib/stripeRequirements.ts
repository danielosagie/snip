/**
 * Turn Stripe `requirements` keys into something a seller can act on.
 *
 * Stripe hands back dotted machine keys like
 * "individual.verification.document". Showing those raw is how you get a
 * support ticket, so every key we've actually seen gets a plain-English
 * label. Unknown keys fall back to a readable de-dotted form rather than
 * being dropped — a requirement we can't name is still a requirement that
 * blocks payouts, and hiding it would make the list lie.
 */

const LABELS: Record<string, string> = {
  "individual.verification.document": "A photo of your ID",
  "individual.verification.additional_document": "A second ID document",
  "individual.id_number": "Your ID or SSN number",
  "individual.dob.day": "Your date of birth",
  "individual.dob.month": "Your date of birth",
  "individual.dob.year": "Your date of birth",
  "individual.address.line1": "Your address",
  "individual.address.city": "Your address",
  "individual.address.postal_code": "Your address",
  "individual.first_name": "Your legal name",
  "individual.last_name": "Your legal name",
  "individual.email": "Your email",
  "individual.phone": "Your phone number",
  external_account: "A bank account to pay into",
  "business_profile.url": "A website or product link",
  "business_profile.mcc": "What you sell",
  "business_profile.product_description": "What you sell",
  "company.tax_id": "Your business tax ID",
  "company.address.line1": "Your business address",
  "company.name": "Your business name",
  "company.verification.document": "A business verification document",
  "relationship.representative": "Who represents the business",
  "tos_acceptance.date": "Accepting the Stripe terms",
  "tos_acceptance.ip": "Accepting the Stripe terms",
};

export function humanizeRequirement(key: string): string {
  const known = LABELS[key];
  if (known) return known;
  // "company.address.state" -> "Company address state"
  const words = key.replace(/[._]/g, " ").trim();
  if (!words) return "Something else Stripe needs";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type RequirementItem = {
  key: string;
  label: string;
  pastDue: boolean;
};

/**
 * Merge the two Stripe buckets into one ordered list. Past-due items come
 * first and are flagged, because they're the ones actively holding money.
 * Several Stripe keys collapse to the same human label (date of birth is
 * three keys); we de-duplicate by label so the list reads like a to-do
 * list rather than a schema dump.
 */
export function buildRequirementList(requirements: {
  currentlyDue: string[];
  pastDue: string[];
} | null): RequirementItem[] {
  if (!requirements) return [];
  const pastDue = new Set(requirements.pastDue);
  const all = [...requirements.pastDue, ...requirements.currentlyDue];

  const seenLabels = new Set<string>();
  const out: RequirementItem[] = [];
  for (const key of all) {
    const label = humanizeRequirement(key);
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);
    out.push({ key, label, pastDue: pastDue.has(key) });
  }
  return out.sort((a, b) => Number(b.pastDue) - Number(a.pastDue));
}

export type PayoutState =
  | "notConnected"
  | "verifying"
  | "held"
  | "restricted"
  | "ready"
  | "disabled";

/**
 * Collapse the Connect fields into the state the UI actually renders.
 *
 * The important one is "held": charges work, payouts don't. The seller is
 * taking money that Stripe is sitting on. The old UI showed this as a
 * generic "Finish setup" chip, which is why it needs its own state.
 */
export function derivePayoutState(status: {
  stripeAccountId: string | null;
  status: "pending" | "active" | "restricted" | "disabled" | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}): PayoutState {
  if (!status.stripeAccountId) return "notConnected";
  if (status.status === "disabled") return "disabled";
  if (status.chargesEnabled && status.payoutsEnabled) {
    return status.status === "restricted" ? "restricted" : "ready";
  }
  if (status.chargesEnabled && !status.payoutsEnabled) return "held";
  return "verifying";
}

export function describePayoutState(state: PayoutState): {
  label: string;
  tone: "good" | "warn" | "bad" | "neutral";
} {
  switch (state) {
    case "ready":
      return { label: "Paying out", tone: "good" };
    case "held":
      return { label: "Money held", tone: "bad" };
    case "restricted":
      return { label: "Action needed", tone: "warn" };
    case "verifying":
      return { label: "Verifying", tone: "warn" };
    case "disabled":
      return { label: "Disabled", tone: "bad" };
    case "notConnected":
    default:
      return { label: "Not connected", tone: "neutral" };
  }
}
