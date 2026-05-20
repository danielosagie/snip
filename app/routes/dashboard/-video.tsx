
import { useConvex, useMutation, useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video-player/VideoPlayer";
import { ImageSequenceFrameGrid } from "@/components/videos/ImageSequenceFrameGrid";
import { VideoPaywallControl } from "@/components/videos/VideoPaywallControl";
import { VideoVersionDropdown } from "@/components/videos/VideoVersionDropdown";
import { triggerDownload } from "@/lib/download";
import { CommentList } from "@/components/comments/CommentList";
import { CommentInput } from "@/components/comments/CommentInput";
import { ShareDialog } from "@/components/ShareDialog";
import {
  VideoWorkflowStatusControl,
  type VideoWorkflowStatus,
} from "@/components/videos/VideoWorkflowStatusControl";
import { cn, formatDuration } from "@/lib/utils";
import { useVideoPresence } from "@/lib/useVideoPresence";
import { VideoWatchers } from "@/components/presence/VideoWatchers";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  ArrowLeft,
  Edit2,
  Check,
  X,
  Link as LinkIcon,
  MessageSquare,
  MoreVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Id } from "@convex/_generated/dataModel";
import { projectPath, teamHomePath } from "@/lib/routes";
import { useRoutePrewarmIntent } from "@/lib/useRoutePrewarmIntent";
import { prewarmProject } from "./-project.data";
import { prewarmTeam } from "./-team.data";
import { useVideoData } from "./-video.data";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Lightweight plaintext → HTML: blank-line-separated paragraphs, with
// `<br>` inside each paragraph for inline newlines. Enough for log
// files, README-style notes, and the simple text-document case.
function plainTextToHtml(text: string): string {
  if (!text.trim()) return "<p><em>(empty)</em></p>";
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks
    .map((b) => {
      const inner = escapeHtml(b).replace(/\n/g, "<br />");
      return `<p>${inner}</p>`;
    })
    .join("\n");
}

// Minimal markdown → HTML for the file-viewer surface. Covers
// headings (#/##/###), bold (**), italic (*), inline code (`),
// fenced code (```), bullet lists, and blank-line paragraphs.
// Not a full CommonMark implementation — for full fidelity the
// user would round-trip through the contract editor.
function markdownToHtml(md: string): string {
  if (!md.trim()) return "<p><em>(empty)</em></p>";
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  let codeBuf: string[] = [];
  const flushList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    if (raw.startsWith("```")) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }
    const line = raw;
    if (/^### /.test(line)) {
      flushList();
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
      continue;
    }
    if (/^## /.test(line)) {
      flushList();
      out.push(`<h2>${inline(line.slice(3))}</h2>`);
      continue;
    }
    if (/^# /.test(line)) {
      flushList();
      out.push(`<h1>${inline(line.slice(2))}</h1>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (line.trim() === "") {
      flushList();
      out.push("");
      continue;
    }
    flushList();
    out.push(`<p>${inline(line)}</p>`);
  }
  flushList();
  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  return out.join("\n");

  function inline(s: string): string {
    let r = escapeHtml(s);
    r = r.replace(/`([^`]+)`/g, "<code>$1</code>");
    r = r.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    r = r.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return r;
  }
}

export default function VideoPage() {
  const params = useParams({ strict: false });
  const navigate = useNavigate({});
  // Deep-link from search: ?t=<sec> seeks the player to a matched
  // frame/transcript moment. Untyped (route has no validateSearch), so
  // read loosely and coerce.
  const routeSearch = useSearch({ strict: false }) as { t?: unknown };
  const deepLinkTime = Number(routeSearch?.t);
  const initialPlaybackTime =
    Number.isFinite(deepLinkTime) && deepLinkTime > 0
      ? deepLinkTime
      : undefined;
  const pathname = useLocation().pathname;
  const teamSlug = typeof params.teamSlug === "string" ? params.teamSlug : "";
  const projectId = params.projectId as Id<"projects">;
  const videoId = params.videoId as Id<"videos">;
  const convex = useConvex();

  const {
    context,
    resolvedTeamSlug,
    resolvedProjectId,
    resolvedVideoId,
    video,
    comments,
    commentsThreaded,
  } = useVideoData({
    teamSlug,
    projectId,
    videoId,
  });
  const updateVideo = useMutation(api.videos.update);
  const updateVideoWorkflowStatus = useMutation(api.videos.updateWorkflowStatus);
  const getPlaybackSession = useAction(api.videoActions.getPlaybackSession);
  const getOriginalPlaybackUrl = useAction(api.videoActions.getOriginalPlaybackUrl);
  const getDownloadUrl = useAction(api.videoActions.getDownloadUrl);

  const [currentTime, setCurrentTime] = useState(0);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [highlightedCommentId, setHighlightedCommentId] = useState<Id<"comments"> | undefined>();
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [mobileCommentsOpen, setMobileCommentsOpen] = useState(false);
  const [playbackSession, setPlaybackSession] = useState<{
    url: string;
    posterUrl: string;
  } | null>(null);
  const [isLoadingPlayback, setIsLoadingPlayback] = useState(false);
  const [originalPlaybackUrl, setOriginalPlaybackUrl] = useState<string | null>(null);
  const [isLoadingOriginalPlayback, setIsLoadingOriginalPlayback] = useState(false);
  const [preferredSource, setPreferredSource] = useState<"mux720" | "original">("original");
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const isPlayable = video?.status === "ready" && Boolean(video?.muxPlaybackId);
  const playbackUrl = playbackSession?.url ?? null;
  const activePlaybackUrl =
    preferredSource === "mux720"
      ? playbackUrl ?? originalPlaybackUrl
      : originalPlaybackUrl ?? playbackUrl;
  const activeQualityId =
    activePlaybackUrl && playbackUrl && activePlaybackUrl === playbackUrl
      ? "mux720"
      : "original";
  const isUsingOriginalFallback = Boolean(activePlaybackUrl && activePlaybackUrl === originalPlaybackUrl && !playbackUrl);
  // Mux-generated captions track. Available once
  // `video.asset.track.ready` has fired (muxActions.ts). Falls back to
  // undefined for videos that predate the captions backfill — the
  // VideoPlayer simply omits the <track> in that case.
  const captionsVttUrl =
    video?.muxPlaybackId && video?.muxCaptionsTrackId
      ? `https://stream.mux.com/${video.muxPlaybackId}/text/${video.muxCaptionsTrackId}.vtt`
      : undefined;
  // Transcript tab data — loaded lazily; the search.ts query returns
  // the ordered ~45s cue windows from the search index.
  const transcriptCues = useQuery(
    api.search.getCuesForVideo,
    resolvedVideoId ? { videoId: resolvedVideoId } : "skip",
  );
  const [sidebarTab, setSidebarTab] = useState<"comments" | "transcript">("comments");
  // Item-type dispatch. Images/GIFs and PDFs are also `videos` rows; they
  // get the same focused view (header + comments + version stack) but a
  // different renderer in the media pane. Anything else (video/audio)
  // keeps the existing Mux/player path.
  const contentType = video?.contentType ?? "";
  const isImageItem = contentType.startsWith("image/");
  const isPdfItem = contentType === "application/pdf";
  const isTextItem =
    contentType === "text/plain" ||
    contentType === "text/markdown" ||
    contentType === "text/x-markdown" ||
    contentType.startsWith("text/");
  const isWordDocItem =
    contentType === "application/msword" ||
    contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const isDocItem = isPdfItem || isTextItem || isWordDocItem;
  const isSequenceItem = video?.kind === "image_sequence";
  // Only time-based media has a playhead, so only it gets timestamped
  // comments. Stills/docs post plain comments (timestampSeconds 0).
  // Sequences become time-based once stitched; until then they behave
  // like stills.
  const isTimeBasedItem = !isImageItem && !isDocItem;
  const getSequenceFrameUrls = useAction(api.videoActions.getSequenceFrameUrls);
  const [sequenceFrames, setSequenceFrames] = useState<
    Array<{ key: string; url: string }> | null
  >(null);
  // Plain-text / markdown / Word body — fetched lazily when the user
  // opens a doc-class file. PDFs are rendered via the existing
  // iframe; this is the path for files we want to surface in the
  // editor shell instead. No wizard, no signing — just the contents.
  const [docHtml, setDocHtml] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  useEffect(() => {
    if (!resolvedVideoId || (!isTextItem && !isWordDocItem)) {
      setDocHtml(null);
      setDocError(null);
      return;
    }
    let cancelled = false;
    setDocHtml(null);
    setDocError(null);
    (async () => {
      try {
        const { url, contentType: ct } = await getOriginalPlaybackUrl({
          videoId: resolvedVideoId,
        });
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Fetch failed (${resp.status})`);
        if (isWordDocItem) {
          const buf = await resp.arrayBuffer();
          // Defer mammoth's bundle until actually needed.
          const mammoth = await import("mammoth");
          const result = await mammoth.convertToHtml({ arrayBuffer: buf });
          if (!cancelled) setDocHtml(result.value || "<p><em>(empty document)</em></p>");
          return;
        }
        const text = await resp.text();
        if (cancelled) return;
        // Markdown → rendered as paragraphs split on blank lines, with
        // headings detected. Lightweight conversion — avoids a markdown
        // parser dep for the simple cases. Plain text falls through
        // the same path and just becomes paragraphs.
        const isMarkdown =
          ct === "text/markdown" ||
          ct === "text/x-markdown" ||
          video?.title?.toLowerCase?.().endsWith(".md") === true;
        const html = isMarkdown ? markdownToHtml(text) : plainTextToHtml(text);
        setDocHtml(html);
      } catch (err) {
        if (!cancelled) {
          setDocError(
            err instanceof Error ? err.message : "Could not load document.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    resolvedVideoId,
    isTextItem,
    isWordDocItem,
    video?.title,
    getOriginalPlaybackUrl,
  ]);
  useEffect(() => {
    if (!isSequenceItem || !resolvedVideoId) {
      setSequenceFrames(null);
      return;
    }
    let cancelled = false;
    getSequenceFrameUrls({ videoId: resolvedVideoId })
      .then((frames) => {
        if (!cancelled) setSequenceFrames(frames);
      })
      .catch((err) => {
        console.error("getSequenceFrameUrls failed", err);
        if (!cancelled) setSequenceFrames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isSequenceItem, resolvedVideoId, getSequenceFrameUrls]);
  const shouldCanonicalize =
    !!context && !context.isCanonical && pathname !== context.canonicalPath;
  const prewarmTeamIntentHandlers = useRoutePrewarmIntent(() =>
    prewarmTeam(convex, { teamSlug: resolvedTeamSlug }),
  );
  const prewarmProjectIntentHandlers = useRoutePrewarmIntent(() => {
    if (!resolvedProjectId) return;
    return prewarmProject(convex, {
      teamSlug: resolvedTeamSlug,
      projectId: resolvedProjectId,
    });
  });
  const { watchers } = useVideoPresence({
    videoId: resolvedVideoId,
    enabled: Boolean(resolvedVideoId),
  });

  useEffect(() => {
    if (shouldCanonicalize && context) {
      navigate({ to: context.canonicalPath, replace: true });
    }
  }, [shouldCanonicalize, context, navigate]);

  useEffect(() => {
    if (!resolvedVideoId || !isPlayable) {
      setPlaybackSession(null);
      setIsLoadingPlayback(false);
      return;
    }

    let cancelled = false;
    setIsLoadingPlayback(true);

    void getPlaybackSession({ videoId: resolvedVideoId })
      .then((session) => {
        if (cancelled) return;
        setPlaybackSession(session);
      })
      .catch(() => {
        if (cancelled) return;
        setPlaybackSession(null);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingPlayback(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getPlaybackSession, isPlayable, resolvedVideoId, video?.muxPlaybackId]);

  useEffect(() => {
    if (
      !resolvedVideoId ||
      !video ||
      video.status === "uploading" ||
      video.status === "failed" ||
      // Seeded demo videos have a Mux playback ID but no s3Key — there's
      // nothing in object storage to fetch. Skip the action so we don't
      // log "Original bucket file not found" on every page load.
      !video.s3Key
    ) {
      setOriginalPlaybackUrl(null);
      setIsLoadingOriginalPlayback(false);
      return;
    }

    let cancelled = false;
    setIsLoadingOriginalPlayback(true);

    void getOriginalPlaybackUrl({ videoId: resolvedVideoId })
      .then((result) => {
        if (cancelled) return;
        setOriginalPlaybackUrl(result.url);
      })
      .catch(() => {
        if (cancelled) return;
        setOriginalPlaybackUrl(null);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingOriginalPlayback(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getOriginalPlaybackUrl, resolvedVideoId, video?.status, video?.s3Key]);

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleMarkerClick = useCallback((comment: { _id: string }) => {
    setHighlightedCommentId(comment._id as Id<"comments">);
    setTimeout(() => setHighlightedCommentId(undefined), 3000);
  }, []);

  const requestDownload = useCallback(async () => {
    if (!video || video.status !== "ready" || !resolvedVideoId) return null;
    try {
      const result = await getDownloadUrl({ videoId: resolvedVideoId });
      return result;
    } catch (error) {
      console.error("Failed to prepare download:", error);
      return null;
    }
  }, [getDownloadUrl, video, resolvedVideoId]);

  const handleTimestampClick = useCallback(
    (time: number) => {
      playerRef.current?.seekTo(time);
      setHighlightedCommentId(undefined);
    },
    [playerRef, setHighlightedCommentId]
  );

  const handleSaveTitle = async () => {
    if (!editedTitle.trim() || !video || !resolvedVideoId) return;
    try {
      await updateVideo({ videoId: resolvedVideoId, title: editedTitle.trim() });
      setIsEditingTitle(false);
    } catch (error) {
      console.error("Failed to update title:", error);
    }
  };

  const handleUpdateWorkflowStatus = useCallback(
    async (workflowStatus: VideoWorkflowStatus) => {
      if (!resolvedVideoId) return;
      try {
        await updateVideoWorkflowStatus({ videoId: resolvedVideoId, workflowStatus });
      } catch (error) {
        console.error("Failed to update review status:", error);
      }
    },
    [resolvedVideoId, updateVideoWorkflowStatus],
  );

  const startEditingTitle = () => {
    if (video) {
      setEditedTitle(video.title);
      setIsEditingTitle(true);
    }
  };

  if (context === undefined || video === undefined || shouldCanonicalize) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#888]">Loading...</div>
      </div>
    );
  }

  if (context === null || video === null || !resolvedProjectId || !resolvedVideoId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#888]">Video not found</div>
      </div>
    );
  }

  const canEdit = video.role !== "viewer";
  const canComment = true;

  return (
    <div className="h-full flex flex-col">
      {/* Header — no breadcrumbs on the video page. The Back button +
          inline title sit on the left where the breadcrumb used to be. */}
      <DashboardHeader hideBreadcrumb>
        <div className="flex items-center gap-2 min-w-0 mr-auto">
          <Link
            to={projectPath(resolvedTeamSlug, resolvedProjectId)}
            preload="intent"
            {...prewarmProjectIntentHandlers}
            className="inline-flex items-center gap-1 px-3 h-9 border-2 border-[#1a1a1a] text-xs font-bold uppercase tracking-wider bg-[#f0f0e8] text-[#1a1a1a] shadow-[4px_4px_0px_0px_var(--shadow-color)] hover:bg-[#1a1a1a] hover:text-[#f0f0e8] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_var(--shadow-color)] active:translate-y-[2px] active:translate-x-[2px] transition-all flex-shrink-0"
            title="Back to project"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          {isEditingTitle ? (
            <div className="flex items-center gap-2 min-w-0">
              <Input
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="w-40 sm:w-64 h-9 text-base font-black tracking-tighter uppercase font-mono"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveTitle();
                  if (e.key === "Escape") setIsEditingTitle(false);
                }}
              />
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={handleSaveTitle}>
                <Check className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                onClick={() => setIsEditingTitle(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base font-black tracking-tighter text-[#1a1a1a] truncate max-w-[200px] sm:max-w-[360px]">
                {video.title}
              </span>
              {canEdit && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={startEditingTitle}
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              )}
              {video.status !== "ready" && (
                <Badge
                  variant={video.status === "failed" ? "destructive" : "secondary"}
                >
                  {video.status === "uploading" && "Uploading"}
                  {video.status === "processing" && "Processing"}
                  {video.status === "failed" && "Failed"}
                </Badge>
              )}
            </div>
          )}
        </div>
        {/* Desktop: inline actions. All buttons share h-9 so the row
            doesn't look ragged. */}
        <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
          <VideoWorkflowStatusControl
            status={video.workflowStatus}
            size="lg"
            disabled={!canEdit}
            onChange={(workflowStatus) => {
              void handleUpdateWorkflowStatus(workflowStatus);
            }}
          />
          {resolvedVideoId && resolvedProjectId ? (
            <VideoVersionDropdown
              teamSlug={resolvedTeamSlug}
              projectId={resolvedProjectId}
              videoId={resolvedVideoId}
              canEdit={canEdit}
            />
          ) : null}
          {resolvedVideoId ? (
            <VideoPaywallControl
              videoId={resolvedVideoId}
              isDownloading={false}
              onRequestPrivateDownload={async () => {
                const result = await requestDownload();
                if (result?.url) triggerDownload(result.url, result.filename);
              }}
            />
          ) : null}
          <Button
            variant="outline"
            className="h-9"
            onClick={() => setShareDialogOpen(true)}
          >
            <LinkIcon className="mr-1.5 h-4 w-4" />
            Share
          </Button>
          <Button
            variant="outline"
            className="h-9 lg:hidden"
            onClick={() => setMobileCommentsOpen(true)}
          >
            <MessageSquare className="h-4 w-4" />
            {comments && comments.length > 0 && (
              <span className="ml-1 text-xs">{comments.length}</span>
            )}
          </Button>
        </div>

        {/* Mobile: workflow status + menu button */}
        <div className="flex sm:hidden items-center gap-2">
          <VideoWorkflowStatusControl
            status={video.workflowStatus}
            size="lg"
            disabled={!canEdit}
            onChange={(workflowStatus) => {
              void handleUpdateWorkflowStatus(workflowStatus);
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setShareDialogOpen(true)}>
              <LinkIcon className="mr-2 h-4 w-4" />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMobileCommentsOpen(true)}>
              <MessageSquare className="mr-2 h-4 w-4" />
              Comments{comments && comments.length > 0 ? ` (${comments.length})` : ""}
            </DropdownMenuItem>
          </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </DashboardHeader>

      {/* Main content - horizontal split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video player area — full black, Frame.io style */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-black">
          {isSequenceItem && !activePlaybackUrl ? (
            <ImageSequenceFrameGrid
              frames={sequenceFrames}
              stitchStatus={
                (video as { sequenceStitchStatus?: string }).sequenceStitchStatus
              }
              stitchError={
                (video as { sequenceStitchError?: string }).sequenceStitchError
              }
            />
          ) : isImageItem ? (
            activePlaybackUrl ? (
              <div className="flex-1 flex items-center justify-center overflow-auto p-4">
                <img
                  src={activePlaybackUrl}
                  alt={video.title}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center">
                {video.status === "failed" ? (
                  <p className="text-[#dc2626]">This file failed to process</p>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-white">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                    <p className="text-sm font-medium text-white/85">
                      Loading image…
                    </p>
                  </div>
                )}
              </div>
            )
          ) : isPdfItem ? (
            activePlaybackUrl ? (
              <iframe
                src={activePlaybackUrl}
                title={video.title}
                className="flex-1 w-full bg-white"
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-center">
                {video.status === "failed" ? (
                  <p className="text-[#dc2626]">This file failed to process</p>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-white">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                    <p className="text-sm font-medium text-white/85">
                      Loading document…
                    </p>
                  </div>
                )}
              </div>
            )
          ) : isTextItem || isWordDocItem ? (
            // Generic document viewer — paper-style canvas, same look
            // as the contract editor but stripped of wizard / signing
            // chrome. View-only for now; the round-trip back to .docx
            // / plain-text is in the share menu instead of inline.
            <div className="flex-1 overflow-y-auto bg-[#1a1a1a] py-10">
              <div className="mx-auto max-w-3xl bg-white border-2 border-[#1a1a1a] shadow-[6px_6px_0px_0px_#000] p-10 sm:p-14">
                {docError ? (
                  <p className="text-[#dc2626] text-sm font-mono">
                    {docError}
                  </p>
                ) : docHtml === null ? (
                  <div className="flex flex-col items-center gap-3 text-[#888]">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1a1a1a]/15 border-t-[#1a1a1a]/60" />
                    <p className="text-sm font-medium">Loading document…</p>
                  </div>
                ) : (
                  <article
                    className="prose prose-sm max-w-none text-[#1a1a1a]"
                    dangerouslySetInnerHTML={{ __html: docHtml }}
                  />
                )}
              </div>
            </div>
          ) : (
            <>
              {video.status === "processing" && isUsingOriginalFallback && activePlaybackUrl ? (
                <div className="flex-shrink-0 flex items-center gap-2 bg-[#1a1a1a] px-4 py-2 text-sm text-white">
                  <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-[#FF6600]" />
                  <span className="font-semibold">Original playback active.</span>
                  <span className="text-white/60">720p stream is still encoding.</span>
                </div>
              ) : null}

              {activePlaybackUrl ? (
                <VideoPlayer
                  ref={playerRef}
                  src={activePlaybackUrl}
                  poster={playbackSession?.posterUrl}
                  initialTime={initialPlaybackTime}
                  comments={comments || []}
                  onTimeUpdate={handleTimeUpdate}
                  onMarkerClick={handleMarkerClick}
                  allowDownload={video.status === "ready"}
                  downloadFilename={`${video.title}.mp4`}
                  onRequestDownload={requestDownload}
                  captionsVttUrl={captionsVttUrl}
                  controlsBelow
                  qualityOptionsConfig={[
                    {
                      id: "mux720",
                      label: playbackUrl ? "720p" : "720p (encoding...)",
                      disabled: !playbackUrl,
                    },
                    {
                      id: "original",
                      label: "Original",
                      disabled: !originalPlaybackUrl,
                    },
                  ]}
                  selectedQualityId={activeQualityId}
                  onSelectQuality={(id) => {
                    if (id === "mux720" || id === "original") {
                      setPreferredSource(id);
                    }
                  }}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  {video.status === "ready" && !playbackUrl ? (
                    <div className="flex flex-col items-center gap-3 text-white">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                      <p className="text-sm font-medium text-white/85">
                        {isLoadingPlayback ? "Loading stream..." : "Preparing stream..."}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center">
                      {video.status === "uploading" && (
                        <p className="text-white/60">Uploading...</p>
                      )}
                      {video.status === "processing" && (
                        <p className="text-white/60">
                          {isLoadingOriginalPlayback
                            ? "Preparing original playback..."
                            : "Processing video..."}
                        </p>
                      )}
                      {video.status === "failed" && (
                        <p className="text-[#dc2626]">Processing failed</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Comments sidebar — desktop */}
        <aside className="hidden lg:flex w-80 xl:w-96 border-l-2 border-[#1a1a1a] flex-col bg-[#f0f0e8]">
          {/* Tabs: Comments | Transcript. Brutalist: 2px border on the
              active tab, cream bg, no rounded corners. */}
          <div className="flex-shrink-0 border-b-2 border-[#1a1a1a] grid grid-cols-2">
            <button
              type="button"
              onClick={() => setSidebarTab("comments")}
              className={cn(
                "h-10 text-xs font-bold uppercase tracking-wider border-r-2 border-[#1a1a1a] transition-colors",
                sidebarTab === "comments"
                  ? "bg-[#1a1a1a] text-[#f0f0e8]"
                  : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#FFEDD5]",
              )}
            >
              Comments
              {comments && comments.length > 0 && (
                <span className="ml-2 text-[#C2410C]">{comments.length}</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab("transcript")}
              disabled={!transcriptCues || transcriptCues.length === 0}
              className={cn(
                "h-10 text-xs font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                sidebarTab === "transcript"
                  ? "bg-[#1a1a1a] text-[#f0f0e8]"
                  : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#FFEDD5]",
              )}
              title={!transcriptCues || transcriptCues.length === 0 ? "No transcript yet" : "Transcript"}
            >
              Transcript
              {transcriptCues && transcriptCues.length > 0 && (
                <span className="ml-2 text-[#C2410C]">{transcriptCues.length}</span>
              )}
            </button>
          </div>
          {sidebarTab === "comments" ? (
            <>
              <div className="flex-1 overflow-hidden">
                <CommentList
                  videoId={resolvedVideoId}
                  comments={commentsThreaded}
                  onTimestampClick={handleTimestampClick}
                  highlightedCommentId={highlightedCommentId}
                  canResolve={canEdit}
                  currentTime={isTimeBasedItem ? currentTime : undefined}
                />
              </div>
              {canComment && (
                <div className="flex-shrink-0 border-t-2 border-[#1a1a1a] bg-[#f0f0e8]">
                  <CommentInput
                    videoId={resolvedVideoId}
                    timestampSeconds={isTimeBasedItem ? currentTime : 0}
                    showTimestamp={isTimeBasedItem}
                    variant="seamless"
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {transcriptCues && transcriptCues.length > 0 ? (
                <ul className="divide-y divide-[#1a1a1a]/10">
                  {transcriptCues.map((cue) => (
                    <li key={`${cue.start}`}>
                      <button
                        type="button"
                        onClick={() => handleTimestampClick(cue.start)}
                        className={cn(
                          "w-full text-left px-4 py-3 hover:bg-[#FFEDD5] transition-colors",
                          Math.abs(currentTime - cue.start) < 45 && "bg-[#FFEDD5]",
                        )}
                      >
                        <div className="text-[11px] font-mono font-bold text-[#C2410C]">
                          {formatDuration(cue.start)}
                        </div>
                        <div className="text-sm text-[#1a1a1a] mt-1 leading-snug">
                          {cue.text}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-6 text-center text-sm text-[#888]">
                  No transcript yet. Mux auto-transcribes audio when it ingests
                  a video — it should appear shortly after upload.
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Comments overlay — mobile */}
      {mobileCommentsOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex flex-col bg-[#f0f0e8]">
          <div className="flex-shrink-0 px-5 py-4 border-b-2 border-[#1a1a1a] flex items-center justify-between">
            <h2 className="font-semibold text-sm tracking-tight flex items-center gap-2 text-[#1a1a1a]">
              Discussion
              {comments && comments.length > 0 && (
                <span className="text-[11px] font-medium text-[#888] bg-[#1a1a1a]/5 px-2 py-0.5 rounded-full">
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
          <div className="flex-1 overflow-hidden">
            <CommentList
              videoId={resolvedVideoId}
              comments={commentsThreaded}
              onTimestampClick={(time) => {
                handleTimestampClick(time);
                setMobileCommentsOpen(false);
              }}
              highlightedCommentId={highlightedCommentId}
              canResolve={canEdit}
              currentTime={isTimeBasedItem ? currentTime : undefined}
            />
          </div>
          {canComment && (
            <div className="flex-shrink-0 border-t-2 border-[#1a1a1a] bg-[#f0f0e8]">
              <CommentInput
                videoId={resolvedVideoId}
                timestampSeconds={isTimeBasedItem ? currentTime : 0}
                showTimestamp={isTimeBasedItem}
                variant="seamless"
              />
            </div>
          )}
        </div>
      )}

      <ShareDialog
        videoId={resolvedVideoId}
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
      />
    </div>
  );
}
