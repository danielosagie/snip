import { createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CreditCard,
  Users,
  Receipt,
  Check,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  HardDrive,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { seoHead } from "@/lib/seo";

export const Route = createFileRoute("/dashboard/billing")({
  head: () =>
    seoHead({
      title: "Billing & usage",
      description: "Manage your workspace subscription.",
      path: "/dashboard/billing",
      noIndex: true,
    }),
  component: BillingRoute,
});

/**
 * Account-level billing page.
 *
 * Pricing shape (flat base + per-seat overage) is sourced from
 * api.workspaceBilling.getMySubscription. The seat count is computed
 * live across every team the user participates in, so adding a
 * collaborator anywhere updates the monthly total without any
 * action here.
 *
 * The CTA flips between "Activate" (no subscription yet),
 * "Subscribed" (active), or "Reactivate" (canceled). In demo mode
 * the buttons hit simulate* mutations; real Stripe Checkout swaps in
 * later.
 */
function BillingRoute() {
  const subscription = useQuery(api.workspaceBilling.getMySubscription, {});
  const tiers = useQuery(api.workspaceBilling.listTiers, {});
  const demoStatus = useQuery(api.demoSeed.isDemoMode, {});
  const simulateActivate = useMutation(api.workspaceBilling.simulateActivate);
  const cancel = useMutation(api.workspaceBilling.simulateCancel);
  const createCheckout = useAction(
    api.workspaceBillingActions.createCheckout,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [activationNote, setActivationNote] = useState<string | null>(null);

  const isLoading = subscription === undefined;
  const isAuthed = subscription !== null;

  const handleActivate = async (plan: string) => {
    setBusy(`activate:${plan}`);
    setActivationNote(null);
    try {
      // Ask the server: real Stripe Checkout, or demo simulate?
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const result = await createCheckout({
        plan,
        successUrl: `${origin}/dashboard/billing?checkout=success`,
        cancelUrl: `${origin}/dashboard/billing?checkout=cancel`,
      });
      if (result.kind === "redirect") {
        if (typeof window !== "undefined") {
          window.location.assign(result.url);
        }
        return;
      }
      // Fallback path — Stripe isn't fully configured. Activate
      // locally so the user can still test the rest of the app.
      await simulateActivate({ plan });
      setActivationNote(result.reason);
    } finally {
      setBusy(null);
    }
  };
  const handleCancel = async () => {
    if (!confirm("Cancel your workspace subscription at the end of the period?")) {
      return;
    }
    setBusy("cancel");
    try {
      await cancel({});
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <DashboardHeader paths={[{ label: "Billing & usage" }]} />

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-black tracking-tight text-[#1a1a1a]">
            Billing &amp; usage
          </h1>
          <p className="text-sm text-[#666] mt-1 max-w-prose">
            One subscription covers all your teams. You pay a flat monthly
            fee plus a small per-seat amount for each collaborator beyond
            the included seats.
          </p>

          {isLoading || !isAuthed ? (
            <div className="mt-8 text-sm text-[#888]">Loading…</div>
          ) : (
            <>
              <PricingCard
                plan={subscription.plan}
                status={subscription.status}
                baseCents={subscription.baseCents}
                perSeatCents={subscription.perSeatCents}
                includedSeats={subscription.includedSeats}
                seatCount={subscription.seatCount}
                overageSeats={subscription.overageSeats}
                monthlyCents={subscription.monthlyCents}
                currency={subscription.currency}
                currentPeriodEnd={subscription.currentPeriodEnd}
              />

              {/* Tier picker. Active sub shows a Cancel button; otherwise
                  each tier card has its own Activate CTA. */}
              <div className="mt-8">
                <h2 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#888] mb-3">
                  {subscription.status === "active" ||
                  subscription.status === "trialing"
                    ? "Change plan"
                    : "Choose a plan"}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {(tiers ?? []).map((tier) => {
                    const isCurrent =
                      (subscription.status === "active" ||
                        subscription.status === "trialing") &&
                      subscription.plan === tier.plan;
                    return (
                      <TierCard
                        key={tier.plan}
                        plan={tier.plan}
                        label={tier.label}
                        baseCents={tier.baseCents}
                        perSeatCents={tier.perSeatCents}
                        includedSeats={tier.includedSeats}
                        storageBytes={tier.storageBytes}
                        currency={tier.currency}
                        features={tier.features}
                        isCurrent={isCurrent}
                        busy={busy === `activate:${tier.plan}`}
                        disabled={busy !== null}
                        onActivate={() => void handleActivate(tier.plan)}
                      />
                    );
                  })}
                </div>
                {(subscription.status === "active" ||
                  subscription.status === "trialing") && (
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      onClick={() => void handleCancel()}
                      disabled={busy !== null}
                    >
                      {busy === "cancel"
                        ? "Cancelling…"
                        : "Cancel subscription"}
                    </Button>
                  </div>
                )}
              </div>

              {activationNote ? (
                <div className="mt-4 inline-flex items-start gap-2 border-2 border-[#b45309] bg-[#fdf6e3] px-3 py-2 text-xs max-w-2xl">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-[#b45309]" />
                  <div>
                    <strong>Activated in demo mode.</strong> {activationNote}
                  </div>
                </div>
              ) : demoStatus?.enabled ? (
                <div className="mt-4 inline-flex items-start gap-2 border-2 border-[#1a1a1a] bg-[#e8e8e0] px-3 py-2 text-xs">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <strong>Demo mode.</strong> No Stripe keys are
                    configured, so activation is simulated locally — no
                    card is charged. Set STRIPE_SECRET_KEY +
                    STRIPE_PRICE_WORKSPACE_STUDIO +
                    STRIPE_PRICE_WORKSPACE_PRO in Convex to enable real
                    Checkout.
                  </div>
                </div>
              ) : null}

              <SeatBreakdown
                seatCount={subscription.seatCount}
                includedSeats={subscription.includedSeats}
              />

              {subscription.plan === "enterprise" && <EnterpriseUsage />}

              <PayoutsSection />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TierCard({
  plan,
  label,
  baseCents,
  perSeatCents,
  includedSeats,
  storageBytes,
  currency,
  features,
  isCurrent,
  busy,
  disabled,
  onActivate,
}: {
  plan: string;
  label: string;
  baseCents: number;
  perSeatCents: number;
  includedSeats: number;
  storageBytes: number;
  currency: string;
  features: string[];
  isCurrent: boolean;
  busy: boolean;
  disabled: boolean;
  onActivate: () => void;
}) {
  // The "current" card flips to the forest-green inverted treatment
  // (used elsewhere for active/badge states). This keeps text legible
  // in both light and dark themes — the cream-on-cream variant the
  // previous version used became invisible after the theme tokens
  // remapped #1a1a1a.
  return (
    <div
      className={cn(
        "border-2 p-5 flex flex-col gap-3",
        isCurrent
          ? "border-[#FF6600] bg-[#FF6600] text-[#f0f0e8]"
          : "border-[#1a1a1a] bg-[#f0f0e8]",
      )}
    >
      <div className="flex items-baseline gap-2 justify-between">
        <div
          className={cn(
            "font-black text-lg tracking-tight",
            isCurrent ? "text-[#f0f0e8]" : "text-[#1a1a1a]",
          )}
        >
          {label}
        </div>
        {isCurrent ? (
          <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 bg-[#f0f0e8] text-[#FF6600] font-bold">
            current
          </span>
        ) : (
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#888]">
            {plan}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className={cn(
            "font-mono font-black text-3xl",
            isCurrent ? "text-[#f0f0e8]" : "text-[#1a1a1a]",
          )}
        >
          {formatMoney(baseCents, currency)}
        </span>
        <span
          className={cn(
            "text-xs",
            isCurrent ? "text-[#FFB380]" : "text-[#666]",
          )}
        >
          / month
        </span>
      </div>
      <div
        className={cn(
          "text-xs font-mono",
          isCurrent ? "text-[#c8e0c8]" : "text-[#888]",
        )}
      >
        {includedSeats} seats included · {formatMoney(perSeatCents, currency)} /
        additional seat
      </div>
      <div
        className={cn(
          "text-xs font-mono flex items-center gap-1.5",
          isCurrent ? "text-[#c8e0c8]" : "text-[#888]",
        )}
      >
        <HardDrive className="h-3 w-3" />
        {formatStorage(storageBytes)} storage
      </div>
      <ul
        className={cn(
          "text-sm space-y-1 mt-1",
          isCurrent ? "text-[#f0f0e8]" : "text-[#1a1a1a]",
        )}
      >
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check
              className={cn(
                "h-3.5 w-3.5 mt-0.5 flex-shrink-0",
                isCurrent ? "text-[#FFB380]" : "text-[#FF6600]",
              )}
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Button
        onClick={onActivate}
        disabled={isCurrent || disabled}
        variant={isCurrent ? "outline" : "default"}
        className={cn(
          "mt-auto",
          isCurrent
            ? "bg-transparent border-[#f0f0e8] text-[#f0f0e8] hover:bg-[#f0f0e8] hover:text-[#FF6600]"
            : "bg-[#FF6600] hover:bg-[#FF7A1F]",
        )}
      >
        <CreditCard className="h-4 w-4 mr-1.5" />
        {isCurrent
          ? "Current plan"
          : busy
            ? "Activating…"
            : "Switch to this plan"}
      </Button>
    </div>
  );
}

const GIBIBYTE = 1024 ** 3;
const TEBIBYTE = 1024 ** 4;

function formatStorage(bytes: number): string {
  if (bytes >= TEBIBYTE) return `${(bytes / TEBIBYTE).toFixed(0)} TB`;
  return `${Math.round(bytes / GIBIBYTE)} GB`;
}

function PricingCard({
  plan,
  status,
  baseCents,
  perSeatCents,
  includedSeats,
  seatCount,
  overageSeats,
  monthlyCents,
  currency,
  currentPeriodEnd,
}: {
  plan: string;
  status: string;
  baseCents: number;
  perSeatCents: number;
  includedSeats: number;
  seatCount: number;
  overageSeats: number;
  monthlyCents: number;
  currency: string;
  currentPeriodEnd: number | undefined;
}) {
  const isActive = status === "active" || status === "trialing";
  return (
    <div className="mt-6 border-2 border-[#1a1a1a] bg-[#f0f0e8]">
      <div className="px-5 py-4 border-b-2 border-[#1a1a1a] flex items-center gap-2 flex-wrap">
        <div className="font-black text-sm uppercase tracking-tight">
          {plan === "studio_v1" ? "Studio plan" : plan}
        </div>
        <Badge variant={isActive ? "success" : "secondary"}>
          {status === "active"
            ? "Active"
            : status === "trialing"
              ? "Trial"
              : status === "canceled"
                ? "Canceled"
                : status === "past_due"
                  ? "Past due"
                  : "Not subscribed"}
        </Badge>
        {currentPeriodEnd && isActive ? (
          <span className="text-xs font-mono text-[#888] ml-auto">
            renews {new Date(currentPeriodEnd).toLocaleDateString()}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y-2 sm:divide-y-0 sm:divide-x-2 divide-[#1a1a1a]">
        <PricingRow
          label="Base"
          help={`Includes ${includedSeats} seats.`}
          amountCents={baseCents}
          currency={currency}
        />
        <PricingRow
          label="Per additional seat"
          help={`${overageSeats} extra seat${overageSeats === 1 ? "" : "s"} this period.`}
          amountCents={perSeatCents}
          currency={currency}
          accent={overageSeats > 0}
        />
      </div>

      <div
        className={cn(
          "px-5 py-4 border-t-2 border-[#1a1a1a] flex items-center justify-between gap-2",
          isActive ? "bg-[#1a1a1a] text-[#f0f0e8]" : "bg-[#e8e8e0]",
        )}
      >
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          <span className="font-black text-sm uppercase tracking-tight">
            Total per month
          </span>
        </div>
        <div className="font-mono font-black text-xl">
          {formatMoney(monthlyCents, currency)}
        </div>
      </div>

      <div className="px-5 py-2 text-[10px] font-mono text-[#888] uppercase tracking-wider border-t border-[#ccc]">
        {seatCount} seat{seatCount === 1 ? "" : "s"} ·{" "}
        {overageSeats > 0
          ? `${overageSeats} over included`
          : `${includedSeats - seatCount} seat${
              includedSeats - seatCount === 1 ? "" : "s"
            } left in plan`}
      </div>
    </div>
  );
}

function PricingRow({
  label,
  help,
  amountCents,
  currency,
  accent,
}: {
  label: string;
  help?: string;
  amountCents: number;
  currency: string;
  accent?: boolean;
}) {
  return (
    <div className="px-5 py-4 flex items-start gap-3">
      <div className="flex-shrink-0 w-8 h-8 border-2 border-[#1a1a1a] flex items-center justify-center bg-[#e8e8e0]">
        {accent ? (
          <Users className="h-4 w-4 text-[#FF6600]" />
        ) : (
          <Check className="h-4 w-4 text-[#888]" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm uppercase tracking-wider">
          {label}
        </div>
        {help ? (
          <div className="text-xs text-[#666] mt-0.5">{help}</div>
        ) : null}
      </div>
      <div className="font-mono font-bold text-base text-[#1a1a1a]">
        {formatMoney(amountCents, currency)}
      </div>
    </div>
  );
}

function SeatBreakdown({
  seatCount,
  includedSeats,
}: {
  seatCount: number;
  includedSeats: number;
}) {
  return (
    <section className="mt-10 border-2 border-[#1a1a1a] p-5">
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-4 w-4" />
        <h2 className="font-black text-sm uppercase tracking-tight">
          Seat usage
        </h2>
      </div>
      <div className="h-3 border-2 border-[#1a1a1a] bg-[#f0f0e8] relative">
        <div
          className={cn(
            "absolute inset-y-0 left-0",
            seatCount > includedSeats ? "bg-[#b45309]" : "bg-[#FF6600]",
          )}
          style={{
            width: `${Math.min(100, (seatCount / Math.max(includedSeats, 1)) * 100)}%`,
          }}
        />
      </div>
      <div className="mt-2 text-xs font-mono text-[#666] flex items-center justify-between">
        <span>
          {seatCount} / {includedSeats} included
        </span>
        {seatCount > includedSeats ? (
          <span className="text-[#b45309]">
            +{seatCount - includedSeats} overage
          </span>
        ) : null}
      </div>
      <p className="text-xs text-[#666] mt-3 max-w-prose">
        A seat is any unique person across your teams — owners, members,
        and viewers all count. Invite or remove collaborators from each
        team's settings page.
      </p>
    </section>
  );
}

function formatMoney(cents: number, currency: string) {
  const amount = cents / 100;
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  });
}

/**
 * Payouts (per-team Stripe Connect) used to live under each team's
 * settings. It now sits with billing so all money-in/money-out controls
 * are in one place. Receiving client money is still team-scoped, so this
 * lists every team the user belongs to with its own Connect card.
 */
/**
 * Pay-as-you-go usage table. Only rendered for enterprise subscribers.
 * Reads `usageMeters.getCurrentPeriod` which returns the current
 * billing period's running totals (or zeros if nothing's recorded
 * yet). Values are local — the daily cron pushes them to Stripe.
 */
function EnterpriseUsage() {
  const period = useQuery(api.usageMeters.getCurrentPeriod, {});
  const tiers = useQuery(api.workspaceBilling.listTiers, {});
  const enterprise = tiers?.find((t) => t.plan === "enterprise");
  if (!period || !enterprise?.meters) return null;

  const rates = enterprise.meters;

  const rows = [
    {
      label: "Storage",
      value: period.storageBytesGbMonths,
      unit: "GB-mo",
      cents: rates.storageGbMonthCents,
      rateUnit: "/ GB-mo",
    },
    {
      label: "Egress",
      value: period.egressBytesGb,
      unit: "GB",
      cents: rates.egressGbCents,
      rateUnit: "/ GB",
    },
    {
      label: "Seats",
      value: period.seatCount,
      unit: "",
      cents: rates.perSeatCents,
      rateUnit: "/ seat / mo",
    },
    {
      label: "Transcription",
      value: period.transcribedMinutes / 1000,
      unit: "1k min",
      cents: rates.transcriptionPer1kMinCents,
      rateUnit: "/ 1k min",
    },
  ];

  return (
    <div className="mt-8">
      <h2 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#888] mb-3">
        This period's usage
      </h2>
      <div className="border-2 border-[#1a1a1a] bg-[#f0f0e8]">
        <div className="grid grid-cols-4 divide-x-2 divide-[#1a1a1a]/15">
          {rows.map((row) => (
            <div key={row.label} className="p-4">
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
                {row.label}
              </div>
              <div className="mt-2 text-2xl font-black tracking-tighter text-[#1a1a1a]">
                {row.value.toFixed(2)}
                {row.unit && (
                  <span className="text-xs text-[#888] ml-1 font-mono font-normal">
                    {row.unit}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-[#C2410C] font-mono mt-1">
                ${(row.cents / 100).toFixed(2)} {row.rateUnit}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t-2 border-[#1a1a1a] px-4 py-2 text-[10px] font-mono text-[#888]">
          Reported daily to Stripe at 03:00 UTC. Period ends{" "}
          {new Date(period.periodEnd).toLocaleDateString()}.
        </div>
      </div>
    </div>
  );
}

function PayoutsSection() {
  const teams = useQuery(api.teams.list, {});
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});

  return (
    <section className="mt-10">
      <div className="flex items-center gap-2 mb-1">
        <Wallet className="h-4 w-4" />
        <h2 className="font-black text-sm uppercase tracking-tight">Payouts</h2>
      </div>
      <p className="text-sm text-[#666] mb-4 max-w-prose">
        Connect Stripe to collect payments from clients on paywalled delivery
        links. Snip never touches the money — it goes straight to your Stripe
        account. Each team has its own connected account.
      </p>

      {featureStatus && !featureStatus.stripeConnect ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-[#dc2626]" />
              <CardTitle>Stripe not configured</CardTitle>
            </div>
            <CardDescription>
              Set <code className="bg-[#e8e8e0] px-1">STRIPE_SECRET_KEY</code>{" "}
              and{" "}
              <code className="bg-[#e8e8e0] px-1">STRIPE_WEBHOOK_SECRET</code>{" "}
              on this deployment before teams can collect client payments.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : teams === undefined ? (
        <div className="text-sm text-[#888]">Loading payout accounts…</div>
      ) : teams.length === 0 ? (
        <div className="text-sm text-[#888]">
          You're not on any teams yet.
        </div>
      ) : (
        <div className="space-y-4">
          {teams.map((team) => (
            <TeamPayoutCard
              key={team._id}
              teamId={team._id as Id<"teams">}
              teamName={team.name}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TeamPayoutCard({
  teamId,
  teamName,
}: {
  teamId: Id<"teams">;
  teamName: string;
}) {
  const onboardingStatus = useQuery(api.stripeConnect.getOnboardingStatus, {
    teamId,
  });
  const createAccount = useAction(api.stripeConnectActions.createConnectAccount);
  const createOnboardingLink = useAction(
    api.stripeConnectActions.createOnboardingLink,
  );
  const refreshStatus = useAction(api.stripeConnectActions.refreshAccountStatus);

  const [busy, setBusy] = useState<null | "create" | "link" | "refresh">(null);
  const [error, setError] = useState<string | null>(null);

  const status = onboardingStatus?.status ?? null;

  // Reconcile once on mount when an account exists but isn't active yet,
  // so a just-completed Stripe onboarding reflects without a manual click
  // (and without depending on the account.updated webhook arriving).
  useEffect(() => {
    if (!onboardingStatus?.stripeAccountId || status === "active") return;
    void refreshStatus({ teamId }).catch(() => {});
  }, [onboardingStatus?.stripeAccountId, status, refreshStatus, teamId]);

  const returnUrl = `${window.location.origin}/dashboard/billing?stripe=return`;
  const refreshUrl = `${window.location.origin}/dashboard/billing?stripe=refresh`;

  const handleConnect = async () => {
    setError(null);
    setBusy("create");
    try {
      const result = await createAccount({ teamId });
      if (result.status === "disabled") {
        setError(result.reason ?? "Stripe is not configured on this deployment.");
        return;
      }
      setBusy("link");
      const link = await createOnboardingLink({ teamId, returnUrl, refreshUrl });
      if (link.status === "ok" && link.url) {
        window.location.href = link.url;
        return;
      }
      setError(link.reason ?? "Could not start Stripe onboarding.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect Stripe.");
    } finally {
      setBusy(null);
    }
  };

  const handleContinue = async () => {
    setError(null);
    setBusy("link");
    try {
      const link = await createOnboardingLink({ teamId, returnUrl, refreshUrl });
      if (link.status === "ok" && link.url) {
        window.location.href = link.url;
        return;
      }
      setError(link.reason ?? "Could not continue onboarding.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleRefresh = async () => {
    setError(null);
    setBusy("refresh");
    try {
      const result = await refreshStatus({ teamId });
      if (result.status === "disabled") {
        setError(result.reason ?? "Stripe not configured.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>{teamName}</CardTitle>
            <CardDescription>
              Stripe Express account — Stripe handles compliance, payouts, and
              onboarding.
            </CardDescription>
          </div>
          {status === "active" ? (
            <Badge variant="success">
              <CheckCircle className="h-3 w-3 mr-1" /> Active
            </Badge>
          ) : status === "pending" ? (
            <Badge variant="secondary">Pending</Badge>
          ) : status === "restricted" ? (
            <Badge variant="destructive">Restricted</Badge>
          ) : status === "disabled" ? (
            <Badge variant="destructive">Disabled</Badge>
          ) : (
            <Badge variant="secondary">Not connected</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {onboardingStatus === undefined ? (
          <div className="text-sm text-[#888]">Loading status…</div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-[#888]">Account ID</dt>
              <dd className="font-mono truncate">
                {onboardingStatus.stripeAccountId ?? "—"}
              </dd>
              <dt className="text-[#888]">Charges enabled</dt>
              <dd>{onboardingStatus.chargesEnabled ? "Yes" : "No"}</dd>
              <dt className="text-[#888]">Payouts enabled</dt>
              <dd>{onboardingStatus.payoutsEnabled ? "Yes" : "No"}</dd>
            </dl>

            {!onboardingStatus.stripeAccountId ? (
              <Button
                onClick={() => void handleConnect()}
                disabled={busy !== null || !onboardingStatus.canManageBilling}
                className="w-full bg-[#FF6600] hover:bg-[#FF7A1F]"
              >
                {busy === "create" || busy === "link"
                  ? "Opening Stripe…"
                  : "Connect Stripe"}
              </Button>
            ) : status !== "active" ? (
              <div className="flex gap-2">
                <Button
                  onClick={() => void handleContinue()}
                  disabled={busy !== null || !onboardingStatus.canManageBilling}
                  className="flex-1 bg-[#FF6600] hover:bg-[#FF7A1F]"
                >
                  {busy === "link" ? "Opening…" : "Continue onboarding"}
                  <ExternalLink className="h-3 w-3 ml-2" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleRefresh()}
                  disabled={busy !== null}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {busy === "refresh" ? "…" : "Refresh"}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => void handleRefresh()}
                disabled={busy !== null}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {busy === "refresh" ? "Refreshing…" : "Refresh status"}
              </Button>
            )}

            {!onboardingStatus.canManageBilling ? (
              <p className="text-xs text-[#888]">
                Only the team owner can manage payout settings.
              </p>
            ) : null}

            {error ? (
              <div className="text-sm text-[#dc2626] border-l-2 border-[#dc2626] pl-2">
                {error}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
