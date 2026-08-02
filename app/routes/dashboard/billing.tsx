import { createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DashboardHeader } from "@/components/DashboardHeader";
import { StorageUsageBar } from "@/components/StorageUsageBar";
import { StoragePlanner } from "@/components/StoragePlanner";
import { AddOnsSection } from "@/components/AddOnsSection";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CheckCircle,
  CreditCard,
  ExternalLink,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { seoHead } from "@/lib/seo";
import {
  buildRequirementList,
  derivePayoutState,
  describePayoutState,
} from "@/lib/stripeRequirements";

export const Route = createFileRoute("/dashboard/billing")({
  head: () =>
    seoHead({
      title: "Billing & usage",
      description: "Manage your Snip storage plan and client payments.",
      path: "/dashboard/billing",
      noIndex: true,
    }),
  component: BillingRoute,
});

function BillingRoute() {
  const subscription = useQuery(api.workspaceBilling.getMySubscription, {});
  // Drives the planner's downgrade guard: we must not offer a size that
  // is smaller than what the workspace already stores.
  const storageUsage = useQuery(api.workspaceBilling.getMyStorageUsage, {});
  const demoStatus = useQuery(api.demoSeed.isDemoMode, {});
  const createCheckout = useAction(api.workspaceBillingActions.createCheckout);
  const createPortal = useAction(api.workspaceBillingActions.createPortal);
  const simulateActivate = useMutation(api.workspaceBilling.simulateActivate);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "warning" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("checkout");
    if (result === "success") {
      setNotice({
        kind: "success",
        message: "Payment received. Your plan will update as Stripe confirms it.",
      });
    } else if (result === "cancel") {
      setNotice({ kind: "warning", message: "Checkout was canceled. Nothing changed." });
    }
  }, []);

  const activate = async (plan: string) => {
    setBusy(`checkout:${plan}`);
    setNotice(null);
    try {
      const origin = window.location.origin;
      const result = await createCheckout({
        plan,
        cadence: "monthly",
        successUrl: `${origin}/dashboard/billing?checkout=success`,
        cancelUrl: `${origin}/dashboard/billing?checkout=cancel`,
      });
      if (result.kind === "redirect") {
        window.location.assign(result.url);
        return;
      }
      await simulateActivate({ plan });
      setNotice({ kind: "warning", message: result.reason });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Checkout could not be started.",
      });
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy("portal");
    setNotice(null);
    try {
      const session = await createPortal({
        returnUrl: `${window.location.origin}/dashboard/billing`,
      });
      window.location.assign(session.url);
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The Stripe billing portal could not be opened.",
      });
    } finally {
      setBusy(null);
    }
  };

  const isLive =
    subscription?.status === "active" || subscription?.status === "trialing";

  return (
    <div className="flex h-full flex-col">
      <DashboardHeader paths={[{ label: "Billing & usage" }]} />
      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-9">
        <div className="w-full max-w-4xl space-y-10">
          <header>
            <h1 className="text-3xl font-black tracking-tight text-[#1a1a1a]">
              Billing &amp; usage
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#666]">
              Pick storage for your workspace, then invite as many collaborators as
              you need. Client payments are configured separately and pay out to
              your connected Stripe account.
            </p>
          </header>

          {notice ? <Notice kind={notice.kind}>{notice.message}</Notice> : null}

          {subscription === undefined ? (
            <p className="text-sm text-[#888]">Loading billing…</p>
          ) : subscription === null ? (
            <Notice kind="warning">Sign in to manage billing.</Notice>
          ) : (
            <>
              <section aria-labelledby="current-plan-heading">
                <div className="mb-3 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#888]">
                      Current workspace
                    </p>
                    <h2 id="current-plan-heading" className="mt-1 text-xl font-black capitalize">
                      {subscription.plan} plan
                    </h2>
                  </div>
                  <StatusBadge status={subscription.status} />
                </div>

                <div className="overflow-hidden border-2 border-[#1a1a1a]">
                  <div className="grid gap-px bg-[#1a1a1a] sm:grid-cols-3">
                    <SummaryCell
                      label="Monthly price"
                      value={formatMoney(subscription.monthlyCents, subscription.currency)}
                    />
                    <SummaryCell label="Collaborators" value={`${subscription.seatCount}`} />
                    <SummaryCell
                      label={subscription.cancelAtPeriodEnd ? "Access ends" : "Next renewal"}
                      value={
                        subscription.currentPeriodEnd
                          ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                          : isLive
                            ? "Pending"
                            : "No renewal"
                      }
                    />
                  </div>
                  {subscription.stripeCustomerId ? (
                    <div className="flex flex-col gap-3 border-t-2 border-[#1a1a1a] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-[#666]">
                        Stripe handles invoices, payment methods, and cancellation.
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => void openPortal()}
                        disabled={busy !== null}
                      >
                        <CreditCard className="mr-2 h-4 w-4" />
                        {busy === "portal" ? "Opening…" : "Manage in Stripe"}
                        <ExternalLink className="ml-2 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </section>

              <StorageUsageBar variant="full" />

              <section aria-labelledby="plans-heading">
                <div className="mb-4">
                  <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#888]">
                    Storage plans
                  </p>
                  <h2 id="plans-heading" className="mt-1 text-xl font-black">
                    Pay for capacity, not headcount
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm text-[#666]">
                    Every plan includes projects, review, contracts, desktop drive,
                    and paywalled delivery. Paid plans include unlimited collaborators.
                  </p>
                </div>
                <StoragePlanner
                  currentPlan={subscription.plan}
                  usedBytes={storageUsage?.usedBytes ?? 0}
                  busy={busy?.startsWith("checkout:") ?? false}
                  onChoose={(plan) => void activate(plan)}
                />
                {isLive ? (
                  <p className="mt-3 text-xs text-[#666]">
                    Change or cancel your active plan from the Stripe billing portal above.
                  </p>
                ) : null}
                {demoStatus?.enabled ? (
                  <p className="mt-3 text-xs text-[#666]">
                    Demo mode is enabled. Checkout simulates activation when Stripe is absent.
                  </p>
                ) : null}
              </section>

              <AddOnsSection />

              <PayoutsSection />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#f0f0e8] px-4 py-4">
      <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
        {label}
      </p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const live = status === "active" || status === "trialing";
  const label =
    status === "active"
      ? "Active"
      : status === "trialing"
        ? "Trial"
        : status === "past_due"
          ? "Past due"
          : status === "canceled"
            ? "Canceled"
            : "Free";
  return <Badge variant={live ? "success" : status === "past_due" ? "destructive" : "secondary"}>{label}</Badge>;
}


function Notice({
  kind,
  children,
}: {
  kind: "success" | "warning" | "error";
  children: ReactNode;
}) {
  const styles = {
    success: "border-[#166534] bg-[#dcfce7] text-[#14532d]",
    warning: "border-[#b45309] bg-[#fef3c7] text-[#78350f]",
    error: "border-[#dc2626] bg-[#fee2e2] text-[#7f1d1d]",
  };
  return (
    <div role="status" className={cn("flex items-start gap-2 border-2 px-3 py-2 text-sm", styles[kind])}>
      {kind === "success" ? (
        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{children}</span>
    </div>
  );
}


function formatMoney(cents: number, currency: string): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  });
}

function PayoutsSection() {
  const teams = useQuery(api.teams.list, {});
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});
  const ownedTeams = (teams ?? []).filter((team) => team.role === "owner");

  return (
    <section aria-labelledby="payments-heading">
      <div className="mb-4">
        <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#888]">
          Client payments
        </p>
        <h2 id="payments-heading" className="mt-1 text-xl font-black">
          Sell access to a delivery
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#666]">
          Set a price on a share link. Snip shows a watermarked preview, Stripe
          collects payment, and the original unlocks automatically. Connect your
          payout account once for each workspace you own.
        </p>
      </div>

      {featureStatus && !featureStatus.stripeConnect ? (
        <Notice kind="error">Stripe Connect is not configured on this deployment.</Notice>
      ) : teams === undefined ? (
        <p className="text-sm text-[#888]">Loading payout accounts…</p>
      ) : ownedTeams.length === 0 ? (
        <p className="text-sm text-[#888]">Create a workspace to connect payouts.</p>
      ) : (
        <div className="space-y-3">
          {ownedTeams.map((team) => (
            <TeamPayoutRow
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

function TeamPayoutRow({ teamId, teamName }: { teamId: Id<"teams">; teamName: string }) {
  const status = useQuery(api.stripeConnect.getOnboardingStatus, { teamId });
  const earnings = useQuery(api.payments.getTeamEarnings, { teamId, limit: 5 });
  const createAccount = useAction(api.stripeConnectActions.createConnectAccount);
  const createOnboardingLink = useAction(api.stripeConnectActions.createOnboardingLink);
  const refreshStatus = useAction(api.stripeConnectActions.refreshAccountStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status?.stripeAccountId || status.status === "active") return;
    void refreshStatus({ teamId }).catch(() => undefined);
  }, [refreshStatus, status?.status, status?.stripeAccountId, teamId]);

  const startOnboarding = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!status?.stripeAccountId) {
        const account = await createAccount({ teamId });
        if (account.status !== "ok" && account.status !== "exists") {
          throw new Error(account.reason ?? "Stripe account setup is unavailable.");
        }
      }
      const origin = window.location.origin;
      const link = await createOnboardingLink({
        teamId,
        returnUrl: `${origin}/dashboard/billing?stripe=return`,
        refreshUrl: `${origin}/dashboard/billing?stripe=refresh`,
      });
      if (link.status !== "ok" || !link.url) {
        throw new Error(link.reason ?? "Stripe onboarding could not be opened.");
      }
      window.location.assign(link.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stripe setup failed.");
    } finally {
      setBusy(false);
    }
  };

  const state = status ? derivePayoutState(status) : "notConnected";
  const badge = describePayoutState(state);
  const todo = buildRequirementList(status?.requirements ?? null);
  const ready = state === "ready";

  return (
    <div className="border-2 border-[#1a1a1a] bg-[#f0f0e8] px-4 py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Wallet className="h-4 w-4" />
            <h3 className="font-bold">{teamName}</h3>
            <Badge
              variant={
                badge.tone === "good"
                  ? "success"
                  : badge.tone === "bad"
                    ? "destructive"
                    : "secondary"
              }
            >
              {badge.label}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-[#666]">{PAYOUT_COPY[state]}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {ready ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void refreshStatus({ teamId }).finally(() => setBusy(false));
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          ) : (
            <Button
              disabled={busy || status === undefined || !status.canManageBilling}
              onClick={() => void startOnboarding()}
            >
              {busy
                ? "Opening Stripe…"
                : status?.stripeAccountId
                  ? "Finish verification"
                  : "Connect Stripe"}
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {status && !status.canManageBilling && !ready ? (
        <p className="mt-3 text-xs text-[#666]">
          Only a workspace owner can set this up.
        </p>
      ) : null}

      {todo.length > 0 ? (
        <div className="mt-4 border-t-2 border-[#1a1a1a] pt-3">
          <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#888]">
            Stripe still needs
          </p>
          <ul className="mt-2 space-y-1.5">
            {todo.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-4 text-sm">
                <span>{item.label}</span>
                {item.pastDue ? (
                  <span className="font-mono text-xs text-[#C2410C]">Past due</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {earnings && earnings.saleCount > 0 ? (
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t-2 border-[#1a1a1a] pt-3 text-sm">
          <span>
            <span className="text-[#666]">Sales </span>
            <span className="font-bold">{earnings.saleCount}</span>
          </span>
          <span>
            <span className="text-[#666]">You earned </span>
            <span className="font-bold">
              {formatMoney(earnings.netCents, earnings.currency)}
            </span>
          </span>
          {earnings.owedByPlatformCents > 0 ? (
            <span>
              <span className="text-[#666]">Waiting on setup </span>
              <span className="font-bold text-[#C2410C]">
                {formatMoney(earnings.owedByPlatformCents, earnings.currency)}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="mt-3"><Notice kind="error">{error}</Notice></div> : null}
    </div>
  );
}

const PAYOUT_COPY: Record<ReturnType<typeof derivePayoutState>, string> = {
  ready: "Client payments route straight to this Stripe account.",
  held:
    "Sales are working, but Stripe is holding the money until verification is finished.",
  restricted: "Stripe needs more information to keep paying out.",
  verifying: "Stripe is checking the details you submitted.",
  disabled: "Stripe disabled this account. Open Stripe for the reason.",
  notConnected: "Stripe Express verifies your business and handles payouts.",
};
