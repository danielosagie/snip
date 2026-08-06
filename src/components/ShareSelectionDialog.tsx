"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Copy,
  Check,
  Plus,
  ExternalLink,
  DollarSign,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { publicShareUrl } from "@/lib/publicUrl";
import { cn } from "@/lib/utils";
import {
  softButton,
  softButtonPrimary,
  softInput,
} from "@/components/soft";

const SOFT_MENU_CONTENT =
  "rounded-[12px] border border-[#E8E8EC] bg-white p-1 text-[#131315] shadow-[0_8px_24px_rgba(19,19,21,0.10)]";
const SOFT_MENU_ITEM =
  "rounded-[8px] px-2.5 py-1.5 text-[13px] font-medium text-[#131315] hover:bg-[#F1F1F3] focus:bg-[#F1F1F3] focus:text-[#131315]";

/**
 * Slim sibling of ShareDialog used when the user has multi-selected items
 * in the project grid and wants to bundle them under one share link with
 * one paywall. Creates a "selection" bundle (frozen snapshot of videoIds)
 * then a share link pointing at it.
 *
 * Intentionally skips the per-video visibility toggle and the "existing
 * links" list — a selection bundle is a one-shot ad-hoc share, not a
 * long-lived resource the team manages.
 */

interface ShareSelectionDialogProps {
  videoIds: Id<"videos">[];
  defaultName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareSelectionDialog({
  videoIds,
  defaultName,
  open,
  onOpenChange,
}: ShareSelectionDialogProps) {
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});
  const createBundle = useMutation(api.shareBundles.createForSelection);
  const createShareLink = useMutation(api.shareLinks.create);

  const paywallProductionReady = featureStatus?.paywallReady ?? false;
  const [isCreating, setIsCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [paywallEnabled, setPaywallEnabled] = useState(false);
  const [allowDownload, setAllowDownload] = useState(true);
  const [name, setName] = useState(
    defaultName ?? `Bundle (${videoIds.length} items)`,
  );
  const [opts, setOpts] = useState({
    expiresInDays: undefined as number | undefined,
    password: "" as string,
    priceDollars: "" as string,
    currency: "usd",
    clientEmail: "" as string,
    description: "" as string,
  });

  const reset = () => {
    setCreatedUrl(null);
    setCopied(false);
    setCreateError(null);
    setIsCreating(false);
  };

  const handleCreate = async () => {
    setCreateError(null);
    let paywallArg:
      | { priceCents: number; currency: string; description?: string }
      | undefined;
    if (paywallEnabled) {
      const dollars = parseFloat(opts.priceDollars);
      if (!Number.isFinite(dollars) || dollars < 0.5) {
        setCreateError("Price must be at least $0.50.");
        return;
      }
      paywallArg = {
        priceCents: Math.round(dollars * 100),
        currency: opts.currency || "usd",
        description: opts.description || undefined,
      };
    }
    setIsCreating(true);
    try {
      const bundleId = await createBundle({
        videoIds,
        name: name.trim() || `Bundle (${videoIds.length} items)`,
      });
      const created = await createShareLink({
        bundleId,
        expiresInDays: opts.expiresInDays,
        allowDownload,
        password: opts.password || undefined,
        paywall: paywallArg,
        clientEmail: opts.clientEmail || undefined,
      });
      const url = publicShareUrl(created.token);
      setCreatedUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2400);
      } catch {
        // Clipboard might be unavailable; user can still copy manually.
      }
    } catch (error) {
      console.error("Failed to create bundle share:", error);
      setCreateError(
        error instanceof Error ? error.message : "Failed to create share",
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="surface-soft flex max-h-[85vh] max-w-lg flex-col gap-4 overflow-y-auto rounded-[14px] border border-[#E8E8EC] bg-white text-[#131315] shadow-[0_8px_24px_rgba(19,19,21,0.10)]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold normal-case tracking-[-0.01em] text-[#131315]">
            Share {videoIds.length} item{videoIds.length === 1 ? "" : "s"}
          </DialogTitle>
        </DialogHeader>

        {createdUrl ? (
          <div className="space-y-3 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-5">
            <div className="font-['Geist_Mono',system-ui,sans-serif] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
              Share URL
            </div>
            <code className="block break-all rounded-[8px] border border-[#E8E8EC] bg-white px-2.5 py-2 font-mono text-sm text-[#131315]">
              {createdUrl}
            </code>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className={cn(softButton, "flex-1")}
                onClick={async () => {
                  await navigator.clipboard.writeText(createdUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2400);
                }}
              >
                {copied ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copied ? "Copied" : "Copy URL"}
              </Button>
              <Button
                variant="outline"
                className={cn(softButton, "flex-1")}
                onClick={() => window.open(createdUrl, "_blank")}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open
              </Button>
            </div>
            <p className="text-xs text-[#6E6E73]">
              Bundle saved as <span className="font-mono">{name}</span>. New
              uploads to this project do not auto-join. Selection bundles are
              frozen at the items picked.
            </p>
          </div>
        ) : (
          <section className="space-y-5 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-5">
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-[#6E6E73]">
                Bundle name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Final delivery: brand campaign"
                className={softInput}
              />
              <p className="text-[11px] text-[#A0A0A5]">
                Shown at the top of the share page above the item grid.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-[#6E6E73]">
                Expiration
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(softButton, "w-full justify-between")}
                  >
                    {opts.expiresInDays ? `${opts.expiresInDays} days` : "Never"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className={SOFT_MENU_CONTENT}>
                  <DropdownMenuItem
                    className={SOFT_MENU_ITEM}
                    onClick={() => setOpts((o) => ({ ...o, expiresInDays: undefined }))}
                  >
                    Never
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={SOFT_MENU_ITEM}
                    onClick={() => setOpts((o) => ({ ...o, expiresInDays: 1 }))}
                  >
                    1 day
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={SOFT_MENU_ITEM}
                    onClick={() => setOpts((o) => ({ ...o, expiresInDays: 7 }))}
                  >
                    7 days
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={SOFT_MENU_ITEM}
                    onClick={() => setOpts((o) => ({ ...o, expiresInDays: 30 }))}
                  >
                    30 days
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-[#6E6E73]">
                Password (optional)
              </label>
              <Input
                type="password"
                placeholder="Leave empty for no password"
                value={opts.password}
                onChange={(e) =>
                  setOpts((o) => ({ ...o, password: e.target.value }))
                }
                className={softInput}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-[11px] border border-[#E8E8EC] bg-white px-4 py-3.5">
              <div className="text-sm font-medium">Allow download</div>
              <button
                type="button"
                onClick={() => setAllowDownload((d) => !d)}
                aria-pressed={allowDownload}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  allowDownload
                    ? "bg-[#131315] text-white"
                    : "bg-[#F1F1F3] text-[#6E6E73]"
                }`}
              >
                {allowDownload ? "On" : "Off"}
              </button>
            </div>

            <div className="overflow-hidden rounded-[11px] border border-[#E8E8EC] bg-white">
              <div className="flex items-center justify-between gap-2 px-4 py-3.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <DollarSign className="h-4 w-4" />
                  Paywall
                  {!paywallProductionReady ? (
                    <span className="rounded-[6px] bg-[#F1F1F3] px-1.5 py-0.5 text-[10px] font-medium text-[#6E6E73]">
                      Demo
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setPaywallEnabled((p) => !p)}
                  aria-pressed={paywallEnabled}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    paywallEnabled
                      ? "bg-[#131315] text-white"
                      : "bg-[#F1F1F3] text-[#6E6E73]"
                  }`}
                >
                  {paywallEnabled ? "On" : "Off"}
                </button>
              </div>
              {paywallEnabled ? (
                <div className="space-y-3 border-t border-[#F1F1F3] p-4">
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1.5">
                      <label className="text-[13px] font-medium text-[#6E6E73]">
                        Price
                      </label>
                      <Input
                        type="number"
                        min={0.5}
                        step={0.5}
                        placeholder="500.00"
                        value={opts.priceDollars}
                        onChange={(e) =>
                          setOpts((o) => ({ ...o, priceDollars: e.target.value }))
                        }
                        className={softInput}
                      />
                    </div>
                    <div className="w-24 space-y-1.5">
                      <label className="text-[13px] font-medium text-[#6E6E73]">
                        Currency
                      </label>
                      <Input
                        value={opts.currency.toUpperCase()}
                        onChange={(e) =>
                          setOpts((o) => ({
                            ...o,
                            currency: e.target.value.toLowerCase().slice(0, 4),
                          }))
                        }
                        className={softInput}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-[#6E6E73]">
                      Client email (for invoice + watermark)
                    </label>
                    <Input
                      type="email"
                      placeholder="client@agency.com"
                      value={opts.clientEmail}
                      onChange={(e) =>
                        setOpts((o) => ({ ...o, clientEmail: e.target.value }))
                      }
                      className={softInput}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-[#6E6E73]">
                      Invoice description (optional)
                    </label>
                    <Input
                      placeholder="Final delivery: brand video v3"
                      value={opts.description}
                      onChange={(e) =>
                        setOpts((o) => ({ ...o, description: e.target.value }))
                      }
                      className={softInput}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {createError ? (
              <div className="rounded-[10px] bg-[#FFF5F5] px-3 py-2 text-xs text-[#D8434F]">
                {createError}
              </div>
            ) : null}

            <Button
              onClick={handleCreate}
              disabled={isCreating || videoIds.length === 0}
              className={cn(softButtonPrimary, "w-full")}
            >
              <Plus className="mr-2 h-4 w-4" />
              {isCreating
                ? "Creating bundle…"
                : `Create share link for ${videoIds.length} item${
                    videoIds.length === 1 ? "" : "s"
                  }`}
            </Button>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
