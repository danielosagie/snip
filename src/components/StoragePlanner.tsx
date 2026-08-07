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
    <section className="rounded-[14px] border border-[#E8E8EC] bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="ui-card-title text-base font-semibold text-[#131315]">How much room do you need?</h2>
        <p className="text-xs text-[#6E6E73]">
          Using {formatBytes(usedBytes)}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-semibold tracking-tight text-[#131315]">
            {formatStorage(target.gb)}
          </span>
          <span className="text-sm text-[#6E6E73]">
            {formatCentsPerGb(target)}
          </span>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold tracking-tight text-[#131315]">
            {formatUsd(target.monthlyCents)}
            <span className="ml-1 text-base font-normal text-[#6E6E73]">/ mo</span>
          </div>
          {change.direction !== "same" ? (
            <div
              className={cn(
                "text-xs",
                change.direction === "upgrade" ? "text-[#D14E00]" : "text-[#225B36]",
              )}
            >
              {change.deltaCents > 0 ? "+" : "−"}
              {formatUsd(Math.abs(change.deltaCents))} / mo
            </div>
          ) : (
            <div className="text-xs text-[#6E6E73]">Current plan</div>
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
        className="mt-5 w-full accent-[#FF6600]"
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
              "rounded-full px-2 py-1 text-xs transition-colors",
              i === index
                ? "bg-[#FFF0E6] font-medium text-[#D14E00]"
                : "text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]",
            )}
          >
            {formatStorage(stop.gb)}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[#E8E8EC] pt-5">
        <label htmlFor="need-gb" className="text-sm">
          Know your number?
        </label>
        <input
          id="need-gb"
          inputMode="decimal"
          value={needGb}
          placeholder="750"
          onChange={(event) => applyNeed(event.target.value)}
          className="w-28 rounded-[11px] border border-[#D8D8DE] bg-white px-3 py-1.5 text-sm text-[#131315] outline-none placeholder:text-[#A0A0A5] focus:border-[#FF6600] focus:ring-2 focus:ring-[#FF6600]/10"
        />
        <span className="text-sm text-[#6E6E73]">GB</span>
        {needGb && !overLargest ? (
          <span className="text-xs text-[#6E6E73]">
            {formatStorage(target.gb)} is the smallest that fits
          </span>
        ) : null}
      </div>

      {overLargest ? (
        <p className="mt-4 rounded-[11px] bg-[#FFF9EC] px-4 py-3 text-sm text-[#74521D]">
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
        <p className="mt-4 rounded-[11px] bg-[#FFF9EC] px-4 py-3 text-sm text-[#74521D]">
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
          <span className="text-sm text-[#6E6E73]">
            Cancel to choose Free.
          </span>
        ) : (
          <span className="text-sm text-[#6E6E73]">
            Stripe checkout
          </span>
        )}
      </div>
    </section>
  );
}
