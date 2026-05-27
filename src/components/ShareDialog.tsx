"use client";

import { useState } from "react";
import { useAction, useQuery, useMutation } from "convex/react";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Copy,
  Check,
  Plus,
  Trash2,
  Eye,
  Lock,
  ExternalLink,
  Globe,
  DollarSign,
  Users,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/lib/utils";
import { ShareAccessPanel } from "@/components/share/ShareAccessPanel";

interface ShareDialogProps {
  videoId: Id<"videos">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDialog({ videoId, open, onOpenChange }: ShareDialogProps) {
  const video = useQuery(api.videos.get, { videoId });
  const shareLinks = useQuery(api.shareLinks.list, { videoId });
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});
  const createShareLink = useMutation(api.shareLinks.create);
  const createBundleForFolder = useMutation(api.shareBundles.createForFolder);
  const deleteShareLink = useMutation(api.shareLinks.remove);
  const setVisibility = useMutation(api.videos.setVisibility);
  const ensurePreviewAsset = useAction(
    api.videoActions.ensurePreviewAssetForShareLink,
  );

  // When the video sits inside a folder we offer a "share entire folder"
  // toggle. The dialog still scopes per-video by default — bundle sharing
  // is opt-in to avoid surprise paywall scope changes.
  const folderBreadcrumbs = useQuery(
    api.folders.breadcrumbs,
    video?.folderId ? { folderId: video.folderId } : "skip",
  );
  const containingFolder = folderBreadcrumbs?.length
    ? folderBreadcrumbs[folderBreadcrumbs.length - 1]
    : null;

  const [scope, setScope] = useState<"video" | "folder">("video");
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [accessOpenId, setAccessOpenId] = useState<string | null>(null);
  const [paywallEnabled, setPaywallEnabled] = useState(false);
  const [allowDownload, setAllowDownload] = useState(true);
  const [newLinkOptions, setNewLinkOptions] = useState({
    expiresInDays: undefined as number | undefined,
    password: undefined as string | undefined,
    priceDollars: "" as string,
    currency: "usd",
    clientEmail: "" as string,
    description: "" as string,
  });
  const [createError, setCreateError] = useState<string | null>(null);

  // Paywall is always usable in the dialog. We surface a small badge when
  // the deployment is missing any of the integrations a paywalled link
  // actually needs (Stripe Connect, Stripe webhooks, Mux signed playback,
  // watermark pipeline) — clicking Pay on the share page in that state
  // returns a "Payments aren't configured on this deployment" error.
  const paywallProductionReady = featureStatus?.paywallReady ?? false;

  const handleCreateLink = async () => {
    setCreateError(null);
    let paywallArg:
      | { priceCents: number; currency: string; description?: string }
      | undefined;
    if (paywallEnabled) {
      const dollars = parseFloat(newLinkOptions.priceDollars);
      if (!Number.isFinite(dollars) || dollars < 0.5) {
        setCreateError("Price must be at least $0.50.");
        return;
      }
      // Server-side guard (requireRecipientIdentityForPaywall) refuses
      // paywalled links without a recipient identity, since that's
      // what the watermark + Stripe Checkout key off. Surface the same
      // requirement here so the user gets an inline error instead of a
      // generic "Server Error" wrapper.
      if (!newLinkOptions.clientEmail.trim()) {
        setCreateError(
          "A client email is required for paywalled links — it's used in the watermark and pre-fills checkout.",
        );
        return;
      }
      paywallArg = {
        priceCents: Math.round(dollars * 100),
        currency: newLinkOptions.currency || "usd",
        description: newLinkOptions.description || undefined,
      };
    }
    setIsCreating(true);
    try {
      // When the user picks "folder" scope, we first materialize a folder
      // bundle row, then create a share link pointing at it. Bundle creation
      // is idempotent in semantics but not in storage — a fresh bundle row
      // per share lets us track who shared the folder when.
      let bundleId: Id<"shareBundles"> | undefined;
      if (scope === "folder" && video?.folderId) {
        bundleId = await createBundleForFolder({ folderId: video.folderId });
      }

      const created = await createShareLink({
        videoId: scope === "video" ? videoId : undefined,
        bundleId,
        expiresInDays: newLinkOptions.expiresInDays,
        allowDownload,
        password: newLinkOptions.password,
        paywall: paywallArg,
        clientEmail: newLinkOptions.clientEmail || undefined,
      });
      // For single-video paywalled links we kick off preview generation
      // immediately. Bundle links generate per-item previews lazily on
      // first view because a live folder's contents aren't known yet.
      if (paywallArg && scope === "video" && shareLinks) {
        const newLink = shareLinks.find((l) => l.token === created.token);
        if (newLink) {
          void ensurePreviewAsset({ shareLinkId: newLink._id });
        }
      }
      setNewLinkOptions({
        expiresInDays: undefined,
        password: undefined,
        priceDollars: "",
        currency: "usd",
        clientEmail: "",
        description: "",
      });
      setPaywallEnabled(false);
    } catch (error) {
      console.error("Failed to create share link:", error);
      setCreateError(
        error instanceof Error ? error.message : "Failed to create share link",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleSetVisibility = async (visibility: "public" | "private") => {
    if (!video || isUpdatingVisibility || video.visibility === visibility) return;
    setIsUpdatingVisibility(true);
    try {
      await setVisibility({ videoId, visibility });
    } catch (error) {
      console.error("Failed to update visibility:", error);
    } finally {
      setIsUpdatingVisibility(false);
    }
  };

  const handleCopyLink = (token: string) => {
    const url = `${window.location.origin}/share/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(token);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyPublicLink = () => {
    if (!video?.publicId) return;
    const url = `${window.location.origin}/watch/${video.publicId}`;
    navigator.clipboard.writeText(url);
    setCopiedId("public");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDeleteLink = async (linkId: Id<"shareLinks">) => {
    if (!confirm("Are you sure you want to delete this share link?")) return;
    try {
      await deleteShareLink({ linkId });
    } catch (error) {
      console.error("Failed to delete share link:", error);
    }
  };

  const publicWatchPath = video?.publicId ? `/watch/${video.publicId}` : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto flex flex-col gap-4">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Share</DialogTitle>
        </DialogHeader>

        {/* Unified "best of both" header — Google-Drive IA (People with
            access + General access) with snip's public/private folded into
            the General-access dropdown. The detailed access controls (paywall,
            expiry, password, download, link list) live below, unchanged. */}
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-2">
            People with access
          </div>
          <div className="flex items-center gap-3">
            <span className="h-8 w-8 flex-shrink-0 inline-flex items-center justify-center rounded-full border-2 border-[#1a1a1a] bg-[#FFEDD5]">
              <Users className="h-4 w-4 text-[#1a1a1a]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-[#1a1a1a]">You</div>
              <div className="text-[11px] font-mono text-[#888]">Your team</div>
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#888]">
              Owner
            </span>
          </div>
        </div>

        <div className="border-t-2 border-[#1a1a1a] pt-3">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-2">
            General access
          </div>
          <div className="flex items-center gap-3">
            <span className="h-8 w-8 flex-shrink-0 inline-flex items-center justify-center rounded-full border-2 border-[#1a1a1a] bg-[#f0f0e8]">
              {video?.visibility === "public" ? (
                <Globe className="h-4 w-4 text-[#1a1a1a]" />
              ) : (
                <Lock className="h-4 w-4 text-[#888]" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={isUpdatingVisibility || video === undefined}
                    className="inline-flex items-center gap-1 text-sm font-bold text-[#1a1a1a] hover:bg-[#FFEDD5] px-1 -ml-1 disabled:opacity-50"
                  >
                    {video?.visibility === "public"
                      ? "Anyone with the link"
                      : "Restricted"}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[240px]">
                  <DropdownMenuItem
                    onClick={() => void handleSetVisibility("private")}
                  >
                    Restricted
                    {video?.visibility !== "public" ? (
                      <Check className="ml-auto h-3.5 w-3.5 text-[#C2410C]" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void handleSetVisibility("public")}
                  >
                    Anyone with the link
                    {video?.visibility === "public" ? (
                      <Check className="ml-auto h-3.5 w-3.5 text-[#C2410C]" />
                    ) : null}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="text-[11px] font-mono text-[#888]">
                {video?.visibility === "public"
                  ? "Anyone with the link can watch"
                  : "Only people with a link you create below"}
              </div>
            </div>
          </div>
        </div>

        {/* Public branch — just the URL + copy/open. */}
        {video?.visibility === "public" && publicWatchPath ? (
          <div className="space-y-3 border-2 border-[#1a1a1a] p-4 bg-[#f0f0e8]">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
              Public URL
            </div>
            <code className="block text-sm bg-[#e8e8e0] border border-[#1a1a1a] px-2 py-1.5 font-mono truncate">
              {publicWatchPath}
            </code>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleCopyPublicLink}
              >
                {copiedId === "public" ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                Copy URL
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.open(publicWatchPath, "_blank")}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open
              </Button>
            </div>
          </div>
        ) : null}

        {/* Private branch — the restricted-link creator + existing
            links. Hidden entirely when the video is public so the
            dialog stays single-purpose. */}
        {video?.visibility === "private" ? (
        <>
        <section className="border-2 border-[#1a1a1a] p-5 bg-[#e8e8e0] space-y-5 pb-3">

          {containingFolder ? (
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[#888]">
                What to share
              </label>
              <div className="flex border-2 border-[#1a1a1a]">
                <button
                  type="button"
                  onClick={() => setScope("video")}
                  className={`flex-1 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                    scope === "video"
                      ? "bg-[#1a1a1a] text-[#f0f0e8]"
                      : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e8e8e0]"
                  }`}
                >
                  Just this video
                </button>
                <button
                  type="button"
                  onClick={() => setScope("folder")}
                  className={`flex-1 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors border-l-2 border-[#1a1a1a] ${
                    scope === "folder"
                      ? "bg-[#1a1a1a] text-[#f0f0e8]"
                      : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e8e8e0]"
                  }`}
                  title={`Share everything in "${containingFolder.name}" — new uploads to this folder will join the share automatically.`}
                >
                  Folder: {containingFolder.name}
                </button>
              </div>
              {scope === "folder" ? (
                <p className="text-[11px] text-[#888]">
                  Live folder share. One paywall covers every item; new uploads
                  to <span className="font-mono">{containingFolder.name}</span> appear
                  automatically.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-[#888]">Expiration</label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  {newLinkOptions.expiresInDays
                    ? `${newLinkOptions.expiresInDays} days`
                    : "Never"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onClick={() =>
                    setNewLinkOptions((o) => ({ ...o, expiresInDays: undefined }))
                  }
                >
                  Never
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setNewLinkOptions((o) => ({ ...o, expiresInDays: 1 }))
                  }
                >
                  1 day
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setNewLinkOptions((o) => ({ ...o, expiresInDays: 7 }))
                  }
                >
                  7 days
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setNewLinkOptions((o) => ({ ...o, expiresInDays: 30 }))
                  }
                >
                  30 days
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-[#888]">Password (optional)</label>
            <Input
              type="password"
              placeholder="Leave empty for no password"
              value={newLinkOptions.password || ""}
              onChange={(e) =>
                setNewLinkOptions((o) => ({
                  ...o,
                  password: e.target.value || undefined,
                }))
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
                    <label className="text-xs font-bold uppercase tracking-wider text-[#888]">Price</label>
                    <Input
                      type="number"
                      min={0.5}
                      step={0.5}
                      placeholder="500.00"
                      value={newLinkOptions.priceDollars}
                      onChange={(e) =>
                        setNewLinkOptions((o) => ({
                          ...o,
                          priceDollars: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="w-24 space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#888]">Currency</label>
                    <Input
                      value={newLinkOptions.currency.toUpperCase()}
                      onChange={(e) =>
                        setNewLinkOptions((o) => ({
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
                    value={newLinkOptions.clientEmail}
                    onChange={(e) =>
                      setNewLinkOptions((o) => ({
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
                    placeholder="Final delivery: brand video v3"
                    value={newLinkOptions.description}
                    onChange={(e) =>
                      setNewLinkOptions((o) => ({
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

          <Button onClick={handleCreateLink} disabled={isCreating} className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            {isCreating ? "Creating…" : "Create link"}
          </Button>
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="font-bold text-sm text-[#1a1a1a] flex items-center justify-between uppercase tracking-wider">
            <span>Links</span>
            <span className="text-[10px] font-mono font-normal text-[#888]">
              {shareLinks?.length ?? 0}
            </span>
          </div>
          {shareLinks === undefined ? (
            <p className="text-sm text-[#888]">Loading...</p>
          ) : shareLinks.length === 0 ? (
            <p className="text-sm text-[#888]">No share links yet</p>
          ) : (
            <div className="space-y-2">
              {shareLinks.map((link) => (
                <div key={link._id} className="border-2 border-[#1a1a1a]">
                  <div className="flex items-center justify-between p-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-sm bg-[#e8e8e0] px-2 py-0.5 font-mono truncate max-w-[200px]">
                          /share/{link.token}
                        </code>
                        {link.generalAccess === "invite" ? (
                          <Badge variant="outline">Invite only</Badge>
                        ) : null}
                        {link.isExpired ? (
                          <Badge variant="destructive">Expired</Badge>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-[#888]">
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {link.viewCount} views
                        </span>
                        {link.hasPassword ? (
                          <span className="flex items-center gap-1">
                            <Lock className="h-3 w-3" />
                            Protected
                          </span>
                        ) : null}
                        {link.paywall ? (
                          <span className="flex items-center gap-1 text-[#FF6600] font-bold">
                            <DollarSign className="h-3 w-3" />
                            {(link.paywall.priceCents / 100).toFixed(2)}{" "}
                            {link.paywall.currency.toUpperCase()}
                          </span>
                        ) : null}
                        {link.expiresAt ? (
                          <span>Expires {formatRelativeTime(link.expiresAt)}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Manage access"
                        className={
                          accessOpenId === link._id ? "text-[#C2410C]" : undefined
                        }
                        onClick={() =>
                          setAccessOpenId((id) =>
                            id === link._id ? null : link._id,
                          )
                        }
                      >
                        <Users className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopyLink(link.token)}
                      >
                        {copiedId === link.token ? (
                          <Check className="h-4 w-4 text-[#FF6600]" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.open(`/share/${link.token}`, "_blank")}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-[#dc2626] hover:text-[#dc2626]"
                        onClick={() => handleDeleteLink(link._id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {accessOpenId === link._id ? (
                    <ShareAccessPanel linkId={link._id} />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
        </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
