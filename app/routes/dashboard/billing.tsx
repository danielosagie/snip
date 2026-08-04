import { createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DashboardHeader } from "@/components/DashboardHeader";
import { StorageUsageBar } from "@/components/StorageUsageBar";
import { StoragePlanner } from "@/components/StoragePlanner";
import { AddOnsSection } from "@/components/AddOnsSection";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, CheckCircle, ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { seoHead } from "@/lib/seo";
import { formatBytes } from "@/lib/storagePricing";
import {
  buildRequirementList,
  derivePayoutState,
  describePayoutState,
} from "@/lib/stripeRequirements";

export const Route = createFileRoute("/dashboard/billing")({
  head: () =>
    seoHead({
      title: "Billing & Invoices",
      description: "Manage your Snip plan, invoices, and client payouts.",
      path: "/dashboard/billing",
      noIndex: true,
    }),
  component: BillingRoute,
});

type InvoiceRow = {
  id: string;
  createdAt: number;
  description: string;
  status: string;
  amountPaidCents: number;
  currency: string;
  hostedInvoiceUrl: string | null;
};

const softCard =
  "rounded-[14px] border border-[#E8E8EC] bg-white px-5 py-5 sm:px-6 sm:py-[22px]";

function BillingRoute() {
  const subscription = useQuery(api.workspaceBilling.getMySubscription, {});
  const storageUsage = useQuery(api.workspaceBilling.getMyStorageUsage, {});
  const demoStatus = useQuery(api.demoSeed.isDemoMode, {});
  const createCheckout = useAction(api.workspaceBillingActions.createCheckout);
  const createPortal = useAction(api.workspaceBillingActions.createPortal);
  const simulateActivate = useMutation(api.workspaceBilling.simulateActivate);
  const [planOpen, setPlanOpen] = useState(false);
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
        message: "Payment received. Your plan will update when Stripe confirms it.",
      });
    } else if (result === "cancel") {
      setNotice({ kind: "warning", message: "Nothing changed." });
    }
  }, []);

  const activate = async (plan: "basic" | "pro") => {
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
      setPlanOpen(false);
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

  const isLive = subscription?.status === "active" || subscription?.status === "trialing";

  return (
    <div className="flex h-full flex-col">
      <DashboardHeader paths={[{ label: "Billing & Invoices" }]} />
      <main className="surface-billing-soft flex-1 overflow-y-auto bg-[#FAFAFA] px-4 py-8 text-[#131315] sm:px-8 lg:px-14 lg:py-10">
        <div className="w-full max-w-[1120px] space-y-3.5">
          <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.02em]">
            Billing &amp; Invoices
          </h1>

          {notice ? <Notice kind={notice.kind}>{notice.message}</Notice> : null}

          {subscription === undefined ? (
            <SoftSkeleton />
          ) : subscription === null ? (
            <Notice kind="warning">Sign in to manage billing.</Notice>
          ) : (
            <>
              <section className={cn(softCard, "flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between")}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-base font-semibold capitalize">{subscription.plan}</h2>
                    <span className="rounded-full bg-[#F1F1F3] px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[#6E6E73]">
                      {subscription.billingCadence === "annual" ? "Annual" : "Monthly"}
                    </span>
                  </div>
                  <p className="mt-3 text-[28px] font-semibold leading-8 tracking-[-0.03em]">
                    {formatMoney(subscription.monthlyCents, subscription.currency)}
                    <span className="ml-1 text-sm font-normal tracking-normal text-[#6E6E73]">/ mo.</span>
                  </p>
                  <p className="mt-2 text-sm leading-5 text-[#6E6E73]">
                    {formatPlanDescription(subscription.plan, subscription.storageLimitBytes)}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-[#6E6E73]">
                    {subscription.cancelAtPeriodEnd
                      ? `Ends ${formatDate(subscription.currentPeriodEnd)}.`
                      : subscription.currentPeriodEnd
                        ? `Renews on ${formatDate(subscription.currentPeriodEnd)}.`
                        : "No renewal scheduled."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPlanOpen(true)}
                  className="shrink-0 rounded-full border border-[#DADADD] bg-white px-4 py-2 text-[13px] font-medium transition-colors hover:bg-[#F7F7F8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315]"
                >
                  Adjust plan
                </button>
              </section>

              <InvoicesCard
                enabled={Boolean(subscription.stripeCustomerId)}
                currency={subscription.currency}
                onOpenPortal={() => void openPortal()}
                portalBusy={busy === "portal"}
              />

              <div className="h-0.5 bg-[#DDDDDF]" />

              <PayoutsSection />

              <Dialog open={planOpen} onOpenChange={setPlanOpen}>
                <DialogContent className="surface-client max-h-[88vh] max-w-3xl overflow-y-auto rounded-2xl border border-[#E8E8EC] bg-white p-6 text-[#131315] sm:p-8">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-semibold">Adjust plan</DialogTitle>
                    <DialogDescription className="text-sm text-[#6E6E73]">
                      Storage, plan controls, and optional add-ons.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-5 space-y-5">
                    <StorageUsageBar variant="full" />
                    <StoragePlanner
                      currentPlan={subscription.plan}
                      usedBytes={storageUsage?.usedBytes ?? 0}
                      busy={busy?.startsWith("checkout:") ?? false}
                      onChoose={(plan) => {
                        if (isLive && subscription.stripeCustomerId) {
                          void openPortal();
                        } else {
                          void activate(plan);
                        }
                      }}
                    />
                    {isLive && subscription.stripeCustomerId ? (
                      <p className="text-xs text-[#6E6E73]">
                        Active-plan changes finish in Stripe.
                      </p>
                    ) : null}
                    {demoStatus?.enabled ? (
                      <p className="text-xs text-[#6E6E73]">
                        Demo mode is on. Checkout simulates activation when Stripe is absent.
                      </p>
                    ) : null}
                    <AddOnsSection />
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function InvoicesCard({
  enabled,
  currency,
  onOpenPortal,
  portalBusy,
}: {
  enabled: boolean;
  currency: string;
  onOpenPortal: () => void;
  portalBusy: boolean;
}) {
  const listInvoices = useAction(api.workspaceBillingActions.listRecentInvoices);
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setInvoices([]);
      return;
    }
    let canceled = false;
    void listInvoices({ limit: 6 })
      .then((rows) => {
        if (!canceled) setInvoices(rows);
      })
      .catch((cause) => {
        if (!canceled) {
          setError(cause instanceof Error ? cause.message : "Invoices could not be loaded.");
          setInvoices([]);
        }
      });
    return () => {
      canceled = true;
    };
  }, [enabled, listInvoices]);

  return (
    <section className={softCard} aria-labelledby="invoices-heading">
      <CardHeading
        id="invoices-heading"
        title="Invoices"
        subtitle="What you paid Snip."
        aside={<PeriodPill />}
      />
      <div className="mt-4">
        <div className="hidden grid-cols-[130px_minmax(0,1fr)_110px_120px_80px] pb-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-[#A0A0A5] md:grid">
          <span>Date</span><span>Description</span><span>Status</span><span className="text-right">Amount</span><span className="text-right">Invoice</span>
        </div>
        {invoices === null ? (
          <p className="border-t border-[#F1F1F3] py-4 text-sm text-[#6E6E73]">Loading invoices…</p>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col gap-3 border-t border-[#F1F1F3] py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[#6E6E73]">{error ?? "No Snip invoices yet."}</p>
            {enabled ? (
              <button type="button" onClick={onOpenPortal} disabled={portalBusy} className="text-left text-sm font-medium hover:underline">
                {portalBusy ? "Opening…" : "Open Stripe"}
              </button>
            ) : null}
          </div>
        ) : (
          invoices.map((invoice) => (
            <div key={invoice.id} className="grid gap-1 border-t border-[#F1F1F3] py-3 text-sm md:grid-cols-[130px_minmax(0,1fr)_110px_120px_80px] md:items-center md:gap-0">
              <span className="text-[#6E6E73]">{formatDate(invoice.createdAt)}</span>
              <span className="min-w-0 truncate">{invoice.description}</span>
              <span className="capitalize text-[#6E6E73]">{invoice.status}</span>
              <span className="md:text-right">{formatMoney(invoice.amountPaidCents, invoice.currency || currency)}</span>
              <span className="md:text-right">
                {invoice.hostedInvoiceUrl ? (
                  <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="font-medium hover:underline">View</a>
                ) : <span className="text-[#A0A0A5]">—</span>}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function PayoutsSection() {
  const teams = useQuery(api.teams.list, {});
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});
  const ownedTeams = (teams ?? []).filter((team) => team.role === "owner");

  if (featureStatus && !featureStatus.stripeConnect) {
    return <Notice kind="error">Stripe Connect is not configured on this deployment.</Notice>;
  }
  if (teams === undefined) return <SoftSkeleton />;
  if (ownedTeams.length === 0) {
    return <p className="py-4 text-sm text-[#6E6E73]">Create a workspace to accept client payments.</p>;
  }

  return (
    <div className="space-y-3.5">
      {ownedTeams.map((team) => (
        <TeamBillingCards
          key={team._id}
          teamId={team._id as Id<"teams">}
          teamName={team.name}
          showTeamName={ownedTeams.length > 1}
        />
      ))}
    </div>
  );
}

function TeamBillingCards({
  teamId,
  teamName,
  showTeamName,
}: {
  teamId: Id<"teams">;
  teamName: string;
  showTeamName: boolean;
}) {
  const status = useQuery(api.stripeConnect.getOnboardingStatus, { teamId });
  const earnings = useQuery(api.payments.getTeamEarnings, { teamId, limit: 6 });
  const createAccount = useAction(api.stripeConnectActions.createConnectAccount);
  const createOnboardingLink = useAction(api.stripeConnectActions.createOnboardingLink);
  const refreshStatus = useAction(api.stripeConnectActions.refreshAccountStatus);
  const getReceiptUrl = useAction(api.paymentsActions.getReceiptUrl);
  const [busy, setBusy] = useState(false);
  const [receiptBusy, setReceiptBusy] = useState<string | null>(null);
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

  const openReceipt = async (paymentId: Id<"payments">) => {
    setReceiptBusy(paymentId);
    setError(null);
    try {
      const result = await getReceiptUrl({ paymentId });
      if (!result.url) throw new Error("Stripe has not attached a receipt yet.");
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Receipt could not be opened.");
    } finally {
      setReceiptBusy(null);
    }
  };

  const state = status ? derivePayoutState(status) : "notConnected";
  const payout = describePayoutState(state);
  const todo = buildRequirementList(status?.requirements ?? null);
  const ready = state === "ready";

  return (
    <>
      <section className={softCard} aria-labelledby={`paid-${teamId}`}>
        <CardHeading
          id={`paid-${teamId}`}
          title="Paid to you"
          subtitle="What clients paid for your files, minus the 5% + 30¢ fee."
          aside={<div className="flex items-center gap-2">{showTeamName ? <span className="text-xs text-[#6E6E73]">{teamName}</span> : null}<PeriodPill /></div>}
        />
        <div className="mt-4">
          <div className="hidden grid-cols-[130px_minmax(0,1fr)_110px_120px_80px] pb-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-[#A0A0A5] md:grid">
            <span>Date</span><span>File</span><span>Paid out</span><span className="text-right">You get</span><span className="text-right">Receipt</span>
          </div>
          {earnings === undefined ? (
            <p className="border-t border-[#F1F1F3] py-4 text-sm text-[#6E6E73]">Loading payments…</p>
          ) : earnings.recent.length === 0 ? (
            <p className="border-t border-[#F1F1F3] py-4 text-sm text-[#6E6E73]">No client payments yet.</p>
          ) : (
            earnings.recent.map((row) => (
              <div key={row.id} className="grid gap-1 border-t border-[#F1F1F3] py-3 text-sm md:grid-cols-[130px_minmax(0,1fr)_110px_120px_80px] md:items-center md:gap-0">
                <span className="text-[#6E6E73]">{formatDate(row.paidAt)}</span>
                <span className="min-w-0 truncate">{row.fileName}</span>
                <span className={row.routedTo === "held" ? "text-[#D14E00]" : "text-[#6E6E73]"}>{row.routedTo === "held" ? "Held" : "Sent"}</span>
                <span className="md:text-right">{formatMoney(row.netCents, row.currency)}</span>
                <button type="button" disabled={receiptBusy === row.id} onClick={() => void openReceipt(row.id)} className="text-left font-medium hover:underline disabled:opacity-50 md:text-right">
                  {receiptBusy === row.id ? "…" : "View"}
                </button>
              </div>
            ))
          )}
          {earnings?.totals && earnings.totals.owedByPlatformCents > 0 ? (
            <div className="grid grid-cols-[1fr_120px_80px] border-t border-[#E8E8EC] pt-3 text-sm">
              <span className="font-medium">Waiting on Stripe verification</span>
              <span className="text-right text-[15px] font-semibold">{formatMoney(earnings.totals.owedByPlatformCents, earnings.totals.currency)}</span>
              <span />
            </div>
          ) : null}
        </div>
      </section>

      <section className={softCard} aria-labelledby={`getting-paid-${teamId}`}>
        <CardHeading
          id={`getting-paid-${teamId}`}
          title="Getting paid"
          subtitle="Set up Stripe once. Clients pay through your share links, Stripe pays you out."
          aside={
            <button
              type="button"
              disabled={busy || status === undefined || (!status.canManageBilling && !ready)}
              onClick={() => {
                if (ready) {
                  setBusy(true);
                  void refreshStatus({ teamId }).finally(() => setBusy(false));
                } else {
                  void startOnboarding();
                }
              }}
              className="inline-flex items-center rounded-full bg-[#131315] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40"
            >
              {busy ? "Opening…" : ready ? <><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</> : <>Finish setup<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></>}
            </button>
          }
        />

        <div className="mt-4 grid rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] sm:grid-cols-3">
          <Metric label="Payments" value={status?.available === false ? "Unavailable" : "Active"} accent />
          <Metric label="Payouts" value={payout.label} />
          <Metric label="Collected so far" value={earnings?.totals ? formatMoney(earnings.totals.grossCents, earnings.totals.currency) : "—"} />
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between pb-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-[#A0A0A5]">
            <span>Stripe still needs</span><span>Due</span>
          </div>
          {todo.length > 0 ? todo.map((item) => (
            <div key={item.key} className="flex items-center border-t border-[#F1F1F3] py-3 text-sm">
              <span className={cn("mr-3 h-1.5 w-1.5 rounded-full", item.pastDue ? "bg-[#D8434F]" : "bg-[#D39329]")} />
              <span className="flex-1">{item.label}</span>
              <span className={cn("text-[13px] font-medium", item.pastDue ? "text-[#D8434F]" : "text-[#6E6E73]")}>{item.pastDue ? "Past due" : "Now"}</span>
            </div>
          )) : (
            <p className="border-t border-[#F1F1F3] py-3 text-sm text-[#6E6E73]">
              {ready
                ? "Stripe has everything it needs."
                : status?.stripeAccountId
                  ? "Checking your Stripe requirements…"
                  : "Connect Stripe to add your payout details."}
            </p>
          )}
        </div>
        {error ? <div className="mt-3"><Notice kind="error">{error}</Notice></div> : null}
      </section>
    </>
  );
}

function CardHeading({ id, title, subtitle, aside }: { id: string; title: string; subtitle: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div>
        <h2 id={id} className="text-base font-semibold leading-[22px]">{title}</h2>
        <p className="mt-1 text-sm leading-5 text-[#6E6E73]">{subtitle}</p>
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

function PeriodPill() {
  return <span className="inline-flex rounded-full border border-[#E8E8EC] bg-white px-3 py-1.5 text-[12px] text-[#6E6E73]">Last 6 months</span>;
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-4 py-3.5 sm:border-l sm:border-[#E8E8EC] sm:first:border-l-0">
      <p className="text-sm font-medium">{label}</p>
      <p className={cn("mt-0.5 text-[13px]", accent ? "text-[#D14E00]" : "text-[#6E6E73]")}>{value}</p>
    </div>
  );
}

function SoftSkeleton() {
  return <div className={cn(softCard, "h-28 animate-pulse bg-white")} aria-label="Loading" />;
}

function Notice({ kind, children }: { kind: "success" | "warning" | "error"; children: ReactNode }) {
  const styles = {
    success: "border-[#BBE2CA] bg-[#F2FBF5] text-[#225B36]",
    warning: "border-[#E7D3AB] bg-[#FFF9EC] text-[#74521D]",
    error: "border-[#E8B9BD] bg-[#FFF5F5] text-[#8A2B34]",
  };
  return (
    <div role="status" className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm", styles[kind])}>
      {kind === "success" ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

function formatMoney(cents: number, currency: string): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: number | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPlanDescription(plan: string, storageLimitBytes: number): string {
  if (plan === "free") return `${formatBytes(storageLimitBytes)} of storage, 1 collaborator, paid delivery.`;
  if (plan === "enterprise") return "Usage-based storage, unlimited collaborators, paid delivery.";
  return `${formatBytes(storageLimitBytes)} of storage, unlimited collaborators, paid delivery.`;
}
