import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Link, useParams } from "@tanstack/react-router";
import { useUser } from "@clerk/tanstack-react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video-player/VideoPlayer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DelayedAppear } from "@/components/ui/delayed-appear";
import { triggerDownload } from "@/lib/download";
import { formatDuration, formatTimestamp, formatRelativeTime } from "@/lib/utils";
import { AlertCircle, MessageSquare, Clock, Download, X } from "lucide-react";
import { useWatchData } from "./-watch.data";

export default function WatchPage() {
  const params = useParams({ strict: false });
  const publicId = params.publicId as string;
  const { user, isLoaded: isUserLoaded } = useUser();

  const createComment = useMutation(api.comments.createForPublic);
  const getPlaybackSession = useAction(api.videoActions.getPublicPlaybackSession);
  const getOriginalPlaybackUrl = useAction(
    api.videoActions.getPublicOriginalPlaybackUrl,
  );
  const getDownloadUrl = useAction(api.videoActions.getPublicDownloadUrl);

  const { videoData, comments } = useWatchData({ publicId });
  const [playbackSession, setPlaybackSession] = useState<{
    url: string;
    posterUrl: string;
  } | null>(null);
  // Instant-play fallback: the signed URL of the original upload, used while
  // Mux is still encoding (before muxPlaybackId exists).
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [isLoadingPlayback, setIsLoadingPlayback] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [mobileCommentsOpen, setMobileCommentsOpen] = useState(false);
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  useEffect(() => {
    if (!videoData?.video?.muxPlaybackId) {
      setPlaybackSession(null);
      return;
    }

    let cancelled = false;
    setIsLoadingPlayback(true);
    setPlaybackError(null);

    void getPlaybackSession({ publicId })
      .then((session) => {
        if (cancelled) return;
        setPlaybackSession(session);
      })
      .catch(() => {
        if (cancelled) return;
        setPlaybackError("Unable to load playback session.");
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingPlayback(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getPlaybackSession, publicId, videoData?.video?.muxPlaybackId]);

  // Instant playback while Mux is still encoding: as soon as the upload lands
  // in storage we stream the original file directly. Once muxPlaybackId appears
  // we clear this and the Mux-session effect above takes over (the player
  // prefers the adaptive stream).
  useEffect(() => {
    const v = videoData?.video;
    // getByPublicId only ever returns ready/processing videos, so the only
    // gate here is: we have an original file (s3Key) and Mux isn't ready yet.
    if (!v || !v.s3Key || v.muxPlaybackId) {
      setOriginalUrl(null);
      return;
    }

    let cancelled = false;
    void getOriginalPlaybackUrl({ publicId })
      .then((result) => {
        if (cancelled) return;
        setOriginalUrl(result.url);
      })
      .catch(() => {
        if (cancelled) return;
        setOriginalUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    getOriginalPlaybackUrl,
    publicId,
    videoData?.video?.s3Key,
    videoData?.video?.muxPlaybackId,
  ]);

  // Reflect the video name in the browser tab instead of the static
  // "Watch video | snip" route default.
  useEffect(() => {
    const title = videoData?.video?.title;
    if (title) document.title = `${title} | snip`;
    return () => {
      document.title = "snip";
    };
  }, [videoData?.video?.title]);

  useEffect(() => {
    setIsDownloading(false);
    setDownloadError(null);
  }, [publicId]);

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
    if (!commentText.trim() || isSubmittingComment) return;

    setIsSubmittingComment(true);
    setCommentError(null);
    try {
      await createComment({
        publicId,
        text: commentText.trim(),
        timestampSeconds: currentTime,
      });
      setCommentText("");
    } catch {
      setCommentError("Failed to post comment.");
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDownload = useCallback(async () => {
    if (isDownloading) return;

    setDownloadError(null);
    setIsDownloading(true);
    try {
      const result = await getDownloadUrl({ publicId });
      triggerDownload(result.url, result.filename);
    } catch (error) {
      console.error("Failed to prepare public download:", error);
      setDownloadError(
        error instanceof Error
          ? error.message
          : "Unable to prepare this download right now.",
      );
    } finally {
      setIsDownloading(false);
    }
  }, [getDownloadUrl, isDownloading, publicId]);

  if (videoData === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
        <DelayedAppear>
          <div className="text-[#6E6E73]">Opening…</div>
        </DelayedAppear>
      </div>
    );
  }

  if (!videoData?.video) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA] p-4 text-[#131315]">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF5F5]">
              <AlertCircle className="h-6 w-6 text-[#8A2B34]" />
            </div>
            <CardTitle>Video unavailable</CardTitle>
            <CardDescription>
              This video is private, invalid, or no longer available.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/" preload="intent" className="block">
              <Button variant="outline" className="w-full">Go to snip</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const video = videoData.video;
  // Prefer the Mux adaptive stream; fall back to the original upload while the
  // asset is still encoding so the video is watchable the instant it's posted.
  const activePlaybackUrl = playbackSession?.url ?? originalUrl;
  // Mux auto-captions, available once the track is ready. The player only
  // attaches them on the Mux (HLS) source, so they're simply absent during the
  // original-file fallback.
  const captionsVttUrl =
    video.muxPlaybackId && video.muxCaptionsTrackId
      ? `https://stream.mux.com/${video.muxPlaybackId}/text/${video.muxCaptionsTrackId}.vtt`
      : undefined;

  return (
    <div className="flex h-[100dvh] flex-col bg-[#FAFAFA] text-[#131315]">
      {/* Header */}
      <header className="flex flex-shrink-0 items-center justify-between border-b border-[#E8E8EC] bg-white px-5 py-3">
        <div className="flex items-center gap-4">
          <Link
            preload="intent"
            to="/"
            className="flex items-center gap-2 text-sm font-semibold text-[#6E6E73] transition-colors hover:text-[#131315]"
          >
            snip
          </Link>
          <div className="h-4 w-px bg-[#E8E8EC]" />
          <h1 className="max-w-[150px] truncate text-base font-semibold tracking-[-0.01em] text-[#131315] sm:max-w-[300px]">{video.title}</h1>
        </div>
        <div className="flex items-center gap-3 text-xs text-[#6E6E73]">
          {video.duration && (
            <>
              <span className="hidden text-[#A0A0A5] sm:inline">·</span>
              <span className="hidden sm:inline">{formatDuration(video.duration)}</span>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void handleDownload()}
            disabled={isDownloading}
            aria-label={isDownloading ? "Preparing download" : "Download video"}
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{isDownloading ? "Preparing…" : "Download"}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden h-8"
            onClick={() => setMobileCommentsOpen(true)}
          >
            <MessageSquare className="h-4 w-4" />
            {comments && comments.length > 0 && (
              <span className="ml-1.5 text-xs">{comments.length}</span>
            )}
          </Button>
        </div>
      </header>

      {/* Main content - horizontal split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video player area */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#0A0A0B]">
          {downloadError ? (
            <div
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              className="border-b border-[#E8E8EC] bg-[#FFF5F5] px-5 py-3 text-sm text-[#8A2B34]"
            >
              {downloadError}
            </div>
          ) : null}

          {activePlaybackUrl ? (
            <VideoPlayer
              ref={playerRef}
              src={activePlaybackUrl}
              poster={playbackSession?.posterUrl ?? video.thumbnailUrl ?? undefined}
              captionsVttUrl={captionsVttUrl}
              comments={flattenedComments}
              onTimeUpdate={setCurrentTime}
              allowDownload={false}
              controlsBelow
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-white">
                 <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                 <p className="text-sm font-medium text-white/85">
                   {playbackError ?? (isLoadingPlayback ? "Loading stream…" : "Preparing stream…")}
                 </p>
              </div>
            </div>
          )}
        </div>

        {/* Comments sidebar — desktop */}
        <aside className="hidden w-80 flex-col border-l border-[#E8E8EC] bg-white lg:flex xl:w-96">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-[#F1F1F3] px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em] text-[#131315]">
              Discussion
            </h2>
            {comments && comments.length > 0 && (
              <span className="rounded-full bg-[#F1F1F3] px-2 py-0.5 text-[11px] font-medium text-[#6E6E73]">
                {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
              </span>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {comments === undefined ? (
              <DelayedAppear>
                <p className="text-sm text-[#6E6E73]">Loading comments…</p>
              </DelayedAppear>
            ) : comments.length === 0 ? (
              <p className="text-sm text-[#6E6E73]">
                {isUserLoaded && user
                  ? "No comments yet. Yours will pin to the exact frame you're watching."
                  : "No comments yet."}
              </p>
            ) : (
              <div className="space-y-3">
                {comments.map((comment) => (
                  <article key={comment._id} className="rounded-[11px] border border-[#E8E8EC] bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-[#131315]">{comment.userName}</div>
                      <button
                        type="button"
                        className="text-xs font-medium text-[#D14E00] transition-colors hover:text-[#131315]"
                        onClick={() => playerRef.current?.seekTo(comment.timestampSeconds, { play: true })}
                      >
                        {formatTimestamp(comment.timestampSeconds)}
                      </button>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[#131315]">{comment.text}</p>
                    <p className="mt-1 text-[11px] text-[#6E6E73]">{formatRelativeTime(comment._creationTime)}</p>

                    {comment.replies.length > 0 ? (
                      <div className="ml-4 mt-3 space-y-2 border-l border-[#F1F1F3] pl-3">
                        {comment.replies.map((reply) => (
                          <div key={reply._id} className="text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-[#131315]">{reply.userName}</span>
                              <button
                                type="button"
                                className="text-xs font-medium text-[#D14E00] transition-colors hover:text-[#131315]"
                                onClick={() => playerRef.current?.seekTo(reply.timestampSeconds, { play: true })}
                              >
                                {formatTimestamp(reply.timestampSeconds)}
                              </button>
                            </div>
                            <p className="whitespace-pre-wrap text-[#131315]">{reply.text}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex-shrink-0 border-t border-[#E8E8EC] bg-white p-4">
            {isUserLoaded && user ? (
              <form onSubmit={handleSubmitComment} className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-[#6E6E73]">
                  <Clock className="h-3.5 w-3.5" />
                  Comment at {formatTimestamp(currentTime)}
                </div>
                <Textarea
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder="Leave a comment…"
                  className="min-h-[90px] text-sm"
                />
                {commentError ? <p className="text-xs text-[#8A2B34]">{commentError}</p> : null}
                <Button type="submit" size="sm" disabled={!commentText.trim() || isSubmittingComment} className="w-full">
                  <MessageSquare className="mr-1.5 h-4 w-4" />
                  {isSubmittingComment ? "Posting…" : "Post comment"}
                </Button>
              </form>
            ) : (
              <a
                href={`/sign-in?redirect_url=${encodeURIComponent(`/watch/${publicId}`)}`}
                className="block"
              >
                <Button className="w-full">
                  <MessageSquare className="mr-1.5 h-4 w-4" />
                  Sign in to comment
                </Button>
              </a>
            )}
          </div>
        </aside>
      </div>

      {/* Comments overlay — mobile */}
      {mobileCommentsOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white lg:hidden">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-[#E8E8EC] px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em] text-[#131315]">
              Discussion
              {comments && comments.length > 0 && (
                <span className="rounded-full bg-[#F1F1F3] px-2 py-0.5 text-[11px] font-medium text-[#6E6E73]">
                  {comments.length}
                </span>
              )}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setMobileCommentsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {comments === undefined ? (
              <DelayedAppear>
                <p className="text-sm text-[#6E6E73]">Loading comments…</p>
              </DelayedAppear>
            ) : comments.length === 0 ? (
              <p className="text-sm text-[#6E6E73]">
                {isUserLoaded && user
                  ? "No comments yet. Yours will pin to the exact frame you're watching."
                  : "No comments yet."}
              </p>
            ) : (
              <div className="space-y-3">
                {comments.map((comment) => (
                  <article key={comment._id} className="rounded-[11px] border border-[#E8E8EC] bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-[#131315]">{comment.userName}</div>
                      <button
                        type="button"
                        className="text-xs font-medium text-[#D14E00] transition-colors hover:text-[#131315]"
                        onClick={() => {
                          playerRef.current?.seekTo(comment.timestampSeconds, { play: true });
                          setMobileCommentsOpen(false);
                        }}
                      >
                        {formatTimestamp(comment.timestampSeconds)}
                      </button>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[#131315]">{comment.text}</p>
                    <p className="mt-1 text-[11px] text-[#6E6E73]">{formatRelativeTime(comment._creationTime)}</p>

                    {comment.replies.length > 0 ? (
                      <div className="ml-4 mt-3 space-y-2 border-l border-[#F1F1F3] pl-3">
                        {comment.replies.map((reply) => (
                          <div key={reply._id} className="text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-[#131315]">{reply.userName}</span>
                              <button
                                type="button"
                                className="text-xs font-medium text-[#D14E00] transition-colors hover:text-[#131315]"
                                onClick={() => {
                                  playerRef.current?.seekTo(reply.timestampSeconds, { play: true });
                                  setMobileCommentsOpen(false);
                                }}
                              >
                                {formatTimestamp(reply.timestampSeconds)}
                              </button>
                            </div>
                            <p className="whitespace-pre-wrap text-[#131315]">{reply.text}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex-shrink-0 border-t border-[#E8E8EC] bg-white p-4 pb-safe">
            {isUserLoaded && user ? (
              <form onSubmit={handleSubmitComment} className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-[#6E6E73]">
                  <Clock className="h-3.5 w-3.5" />
                  Comment at {formatTimestamp(currentTime)}
                </div>
                <Textarea
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder="Leave a comment…"
                  className="min-h-[90px] text-sm"
                />
                {commentError ? <p className="text-xs text-[#8A2B34]">{commentError}</p> : null}
                <Button type="submit" size="sm" disabled={!commentText.trim() || isSubmittingComment} className="w-full">
                  <MessageSquare className="mr-1.5 h-4 w-4" />
                  {isSubmittingComment ? "Posting…" : "Post comment"}
                </Button>
              </form>
            ) : (
              <a
                href={`/sign-in?redirect_url=${encodeURIComponent(`/watch/${publicId}`)}`}
                className="block"
              >
                <Button className="w-full">
                  <MessageSquare className="mr-1.5 h-4 w-4" />
                  Sign in to comment
                </Button>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
