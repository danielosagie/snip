import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { Link, useParams } from "@tanstack/react-router";
import { useUser } from "@clerk/tanstack-react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video-player/VideoPlayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { triggerDownload } from "@/lib/download";
import { formatDuration, formatTimestamp, formatRelativeTime } from "@/lib/utils";
import { useVideoPresence } from "@/lib/useVideoPresence";
import { VideoWatchers } from "@/components/presence/VideoWatchers";
import { Lock, Video, AlertCircle, MessageSquare, Clock, Download, ShieldCheck } from "lucide-react";
import { useShareData } from "./-share.data";
import {
  ShareWatermarkOverlay,
  useAntiPiracyDefenses,
} from "@/components/share/ShareWatermarkOverlay";

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

export default function SharePage() {
  const params = useParams({ strict: false });
  const token = params.token as string;
  const { user, isLoaded: isUserLoaded } = useUser();

  const issueAccessGrant = useMutation(api.shareLinks.issueAccessGrant);
  const createComment = useMutation(api.comments.createForShareGrant);
  const getPaywalledPlayback = useAction(api.videoActions.getSharedPaywalledPlayback);
  const getImagePreview = useAction(api.videoActions.getSharedImagePreview);
  const getFileAccess = useAction(api.videoActions.getSharedFileAccess);
  const createCheckoutForGrant = useAction(
    api.paymentsActions.createCheckoutForGrant,
  );
  const simulatePayment = useMutation(api.demoSeed.simulatePaymentForGrant);
  const getDownloadUrl = useAction(api.videoActions.getSharedDownloadUrl);
  const demoStatus = useQuery(api.demoSeed.isDemoMode, {});

  const [grantToken, setGrantToken] = useState<string | null>(null);
  const [hasAttemptedAutoGrant, setHasAttemptedAutoGrant] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [isRequestingGrant, setIsRequestingGrant] = useState(false);
  const [playbackSession, setPlaybackSession] = useState<{
    kind: "video" | "image" | "file";
    fileKind?: "pdf" | "audio" | "text" | "file";
    fileName?: string | null;
    contentType?: string | null;
    url: string;
    posterUrl: string;
    mode:
      | "public"
      | "preview"
      | "preview_pending"
      | "preview_unavailable"
      | "full"
      | "unsupported"
      | "locked";
    tokenExpiresAt: number | null;
  } | null>(null);
  const [isLoadingPlayback, setIsLoadingPlayback] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isCreatingCheckout, setIsCreatingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  // Live unlock-state subscription. Convex reactivity flips this from
  // paid:false to paid:true the instant the Stripe webhook fires, with no
  // polling.
  const unlockState = useQuery(
    api.payments.getGrantUnlockState,
    grantToken ? { grantToken } : "skip",
  );

  // Source of truth for paywall state is the live unlockState query — it
  // works even when playbackSession failed to load (e.g. preview asset still
  // ingesting). Playback mode is only used for the player UI.
  const paywall = unlockState?.paywall ?? null;
  const isPaid = Boolean(unlockState?.paid);
  const isPaywalled = Boolean(paywall);
  const { suspectAutomation } = useAntiPiracyDefenses(isPaywalled);

  // For bundle shares, the active item is the one currently being viewed /
  // commented on. Defaults to the first ready item once the summary loads.
  const [activeItemId, setActiveItemId] = useState<Id<"videos"> | null>(null);

  useEffect(() => {
    setIsDownloading(false);
    setDownloadError(null);
  }, [token]);

  const { shareInfo, summary, videoData, comments } = useShareData({
    token,
    grantToken,
    itemVideoId: activeItemId,
  });

  const isBundle = summary?.kind === "bundle";
  const bundleItems = summary?.bundle?.items ?? [];

  // Auto-pick the first bundle item once we have the summary, and reset
  // whenever the share token changes.
  useEffect(() => {
    if (isBundle && !activeItemId && bundleItems.length > 0) {
      setActiveItemId(bundleItems[0]._id as Id<"videos">);
    }
  }, [isBundle, activeItemId, bundleItems]);

  useEffect(() => {
    setActiveItemId(null);
  }, [token]);

  const canTrackPresence = Boolean(playbackSession?.url && videoData?.video?._id);
  const { watchers } = useVideoPresence({
    videoId: videoData?.video?._id,
    enabled: canTrackPresence,
    shareToken: token,
  });

  useEffect(() => {
    setGrantToken(null);
    setHasAttemptedAutoGrant(false);
  }, [token]);

  const acquireGrant = useCallback(
    async (password?: string) => {
      if (isRequestingGrant) return;
      setIsRequestingGrant(true);
      setPasswordError(false);

      try {
        const result = await issueAccessGrant({ token, password });
        if (result.ok && result.grantToken) {
          setGrantToken(result.grantToken);
          return true;
        }

        setPasswordError(Boolean(password));
        return false;
      } catch {
        setPasswordError(Boolean(password));
        return false;
      } finally {
        setIsRequestingGrant(false);
      }
    },
    [isRequestingGrant, issueAccessGrant, token],
  );

  useEffect(() => {
    if (!shareInfo || grantToken) return;
    if (shareInfo.status !== "ok" || hasAttemptedAutoGrant) return;

    setHasAttemptedAutoGrant(true);
    void acquireGrant();
  }, [acquireGrant, grantToken, hasAttemptedAutoGrant, shareInfo]);

  // Load (and re-load) the playback session. Re-runs when unlockState.paid
  // flips so payment immediately swaps preview → full-res. Also re-runs as
  // signed-token expiry approaches via the heartbeat below.
  const reloadCounter = useRef(0);
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const paidFlag = Boolean(unlockState?.paid);
  // Tokens we've already tried and got "Share grant invalid or expired" for.
  // Without this gate, the effect below re-fires whenever any of its 10
  // useQuery/useAction deps re-resolve (notably `summary` and `bundleItems`,
  // which Convex re-emits on subscription ticks), and we end up hammering
  // the action with the same dead token — dozens per second under network
  // flutter. Keying by `${token}::${itemId}` lets a paid checkout's new
  // grant still go through after the user reloads.
  const failedGrantKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!grantToken) {
      setPlaybackSession(null);
      setPlaybackError(null);
      return;
    }

    const failureKey = `${grantToken}::${activeItemId ?? ""}`;
    if (failedGrantKeysRef.current.has(failureKey)) {
      // Already known dead. Show the error once and stop calling.
      setIsLoadingPlayback(false);
      return;
    }

    let cancelled = false;
    setIsLoadingPlayback(true);
    setPlaybackError(null);

    // Bundle shares can't request playback until we know which item is active.
    if (isBundle && !activeItemId) {
      setIsLoadingPlayback(false);
      return;
    }

    // Branch on content type:
    //  • video/* or anything with a Mux playback id → signed Mux stream
    //  • image/* → sharp-rendered watermarked preview + signed S3
    //  • pdf / audio / text / etc → signed S3 with the file kind for UI
    const activeContentType =
      (isBundle
        ? bundleItems.find((item) => item._id === activeItemId)?.contentType
        : summary?.kind === "single"
          ? summary.single?.contentType
          : null) ?? null;
    const isImage = Boolean(activeContentType?.startsWith("image/"));
    const isVideo =
      Boolean(activeContentType?.startsWith("video/")) ||
      (isBundle
        ? bundleItems.find((item) => item._id === activeItemId)?.hasMuxPlayback ?? false
        : true);

    const loader: Promise<{
      kind: "video" | "image" | "file";
      fileKind?: "pdf" | "audio" | "text" | "file";
      fileName?: string | null;
      contentType?: string | null;
      url: string;
      posterUrl: string;
      mode:
        | "public"
        | "preview"
        | "preview_pending"
        | "preview_unavailable"
        | "full"
        | "unsupported"
        | "locked";
      tokenExpiresAt: number | null;
    }> = isImage
      ? getImagePreview({
          grantToken,
          itemVideoId: activeItemId ?? undefined,
        }).then((s) => ({
          kind: "image" as const,
          url: s.url,
          posterUrl: "",
          mode: s.mode,
          contentType: s.contentType,
          tokenExpiresAt: s.tokenExpiresAt,
        }))
      : isVideo
        ? getPaywalledPlayback({
            grantToken,
            itemVideoId: activeItemId ?? undefined,
          }).then((s) => ({
            kind: "video" as const,
            url: s.url,
            posterUrl: s.posterUrl,
            mode: s.mode,
            tokenExpiresAt: s.tokenExpiresAt,
          }))
        : getFileAccess({
            grantToken,
            itemVideoId: activeItemId ?? undefined,
          }).then((s) => ({
            kind: "file" as const,
            fileKind: s.kind,
            fileName: s.fileName,
            contentType: s.contentType,
            url: s.url,
            posterUrl: "",
            mode: s.mode,
            tokenExpiresAt: s.tokenExpiresAt,
          }));

    void loader
      .then((session) => {
        if (cancelled) return;
        setPlaybackSession(session);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Unable to load playback session.";
        // Latch terminal-state errors so the next effect-fire on the same
        // token short-circuits instead of re-hitting the action. The
        // exact error string comes from
        // convex/videoActions.ts → "Share grant invalid or expired."
        if (message.includes("Share grant invalid or expired")) {
          failedGrantKeysRef.current.add(failureKey);
        }
        setPlaybackError(message);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingPlayback(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    getPaywalledPlayback,
    getImagePreview,
    grantToken,
    paidFlag,
    reloadTrigger,
    isBundle,
    activeItemId,
    bundleItems,
    summary,
    getFileAccess,
  ]);

  // Heartbeat — refresh the signed Mux JWT before it expires. Token TTL is
  // 5 minutes; refresh at 4 minutes.
  useEffect(() => {
    if (!playbackSession?.tokenExpiresAt) return;
    const msUntilRefresh = Math.max(
      30_000,
      playbackSession.tokenExpiresAt - Date.now() - 60_000,
    );
    const timer = window.setTimeout(() => {
      reloadCounter.current += 1;
      setReloadTrigger((n) => n + 1);
    }, msUntilRefresh);
    return () => window.clearTimeout(timer);
  }, [playbackSession?.tokenExpiresAt]);

  // While the watermarked preview asset is still ingesting, poll every 5s so
  // the share page auto-recovers without a manual refresh. The server-side
  // action polls Mux directly on each tick, so this resolves even if the
  // Mux webhook never reaches the deployment.
  useEffect(() => {
    if (playbackSession?.mode !== "preview_pending") return;
    const timer = window.setInterval(() => {
      setReloadTrigger((n) => n + 1);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [playbackSession?.mode]);

  // If the preview has been "pending" for a while, stop showing the
  // optimistic "30–90 seconds" copy and tell the viewer the truth: they
  // can pay now and we'll unlock full-res the moment it's ready.
  const [previewTakingLong, setPreviewTakingLong] = useState(false);
  useEffect(() => {
    if (playbackSession?.mode !== "preview_pending") {
      setPreviewTakingLong(false);
      return;
    }
    const timer = window.setTimeout(() => setPreviewTakingLong(true), 90_000);
    return () => window.clearTimeout(timer);
  }, [playbackSession?.mode]);

  const handlePay = useCallback(async () => {
    if (!grantToken || isCreatingCheckout) return;
    setIsCreatingCheckout(true);
    setCheckoutError(null);

    // Demo bypass: if Stripe isn't configured, simulate the payment on the
    // server (flip grant.paidAt directly). Lets you exercise the full
    // preview → paid swap without standing up Stripe.
    const stripeConfigured = demoStatus?.stripeConfigured ?? false;
    if (!stripeConfigured) {
      try {
        const result = await simulatePayment({ grantToken });
        if (result.status === "ok" || result.status === "alreadyPaid") {
          setReloadTrigger((n) => n + 1);
        } else if (result.status === "noPaywall") {
          setCheckoutError("This link is not paywalled.");
        } else if (result.status === "invalidGrant") {
          setCheckoutError("Session expired. Please reload.");
        } else if (result.status === "stripeIsConfigured") {
          // Should not happen because we checked above, but fall through.
        }
      } catch (err) {
        setCheckoutError(
          err instanceof Error ? err.message : "Demo payment failed.",
        );
      } finally {
        setIsCreatingCheckout(false);
      }
      return;
    }

    try {
      const result = await createCheckoutForGrant({
        grantToken,
        successUrl: `${window.location.origin}/share/${token}?paid=1`,
        cancelUrl: `${window.location.origin}/share/${token}`,
      });
      if (result.status === "ok" && result.url) {
        window.location.href = result.url;
        return;
      }
      const reasons: Record<typeof result.status, string> = {
        ok: "",
        disabled: "Payments aren't configured on this deployment.",
        noPaywall: "This link is not paywalled.",
        alreadyPaid: "Already unlocked — reloading…",
        teamNotConnected: "The agency hasn't connected Stripe yet.",
        invalidGrant: "Session expired. Please reload.",
      };
      setCheckoutError(result.reason ?? reasons[result.status]);
      if (result.status === "alreadyPaid") {
        setReloadTrigger((n) => n + 1);
      }
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Could not start checkout.");
    } finally {
      setIsCreatingCheckout(false);
    }
  }, [
    createCheckoutForGrant,
    demoStatus?.stripeConfigured,
    grantToken,
    isCreatingCheckout,
    simulatePayment,
    token,
  ]);

  const flattenedComments = useMemo(() => {
    if (!comments) return [] as Array<{ _id: string; timestampSeconds: number; resolved: boolean }>;

    const markers: Array<{ _id: string; timestampSeconds: number; resolved: boolean }> = [];
    for (const comment of comments) {
      markers.push({
        _id: comment._id,
        timestampSeconds: comment.timestampSeconds,
        resolved: comment.resolved,
      });
      for (const reply of comment.replies) {
        markers.push({
          _id: reply._id,
          timestampSeconds: reply.timestampSeconds,
          resolved: reply.resolved,
        });
      }
    }
    return markers;
  }, [comments]);

  const handleSubmitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!grantToken || !commentText.trim() || isSubmittingComment) return;

    setIsSubmittingComment(true);
    setCommentError(null);
    try {
      await createComment({
        grantToken,
        text: commentText.trim(),
        timestampSeconds: currentTime,
        itemVideoId: activeItemId ?? undefined,
      });
      setCommentText("");
    } catch {
      setCommentError("Failed to post comment.");
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDownload = useCallback(async () => {
    if (!grantToken || isDownloading) return;

    setDownloadError(null);
    setIsDownloading(true);
    try {
      const result = await getDownloadUrl({
        grantToken,
        itemVideoId: activeItemId ?? undefined,
      });
      triggerDownload(result.url, result.filename);
    } catch (error) {
      console.error("Failed to prepare shared download:", error);
      setDownloadError(
        error instanceof Error
          ? error.message
          : "Unable to prepare this download right now.",
      );
    } finally {
      setIsDownloading(false);
    }
  }, [getDownloadUrl, grantToken, isDownloading]);

  const isBootstrappingShare =
    shareInfo === undefined ||
    (shareInfo?.status === "ok" &&
      ((!grantToken && (!hasAttemptedAutoGrant || isRequestingGrant)) ||
        (Boolean(grantToken) && videoData === undefined)));

  if (isBootstrappingShare) {
    return (
      <div className="min-h-screen bg-[#f0f0e8] flex items-center justify-center">
        <div className="text-[#888]">Opening shared video...</div>
      </div>
    );
  }

  if (shareInfo.status === "missing" || shareInfo.status === "expired") {
    return (
      <div className="min-h-screen bg-[#f0f0e8] flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-[#dc2626]/10 flex items-center justify-center mb-4 border-2 border-[#dc2626]">
              <AlertCircle className="h-6 w-6 text-[#dc2626]" />
            </div>
            <CardTitle>Link expired or invalid</CardTitle>
            <CardDescription>
              This share link is no longer valid. Please ask the video owner for a new link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/" preload="intent" className="block">
              <Button variant="outline" className="w-full">
                Go to snip
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (shareInfo.status === "requiresPassword" && !grantToken) {
    return (
      <div className="min-h-screen bg-[#f0f0e8] flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-[#e8e8e0] flex items-center justify-center mb-4 border-2 border-[#1a1a1a]">
              <Lock className="h-6 w-6 text-[#888]" />
            </div>
            <CardTitle>Password required</CardTitle>
            <CardDescription>
              This video is password protected. Enter the password to view.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                await acquireGrant(passwordInput);
              }}
              className="space-y-4"
            >
              <Input
                type="password"
                placeholder="Enter password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                autoFocus
              />
              {passwordError && (
                <p className="text-sm text-[#dc2626]">Incorrect password</p>
              )}
              <Button type="submit" className="w-full" disabled={!passwordInput || isRequestingGrant}>
                {isRequestingGrant ? "Verifying..." : "View video"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Single-video shares fail closed when the video can't be loaded. Bundle
  // shares are valid as long as the bundle row exists — they show an empty-
  // state if there are no ready items.
  if (!isBundle && !videoData?.video) {
    return (
      <div className="min-h-screen bg-[#f0f0e8] flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-[#e8e8e0] flex items-center justify-center mb-4 border-2 border-[#1a1a1a]">
              <Video className="h-6 w-6 text-[#888]" />
            </div>
            <CardTitle>Video not available</CardTitle>
            <CardDescription>
              This video is not available or is still processing.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const video = videoData?.video ?? null;
  const headerTitle = isBundle
    ? summary?.bundle?.name ?? "Shared bundle"
    : video?.title ?? "Shared video";
  const headerDescription = isBundle
    ? bundleItems.length === 1
      ? "1 item"
      : `${bundleItems.length} items`
    : video?.description ?? null;
  const isPreviewMode = playbackSession?.mode === "preview";
  const isPreviewPending = playbackSession?.mode === "preview_pending";
  const isPreviewUnavailable = playbackSession?.mode === "preview_unavailable";
  const isFullMode = playbackSession?.mode === "full";
  const downloadAllowed = !isPaywalled || isPaid;

  if (suspectAutomation && (isPreviewMode || isFullMode || isPreviewPending)) {
    return (
      <div className="min-h-screen bg-[#f0f0e8] flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-[#dc2626]/10 flex items-center justify-center mb-4 border-2 border-[#dc2626]">
              <ShieldCheck className="h-6 w-6 text-[#dc2626]" />
            </div>
            <CardTitle>Automation blocked</CardTitle>
            <CardDescription>
              Paywalled deliveries cannot be opened from automated browsers.
              Open this link in a normal browser session.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f0e8]">
      <header className="bg-[#f0f0e8] border-b-2 border-[#1a1a1a] px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link
            preload="intent"
            to="/"
            className="text-[#888] hover:text-[#1a1a1a] text-sm flex items-center gap-2 font-bold"
          >
            snip
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleDownload()}
            disabled={!grantToken || isDownloading || !downloadAllowed}
            title={!downloadAllowed ? "Pay to unlock download" : undefined}
          >
            <Download className="h-4 w-4" />
            {isDownloading ? "Preparing..." : "Download"}
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {downloadError ? (
          <div
            role="alert"
            className="border-2 border-[#dc2626] bg-[#dc2626]/10 px-4 py-3 text-sm text-[#7f1d1d]"
          >
            {downloadError}
          </div>
        ) : null}

        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a]">{headerTitle}</h1>
          {headerDescription ? (
            <p className="text-[#888] mt-1">{headerDescription}</p>
          ) : null}
          <div className="flex items-center gap-4 mt-2 text-sm text-[#888]">
            {isBundle && video?.title ? (
              <span className="font-mono text-[#1a1a1a]">{video.title}</span>
            ) : null}
            {video?.duration ? (
              <span className="font-mono">{formatDuration(video.duration)}</span>
            ) : null}
            {comments && <span>{comments.length} threads</span>}
            <VideoWatchers watchers={watchers} className="ml-auto" />
          </div>
        </div>

        {isBundle && bundleItems.length > 0 ? (
          <section
            className="border-2 border-[#1a1a1a] bg-[#e8e8e0] p-3"
            aria-label="Bundle items"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {bundleItems.map((item) => {
                const isActive = item._id === activeItemId;
                return (
                  <button
                    key={item._id}
                    type="button"
                    onClick={() => setActiveItemId(item._id as Id<"videos">)}
                    className={`text-left border-2 ${
                      isActive
                        ? "border-[#FF6600] bg-[#FFEDD5]"
                        : "border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#e0e0d6]"
                    } transition-colors`}
                  >
                    <div className="aspect-video bg-[#1a1a1a] overflow-hidden">
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#666]">
                          <Video className="h-6 w-6" />
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-xs font-bold text-[#1a1a1a] truncate">
                        {item.title}
                      </div>
                      {item.duration ? (
                        <div className="text-[10px] font-mono text-[#888]">
                          {formatDuration(item.duration)}
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {isBundle && bundleItems.length === 0 ? (
          <section className="border-2 border-[#1a1a1a] bg-[#e8e8e0] p-6 text-center text-sm text-[#888]">
            This bundle has no ready items yet. Uploads will appear here as soon as
            processing finishes.
          </section>
        ) : null}

        {paywall && !isPaid ? (
          <section className="border-2 border-[#1a1a1a] bg-[#FF6600] text-[#f0f0e8] p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-mono uppercase tracking-widest opacity-80">
                {demoStatus && !demoStatus.stripeConfigured
                  ? "Demo mode — simulated payment"
                  : isPreviewPending
                    ? "Preview rendering — you can pay now"
                    : "Preview only — paywalled delivery"}
              </div>
              <div className="font-black text-2xl tracking-tight">
                {formatPrice(paywall.priceCents, paywall.currency)} to unlock full
                quality
              </div>
              {paywall.description ? (
                <div className="text-sm opacity-90 mt-1">{paywall.description}</div>
              ) : null}
            </div>
            <div className="flex flex-col items-stretch sm:items-end gap-2">
              <Button
                onClick={() => void handlePay()}
                disabled={isCreatingCheckout || !grantToken}
                className="bg-[#f0f0e8] text-[#1a1a1a] hover:bg-white"
              >
                {isCreatingCheckout
                  ? demoStatus && !demoStatus.stripeConfigured
                    ? "Unlocking…"
                    : "Opening checkout…"
                  : demoStatus && !demoStatus.stripeConfigured
                    ? `Simulate paying ${formatPrice(paywall.priceCents, paywall.currency)}`
                    : `Pay ${formatPrice(paywall.priceCents, paywall.currency)}`}
              </Button>
              {checkoutError ? (
                <div className="text-xs text-[#ffd1d1] max-w-xs text-right">
                  {checkoutError}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {paywall && isPaid ? (
          <section className="border-2 border-[#1a1a1a] bg-[#FFB380] text-[#1a1a1a] px-5 py-3 flex items-center gap-2 font-bold">
            <ShieldCheck className="h-4 w-4" />
            Paid — full-resolution unlocked
          </section>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 lg:items-start">
        <div className="relative border-2 border-[#1a1a1a] overflow-hidden">
          {playbackSession?.url && playbackSession.kind === "video" ? (
            <>
              <VideoPlayer
                ref={playerRef}
                src={playbackSession.url}
                poster={playbackSession.posterUrl}
                comments={flattenedComments}
                onTimeUpdate={setCurrentTime}
                allowDownload={false}
              />
              {isPaywalled ? (
                <ShareWatermarkOverlay
                  label={
                    user?.primaryEmailAddress?.emailAddress ??
                    user?.fullName ??
                    `share/${token.slice(0, 8)}`
                  }
                  secondary={isPreviewMode ? "PREVIEW — DO NOT REDISTRIBUTE" : undefined}
                  active={isPreviewMode}
                />
              ) : null}
            </>
          ) : playbackSession?.url && playbackSession.kind === "image" ? (
            <div className="relative bg-[#1a1a1a]">
              <img
                src={playbackSession.url}
                alt={video?.title ?? "Shared image"}
                className="w-full h-auto max-h-[80vh] object-contain mx-auto block"
                draggable={false}
                onContextMenu={(e) => {
                  if (isPaywalled) e.preventDefault();
                }}
              />
              {isPaywalled ? (
                <ShareWatermarkOverlay
                  label={
                    user?.primaryEmailAddress?.emailAddress ??
                    user?.fullName ??
                    `share/${token.slice(0, 8)}`
                  }
                  secondary={isPreviewMode ? "PREVIEW — DO NOT REDISTRIBUTE" : undefined}
                  active={isPreviewMode}
                />
              ) : null}
            </div>
          ) : playbackSession?.kind === "file" ? (
            playbackSession.fileKind === "pdf" && playbackSession.url ? (
              <iframe
                src={playbackSession.url}
                title={playbackSession.fileName ?? "Shared PDF"}
                className="w-full h-[80vh] bg-white"
              />
            ) : playbackSession.fileKind === "audio" && playbackSession.url ? (
              <div className="bg-[#1a1a1a] p-8 flex items-center justify-center">
                <audio
                  controls
                  src={playbackSession.url}
                  controlsList={isPaywalled ? "nodownload" : undefined}
                  className="w-full max-w-xl"
                />
              </div>
            ) : (
              <div className="bg-[#e8e8e0] p-10 flex flex-col items-center justify-center gap-4 text-center">
                <div className="text-xs font-mono font-bold uppercase tracking-widest text-[#888]">
                  {playbackSession.fileKind === "pdf"
                    ? "PDF"
                    : playbackSession.fileKind === "text"
                      ? "Text"
                      : "File"}
                </div>
                <div className="text-lg font-black text-[#1a1a1a]">
                  {playbackSession.fileName ?? video?.title ?? "Shared file"}
                </div>
                <div className="text-xs text-[#888] font-mono">
                  {playbackSession.contentType ?? "application/octet-stream"}
                </div>
                {playbackSession.mode === "locked" ? (
                  <p className="text-sm text-[#1a1a1a] max-w-md">
                    Preview locked until paid. Pay above to unlock the file —
                    you can download or open it inline once the grant flips
                    to paid.
                  </p>
                ) : downloadAllowed ? (
                  <Button onClick={() => void handleDownload()}>
                    <Download className="mr-1.5 h-4 w-4" />
                    Download
                  </Button>
                ) : (
                  <p className="text-sm text-[#888] max-w-md">
                    The owner disabled downloads on this share link.
                  </p>
                )}
              </div>
            )
          ) : (
            <div className="relative aspect-video overflow-hidden rounded-xl border border-zinc-800/80 bg-black shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
              {(playbackSession?.posterUrl || video?.thumbnailUrl?.startsWith("http")) ? (
                <img
                  src={playbackSession?.posterUrl ?? video?.thumbnailUrl ?? ""}
                  alt={`${video?.title ?? "Video"} thumbnail`}
                  className="h-full w-full object-cover blur-[4px]"
                />
              ) : null}
              <div className="absolute inset-0 bg-black/45" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white px-4 text-center">
                {isPreviewUnavailable ? (
                  <>
                    <AlertCircle className="h-8 w-8 text-white/80" />
                    <p className="text-sm font-medium text-white/85 max-w-sm">
                      The watermarked preview couldn’t be generated for this
                      delivery.
                    </p>
                    {paywall && !isPaid ? (
                      <p className="text-xs text-white/60 max-w-sm">
                        You can still pay above — the full-resolution video
                        unlocks immediately and doesn’t depend on the preview.
                      </p>
                    ) : (
                      <p className="text-xs text-white/60 max-w-sm">
                        Ask the owner to re-share this file if the issue
                        persists.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                    <p className="text-sm font-medium text-white/85">
                      {isPreviewPending
                        ? previewTakingLong
                          ? "Still preparing the watermarked preview — this one’s taking longer than usual."
                          : "Preparing watermarked preview… this usually takes 30–90 seconds."
                        : playbackError ?? (isLoadingPlayback ? "Loading stream..." : "Preparing stream...")}
                    </p>
                    {isPreviewPending && paywall && !isPaid ? (
                      <p className="text-xs text-white/60 max-w-sm">
                        You can pay now and the full-resolution stream will
                        unlock as soon as it’s ready.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <section className="border-2 border-[#1a1a1a] bg-[#e8e8e0] p-4 space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="font-black text-[#1a1a1a]">Comments</h2>
            <span className="text-xs text-[#888] font-mono">{formatTimestamp(currentTime)}</span>
          </div>

          {isUserLoaded && user ? (
            <form onSubmit={handleSubmitComment} className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-[#666]">
                <Clock className="h-3.5 w-3.5" />
                Comment at {formatTimestamp(currentTime)}
              </div>
              <Textarea
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="Leave a comment..."
                className="min-h-[90px]"
              />
              {commentError ? <p className="text-xs text-[#dc2626]">{commentError}</p> : null}
              <Button type="submit" disabled={!commentText.trim() || isSubmittingComment}>
                <MessageSquare className="mr-1.5 h-4 w-4" />
                {isSubmittingComment ? "Posting..." : "Post comment"}
              </Button>
            </form>
          ) : (
            <a
              href={`/sign-in?redirect_url=${encodeURIComponent(`/share/${token}`)}`}
              className="inline-flex"
            >
              <Button>
                <MessageSquare className="mr-1.5 h-4 w-4" />
                Sign in to comment
              </Button>
            </a>
          )}

          {comments === undefined ? (
            <p className="text-sm text-[#888]">Loading comments...</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-[#888]">No comments yet.</p>
          ) : (
            <div className="space-y-3">
              {comments.map((comment) => (
                <article key={comment._id} className="border-2 border-[#1a1a1a] bg-[#f0f0e8] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-bold text-[#1a1a1a]">{comment.userName}</div>
                    <button
                      type="button"
                      className="font-mono text-xs text-[#FF6600] hover:text-[#1a1a1a]"
                      onClick={() => playerRef.current?.seekTo(comment.timestampSeconds, { play: true })}
                    >
                      {formatTimestamp(comment.timestampSeconds)}
                    </button>
                  </div>
                  <p className="text-sm text-[#1a1a1a] mt-1 whitespace-pre-wrap">{comment.text}</p>
                  <p className="text-[11px] text-[#888] mt-1">{formatRelativeTime(comment._creationTime)}</p>

                  {comment.replies.length > 0 ? (
                    <div className="mt-3 ml-4 border-l-2 border-[#1a1a1a] pl-3 space-y-2">
                      {comment.replies.map((reply) => (
                        <div key={reply._id} className="text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[#1a1a1a]">{reply.userName}</span>
                            <button
                              type="button"
                              className="font-mono text-xs text-[#FF6600] hover:text-[#1a1a1a]"
                              onClick={() => playerRef.current?.seekTo(reply.timestampSeconds, { play: true })}
                            >
                              {formatTimestamp(reply.timestampSeconds)}
                            </button>
                          </div>
                          <p className="text-[#1a1a1a] whitespace-pre-wrap">{reply.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
        </div>
      </main>

      <footer className="border-t-2 border-[#1a1a1a] px-6 py-4 mt-8">
        <div className="max-w-6xl mx-auto text-center text-sm text-[#888]">
          Shared via{" "}
          <Link to="/" preload="intent" className="text-[#1a1a1a] hover:text-[#FF6600] font-bold">
            snip
          </Link>
        </div>
      </footer>
    </div>
  );
}
