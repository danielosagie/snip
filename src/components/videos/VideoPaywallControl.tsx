"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DollarSign, Unlock, Download, Check } from "lucide-react";
import { triggerDownload } from "@/lib/download";
import {
  formatUsdCents,
  parseUsdDollarsToCents,
} from "@/lib/money";
import {
  computeApplicationFee,
  computeBuyerTotal,
  MAX_LINE_ITEM_AMOUNT_CENTS,
} from "../../../convex/paymentsPolicy";

interface Props {
  videoId: Id<"videos">;
  /** Called when the agency wants to download the original (bypasses paywall). */
  onRequestPrivateDownload: () => Promise<void>;
  isDownloading: boolean;
}

function formatPrice(cents: number, currency: string): string {
  if (currency.toLowerCase() === "usd") return formatUsdCents(cents);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/**
 * Canva-style monetization control for a video. Two surfaces in one:
 *
 *   - Agency view (team member): a "Set paywall" badge that opens a modal
 *     to attach / clear a price. They can also download the original.
 *
 *   - External viewer (no team membership): a priced download button that
 *     either pays (Stripe Checkout, or simulated in demo mode) or
 *     downloads immediately if they've already paid for this video.
 */
export function VideoPaywallControl({
  videoId,
  onRequestPrivateDownload,
  isDownloading,
}: Props) {
  const unlock = useQuery(api.videos.getVideoUnlockState, { videoId });
  const demoStatus = useQuery(api.demoSeed.isDemoMode, {});
  const setPaywall = useMutation(api.videos.setPaywall);
  const simulatePayment = useMutation(api.demoSeed.simulatePaymentForVideo);
  const createCheckout = useAction(api.paymentsActions.createCheckoutForVideo);

  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState<null | "pay" | "edit">(null);
  const [error, setError] = useState<string | null>(null);
  const [emailPrompt, setEmailPrompt] = useState("");
  const [showBreakdown, setShowBreakdown] = useState(false);

  const paywall = unlock?.paywall ?? null;
  const paid = unlock?.paid ?? false;
  const paidBy = unlock?.paidBy ?? null;
  const isTeamMember = paidBy === "team-member";

  // No paywall: just the plain Download button. Paywalls are now
  // configured from the Share dialog, so the top bar stays clean.
  if (!paywall) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="h-9 px-3 text-xs"
          onClick={() => void onRequestPrivateDownload()}
          disabled={isDownloading}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          {isDownloading ? "Preparing…" : "Download"}
        </Button>
      </div>
    );
  }

  const priceLabel = formatPrice(paywall.priceCents, paywall.currency);
  const feeCents = computeApplicationFee(paywall.priceCents);
  const totalCents = computeBuyerTotal(paywall.priceCents);

  // Paid (or team member, who bypasses): direct download.
  if (paid) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="h-9 px-3 text-xs"
          onClick={() => void onRequestPrivateDownload()}
          disabled={isDownloading}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          {isDownloading
            ? "Preparing…"
            : isTeamMember
              ? "Download original"
              : "Download (paid)"}
        </Button>
        <Badge variant={isTeamMember ? "secondary" : "success"}>
          {isTeamMember ? (
            <>
              <Unlock className="h-3 w-3 mr-1" />
              Paywall · {priceLabel}
            </>
          ) : (
            <>
              <Check className="h-3 w-3 mr-1" />
              Unlocked
            </>
          )}
        </Badge>
        {isTeamMember ? (
          <PaywallEditTrigger
            onClick={() => setEditorOpen(true)}
            label="Edit"
          />
        ) : null}
        <PaywallEditor
          videoId={videoId}
          existing={paywall}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          onSave={async (next) => {
            setBusy("edit");
            try {
              await setPaywall({ videoId, paywall: next });
              setEditorOpen(false);
            } finally {
              setBusy(null);
            }
          }}
          saving={busy === "edit"}
        />
      </div>
    );
  }

  // Paywalled and locked.
  const stripeReady = demoStatus?.stripeConfigured ?? false;
  const handlePay = async () => {
    setError(null);
    setBusy("pay");
    try {
      if (!stripeReady) {
        const result = await simulatePayment({
          videoId,
          clientEmail: emailPrompt.trim() || undefined,
        });
        if (
          result.status !== "ok" &&
          result.status !== "alreadyPaid"
        ) {
          setError(
            result.status === "noPaywall"
              ? "Paywall was just cleared. Retry."
              : result.status === "videoNotFound"
                ? "Video not found."
                : "Payment simulation failed.",
          );
        }
        return;
      }
      const session = await createCheckout({
        videoId,
        clientEmail: emailPrompt.trim() || undefined,
        successUrl: `${window.location.href}?paid=1`,
        cancelUrl: window.location.href,
      });
      if (session.status === "ok" && session.url) {
        window.location.href = session.url;
        return;
      }
      const msg: Record<typeof session.status, string> = {
        ok: "",
        disabled: "Payments aren't configured on this deployment.",
        noPaywall: "This video has no paywall.",
        teamNotConnected: "The agency hasn't connected Stripe yet.",
        videoNotFound: "Video not found.",
      };
      setError(session.reason ?? msg[session.status]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() =>
            showBreakdown ? void handlePay() : setShowBreakdown(true)
          }
          disabled={busy !== null}
        >
          {busy === "pay"
            ? "Opening checkout…"
            : showBreakdown
              ? `Pay ${formatPrice(totalCents, paywall.currency)}`
              : `Unlock ${priceLabel}`}
        </Button>
        {!stripeReady ? (
          <span className="rounded-full bg-[#F1F1F3] px-2 py-1 text-[11px] font-medium text-[#6E6E73]">
            Demo
          </span>
        ) : null}
      </div>
      {showBreakdown ? (
        <dl className="w-64 space-y-1 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-3 text-xs tabular-nums">
          <div className="flex justify-between gap-4 text-[#6E6E73]">
            <dt>Price</dt>
            <dd>{priceLabel}</dd>
          </div>
          <div className="flex justify-between gap-4 text-[#6E6E73]">
            <dt>Snip fee</dt>
            <dd>{formatPrice(feeCents, paywall.currency)}</dd>
          </div>
          <div className="flex justify-between gap-4 font-semibold text-[#131315]">
            <dt>Total</dt>
            <dd>{formatPrice(totalCents, paywall.currency)}</dd>
          </div>
        </dl>
      ) : null}
      {!stripeReady ? (
        <Input
          placeholder="your email (optional, for receipt)"
          value={emailPrompt}
          onChange={(e) => setEmailPrompt(e.target.value)}
          className="w-64 text-xs h-7"
        />
      ) : null}
      {paywall.description ? (
        <div className="max-w-[280px] text-right text-xs text-[#6E6E73]">
          {paywall.description}
        </div>
      ) : null}
      {error ? (
        <div className="max-w-[280px] rounded-[11px] bg-[#FFF5F5] px-3 py-2 text-xs text-[#8A2B34]">
          {error}
        </div>
      ) : null}
      <PaywallEditor
        videoId={videoId}
        existing={paywall}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSave={async (next) => {
          setBusy("edit");
          try {
            await setPaywall({ videoId, paywall: next });
            setEditorOpen(false);
          } finally {
            setBusy(null);
          }
        }}
        saving={busy === "edit"}
      />
    </div>
  );
}

function PaywallEditTrigger({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-[#D8D8DE] bg-white px-2.5 py-1 text-xs font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3]"
    >
      <DollarSign className="h-3 w-3" />
      {label}
    </button>
  );
}

function PaywallEditor({
  existing,
  open,
  onOpenChange,
  onSave,
  saving,
}: {
  videoId: Id<"videos">;
  existing: { priceCents: number; currency: string; description?: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    paywall: { priceCents: number; currency: string; description?: string } | null,
  ) => Promise<void>;
  saving: boolean;
}) {
  const [priceDollars, setPriceDollars] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPriceDollars(
      existing ? (existing.priceCents / 100).toFixed(2) : "",
    );
    setCurrency(existing?.currency ?? "usd");
    setDescription(existing?.description ?? "");
    setErr(null);
  }, [open, existing]);

  const handleSave = async () => {
    setErr(null);
    const priceCents = parseUsdDollarsToCents(priceDollars);
    if (
      priceCents === null ||
      priceCents < 50 ||
      priceCents > MAX_LINE_ITEM_AMOUNT_CENTS
    ) {
      setErr(
        `$${priceDollars || "0"} is invalid. Use $0.50 to ${formatUsdCents(MAX_LINE_ITEM_AMOUNT_CENTS)}.`,
      );
      return;
    }
    await onSave({
      priceCents,
      currency: currency.toLowerCase(),
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            {existing ? "Edit paywall" : "Add paywall"}
          </DialogTitle>
          <DialogDescription>
            Set a price viewers must pay before they can download this
            video. Watching + commenting stays free.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <label className="flex-1">
              <div className="mb-1 text-xs font-medium text-[#6E6E73]">
                Price
              </div>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="500"
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value)}
              />
            </label>
            <label className="w-24">
              <div className="mb-1 text-xs font-medium text-[#6E6E73]">
                Currency
              </div>
              <Input
                value={currency.toUpperCase()}
                onChange={(e) =>
                  setCurrency(e.target.value.toLowerCase().slice(0, 4))
                }
              />
            </label>
          </div>
          <label className="block">
            <div className="mb-1 text-xs font-medium text-[#6E6E73]">
              Description
            </div>
            <Input
              placeholder="Final 60s hero edit, broadcast-ready"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <p className="text-[11px] text-[#6E6E73]">
            You receive the listed price. Buyer pays the Snip fee on top.
          </p>
          {err ? (
            <div className="rounded-[11px] bg-[#FFF5F5] px-3 py-2 text-xs text-[#8A2B34]">
              {err}
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-[#E8E8EC] pt-3">
            {existing ? (
              <Button
                variant="outline"
                onClick={() => void onSave(null)}
                disabled={saving}
              >
                Remove paywall
              </Button>
            ) : (
              <span />
            )}
            <Button
              onClick={() => void handleSave()}
              disabled={saving || !priceDollars}
            >
              {saving ? "Saving…" : existing ? "Save changes" : "Add paywall"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Helper used by `onRequestPrivateDownload`. Accepts a presigned URL
 * + filename and triggers the browser download. Re-exported so the
 * video page doesn't have to import lib/download separately.
 */
export { triggerDownload };
