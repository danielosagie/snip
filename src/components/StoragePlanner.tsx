import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  STORAGE_STOPS,
  type StorageStop,
  describeChange,
  formatBytes,
  formatCentsPerGb,
  formatStorage,
  formatUsd,
  indexOfPlan,
  smallestStopFor,
  stopAtIndex,
  stopForPlan,
  wouldOverflow,
} from "@/lib/storagePricing";
import { cn } from "@/lib/utils";

type Props = {
  /** Plan key from getMySubscription — "free" | "basic" | "pro" | legacy "studio". */
  currentPlan: string;
  /** From billing.getTeamBilling. Used to block impossible downgrades. */
  usedBytes: number;
  busy: boolean;
  onChoose: (plan: "basic" | "pro") => void;
  onContactSales?: () => void;
};

/**
 * Pick a storage size and see the price before paying.
 *
 * The quote is computed locally, so dragging the slider never hits the
 * network — Stripe is opened only when the user commits. The slider snaps
 * to purchasable stops because each one maps to a fixed Stripe price;
 * a free-form GB number would need per-unit pricing with a quantity.
 */
export function StoragePlanner({
  currentPlan,
  usedBytes,
  busy,
  onChoose,
  onContactSales,
}: Props) {
  const currentIndex = indexOfPlan(currentPlan);
  const currentStop = stopForPlan(currentPlan) ?? STORAGE_STOPS[0];
  const [index, setIndex] = useState(currentIndex);
  // Free-text "how much do I need" entry. Empty means the slider drives.
  const [needGb, setNeedGb] = useState("");
  const [overLargest, setOverLargest] = useState(false);

  const target = stopAtIndex(index);
  const change = useMemo(
    () => describeChange(currentStop, target),
    [currentStop, target],
  );
  const overflows = wouldOverflow(target, usedBytes);
  const isCurrent = target.plan === currentStop.plan;

  const applyNeed = (raw: string) => {
    setNeedGb(raw);
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      setOverLargest(false);
      return;
    }
    const fit = smallestStopFor(parsed);
    if (!fit) {
      setOverLargest(true);
      setIndex(STORAGE_STOPS.length - 1);
      return;
    }
    setOverLargest(false);
    setIndex(STORAGE_STOPS.indexOf(fit));
  };

  return (
    <section className="border-2 border-[#1a1a1a] bg-[#f0f0e8] p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="ui-card-title text-lg font-bold">How much room do you need?</h2>
        <p className="font-mono text-xs text-[#666]">
          Using {formatBytes(usedBytes)}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-black tracking-tight">
            {formatStorage(target.gb)}
          </span>
          <span className="font-mono text-sm text-[#666]">
            {formatCentsPerGb(target)}
          </span>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black tracking-tight">
            {formatUsd(target.monthlyCents)}
            <span className="ml-1 text-base font-normal text-[#666]">/ mo</span>
          </div>
          {change.direction !== "same" ? (
            <div
              className={cn(
                "font-mono text-xs",
                change.direction === "upgrade" ? "text-[#C2410C]" : "text-[#2BB673]",
              )}
            >
              {change.deltaCents > 0 ? "+" : "−"}
              {formatUsd(Math.abs(change.deltaCents))} / mo
            </div>
          ) : (
            <div className="font-mono text-xs text-[#666]">Current plan</div>
          )}
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={STORAGE_STOPS.length - 1}
        step={1}
        value={index}
        aria-label="Storage size"
        onChange={(event) => {
          setIndex(Number(event.target.value));
          setNeedGb("");
          setOverLargest(false);
        }}
        className="mt-5 w-full accent-[#C2410C]"
      />

      <div className="mt-2 flex justify-between">
        {STORAGE_STOPS.map((stop: StorageStop, i: number) => (
          <button
            key={stop.plan}
            type="button"
            onClick={() => {
              setIndex(i);
              setNeedGb("");
              setOverLargest(false);
            }}
            className={cn(
              "font-mono text-xs",
              i === index ? "font-bold text-[#1a1a1a]" : "text-[#888]",
            )}
          >
            {formatStorage(stop.gb)}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t-2 border-[#1a1a1a] pt-5">
        <label htmlFor="need-gb" className="text-sm">
          Know your number?
        </label>
        <input
          id="need-gb"
          inputMode="decimal"
          value={needGb}
          placeholder="e.g. 750"
          onChange={(event) => applyNeed(event.target.value)}
          className="w-28 border-2 border-[#1a1a1a] bg-white px-3 py-1.5 text-sm"
        />
        <span className="text-sm text-[#666]">GB</span>
        {needGb && !overLargest ? (
          <span className="font-mono text-xs text-[#666]">
            {formatStorage(target.gb)} is the smallest that fits
          </span>
        ) : null}
      </div>

      {overLargest ? (
        <p className="mt-4 border-2 border-[#1a1a1a] bg-[#FFEDD5] px-4 py-3 text-sm">
          That's past our largest plan. Enterprise bills by usage at 5¢ per
          GB-month.{" "}
          {onContactSales ? (
            <button
              type="button"
              onClick={onContactSales}
              className="underline underline-offset-2"
            >
              Talk to us
            </button>
          ) : null}
        </p>
      ) : null}

      {overflows ? (
        <p className="mt-4 border-2 border-[#1a1a1a] bg-[#FFEDD5] px-4 py-3 text-sm">
          You're storing {formatBytes(usedBytes)}. Delete something or pick a
          bigger size before moving to {formatStorage(target.gb)}.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || isCurrent || overflows || target.plan === "free"}
          onClick={() => {
            if (target.plan === "basic" || target.plan === "pro") {
              onChoose(target.plan);
            }
          }}
        >
          {isCurrent
            ? "This is your plan"
            : busy
              ? "Opening Stripe…"
              : `Switch to ${target.label}`}
        </Button>
        {target.plan === "free" && !isCurrent ? (
          <span className="text-sm text-[#666]">
            Cancel your plan to drop to Free.
          </span>
        ) : (
          <span className="text-sm text-[#666]">
            Payment happens on Stripe. Nothing changes until it clears.
          </span>
        )}
      </div>
    </section>
  );
}
