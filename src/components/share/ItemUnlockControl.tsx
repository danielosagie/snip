import { Check, LoaderCircle, Lock } from "lucide-react";
import {
  computeApplicationFee,
  computeBuyerTotal,
} from "../../../convex/paymentsPolicy";
import { formatUsdCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  priceCents: number | null;
  unlocked: boolean;
  expanded: boolean;
  confirming: boolean;
  busy: boolean;
  onExpand: () => void;
  onConfirm: () => void;
  className?: string;
}

export function ItemUnlockControl({
  priceCents,
  unlocked,
  expanded,
  confirming,
  busy,
  onExpand,
  onConfirm,
  className,
}: Props) {
  if (unlocked) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 text-[12px] font-medium text-[#225B36]",
          className,
        )}
      >
        <Check className="h-3.5 w-3.5" />
        Unlocked
      </div>
    );
  }

  if (confirming) {
    return (
      <div
        role="status"
        className={cn(
          "inline-flex items-center gap-1.5 text-[12px] font-medium text-[#D14E00]",
          className,
        )}
      >
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        Confirming
      </div>
    );
  }

  if (priceCents === null) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 text-[12px] text-[#A0A0A5]",
          className,
        )}
      >
        <Lock className="h-3.5 w-3.5" />
        Not for sale
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className={cn("flex items-center justify-between gap-2", className)}>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium tabular-nums text-[#131315]">
          <Lock className="h-3.5 w-3.5 text-[#A0A0A5]" />
          {formatUsdCents(priceCents)}
        </span>
        <Button type="button" size="sm" onClick={onExpand}>
          Unlock
        </Button>
      </div>
    );
  }

  const feeCents = computeApplicationFee(priceCents);
  const totalCents = computeBuyerTotal(priceCents);

  return (
    <div
      className={cn(
        "space-y-2 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-3",
        className,
      )}
    >
      <dl className="space-y-1 text-[12px] tabular-nums">
        <div className="flex items-center justify-between gap-4 text-[#6E6E73]">
          <dt>Price</dt>
          <dd>{formatUsdCents(priceCents)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 text-[#6E6E73]">
          <dt>Snip fee</dt>
          <dd>{formatUsdCents(feeCents)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 font-semibold text-[#131315]">
          <dt>Total</dt>
          <dd>{formatUsdCents(totalCents)}</dd>
        </div>
      </dl>
      <Button
        type="button"
        size="sm"
        className="w-full"
        onClick={onConfirm}
        disabled={busy}
      >
        {busy ? "Opening…" : `Pay ${formatUsdCents(totalCents)}`}
      </Button>
    </div>
  );
}
