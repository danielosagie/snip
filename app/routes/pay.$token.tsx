import { createFileRoute } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Check, CheckCircle2, Clock3 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { formatUsdCents } from "@/lib/money";
import { cn } from "@/lib/utils";

type PayInvoice = NonNullable<
  FunctionReturnType<typeof api.invoices.getByPayToken>
>;
type Milestone = PayInvoice["milestones"][number];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export const Route = createFileRoute("/pay/$token")({
  // Undefined rather than false so the router drops the param from the URL
  // entirely once we clear it, instead of leaving "?paid=false" behind.
  validateSearch: (search: Record<string, unknown>) => {
    const isSet = (value: unknown) =>
      value === "1" || value === 1 || value === true;
    return {
      paid: isSet(search.paid) || undefined,
      canceled: isSet(search.canceled) || undefined,
    };
  },
  component: InvoicePayPage,
});

function InvoicePayPage() {
  const { token } = Route.useParams();
  const { paid, canceled } = Route.useSearch();
  const invoice = useQuery(api.invoices.getByPayToken, { payToken: token });
  const createCheckout = useAction(
    api.invoicesActions.createMilestoneCheckout,
  );
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(
    null,
  );
  const [busyMilestoneId, setBusyMilestoneId] = useState<string | null>(null);
  const [rowOutcome, setRowOutcome] = useState<{
    milestoneId: string;
    kind: "info" | "error";
    message: string;
  } | null>(null);
  const [returnedMilestoneId, setReturnedMilestoneId] = useState<string | null>(
    null,
  );
  const [returnState, setReturnState] = useState<"paid" | "canceled" | null>(
    null,
  );

  useEffect(() => {
    if (!paid && !canceled) return;

    const storageKey = paymentStorageKey(token);
    if (paid) {
      setReturnState("paid");
      setReturnedMilestoneId(window.sessionStorage.getItem(storageKey));
    } else {
      setReturnState("canceled");
    }
    // The return param stays in the URL. The router owns search state and
    // rewrites anything we strip here, and a raw history.replaceState during
    // mount updates router state mid-render. Re-showing the confirmation on a
    // refresh is harmless: the milestone itself is the source of truth.
    window.sessionStorage.removeItem(storageKey);
  }, [canceled, paid, token]);

  if (invoice === undefined) return <PayPageLoading />;
  if (invoice === null) return <InactivePayLink />;

  const totals = invoice.milestones.reduce(
    (result, milestone) => {
      result.listedCents += milestone.amountCents;
      if (milestone.paidAt !== undefined) {
        result.paidCents += milestone.amountCents;
      } else {
        result.remainingCents += milestone.amountCents;
      }
      return result;
    },
    { listedCents: 0, paidCents: 0, remainingCents: 0 },
  );
  const fullyPaid = invoice.status === "paid" || totals.remainingCents === 0;
  const returnedMilestone = returnedMilestoneId
    ? invoice.milestones.find(
        (milestone) => milestone.id === returnedMilestoneId,
      )
    : undefined;
  const paymentConfirmed = fullyPaid || returnedMilestone?.paidAt !== undefined;

  const startCheckout = async (milestone: Milestone) => {
    if (selectedMilestoneId !== milestone.id) {
      setSelectedMilestoneId(milestone.id);
      setRowOutcome(null);
      return;
    }

    setBusyMilestoneId(milestone.id);
    setRowOutcome(null);
    try {
      const currentPath = window.location.pathname;
      const result = await createCheckout({
        payToken: token,
        milestoneId: milestone.id,
        successUrl: `${window.location.origin}${currentPath}?paid=1`,
        cancelUrl: `${window.location.origin}${currentPath}?canceled=1`,
      });

      if (result.status === "ok") {
        if (result.url) {
          window.sessionStorage.setItem(
            paymentStorageKey(token),
            milestone.id,
          );
          window.location.assign(result.url);
          return;
        }
        setRowOutcome({
          milestoneId: milestone.id,
          kind: "error",
          message: result.reason ?? "Checkout is unavailable.",
        });
        return;
      }

      if (result.status === "processing") {
        setRowOutcome({
          milestoneId: milestone.id,
          kind: "info",
          message: result.reason ?? "Payment is processing. Try again shortly.",
        });
        return;
      }

      setRowOutcome({
        milestoneId: milestone.id,
        kind: "error",
        message:
          result.reason ??
          (result.status === "disabled"
            ? "Payments are unavailable."
            : "This payment is no longer available."),
      });
    } catch (error) {
      setRowOutcome({
        milestoneId: milestone.id,
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Checkout could not be started.",
      });
    } finally {
      setBusyMilestoneId(null);
    }
  };

  return (
    <PayShell>
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        {returnState === "paid" ? (
          <ReturnNotice
            kind={paymentConfirmed ? "success" : "confirming"}
          >
            {paymentConfirmed ? "Payment confirmed." : "Payment is confirming."}
          </ReturnNotice>
        ) : returnState === "canceled" ? (
          <ReturnNotice kind="canceled">Payment canceled.</ReturnNotice>
        ) : null}

        <div className="mb-7 mt-1 sm:mb-9">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[28px] font-semibold leading-8 tracking-[-0.025em] text-[#131315] sm:text-[34px] sm:leading-10">
                {invoice.title}
              </h1>
              {invoice.clientLabel ? (
                <p className="mt-2 text-sm text-[#6E6E73]">
                  {invoice.clientLabel}
                </p>
              ) : null}
            </div>
            {fullyPaid ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#F2FBF5] px-3 py-1.5 text-xs font-medium text-[#225B36]">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Paid in full
              </span>
            ) : null}
          </div>
        </div>

        <section
          className="overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white"
          aria-labelledby="milestones-heading"
        >
          <div className="border-b border-[#F1F1F3] px-5 py-4 sm:px-6">
            <h2
              id="milestones-heading"
              className="text-base font-semibold text-[#131315]"
            >
              Milestones
            </h2>
          </div>
          <div>
            {invoice.milestones.map((milestone) => {
              const selected = selectedMilestoneId === milestone.id;
              const busy = busyMilestoneId === milestone.id;
              const outcome =
                rowOutcome?.milestoneId === milestone.id ? rowOutcome : null;
              return (
                <MilestoneRow
                  key={milestone.id}
                  milestone={milestone}
                  selected={selected}
                  busy={busy}
                  confirming={
                    returnState === "paid" &&
                    returnedMilestoneId === milestone.id &&
                    milestone.paidAt === undefined
                  }
                  checkoutBusy={busyMilestoneId !== null}
                  outcome={outcome}
                  onPay={() => void startCheckout(milestone)}
                />
              );
            })}
          </div>
        </section>

        <section className="mt-4 rounded-[14px] border border-[#E8E8EC] bg-white px-5 py-4 sm:px-6">
          <h2 className="sr-only">Totals</h2>
          <MoneyLine label="Total listed" cents={totals.listedCents} />
          <MoneyLine label="Total paid" cents={totals.paidCents} />
          <MoneyLine
            label="What remains"
            cents={totals.remainingCents}
            strong
          />
        </section>

        {invoice.note ? (
          <section className="mt-7" aria-labelledby="note-heading">
            <h2
              id="note-heading"
              className="font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]"
            >
              Note
            </h2>
            <p className="mt-2 max-w-[70ch] whitespace-pre-wrap text-sm leading-6 text-[#6E6E73]">
              {invoice.note}
            </p>
          </section>
        ) : null}
      </main>
    </PayShell>
  );
}

function MilestoneRow({
  milestone,
  selected,
  busy,
  confirming,
  checkoutBusy,
  outcome,
  onPay,
}: {
  milestone: Milestone;
  selected: boolean;
  busy: boolean;
  confirming: boolean;
  checkoutBusy: boolean;
  outcome: { kind: "info" | "error"; message: string } | null;
  onPay: () => void;
}) {
  const paid = milestone.paidAt !== undefined;

  return (
    <div className="border-b border-[#F1F1F3] px-5 py-4 last:border-b-0 sm:px-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_130px_110px]">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[#131315]">
            {milestone.label}
          </p>
          {milestone.dueAt ? (
            <p className="mt-1 text-xs text-[#6E6E73]">
              Due {formatDate(milestone.dueAt)}
            </p>
          ) : null}
        </div>
        <p className="tabular-nums text-right text-sm font-medium text-[#131315]">
          {formatUsdCents(milestone.amountCents)}
        </p>
        <div className="col-span-2 flex justify-end sm:col-span-1">
          {paid ? (
            <span className="inline-flex h-10 items-center gap-1.5 text-sm text-[#6E6E73]">
              <Check className="h-4 w-4" aria-hidden="true" />
              Paid
            </span>
          ) : confirming ? (
            <span className="inline-flex h-10 items-center gap-1.5 text-sm text-[#6E6E73]">
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              Confirming
            </span>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#A0A0A5]">Due</span>
              <button
                type="button"
                onClick={onPay}
                disabled={checkoutBusy}
                aria-expanded={selected}
                className="inline-flex h-10 min-w-[88px] items-center justify-center rounded-full bg-[#131315] px-4 text-[13px] font-medium text-white transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315] disabled:cursor-wait disabled:opacity-45"
              >
                {busy ? "Opening..." : selected ? "Continue" : "Pay"}
              </button>
            </div>
          )}
        </div>
      </div>

      {!paid && selected ? (
        <div className="mt-4 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] px-4 py-3">
          <MoneyLine label="Listed" cents={milestone.amountCents} compact />
          <MoneyLine label="Snip fee" cents={milestone.feeCents} compact />
          <MoneyLine
            label="Total"
            cents={milestone.buyerTotalCents}
            compact
            strong
          />
          {outcome ? (
            <p
              role="status"
              className={cn(
                "mt-3 border-t border-[#E8E8EC] pt-3 text-xs leading-5",
                outcome.kind === "error" ? "text-[#8A2B34]" : "text-[#6E6E73]",
              )}
            >
              {outcome.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MoneyLine({
  label,
  cents,
  compact = false,
  strong = false,
}: {
  label: string;
  cents: number;
  compact?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-6 border-b border-[#F1F1F3] last:border-b-0",
        compact ? "py-1.5 text-xs" : "py-2.5 text-sm",
        strong ? "font-semibold text-[#131315]" : "text-[#6E6E73]",
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums text-[#131315]">
        {formatUsdCents(cents)}
      </span>
    </div>
  );
}

function ReturnNotice({
  kind,
  children,
}: {
  kind: "success" | "confirming" | "canceled";
  children: ReactNode;
}) {
  const styles = {
    success: "border-[#BBE2CA] bg-[#F2FBF5] text-[#225B36]",
    confirming: "border-[#E7D3AB] bg-[#FFF9EC] text-[#74521D]",
    canceled: "border-[#E8E8EC] bg-white text-[#6E6E73]",
  };
  const Icon =
    kind === "success"
      ? CheckCircle2
      : kind === "confirming"
        ? Clock3
        : AlertCircle;

  return (
    <div
      role="status"
      className={cn(
        "mb-7 flex items-center gap-2 rounded-[11px] border px-3.5 py-3 text-sm",
        styles[kind],
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function PayPageLoading() {
  return (
    <PayShell>
      <main
        className="mx-auto w-full max-w-3xl animate-pulse px-4 py-8 sm:px-6 sm:py-12"
        aria-label="Loading invoice"
      >
        <div className="h-8 w-2/3 rounded-full bg-[#E8E8EC]" />
        <div className="mt-3 h-4 w-32 rounded-full bg-[#F1F1F3]" />
        <div className="mt-9 h-64 rounded-[14px] border border-[#E8E8EC] bg-white" />
        <div className="mt-4 h-36 rounded-[14px] border border-[#E8E8EC] bg-white" />
      </main>
    </PayShell>
  );
}

function InactivePayLink() {
  return (
    <PayShell>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-[14px] border border-[#E8E8EC] bg-white px-7 py-8 text-center">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#131315]">
            This link is no longer active.
          </h1>
        </div>
      </main>
    </PayShell>
  );
}

function PayShell({ children }: { children: ReactNode }) {
  return (
    <div className="surface-client surface-soft flex min-h-screen flex-col bg-[#FAFAFA] text-[#131315]">
      <header className="border-b border-[#E8E8EC] bg-white px-5 py-4 sm:px-6">
        <span className="text-lg font-bold tracking-[-0.03em]">snip.</span>
      </header>
      {children}
    </div>
  );
}

function paymentStorageKey(token: string): string {
  return `snip:invoice-payment:${token}`;
}

function formatDate(timestamp: number): string {
  return dateFormatter.format(new Date(timestamp));
}
