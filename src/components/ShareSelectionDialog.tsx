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
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>
            Share {videoIds.length} item{videoIds.length === 1 ? "" : "s"}
          </DialogTitle>
        </DialogHeader>

        {createdUrl ? (
          <div className="border-2 border-[#1a1a1a] p-5 bg-[#f0f0e8] space-y-3">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
              Share URL
            </div>
            <code className="block text-sm bg-[#e8e8e0] border border-[#1a1a1a] px-2 py-1.5 font-mono break-all">
              {createdUrl}
            </code>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
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
                className="flex-1"
                onClick={() => window.open(createdUrl, "_blank")}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open
              </Button>
            </div>
            <p className="text-xs text-[#888]">
              Bundle saved as <span className="font-mono">{name}</span>. New
              uploads to this project do NOT auto-join — selection bundles are
              frozen at the items picked.
            </p>
          </div>
        ) : (
          <section className="border-2 border-[#1a1a1a] p-5 bg-[#e8e8e0] space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[#888]">
                Bundle name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Final delivery: brand campaign"
              />
              <p className="text-[11px] text-[#888]">
                Shown at the top of the share page above the item grid.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[#888]">
                Expiration
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    {opts.expiresInDays ? `${opts.expiresInDays} days` : "Never"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => setOpts((o) => ({ ...o, expiresInDays: undefined }))}
                  >
                    Never
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setOpts((o) => ({ ...o, expiresInDays: 1 }))}
                  >
                    1 day
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setOpts((o) => ({ ...o, expiresInDays: 7 }))}
                  >
                    7 days
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setOpts((o) => ({ ...o, expiresInDays: 30 }))}
                  >
                    30 days
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[#888]">
                Password (optional)
              </label>
              <Input
                type="password"
                placeholder="Leave empty for no password"
                value={opts.password}
                onChange={(e) =>
                  setOpts((o) => ({ ...o, password: e.target.value }))
                }
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-4 py-3.5">
              <div className="font-bold text-sm">Allow download</div>
              <button
                type="button"
                onClick={() => setAllowDownload((d) => !d)}
                aria-pressed={allowDownload}
                className={`px-3 py-1 border-2 border-[#1a1a1a] font-bold text-xs ${
                  allowDownload
                    ? "bg-[#FF6600] text-[#f0f0e8]"
                    : "bg-[#e8e8e0] text-[#1a1a1a]"
                }`}
              >
                {allowDownload ? "ON" : "OFF"}
              </button>
            </div>

            <div className="border-2 border-[#1a1a1a] bg-[#f0f0e8]">
              <div className="flex items-center justify-between gap-2 px-4 py-3.5">
                <div className="font-bold text-sm flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Paywall
                  {!paywallProductionReady ? (
                    <span className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 bg-[#1a1a1a] text-[#f0f0e8]">
                      demo
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setPaywallEnabled((p) => !p)}
                  aria-pressed={paywallEnabled}
                  className={`px-3 py-1 border-2 border-[#1a1a1a] font-bold text-xs ${
                    paywallEnabled
                      ? "bg-[#FF6600] text-[#f0f0e8]"
                      : "bg-[#e8e8e0] text-[#1a1a1a]"
                  }`}
                >
                  {paywallEnabled ? "ON" : "OFF"}
                </button>
              </div>
              {paywallEnabled ? (
                <div className="border-t-2 border-[#1a1a1a] p-4 space-y-3">
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-[#888]">
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
                      />
                    </div>
                    <div className="w-24 space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-[#888]">
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
                        className="uppercase"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#888]">
                      Client email (for invoice + watermark)
                    </label>
                    <Input
                      type="email"
                      placeholder="client@agency.com"
                      value={opts.clientEmail}
                      onChange={(e) =>
                        setOpts((o) => ({ ...o, clientEmail: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#888]">
                      Invoice description (optional)
                    </label>
                    <Input
                      placeholder="Final delivery: brand video v3"
                      value={opts.description}
                      onChange={(e) =>
                        setOpts((o) => ({ ...o, description: e.target.value }))
                      }
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {createError ? (
              <div className="text-xs text-[#dc2626] border-l-2 border-[#dc2626] pl-2">
                {createError}
              </div>
            ) : null}

            <Button
              onClick={handleCreate}
              disabled={isCreating || videoIds.length === 0}
              className="w-full"
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
