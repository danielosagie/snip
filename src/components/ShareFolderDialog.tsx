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
  Trash2,
  Lock,
  Clock,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/lib/utils";
import { ShareAccessPanel } from "@/components/share/ShareAccessPanel";

/**
 * Folder-level share. A live "folder" bundle (new uploads to the folder
 * auto-join) wrapped in a share link with the usual paywall / expiry /
 * password / download knobs — same surface as ShareDialog's folder
 * scope, but reachable directly from the folder view instead of via a
 * single video. Unlike ShareSelectionDialog this DOES list + revoke
 * existing folder links, because a shared folder is a long-lived
 * resource the team manages over time.
 */

interface ShareFolderDialogProps {
  folderId: Id<"folders">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareFolderDialog({
  folderId,
  open,
  onOpenChange,
}: ShareFolderDialogProps) {
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});
  const breadcrumbs = useQuery(api.folders.breadcrumbs, { folderId });
  const existingLinks = useQuery(
    api.shareLinks.listForFolder,
    open ? { folderId } : "skip",
  );
  const createBundle = useMutation(api.shareBundles.createForFolder);
  const createShareLink = useMutation(api.shareLinks.create);
  const removeShareLink = useMutation(api.shareLinks.remove);

  const folderName = breadcrumbs?.length
    ? breadcrumbs[breadcrumbs.length - 1].name
    : "folder";
  const paywallProductionReady = featureStatus?.paywallReady ?? false;

  const [isCreating, setIsCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [accessOpenId, setAccessOpenId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [paywallEnabled, setPaywallEnabled] = useState(false);
  const [allowDownload, setAllowDownload] = useState(true);
  const [opts, setOpts] = useState({
    expiresInDays: undefined as number | undefined,
    password: "" as string,
    priceDollars: "" as string,
    currency: "usd",
    clientEmail: "" as string,
    description: "" as string,
  });

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2400);
    } catch {
      // Clipboard may be unavailable; the URL is shown for manual copy.
    }
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
      const bundleId = await createBundle({ folderId });
      const created = await createShareLink({
        bundleId,
        expiresInDays: opts.expiresInDays,
        allowDownload,
        password: opts.password || undefined,
        paywall: paywallArg,
        clientEmail: opts.clientEmail || undefined,
      });
      const url = `${window.location.origin}/share/${created.token}`;
      setCreatedUrl(url);
      void copy(url, "new");
    } catch (error) {
      console.error("Failed to create folder share:", error);
      setCreateError(
        error instanceof Error ? error.message : "Failed to create share",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (linkId: Id<"shareLinks">) => {
    if (!confirm("Revoke this share link? Anyone holding it loses access."))
      return;
    try {
      await removeShareLink({ linkId });
    } catch (error) {
      console.error("Failed to revoke share link:", error);
    }
  };

  const resetOnClose = () => {
    setCreatedUrl(null);
    setCopiedId(null);
    setCreateError(null);
    setIsCreating(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetOnClose();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto flex flex-col gap-4">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            Share folder:{" "}
            <span className="font-mono">{folderName}</span>
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-[#888] -mt-1">
          Shares this folder and everything in it. New uploads to the folder
          automatically join the share — it's a live link, not a frozen
          snapshot.
        </p>

        {createdUrl ? (
          <div className="border-2 border-[#1a1a1a] p-5 bg-[#f0f0e8] space-y-3">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
              New share URL
            </div>
            <code className="block text-sm bg-[#e8e8e0] border border-[#1a1a1a] px-2 py-1.5 font-mono break-all">
              {createdUrl}
            </code>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => void copy(createdUrl, "new")}
              >
                {copiedId === "new" ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copiedId === "new" ? "Copied" : "Copy URL"}
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
          </div>
        ) : (
          <section className="border-2 border-[#1a1a1a] p-5 bg-[#e8e8e0] space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[#888]">
                Expiration
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    {opts.expiresInDays
                      ? `${opts.expiresInDays} days`
                      : "Never"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() =>
                      setOpts((o) => ({ ...o, expiresInDays: undefined }))
                    }
                  >
                    Never
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setOpts((o) => ({ ...o, expiresInDays: 1 }))
                    }
                  >
                    1 day
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setOpts((o) => ({ ...o, expiresInDays: 7 }))
                    }
                  >
                    7 days
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setOpts((o) => ({ ...o, expiresInDays: 30 }))
                    }
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
                          setOpts((o) => ({
                            ...o,
                            priceDollars: e.target.value,
                          }))
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
                            currency: e.target.value
                              .toLowerCase()
                              .slice(0, 4),
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
                        setOpts((o) => ({
                          ...o,
                          clientEmail: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#888]">
                      Invoice description (optional)
                    </label>
                    <Input
                      placeholder="Final delivery: brand campaign"
                      value={opts.description}
                      onChange={(e) =>
                        setOpts((o) => ({
                          ...o,
                          description: e.target.value,
                        }))
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
              disabled={isCreating}
              className="w-full"
            >
              <Plus className="mr-2 h-4 w-4" />
              {isCreating ? "Creating share link…" : "Create share link"}
            </Button>
          </section>
        )}

        {/* Existing links — a shared folder is a long-lived resource, so
            (unlike selection bundles) we surface every active link with
            copy + revoke. */}
        <section className="space-y-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
            Existing links{" "}
            {existingLinks ? `(${existingLinks.length})` : ""}
          </div>
          {existingLinks === undefined ? (
            <p className="text-xs text-[#888]">Loading…</p>
          ) : existingLinks.length === 0 ? (
            <p className="text-xs text-[#888]">
              No share links for this folder yet.
            </p>
          ) : (
            <div className="border-2 border-[#1a1a1a] divide-y-2 divide-[#1a1a1a]">
              {existingLinks.map((link) => {
                const url = `${typeof window !== "undefined" ? window.location.origin : ""}/share/${link.token}`;
                return (
                  <div key={link._id} className="bg-[#f0f0e8]">
                  <div
                    className="flex items-center gap-2 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs font-mono truncate max-w-[180px]">
                          /share/{link.token}
                        </code>
                        {link.generalAccess === "invite" ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-mono font-bold uppercase text-[#1a1a1a]">
                            <Lock className="h-3 w-3" /> invite
                          </span>
                        ) : null}
                        {link.hasPassword ? (
                          <Lock className="h-3 w-3 text-[#888]" />
                        ) : null}
                        {link.paywall ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-mono font-bold uppercase text-[#FF6600]">
                            <DollarSign className="h-3 w-3" />
                            {(link.paywall.priceCents / 100).toFixed(2)}
                          </span>
                        ) : null}
                        {link.isExpired ? (
                          <span className="text-[10px] font-mono font-bold uppercase text-[#dc2626]">
                            expired
                          </span>
                        ) : link.expiresAt ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-mono text-[#888]">
                            <Clock className="h-3 w-3" />
                            {formatRelativeTime(link.expiresAt)}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-[#888] mt-0.5">
                        {link.viewCount} view
                        {link.viewCount === 1 ? "" : "s"} · by{" "}
                        {link.creatorName}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAccessOpenId((id) => (id === link._id ? null : link._id))
                      }
                      title="Manage access"
                      className={`inline-flex h-7 w-7 items-center justify-center border-2 border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#e8e8e0] flex-shrink-0 ${
                        accessOpenId === link._id ? "text-[#C2410C]" : "text-[#1a1a1a]"
                      }`}
                    >
                      <Users className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void copy(url, link.token)}
                      title="Copy link"
                      className="inline-flex h-7 w-7 items-center justify-center border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e8e8e0] flex-shrink-0"
                    >
                      {copiedId === link.token ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRevoke(link._id)}
                      title="Revoke link"
                      className="inline-flex h-7 w-7 items-center justify-center border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#dc2626] hover:bg-[#dc2626] hover:text-[#f0f0e8] flex-shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {accessOpenId === link._id ? (
                    <ShareAccessPanel linkId={link._id} />
                  ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
