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
import { DollarSign, Lock, Unlock, Download, Check } from "lucide-react";
import { triggerDownload } from "@/lib/download";

interface Props {
  videoId: Id<"videos">;
  /** Called when the agency wants to download the original (bypasses paywall). */
  onRequestPrivateDownload: () => Promise<void>;
  isDownloading: boolean;
}

function formatPrice(cents: number, currency: string): string {
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
 *   - External viewer (no team membership): a "Download — $X" button that
 *     redirects to Stripe Checkout, or downloads immediately if they've
 *     already paid for this video.
 */
export function VideoPaywallControl({
  videoId,
  onRequestPrivateDownload,
  isDownloading,
}: Props) {
  const unlock = useQuery(api.videos.getVideoUnlockState, { videoId });
  const setPaywall = useMutation(api.videos.setPaywall);
  const createCheckout = useAction(api.paymentsActions.createCheckoutForVideo);

  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState<null | "pay" | "edit">(null);
  const [error, setError] = useState<string | null>(null);

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

  // Paywalled and locked — the Canva moment.
  const handlePay = async () => {
    setError(null);
    setBusy("pay");
    try {
      const session = await createCheckout({
        videoId,
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
          onClick={() => void handlePay()}
          disabled={busy !== null}
          className="bg-[#FF6600] hover:bg-[#FF7A1F]"
        >
          <Lock className="mr-1.5 h-3.5 w-3.5" />
          {busy === "pay"
            ? "Opening checkout…"
            : `Download — ${priceLabel}`}
        </Button>
      </div>
      {paywall.description ? (
        <div className="text-xs text-[#888] max-w-[280px] text-right">
          {paywall.description}
        </div>
      ) : null}
      {error ? (
        <div className="text-xs text-[#dc2626] border-l-2 border-[#dc2626] pl-2 max-w-[280px]">
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
      className="inline-flex items-center gap-1 px-2 py-1 border-2 border-[#1a1a1a] text-[10px] font-bold uppercase tracking-wider hover:bg-[#1a1a1a] hover:text-[#f0f0e8] transition-colors"
    >
      <DollarSign className="h-3 w-3" />
      {label}
    </button>
  );
}

function PaywallEditor({
  videoId: _videoId,
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
    const dollars = parseFloat(priceDollars);
    if (!Number.isFinite(dollars) || dollars < 0.5) {
      setErr("Price must be at least $0.50.");
      return;
    }
    await onSave({
      priceCents: Math.round(dollars * 100),
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
              <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-[#888] mb-1">
                Price
              </div>
              <Input
                type="number"
                min={0.5}
                step={0.5}
                placeholder="500"
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value)}
              />
            </label>
            <label className="w-24">
              <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-[#888] mb-1">
                Currency
              </div>
              <Input
                value={currency.toUpperCase()}
                onChange={(e) =>
                  setCurrency(e.target.value.toLowerCase().slice(0, 4))
                }
                className="uppercase"
              />
            </label>
          </div>
          <label className="block">
            <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-[#888] mb-1">
              Description (optional)
            </div>
            <Input
              placeholder="Final 60s hero edit, broadcast-ready"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {err ? (
            <div className="text-xs text-[#dc2626] border-l-2 border-[#dc2626] pl-2">
              {err}
            </div>
          ) : null}
          <div className="flex justify-between items-center pt-2 border-t-2 border-[#1a1a1a]">
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
              className="bg-[#FF6600] hover:bg-[#FF7A1F]"
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
 * Helper used by `onRequestPrivateDownload` — accepts a presigned URL
 * + filename and triggers the browser download. Re-exported so the
 * video page doesn't have to import lib/download separately.
 */
export { triggerDownload };
