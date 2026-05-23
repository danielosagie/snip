
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { DropZone } from "@/components/upload/DropZone";
import { formatDuration, formatRelativeTime } from "@/lib/utils";
import { triggerDownload } from "@/lib/download";
import {
  Play,
  MoreVertical,
  Trash2,
  Link as LinkIcon,
  Download,
  MessageSquare,
  Eye,
  Share2,
  Copy,
  FolderInput,
  CheckSquare,
  Pencil,
  Tags,
} from "lucide-react";
import { FileTile, FileListRow } from "@/components/files/FileTile";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "@/components/ui/context-menu";
import { BulkRenameDialog } from "@/components/videos/BulkRenameDialog";
import { BulkEditMetadataDialog } from "@/components/videos/BulkEditMetadataDialog";
import { VideoKanban } from "@/components/videos/VideoKanban";
import { VersionDropdown } from "@/components/projects/VersionDropdown";
import {
  ProjectToolbar,
  type ProjectViewMode,
  type ProjectSortMode,
} from "@/components/projects/ProjectToolbar";
import { ProjectAddButton } from "@/components/projects/ProjectAddButton";
import { FolderRow } from "@/components/folders/FolderRow";
import { ContractListSection } from "@/components/contracts/ContractListSection";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { videoPath } from "@/lib/routes";
import { prefetchHlsRuntime, prefetchMuxPlaybackManifest } from "@/lib/muxPlayback";
import { useRoutePrewarmIntent } from "@/lib/useRoutePrewarmIntent";
import {
  VideoWorkflowStatusControl,
  type VideoWorkflowStatus,
} from "@/components/videos/VideoWorkflowStatusControl";
import { useProjectData } from "./-project.data";
import { prewarmVideo } from "./-video.data";
import { useDashboardUploadContext } from "@/lib/dashboardUploadContext";
import { DashboardHeader } from "@/components/DashboardHeader";
import { ShareSelectionDialog } from "@/components/ShareSelectionDialog";
import { ShareFolderDialog } from "@/components/ShareFolderDialog";
import { MoveToFolderDialog } from "@/components/MoveToFolderDialog";

type ViewMode = ProjectViewMode;
type ShareToastState = {
  tone: "success" | "error";
  message: string;
};

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}

type VideoIntentTargetProps = {
  className: string;
  teamSlug: string;
  projectId: Id<"projects">;
  videoId: Id<"videos">;
  muxPlaybackId?: string;
  draggable?: boolean;
  selected?: boolean;
  /** When true, a plain click toggles selection instead of opening the
   *  video — this is what the header "Select" button turns on so users
   *  don't have to know the Cmd/Ctrl/Shift shortcuts. */
  selectionMode?: boolean;
  onOpen: () => void;
  onSelectToggle?: (
    event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  ) => void;
  children: ReactNode;
};

// Content types that have an in-app focused view (the asset detail
// page). Click in the project grid → navigate to the editor view
// instead of triggering a download. Everything else (zips, source
// files, etc.) downloads on click as before.
const DOC_CONTENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function computeHasFocusedView(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  if (contentType.startsWith("image/")) return true;
  if (contentType.startsWith("text/")) return true;
  return DOC_CONTENT_TYPES.has(contentType);
}

function VideoIntentTarget({
  className,
  teamSlug,
  projectId,
  videoId,
  muxPlaybackId,
  draggable,
  selected,
  selectionMode,
  onOpen,
  onSelectToggle,
  children,
}: VideoIntentTargetProps) {
  const convex = useConvex();
  const prewarmIntentHandlers = useRoutePrewarmIntent(() => {
    prewarmVideo(convex, {
      teamSlug,
      projectId,
      videoId,
    });
    prefetchHlsRuntime();
    if (muxPlaybackId) {
      prefetchMuxPlaybackManifest(muxPlaybackId);
    }
  });

  return (
    <div
      className={`${className}${selected ? " ring-2 ring-[#FF6600] ring-offset-2 ring-offset-[#f0f0e8]" : ""}`}
      onClick={(e) => {
        // In selection mode a plain click toggles. Otherwise Cmd/Ctrl+click
        // toggles a single item, Shift+click extends the range, and a plain
        // click falls through to onOpen. The selection-toggle callback owns
        // whichever modifier behavior is set up at the parent.
        if (
          onSelectToggle &&
          (selectionMode || e.metaKey || e.ctrlKey || e.shiftKey)
        ) {
          e.preventDefault();
          e.stopPropagation();
          onSelectToggle({
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
          });
          return;
        }
        onOpen();
      }}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-snip-video", videoId);
      }}
      {...prewarmIntentHandlers}
    >
      {children}
    </div>
  );
}

export default function ProjectPage({
  teamSlug,
  projectId,
  folderId,
}: {
  teamSlug: string;
  projectId: Id<"projects">;
  folderId?: Id<"folders"> | null;
}) {
  const navigate = useNavigate({});
  const pathname = useLocation().pathname;

  const currentFolderId = folderId ?? null;

  const {
    context,
    resolvedProjectId,
    resolvedTeamSlug,
    project,
    videos,
    folders,
  } = useProjectData({ teamSlug, projectId, folderId: currentFolderId });
  const projectPresenceCounts = useQuery(
    api.videoPresence.listProjectOnlineCounts,
    resolvedProjectId ? { projectId: resolvedProjectId } : "skip",
  );
  const { requestUpload } = useDashboardUploadContext();
  const deleteVideo = useMutation(api.videos.remove);
  const duplicateVideo = useMutation(api.videos.duplicate);
  const updateVideoWorkflowStatus = useMutation(api.videos.updateWorkflowStatus);
  const moveVideoToFolder = useMutation(api.folders.moveVideoToFolder);
  const moveFolder = useMutation(api.folders.moveFolder);
  const getDownloadUrl = useAction(api.videoActions.getDownloadUrl);

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sort, setSort] = useState<ProjectSortMode>("newest");
  const [search, setSearch] = useState("");
  const [shareToast, setShareToast] = useState<ShareToastState | null>(null);
  const shareToastTimeoutRef = useRef<number | null>(null);

  // Multi-select for ad-hoc bundle sharing. Cmd/Ctrl+click toggles single
  // items, Shift+click extends the range from the last clicked item.
  // Plain click on a video opens it (existing behavior), but clears the
  // selection first so the user doesn't accidentally lose their selection
  // when scrolling through.
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<Id<"videos">>>(
    () => new Set(),
  );
  const [lastClickedVideoId, setLastClickedVideoId] = useState<Id<"videos"> | null>(
    null,
  );
  const [selectionShareOpen, setSelectionShareOpen] = useState(false);
  const [folderShareOpen, setFolderShareOpen] = useState(false);
  // When on, a plain click selects instead of opening — toggled by the
  // header "Select" button so the multi-select shortcuts are discoverable.
  const [selectionMode, setSelectionMode] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [bulkRenameOpen, setBulkRenameOpen] = useState(false);
  const [bulkMetaOpen, setBulkMetaOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<null | string>(null);

  const clearSelection = useCallback(() => {
    setSelectedVideoIds(new Set());
    setLastClickedVideoId(null);
    setSelectionMode(false);
  }, []);

  // ESC clears the selection — quick exit when the user is done.
  useEffect(() => {
    if (selectedVideoIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedVideoIds.size, clearSelection]);

  const shouldCanonicalize =
    !!context && !context.isCanonical && pathname !== context.canonicalPath;

  useEffect(() => {
    if (shouldCanonicalize && context) {
      navigate({ to: context.canonicalPath, replace: true });
    }
  }, [shouldCanonicalize, context, navigate]);

  useEffect(
    () => () => {
      if (shareToastTimeoutRef.current !== null) {
        window.clearTimeout(shareToastTimeoutRef.current);
      }
    },
    [],
  );

  const isLoadingData =
    context === undefined ||
    project === undefined ||
    videos === undefined ||
    folders === undefined ||
    shouldCanonicalize;

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      if (!resolvedProjectId) return;
      // When the user is inside a folder, uploads land directly in it.
      // At the root they're created with no folderId as before.
      requestUpload(
        files,
        resolvedProjectId,
        currentFolderId ?? undefined,
      );
    },
    [requestUpload, resolvedProjectId, currentFolderId],
  );

  // Hidden <input type=file> opened by the toolbar's "Add files" action.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const handleHiddenInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    if (picked.length > 0) handleFilesSelected(picked);
    e.target.value = "";
  };

  const handleDeleteVideo = async (videoId: Id<"videos">) => {
    if (!confirm("Are you sure you want to delete this video?")) return;
    try {
      await deleteVideo({ videoId });
    } catch (error) {
      console.error("Failed to delete video:", error);
    }
  };

  const handleDownloadVideo = useCallback(
    async (videoId: Id<"videos">, title: string) => {
      try {
        const result = await getDownloadUrl({ videoId });
        if (result?.url) {
          triggerDownload(result.url, result.filename ?? `${title}.mp4`);
        }
      } catch (error) {
        console.error("Failed to download video:", error);
      }
    },
    [getDownloadUrl],
  );

  const handleMoveVideo = useCallback(
    async (videoId: Id<"videos">, folderId: Id<"folders"> | null) => {
      try {
        await moveVideoToFolder({
          videoId,
          folderId: folderId ?? undefined,
        });
      } catch (e) {
        alert(e instanceof Error ? e.message : "Move failed.");
      }
    },
    [moveVideoToFolder],
  );

  const handleMoveFolder = useCallback(
    async (folderId: Id<"folders">, parentFolderId: Id<"folders"> | null) => {
      try {
        await moveFolder({
          folderId,
          parentFolderId: parentFolderId ?? undefined,
        });
      } catch (e) {
        alert(e instanceof Error ? e.message : "Move failed.");
      }
    },
    [moveFolder],
  );

  // ─── Bulk actions on the multi-selection ──────────────────────────────
  // Each loops the existing single-item mutation/action. Selections are
  // small (a project grid), so a per-item loop is simpler and safer than
  // a bespoke bulk backend signature, and reuses the access checks.
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedVideoIds);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Move ${ids.length} item${ids.length === 1 ? "" : "s"} to the trash?`,
      )
    )
      return;
    setBulkBusy("delete");
    try {
      for (const videoId of ids) {
        await deleteVideo({ videoId });
      }
      clearSelection();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBulkBusy(null);
    }
  };

  const handleBulkDownload = async () => {
    const ids = Array.from(selectedVideoIds);
    if (ids.length === 0) return;
    setBulkBusy("download");
    try {
      const byId = new Map(
        (filteredVideos ?? []).map((v) => [v._id, v.title] as const),
      );
      // Sequential so the browser doesn't block a burst of downloads.
      for (const videoId of ids) {
        await handleDownloadVideo(videoId, byId.get(videoId) ?? "video");
      }
    } finally {
      setBulkBusy(null);
    }
  };

  const handleBulkDuplicate = async () => {
    const ids = Array.from(selectedVideoIds);
    if (ids.length === 0) return;
    setBulkBusy("duplicate");
    try {
      for (const videoId of ids) {
        await duplicateVideo({ videoId });
      }
      clearSelection();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Duplicate failed.");
    } finally {
      setBulkBusy(null);
    }
  };

  const handleBulkMove = async (
    destinationFolderId: Id<"folders"> | null,
  ) => {
    const ids = Array.from(selectedVideoIds);
    if (ids.length === 0) return;
    for (const videoId of ids) {
      await moveVideoToFolder({
        videoId,
        folderId: destinationFolderId ?? undefined,
      });
    }
    clearSelection();
  };

  const handleUpdateWorkflowStatus = useCallback(
    async (videoId: Id<"videos">, workflowStatus: VideoWorkflowStatus) => {
      try {
        await updateVideoWorkflowStatus({ videoId, workflowStatus });
      } catch (error) {
        console.error("Failed to update video workflow status:", error);
      }
    },
    [updateVideoWorkflowStatus],
  );

  // Right-click context-menu items for a video tile. When the tile is part of a
  // multi-selection, the actions apply to the whole selection (reusing the
  // existing bulk handlers); otherwise they act on the single item.
  const buildVideoMenu = (
    video: { _id: Id<"videos">; title: string },
    canDownload: boolean,
  ): ContextMenuEntry[] => {
    if (!project) return [];
    const inSelection = selectedVideoIds.has(video._id);
    const multi = inSelection && selectedVideoIds.size > 1;
    const n = selectedVideoIds.size;
    const open = () =>
      navigate({ to: videoPath(resolvedTeamSlug, project._id, video._id) });

    if (multi) {
      return [
        {
          label: `Download ${n}`,
          icon: <Download className="h-4 w-4" />,
          onSelect: () => void handleBulkDownload(),
        },
        {
          label: `Duplicate ${n}`,
          icon: <Copy className="h-4 w-4" />,
          onSelect: () => void handleBulkDuplicate(),
        },
        {
          label: `Move ${n}…`,
          icon: <FolderInput className="h-4 w-4" />,
          onSelect: () => setMoveOpen(true),
        },
        {
          label: `Rename ${n}…`,
          icon: <Pencil className="h-4 w-4" />,
          onSelect: () => setBulkRenameOpen(true),
        },
        {
          label: "Edit metadata…",
          icon: <Tags className="h-4 w-4" />,
          onSelect: () => setBulkMetaOpen(true),
        },
        { type: "separator" },
        {
          label: `Move ${n} to trash`,
          icon: <Trash2 className="h-4 w-4" />,
          danger: true,
          onSelect: () => void handleBulkDelete(),
        },
      ];
    }

    return [
      { label: "Open", icon: <Eye className="h-4 w-4" />, onSelect: open },
      ...(canDownload
        ? [
            {
              label: "Download",
              icon: <Download className="h-4 w-4" />,
              onSelect: () => void handleDownloadVideo(video._id, video.title),
            } as ContextMenuEntry,
          ]
        : []),
      {
        label: "Duplicate",
        icon: <Copy className="h-4 w-4" />,
        onSelect: () => void duplicateVideo({ videoId: video._id }),
      },
      {
        label: "Move…",
        icon: <FolderInput className="h-4 w-4" />,
        onSelect: () => {
          setSelectedVideoIds(new Set([video._id]));
          setMoveOpen(true);
        },
      },
      {
        label: "Rename…",
        icon: <Pencil className="h-4 w-4" />,
        onSelect: () => {
          setSelectedVideoIds(new Set([video._id]));
          setBulkRenameOpen(true);
        },
      },
      {
        label: "Edit metadata…",
        icon: <Tags className="h-4 w-4" />,
        onSelect: () => {
          setSelectedVideoIds(new Set([video._id]));
          setBulkMetaOpen(true);
        },
      },
      { type: "separator" },
      {
        label: "Mark needs review",
        onSelect: () => void handleUpdateWorkflowStatus(video._id, "review"),
      },
      {
        label: "Mark rework",
        onSelect: () => void handleUpdateWorkflowStatus(video._id, "rework"),
      },
      {
        label: "Mark done",
        onSelect: () => void handleUpdateWorkflowStatus(video._id, "done"),
      },
      { type: "separator" },
      {
        label: "Move to trash",
        icon: <Trash2 className="h-4 w-4" />,
        danger: true,
        onSelect: () => void handleDeleteVideo(video._id),
      },
    ];
  };

  const showShareToast = useCallback((tone: ShareToastState["tone"], message: string) => {
    setShareToast({ tone, message });
    if (shareToastTimeoutRef.current !== null) {
      window.clearTimeout(shareToastTimeoutRef.current);
    }
    shareToastTimeoutRef.current = window.setTimeout(() => {
      setShareToast(null);
      shareToastTimeoutRef.current = null;
    }, 2400);
  }, []);

  // One-click "share whole project" — creates a fresh project-scoped
  // bundle, wraps it in a default share link (no paywall, downloads
  // off, no expiry), copies the URL to the clipboard, and surfaces a
  // toast. The "set advanced options" flow is still per-video / per-
  // folder; this is the quick-grab affordance the project root has
  // been missing.
  const createProjectBundle = useMutation(api.shareBundles.createForProject);
  const createShareLinkForProject = useMutation(api.shareLinks.create);
  const [isSharingProject, setIsSharingProject] = useState(false);
  const handleShareProject = useCallback(async () => {
    if (!resolvedProjectId || isSharingProject) return;
    setIsSharingProject(true);
    try {
      const bundleId = await createProjectBundle({
        projectId: resolvedProjectId,
      });
      const { token } = await createShareLinkForProject({
        bundleId,
        allowDownload: false,
      });
      const url = `${window.location.origin}/share/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        showShareToast("success", "Project share link copied");
      } catch {
        showShareToast("error", `Share link: ${url}`);
      }
    } catch (err) {
      console.error("Failed to share project", err);
      showShareToast(
        "error",
        err instanceof Error ? err.message : "Couldn't share project",
      );
    } finally {
      setIsSharingProject(false);
    }
  }, [
    createProjectBundle,
    createShareLinkForProject,
    isSharingProject,
    resolvedProjectId,
    showShareToast,
  ]);

  const handleShareVideo = useCallback(
    async (video: {
      _id: Id<"videos">;
      publicId?: string;
      status: string;
      visibility: "public" | "private";
    }) => {
      const canSharePublicly =
        Boolean(video.publicId) &&
        video.status === "ready" &&
        video.visibility === "public";
      const path = canSharePublicly
        ? `/watch/${video.publicId}`
        : videoPath(resolvedTeamSlug, projectId, video._id);
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}${path}`;

      try {
        const copied = await copyTextToClipboard(url);
        if (!copied) {
          showShareToast("error", "Could not copy link");
          return;
        }
        showShareToast(
          "success",
          canSharePublicly
            ? "Share link copied"
            : "Video link copied (public watch link not available yet)",
        );
      } catch {
        showShareToast("error", "Could not copy link");
      }
    },
    [projectId, resolvedTeamSlug, showShareToast],
  );

  // Apply search + sort client-side. The query already scopes by
  // folderId, so we're only filtering by title and reordering.
  // NOTE: these useMemo calls must stay above the early-return guards
  // below — React requires the same hook order on every render.
  const filteredVideos = useMemo(() => {
    if (!videos) return videos;
    const q = search.trim().toLowerCase();
    const filtered = q
      ? videos.filter((v) => v.title.toLowerCase().includes(q))
      : videos.slice();
    filtered.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.title.localeCompare(b.title);
        case "oldest":
          return a._creationTime - b._creationTime;
        case "type":
          return (a.contentType ?? "").localeCompare(b.contentType ?? "");
        case "size":
          return (b.fileSize ?? 0) - (a.fileSize ?? 0);
        case "newest":
        default:
          return b._creationTime - a._creationTime;
      }
    });
    return filtered;
  }, [videos, search, sort]);

  // Single source of truth for modifier-click selection. Cmd/Ctrl toggles
  // a single item. Shift extends the range from the last clicked item.
  // The order used for "range" is the current visual order in filteredVideos
  // so the selection feels natural regardless of sort.
  const handleSelectionToggle = useCallback(
    (
      videoId: Id<"videos">,
      modifiers: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
    ) => {
      const orderedIds = filteredVideos?.map((v) => v._id) ?? [];

      if (modifiers.shiftKey && lastClickedVideoId) {
        const start = orderedIds.indexOf(lastClickedVideoId);
        const end = orderedIds.indexOf(videoId);
        if (start === -1 || end === -1) return;
        const [lo, hi] = start <= end ? [start, end] : [end, start];
        const range = orderedIds.slice(lo, hi + 1);
        setSelectedVideoIds((prev) => {
          const next = new Set(prev);
          for (const id of range) next.add(id);
          return next;
        });
        return;
      }

      setSelectedVideoIds((prev) => {
        const next = new Set(prev);
        if (next.has(videoId)) {
          next.delete(videoId);
        } else {
          next.add(videoId);
        }
        return next;
      });
      setLastClickedVideoId(videoId);
    },
    [filteredVideos, lastClickedVideoId],
  );

  const selectedVideoIdsArray = useMemo(
    () => Array.from(selectedVideoIds),
    [selectedVideoIds],
  );

  // {_id, title} for the selected videos — needed by the bulk rename preview.
  const selectedRenameItems = useMemo(
    () =>
      (filteredVideos ?? [])
        .filter((v) => selectedVideoIds.has(v._id))
        .map((v) => ({ _id: v._id, title: v.title })),
    [filteredVideos, selectedVideoIds],
  );

  const filteredFolders = useMemo(() => {
    if (!folders) return folders;
    const q = search.trim().toLowerCase();
    const filtered = q
      ? folders.filter((f) => f.name.toLowerCase().includes(q))
      : folders.slice();
    filtered.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a._creationTime - b._creationTime;
        case "newest":
          return b._creationTime - a._creationTime;
        case "name":
        case "type":
        case "size":
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return filtered;
  }, [folders, search, sort]);

  // Not found state
  if (context === null || project === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#888]">Project not found</div>
      </div>
    );
  }

  // Loading state — Convex queries return `undefined` until the first
  // result arrives. The body below assumes `project._id` exists, so we
  // bail out cleanly until it does.
  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#888]">Loading project…</div>
      </div>
    );
  }

  const canUpload = project?.role !== "viewer";

  const contractState: "none" | "draft" | "awaiting" | "signed" =
    project?.contract?.signedAt
      ? "signed"
      : project?.contract?.sentForSignatureAt
        ? "awaiting"
        : project?.contract
          ? "draft"
          : "none";

  return (
    <div className="h-full flex flex-col">
      {/* Floating selection toolbar — surfaces only when the user has
          multi-selected items. Drives the ad-hoc bundle share flow. */}
      {selectedVideoIds.size > 0 ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 border-2 border-[#1a1a1a] bg-[#1a1a1a] text-[#f0f0e8] px-4 py-2.5 shadow-[4px_4px_0px_0px_var(--shadow-color)] max-w-[95vw] flex-wrap justify-center">
          <span className="font-mono text-xs uppercase tracking-wider mr-1">
            {selectedVideoIds.size} selected
          </span>
          <button
            type="button"
            disabled={Boolean(bulkBusy)}
            onClick={() => setSelectionShareOpen(true)}
            className="px-3 py-1 border-2 border-[#f0f0e8] bg-[#FF6600] text-[#f0f0e8] font-bold text-xs uppercase tracking-wider hover:bg-[#9A3412] disabled:opacity-40"
          >
            <LinkIcon className="inline h-3.5 w-3.5 mr-1" />
            Share
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy)}
            onClick={() => void handleBulkDownload()}
            className="px-3 py-1 border-2 border-[#f0f0e8] bg-transparent text-[#f0f0e8] font-bold text-xs uppercase tracking-wider hover:bg-[#f0f0e8] hover:text-[#1a1a1a] disabled:opacity-40"
          >
            <Download className="inline h-3.5 w-3.5 mr-1" />
            {bulkBusy === "download" ? "Downloading…" : "Download"}
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy)}
            onClick={() => setMoveOpen(true)}
            className="px-3 py-1 border-2 border-[#f0f0e8] bg-transparent text-[#f0f0e8] font-bold text-xs uppercase tracking-wider hover:bg-[#f0f0e8] hover:text-[#1a1a1a] disabled:opacity-40"
          >
            <FolderInput className="inline h-3.5 w-3.5 mr-1" />
            Move
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy)}
            onClick={() => void handleBulkDuplicate()}
            className="px-3 py-1 border-2 border-[#f0f0e8] bg-transparent text-[#f0f0e8] font-bold text-xs uppercase tracking-wider hover:bg-[#f0f0e8] hover:text-[#1a1a1a] disabled:opacity-40"
          >
            <Copy className="inline h-3.5 w-3.5 mr-1" />
            {bulkBusy === "duplicate" ? "Duplicating…" : "Duplicate"}
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy)}
            onClick={() => setBulkRenameOpen(true)}
            className="px-3 py-1 border-2 border-[#f0f0e8] bg-transparent text-[#f0f0e8] font-bold text-xs uppercase tracking-wider hover:bg-[#f0f0e8] hover:text-[#1a1a1a] disabled:opacity-40"
          >
            <Pencil className="inline h-3.5 w-3.5 mr-1" />
            Rename
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy)}
            onClick={() => setBulkMetaOpen(true)}
            className="px-3 py-1 border-2 border-[#f0f0e8] bg-transparent text-[#f0f0e8] font-bold text-xs uppercase tracking-wider hover:bg-[#f0f0e8] hover:text-[#1a1a1a] disabled:opacity-40"
          >
            <Tags className="inline h-3.5 w-3.5 mr-1" />
            Metadata
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy)}
            onClick={() => void handleBulkDelete()}
            className="px-3 py-1 border-2 border-[#f0f0e8] bg-transparent text-[#f0f0e8] font-bold text-xs uppercase tracking-wider hover:bg-[#dc2626] hover:border-[#dc2626] disabled:opacity-40"
          >
            <Trash2 className="inline h-3.5 w-3.5 mr-1" />
            {bulkBusy === "delete" ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="px-3 py-1 border-2 border-[#f0f0e8]/40 bg-transparent text-[#f0f0e8] font-bold text-xs uppercase tracking-wider hover:bg-[#f0f0e8] hover:text-[#1a1a1a]"
          >
            Cancel
          </button>
        </div>
      ) : null}

      <ShareSelectionDialog
        videoIds={selectedVideoIdsArray}
        defaultName={project?.name ? `${project.name} — selection` : undefined}
        open={selectionShareOpen}
        onOpenChange={(open) => {
          setSelectionShareOpen(open);
          if (!open) clearSelection();
        }}
      />

      <MoveToFolderDialog
        projectId={project._id}
        count={selectedVideoIds.size}
        currentFolderId={currentFolderId}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        onConfirm={handleBulkMove}
      />

      <BulkRenameDialog
        open={bulkRenameOpen}
        onOpenChange={setBulkRenameOpen}
        items={selectedRenameItems}
        onDone={clearSelection}
      />

      <BulkEditMetadataDialog
        open={bulkMetaOpen}
        onOpenChange={setBulkMetaOpen}
        videoIds={selectedVideoIdsArray}
        onDone={clearSelection}
      />

      {/* Header \u2014 breadcrumb skips the team-slug stage. Single-team users
          don't need to see "Home / <team> / <project>"; for multi-team we
          have the team-switcher in the sidebar header. */}
      <DashboardHeader paths={[
        { label: project?.name ?? "\u00A0" }
      ]}>
        <div className={cn(
          "flex items-center gap-2 transition-opacity duration-300 flex-shrink-0",
          isLoadingData ? "opacity-0" : "opacity-100"
        )}>
          {resolvedProjectId ? (
            <VersionDropdown
              projectId={resolvedProjectId}
              canEdit={canUpload}
            />
          ) : null}
          {canUpload ? (
            <button
              type="button"
              onClick={() => {
                if (selectionMode) {
                  clearSelection();
                } else {
                  setSelectionMode(true);
                }
              }}
              aria-pressed={selectionMode}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 border-2 border-[#1a1a1a] text-xs font-bold uppercase tracking-wider transition-colors flex-shrink-0",
                selectionMode
                  ? "bg-[#FF6600] text-[#f0f0e8] hover:bg-[#9A3412]"
                  : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e8e8e0]",
              )}
              title={
                selectionMode
                  ? "Exit select mode"
                  : "Select multiple items for bulk actions"
              }
            >
              <CheckSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {selectionMode ? "Done" : "Select"}
              </span>
            </button>
          ) : null}
          {currentFolderId && canUpload ? (
            <button
              type="button"
              onClick={() => setFolderShareOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] text-xs font-bold uppercase tracking-wider hover:bg-[#e8e8e0] transition-colors flex-shrink-0"
              title="Share this folder & everything in it"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Share folder</span>
            </button>
          ) : null}
          {!currentFolderId && canUpload && resolvedProjectId ? (
            <button
              type="button"
              onClick={() => void handleShareProject()}
              disabled={isSharingProject}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] text-xs font-bold uppercase tracking-wider hover:bg-[#e8e8e0] disabled:opacity-50 transition-colors flex-shrink-0"
              title="Share the whole project — every file in every folder. Link is copied to your clipboard."
            >
              <Share2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {isSharingProject ? "Creating…" : "Share project"}
              </span>
            </button>
          ) : null}
          {resolvedProjectId && canUpload ? (
            <ProjectAddButton
              projectId={resolvedProjectId}
              currentFolderId={currentFolderId}
              onAddFiles={openFilePicker}
              contractHref={`/dashboard/${resolvedTeamSlug}/${resolvedProjectId}/contract`}
              contractState={contractState}
            />
          ) : null}
        </div>
      </DashboardHeader>

      {currentFolderId ? (
        <ShareFolderDialog
          folderId={currentFolderId}
          open={folderShareOpen}
          onOpenChange={setFolderShareOpen}
        />
      ) : null}

      {/* Hidden file input opened by the Add \u2192 Add files action. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleHiddenInputChange}
        className="hidden"
      />

      {resolvedProjectId ? (
        <ProjectToolbar
          teamSlug={resolvedTeamSlug}
          projectId={resolvedProjectId}
          currentFolderId={currentFolderId}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sort={sort}
          onSortChange={setSort}
          search={search}
          onSearchChange={setSearch}
          onDropVideoOnBreadcrumb={(videoId, targetFolderId) =>
            void handleMoveVideo(videoId, targetFolderId)
          }
          onDropFolderOnBreadcrumb={(folderId, targetFolderId) =>
            void handleMoveFolder(folderId, targetFolderId)
          }
        />
      ) : null}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {!isLoadingData &&
        videos.length === 0 &&
        (folders?.length ?? 0) === 0 ? (
          <div className="h-full flex items-center justify-center p-6 animate-in fade-in duration-300">
            <DropZone
              onFilesSelected={handleFilesSelected}
              disabled={!canUpload}
              className="max-w-xl w-full"
            />
          </div>
        ) : viewMode === "kanban" ? (
          <div
            className={cn(
              "p-6 transition-opacity duration-300",
              isLoadingData ? "opacity-0" : "opacity-100",
            )}
          >
            <VideoKanban
              teamSlug={resolvedTeamSlug}
              projectId={project._id}
              videos={(filteredVideos ?? []).map((v) => ({
                _id: v._id,
                _creationTime: v._creationTime,
                title: v.title,
                description: v.description,
                uploaderName: v.uploaderName,
                duration: v.duration,
                thumbnailUrl: v.thumbnailUrl,
                status: v.status,
                workflowStatus: v.workflowStatus,
                commentCount: v.commentCount,
              }))}
              canEdit={canUpload}
            />
          </div>
        ) : viewMode === "grid" ? (
          /* Grid View - Responsive tiles */
          <div className={cn(
            "transition-opacity duration-300",
            isLoadingData ? "opacity-0" : "opacity-100"
          )}>
            <FolderRow
              teamSlug={resolvedTeamSlug}
              projectId={project._id}
              folders={filteredFolders ?? []}
              canEdit={canUpload}
              onDropVideo={(videoId, folderId) =>
                void handleMoveVideo(videoId, folderId)
              }
              onDropFolder={(droppedId, targetId) =>
                void handleMoveFolder(droppedId, targetId)
              }
            />
            {/* Contracts share folder-tile styling and sit alongside
                them as the project's organizational/metadata strip.
                Hidden when empty AND the viewer can't create one. */}
            {currentFolderId === null && (
              <ContractListSection
                projectId={project._id}
                teamSlug={resolvedTeamSlug}
                canEdit={canUpload}
              />
            )}
            <div className="px-6 pt-4 pb-6">
              {(filteredFolders?.length ?? 0) > 0 ? (
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-2">
                  Files
                </div>
              ) : null}
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {/* The contract (legacy embedded + new multi-contracts) now
                  renders in the folder-styled ContractListSection above
                  the FolderRow. Keeping the file grid pure files. */}
              {filteredVideos?.map((video) => {
                // Non-video assets (PDF, docs, images, source files) take
                // a separate Drive-style tile — no thumbnail, no
                // playback, just a big file-type icon and a download
                // affordance. Detection: a "video" without a Mux playback
                // ID after processing finished is, by definition, not a
                // playable video.
                const isPlayableVideo =
                  Boolean(video.muxPlaybackId) ||
                  (video.contentType?.startsWith("video/") ?? false) ||
                  video.status === "uploading" ||
                  video.status === "processing";
                if (!isPlayableVideo) {
                  const hasFocusedView = computeHasFocusedView(video.contentType);
                  return (
                    <FileTile
                      key={video._id}
                      videoId={video._id}
                      title={video.title}
                      contentType={video.contentType}
                      fileSize={video.fileSize}
                      uploaderName={video.uploaderName}
                      createdAt={video._creationTime}
                      status={video.status}
                      canDelete={canUpload}
                      draggable={canUpload}
                      onDelete={() => handleDeleteVideo(video._id)}
                      onOpen={
                        hasFocusedView
                          ? () =>
                              navigate({
                                to: videoPath(
                                  resolvedTeamSlug,
                                  project._id,
                                  video._id,
                                ),
                              })
                          : undefined
                      }
                    />
                  );
                }

                const thumbnailSrc = video.thumbnailUrl?.startsWith("http")
                  ? video.thumbnailUrl
                  : undefined;
                const canDownload = Boolean(video.s3Key) && video.status !== "failed" && video.status !== "uploading";
                const watchingCount =
                  projectPresenceCounts?.counts?.[video._id] ?? 0;

                return (
                  <ContextMenu
                    key={video._id}
                    items={() => buildVideoMenu(video, canDownload)}
                  >
                  <VideoIntentTarget
                    className="group cursor-pointer flex flex-col"
                    teamSlug={resolvedTeamSlug}
                    projectId={project._id}
                    videoId={video._id}
                    muxPlaybackId={video.muxPlaybackId}
                    draggable={canUpload}
                    selected={selectedVideoIds.has(video._id)}
                    selectionMode={selectionMode}
                    onSelectToggle={(mods) =>
                      handleSelectionToggle(video._id, mods)
                    }
                    onOpen={() =>
                      navigate({
                        to: videoPath(resolvedTeamSlug, project._id, video._id),
                      })
                    }
                  >
                    <div className="relative aspect-video bg-[#e8e8e0] overflow-hidden border-2 border-[#1a1a1a] shadow-[4px_4px_0px_0px_var(--shadow-color)] group-hover:translate-y-[2px] group-hover:translate-x-[2px] group-hover:shadow-[2px_2px_0px_0px_var(--shadow-color)] transition-all">
                      {thumbnailSrc ? (
                        <img
                          src={thumbnailSrc}
                          alt={video.title}
                          className="object-cover w-full h-full"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Play className="h-10 w-10 text-[#888]" />
                        </div>
                      )}
                    {video.status === "ready" && video.duration && (
                      <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[11px] font-mono px-1.5 py-0.5">
                        {formatDuration(video.duration)}
                      </div>
                    )}
                    {video.status !== "ready" && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <span className="text-white text-xs font-bold uppercase tracking-wider">
                          {video.status === "uploading" && "Uploading..."}
                          {video.status === "processing" && "Processing..."}
                          {video.status === "failed" && "Failed"}
                        </span>
                      </div>
                    )}
                    {/* Hover menu */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          asChild
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center bg-black/60 hover:bg-black/80 text-white"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canDownload && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDownloadVideo(
                                  video._id,
                                  video.title,
                                );
                              }}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              Download
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleShareVideo(video);
                            }}
                          >
                            <LinkIcon className="mr-2 h-4 w-4" />
                            Share
                          </DropdownMenuItem>
                          {canUpload && (
                            <DropdownMenuItem
                              className="text-[#dc2626] focus:text-[#dc2626]"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteVideo(video._id);
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="mt-2.5">
                    <p className="text-[15px] text-[#1a1a1a] font-black truncate leading-tight">
                      {video.title}
                    </p>
                    <div className="mt-1.5 flex items-center gap-3">
                      <VideoWorkflowStatusControl
                        status={video.workflowStatus}
                        stopPropagation
                        disabled={!canUpload}
                        onChange={(workflowStatus) =>
                          void handleUpdateWorkflowStatus(video._id, workflowStatus)
                        }
                      />
                      {video.commentCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#888]">
                          <MessageSquare className="h-3 w-3" />
                          {video.commentCount}
                        </span>
                      )}
                      {watchingCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[#1a1a1a]">
                          <Eye className="h-3 w-3" />
                          {watchingCount}
                        </span>
                      )}
                      <span className="text-[11px] text-[#888] ml-auto font-mono">
                        {formatRelativeTime(video._creationTime)}
                      </span>
                    </div>
                  </div>
                  </VideoIntentTarget>
                  </ContextMenu>
                );
              })}
              </div>
            </div>
          </div>
        ) : (
          /* List View - Horizontal rows */
          <div className={cn(
            "transition-opacity duration-300",
            isLoadingData ? "opacity-0" : "opacity-100"
          )}>
            <FolderRow
              teamSlug={resolvedTeamSlug}
              projectId={project._id}
              folders={filteredFolders ?? []}
              canEdit={canUpload}
              onDropVideo={(videoId, folderId) =>
                void handleMoveVideo(videoId, folderId)
              }
              onDropFolder={(droppedId, targetId) =>
                void handleMoveFolder(droppedId, targetId)
              }
            />
            {currentFolderId === null && (
              <ContractListSection
                projectId={project._id}
                teamSlug={resolvedTeamSlug}
                canEdit={canUpload}
              />
            )}
            <div className="divide-y-2 divide-[#1a1a1a]">
            {filteredVideos?.map((video) => {
              const isPlayableVideo =
                Boolean(video.muxPlaybackId) ||
                (video.contentType?.startsWith("video/") ?? false) ||
                video.status === "uploading" ||
                video.status === "processing";
              if (!isPlayableVideo) {
                const hasFocusedView =
                  (video.contentType?.startsWith("image/") ?? false) ||
                  video.contentType === "application/pdf";
                return (
                  <FileListRow
                    key={video._id}
                    videoId={video._id}
                    title={video.title}
                    contentType={video.contentType}
                    fileSize={video.fileSize}
                    uploaderName={video.uploaderName}
                    createdAt={video._creationTime}
                    status={video.status}
                    canDelete={canUpload}
                    draggable={canUpload}
                    onDelete={() => handleDeleteVideo(video._id)}
                    onOpen={
                      hasFocusedView
                        ? () =>
                            navigate({
                              to: videoPath(
                                resolvedTeamSlug,
                                project._id,
                                video._id,
                              ),
                            })
                        : undefined
                    }
                  />
                );
              }

              const thumbnailSrc = video.thumbnailUrl?.startsWith("http")
                ? video.thumbnailUrl
                : undefined;
              const canDownload = Boolean(video.s3Key) && video.status !== "failed" && video.status !== "uploading";
              const watchingCount =
                projectPresenceCounts?.counts?.[video._id] ?? 0;

              return (
                <ContextMenu
                  key={video._id}
                  items={() => buildVideoMenu(video, canDownload)}
                >
                <VideoIntentTarget
                  className="group flex items-center gap-5 px-6 py-3 hover:bg-[#e8e8e0] cursor-pointer transition-colors"
                  teamSlug={resolvedTeamSlug}
                  projectId={project._id}
                  videoId={video._id}
                  muxPlaybackId={video.muxPlaybackId}
                  draggable={canUpload}
                  selected={selectedVideoIds.has(video._id)}
                  selectionMode={selectionMode}
                  onSelectToggle={(mods) =>
                    handleSelectionToggle(video._id, mods)
                  }
                  onOpen={() =>
                    navigate({
                      to: videoPath(resolvedTeamSlug, project._id, video._id),
                    })
                  }
                >
                  {/* Thumbnail */}
                  <div className="relative w-44 aspect-video bg-[#e8e8e0] overflow-hidden border-2 border-[#1a1a1a] shrink-0 shadow-[4px_4px_0px_0px_var(--shadow-color)] group-hover:translate-y-[2px] group-hover:translate-x-[2px] group-hover:shadow-[2px_2px_0px_0px_var(--shadow-color)] transition-all">
                    {thumbnailSrc ? (
                      <img
                        src={thumbnailSrc}
                        alt={video.title}
                        className="object-cover w-full h-full"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Play className="h-6 w-6 text-[#888]" />
                      </div>
                    )}
                    {video.status !== "ready" && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <span className="text-white text-[10px] font-bold uppercase tracking-wider">
                          {video.status === "uploading" && "Uploading..."}
                          {video.status === "processing" && "Processing..."}
                          {video.status === "failed" && "Failed"}
                        </span>
                      </div>
                    )}
                    {video.status === "ready" && video.duration && (
                      <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-mono px-1 py-0.5">
                        {formatDuration(video.duration)}
                      </div>
                    )}
                  </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-black text-[#1a1a1a] truncate">
                    {video.title}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    <VideoWorkflowStatusControl
                      status={video.workflowStatus}
                      stopPropagation
                      disabled={!canUpload}
                      onChange={(workflowStatus) =>
                        void handleUpdateWorkflowStatus(video._id, workflowStatus)
                      }
                    />
                    {video.commentCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-[#888]">
                        <MessageSquare className="h-3.5 w-3.5" />
                        {video.commentCount}
                      </span>
                    )}
                    {watchingCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-[#1a1a1a]">
                        <Eye className="h-3.5 w-3.5" />
                        {watchingCount}
                      </span>
                    )}
                    <span className="text-xs text-[#888] font-mono">
                      {formatRelativeTime(video._creationTime)}
                    </span>
                    {video.uploaderName && (
                      <span className="text-xs text-[#888]">
                        {video.uploaderName}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      asChild
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center text-[#888] hover:text-[#1a1a1a]"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canDownload && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDownloadVideo(video._id, video.title);
                          }}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleShareVideo(video);
                        }}
                      >
                        <LinkIcon className="mr-2 h-4 w-4" />
                        Share
                      </DropdownMenuItem>
                      {canUpload && (
                        <DropdownMenuItem
                          className="text-[#dc2626] focus:text-[#dc2626]"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteVideo(video._id);
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                </VideoIntentTarget>
                </ContextMenu>
              );
            })}
            </div>
          </div>
        )}
        {/* Timeline history used to live here as a panel under the grid.
            Pulled out so each file owns its own per-file version dropdown
            in its top bar (Google-Docs style). */}
      </div>

      {shareToast ? (
        <div className="fixed right-4 top-4 z-50" aria-live="polite">
          <div
            className={cn(
              "border-2 px-3 py-2 text-sm font-bold shadow-[4px_4px_0px_0px_var(--shadow-color)]",
              shareToast.tone === "success"
                ? "border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a]"
                : "border-[#dc2626] bg-[#fef2f2] text-[#dc2626]",
            )}
          >
            {shareToast.message}
          </div>
        </div>
      ) : null}
    </div>
  );
}
