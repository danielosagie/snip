
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { DropZone } from "@/components/upload/DropZone";
import { triggerDownload } from "@/lib/download";
import { useDriveAutoRefresh } from "@/lib/useDriveAutoRefresh";
import {
  Trash2,
  Link as LinkIcon,
  Download,
  Eye,
  Share2,
  Copy,
  FolderInput,
  CheckSquare,
  Pencil,
  Tags,
} from "lucide-react";
import {
  fileKindBucketFromContent,
  type FileKindBucket,
} from "@/lib/fileTypes";
import { type ContextMenuEntry } from "@/components/ui/context-menu";
import {
  ProjectFileGrid,
  ProjectFileList,
} from "@/components/projects/ProjectFileGrid";
import {
  useStableActions,
  type ProjectTileActions,
  type ProjectVideoItem,
} from "@/components/projects/projectTileShared";
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
import { ProjectBackgroundMenu } from "@/components/projects/ProjectBackgroundMenu";
import { FolderRow } from "@/components/folders/FolderRow";
import { ContractListSection } from "@/components/contracts/ContractListSection";
import { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { videoPath, contractPath, documentPath } from "@/lib/routes";
import { prefetchHlsRuntime, prefetchMuxPlaybackManifest } from "@/lib/muxPlayback";
import { type VideoWorkflowStatus } from "@/components/videos/VideoWorkflowStatusControl";
import { useProjectData } from "./-project.data";
import { prewarmVideo } from "./-video.data";
import { useDashboardUploadContext } from "@/lib/dashboardUploadContext";
import { publicShareUrl } from "@/lib/publicUrl";
import { DashboardHeader } from "@/components/DashboardHeader";
import { ShareSelectionDialog } from "@/components/ShareSelectionDialog";
import { ShareFolderDialog } from "@/components/ShareFolderDialog";
import { MoveToFolderDialog } from "@/components/MoveToFolderDialog";
import { ProjectFileActivity } from "@/components/presence";
import { friendlyError } from "@/lib/friendlyError";

type ViewMode = ProjectViewMode;
type ShareToastState = {
  tone: "success" | "error";
  message: string;
};

const SELECTION_BAR_BUTTON =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3] disabled:pointer-events-none disabled:opacity-40";

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
  const convex = useConvex();

  const currentFolderId = folderId ?? null;

  const {
    context,
    resolvedProjectId,
    resolvedTeamSlug,
    project,
    videos,
    folders,
  } = useProjectData({ teamSlug, projectId, folderId: currentFolderId });

  // Desktop: when this project's drive-visible tree changes (files added /
  // removed / renamed / moved, or folders change), push an instant rclone
  // vfs/refresh so the mounted drive updates in Finder without waiting out the
  // dir cache. No-op in the browser.
  const driveTreeSignature = useMemo(
    () =>
      [
        ...(videos ?? []).map((v) => `${v._id}:${v.title}:${v.folderId ?? ""}`),
        ...(folders ?? []).map(
          (f) => `f:${f._id}:${f.name}:${f.parentFolderId ?? ""}`,
        ),
      ].join("|"),
    [videos, folders],
  );
  useDriveAutoRefresh(resolvedTeamSlug, project?.name, driveTreeSignature);

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
  const removeSelection = useMutation(api.folders.removeSelection);
  const createFolder = useMutation(api.folders.create);
  const createFolderWithItems = useMutation(api.folders.createWithItems);
  const createContract = useMutation(api.contractsTable.create);
  const getDownloadUrl = useAction(api.videoActions.getDownloadUrl);
  const getProxyDownloadUrl = useAction(api.videoActions.getProxyDownloadUrl);
  const requestProxies = useAction(api.videoActions.requestProxies);
  const contractDocuments = useQuery(
    api.contractsTable.list,
    resolvedProjectId ? { projectId: resolvedProjectId } : "skip",
  );

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sort, setSort] = useState<ProjectSortMode>("newest");
  const [search, setSearch] = useState("");
  // Empty set = no filter (show every kind). Otherwise show only items whose
  // coarse kind bucket is selected. Folders are always shown — a kind filter
  // narrows files, not navigation.
  const [kindFilter, setKindFilter] = useState<Set<FileKindBucket>>(
    () => new Set(),
  );
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
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<Id<"folders">>>(
    () => new Set(),
  );
  const [selectedContractIds, setSelectedContractIds] = useState<
    Set<Id<"contracts">>
  >(() => new Set());
  const [lastClickedVideoId, setLastClickedVideoId] = useState<Id<"videos"> | null>(
    null,
  );
  const [selectionShareOpen, setSelectionShareOpen] = useState(false);
  const [folderShareOpen, setFolderShareOpen] = useState(false);
  // When on, a plain click selects instead of opening — toggled by the
  // header "Select" button so the multi-select shortcuts are discoverable.
  const [selectionMode, setSelectionMode] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  // Folder id that should auto-enter inline rename — set right after a
  // background "New folder" or a drag-combine creates one, so the user can
  // name it immediately (Finder-style). Cleared once the tile consumes it.
  const [renameFolderId, setRenameFolderId] = useState<Id<"folders"> | null>(
    null,
  );
  const [bulkRenameOpen, setBulkRenameOpen] = useState(false);
  const [bulkMetaOpen, setBulkMetaOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<null | string>(null);

  const clearSelection = useCallback(() => {
    setSelectedVideoIds(new Set());
    setSelectedFolderIds(new Set());
    setSelectedContractIds(new Set());
    setLastClickedVideoId(null);
    setSelectionMode(false);
  }, []);

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

  // The scrolling content column. The windowed file grid measures its
  // viewport against this element.
  const contentScrollRef = useRef<HTMLDivElement>(null);

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

  // Download a ready Mux static-rendition proxy (smaller MP4) by its file name.
  const handleDownloadProxy = useCallback(
    async (videoId: Id<"videos">, renditionName: string, title: string) => {
      try {
        const result = await getProxyDownloadUrl({ videoId, renditionName });
        if (result?.url) {
          triggerDownload(result.url, result.filename ?? `${title}.mp4`);
        }
      } catch (error) {
        alert(error instanceof Error ? error.message : "Proxy download failed.");
      }
    },
    [getProxyDownloadUrl],
  );

  // Kick off proxy generation (costs a Mux re-encode). Default single 720p.
  const handleGenerateProxies = useCallback(
    async (videoId: Id<"videos">) => {
      try {
        await requestProxies({ videoId });
        alert("Generating a 720p proxy. It will appear here once Mux finishes.");
      } catch (error) {
        alert(error instanceof Error ? error.message : "Couldn't start proxy generation.");
      }
    },
    [requestProxies],
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

  // ─── Finder-style create + combine ─────────────────────────────────────
  // folders.create / createWithItems throw on duplicate names, so we dedup
  // client-side ("New Folder", "New Folder 2", …) against the current level
  // before calling. The name comparison is case-insensitive to match the
  // backend uniqueness rule.
  const uniqueNewFolderName = useCallback(() => {
    const base = "New Folder";
    const taken = new Set(
      (folders ?? []).map((f) => f.name.trim().toLowerCase()),
    );
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; i < 1000; i += 1) {
      const candidate = `${base} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    // Practically unreachable; fall back to a timestamp suffix.
    return `${base} ${Date.now()}`;
  }, [folders]);

  // Background "New folder": create at the current level with a deduped name,
  // then drop the user straight into the tile's inline rename.
  const handleNewFolder = useCallback(async () => {
    if (!resolvedProjectId) return;
    try {
      const newId = await createFolder({
        projectId: resolvedProjectId,
        name: uniqueNewFolderName(),
        parentFolderId: currentFolderId ?? undefined,
      });
      setRenameFolderId(newId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't create folder.");
    }
  }, [createFolder, resolvedProjectId, currentFolderId, uniqueNewFolderName]);

  // Background "New document" / "New contract" — mirrors ProjectAddButton's
  // handleAdd: create the draft, then navigate into its editor.
  const handleCreateDoc = useCallback(
    async (docType: "contract" | "document") => {
      if (!resolvedProjectId) return;
      const label = docType === "document" ? "document" : "contract";
      try {
        const contractId = await createContract({
          projectId: resolvedProjectId,
          title: `Untitled ${label}`,
          kind: docType === "document" ? "custom" : "sow",
          docType,
          contentHtml: "",
        });
        navigate({
          to:
            docType === "document"
              ? documentPath(resolvedTeamSlug, resolvedProjectId, contractId)
              : contractPath(resolvedTeamSlug, resolvedProjectId, contractId),
        });
      } catch (e) {
        alert(e instanceof Error ? e.message : `Couldn't create ${label}.`);
      }
    },
    [createContract, navigate, resolvedProjectId, resolvedTeamSlug],
  );

  // Drag-combine: dropping `draggedVideoId` onto `targetVideoId` creates a new
  // folder at the current level containing BOTH, then opens it for rename.
  const handleCombineVideos = useCallback(
    async (targetVideoId: Id<"videos">, draggedVideoId: Id<"videos">) => {
      if (!resolvedProjectId || targetVideoId === draggedVideoId) return;
      try {
        const newId = await createFolderWithItems({
          projectId: resolvedProjectId,
          parentFolderId: currentFolderId ?? undefined,
          name: uniqueNewFolderName(),
          videoIds: [targetVideoId, draggedVideoId],
        });
        setRenameFolderId(newId);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Couldn't combine into a folder.");
      }
    },
    [
      createFolderWithItems,
      resolvedProjectId,
      currentFolderId,
      uniqueNewFolderName,
    ],
  );

  // ─── Bulk actions on the multi-selection ──────────────────────────────
  // Each loops the existing single-item mutation/action. Selections are
  // small (a project grid), so a per-item loop is simpler and safer than
  // a bespoke bulk backend signature, and reuses the access checks.
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedVideoIds);
    const folderIds = Array.from(selectedFolderIds);
    const contractIds = Array.from(selectedContractIds);
    if (
      ids.length === 0 &&
      folderIds.length === 0 &&
      contractIds.length === 0
    )
      return;
    const total =
      ids.length + folderIds.length + contractIds.length;
    if (
      !confirm(
        folderIds.length > 0 || contractIds.length > 0
          ? `Delete ${total} selected item${total === 1 ? "" : "s"}? Nested folders will be removed; contained files, contracts, and documents remain recoverable in Recently deleted.`
          : `Move ${ids.length} item${ids.length === 1 ? "" : "s"} to the trash?`,
      )
    )
      return;
    setBulkBusy("delete");
    try {
      await removeSelection({
        projectId: project._id,
        videoIds: ids,
        folderIds,
        contractIds,
      });
      clearSelection();
    } catch (e) {
      alert(friendlyError(e, "Delete failed."));
    } finally {
      setBulkBusy(null);
    }
  };

  const handleBulkDownload = async () => {
    const ids = Array.from(selectedVideoIds);
    if (ids.length === 0) return;
    setBulkBusy("download");
    try {
      // Explicit generics: filteredVideos is declared below this handler,
      // so inference here is circular and collapses to unknown.
      const byId = new Map<Id<"videos">, string>(
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
    videoIds: readonly Id<"videos">[] = Array.from(selectedVideoIds),
  ) => {
    const ids = Array.from(videoIds);
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
    video: ProjectVideoItem,
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

    // Proxy (Mux static-rendition) entries — only for items with a Mux asset.
    // Show a download per ready rendition, a disabled "generating…" per pending
    // one, or a "Generate proxy" trigger when none exist yet.
    const proxyEntries: ContextMenuEntry[] = [];
    if (canDownload && video.muxAssetId) {
      const rends = video.staticRenditions ?? [];
      const ready = rends.filter((r) => r.status === "ready");
      const preparing = rends.filter((r) => r.status === "preparing");
      proxyEntries.push({ type: "separator" });
      for (const r of ready) {
        proxyEntries.push({
          label: `Download proxy (${r.resolution})`,
          icon: <Download className="h-4 w-4" />,
          onSelect: () =>
            void handleDownloadProxy(video._id, r.name, video.title),
        });
      }
      for (const r of preparing) {
        proxyEntries.push({
          label: `Proxy (${r.resolution}), generating…`,
          icon: <Download className="h-4 w-4" />,
          disabled: true,
          onSelect: () => {},
        });
      }
      if (ready.length === 0 && preparing.length === 0) {
        proxyEntries.push({
          label: "Generate proxy (720p)",
          icon: <Download className="h-4 w-4" />,
          onSelect: () => void handleGenerateProxies(video._id),
        });
      }
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
      ...proxyEntries,
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
      const url = publicShareUrl(token);
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
    async (video: ProjectVideoItem) => {
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
  // Which kind buckets actually exist in this folder — so the filter menu
  // only offers buckets with at least one item, instead of dead options.
  const availableKindBuckets = useMemo(() => {
    const present = new Set<FileKindBucket>();
    for (const v of videos ?? []) {
      present.add(fileKindBucketFromContent(v.contentType, v.title));
    }
    return present;
  }, [videos]);

  const filteredVideos = useMemo(() => {
    if (!videos) return videos;
    const q = search.trim().toLowerCase();
    let filtered = q
      ? videos.filter((v) => v.title.toLowerCase().includes(q))
      : videos.slice();
    if (kindFilter.size > 0) {
      filtered = filtered.filter((v) =>
        kindFilter.has(fileKindBucketFromContent(v.contentType, v.title)),
      );
    }
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
  }, [videos, search, sort, kindFilter]);

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

  const handleVideoDragSelectOnly = useCallback(
    (videoId: Id<"videos">) => {
      setSelectedVideoIds(new Set([videoId]));
      setSelectedFolderIds(new Set());
      setSelectedContractIds(new Set());
      setLastClickedVideoId(videoId);
    },
    [],
  );

  const handleFolderDragSelectOnly = useCallback(
    (draggedFolderId: Id<"folders">) => {
      setSelectedVideoIds(new Set());
      setSelectedFolderIds(new Set([draggedFolderId]));
      setSelectedContractIds(new Set());
      setLastClickedVideoId(null);
    },
    [],
  );

  const selectedVideoIdsArray = useMemo(
    () => Array.from(selectedVideoIds),
    [selectedVideoIds],
  );

  // Every per-tile callback, behind one reference-stable object. This is what
  // makes React.memo on the tiles actually hold: a tile's props become its own
  // data plus booleans, so a selection click re-renders the one tile that
  // changed instead of all 369. `currentSelectionIds` is a getter for the same
  // reason — the selection Set's identity must never reach a tile's props.
  const tileActions = useStableActions({
    open: (videoId) => {
      if (!resolvedProjectId) return;
      navigate({ to: videoPath(resolvedTeamSlug, resolvedProjectId, videoId) });
    },
    prewarm: (videoId, muxPlaybackId) => {
      if (!resolvedProjectId) return;
      prewarmVideo(convex, {
        teamSlug: resolvedTeamSlug,
        projectId: resolvedProjectId,
        videoId,
      });
      prefetchHlsRuntime();
      if (muxPlaybackId) prefetchMuxPlaybackManifest(muxPlaybackId);
    },
    selectToggle: (videoId, modifiers) =>
      handleSelectionToggle(videoId, modifiers),
    dragSelectOnly: handleVideoDragSelectOnly,
    currentSelectionIds: () => selectedVideoIdsArray,
    combine: (targetVideoId, draggedVideoId) =>
      void handleCombineVideos(targetVideoId, draggedVideoId),
    remove: (videoId) => void handleDeleteVideo(videoId),
    download: (videoId, title) => void handleDownloadVideo(videoId, title),
    share: (video) => void handleShareVideo(video),
    setWorkflowStatus: (videoId, status) =>
      void handleUpdateWorkflowStatus(videoId, status),
    buildMenu: (video, canDownload) => buildVideoMenu(video, canDownload),
  } satisfies ProjectTileActions);

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

  const selectedCount =
    selectedVideoIds.size +
    selectedFolderIds.size +
    selectedContractIds.size;
  const hasSelectedFolders = selectedFolderIds.size > 0;
  const hasSelectedDocuments = selectedContractIds.size > 0;
  const hasNonFileSelection =
    hasSelectedFolders || hasSelectedDocuments;

  const handleFolderSelectionToggle = useCallback(
    (folderId: Id<"folders">) => {
      setSelectedFolderIds((previous) => {
        const next = new Set(previous);
        if (next.has(folderId)) next.delete(folderId);
        else next.add(folderId);
        return next;
      });
    },
    [],
  );

  const handleContractSelectionToggle = useCallback(
    (contractId: Id<"contracts">) => {
      setSelectedContractIds((previous) => {
        const next = new Set(previous);
        if (next.has(contractId)) next.delete(contractId);
        else next.add(contractId);
        return next;
      });
    },
    [],
  );

  const selectAllVisible = useCallback(() => {
    setSelectionMode(true);
    setSelectedVideoIds(new Set((filteredVideos ?? []).map((video) => video._id)));
    setSelectedFolderIds(new Set((filteredFolders ?? []).map((folder) => folder._id)));
    const q = search.trim().toLowerCase();
    setSelectedContractIds(
      new Set(
        currentFolderId === null
          ? (contractDocuments ?? [])
              .filter((item) => !q || item.title.toLowerCase().includes(q))
              .map((item) => item._id)
          : [],
      ),
    );
  }, [contractDocuments, currentFolderId, filteredFolders, filteredVideos, project, search]);

  // Finder-style project shortcuts. They work without first clicking Select,
  // while inputs and editors retain their normal text shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select, [contenteditable='true']") ||
        target?.closest("[role='dialog']")
      ) {
        return;
      }

      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAllVisible();
        return;
      }
      if (
        event.metaKey &&
        event.key.toLowerCase() === "d" &&
        selectedVideoIds.size > 0 &&
        !hasNonFileSelection
      ) {
        event.preventDefault();
        void handleBulkDuplicate();
        return;
      }
      if (
        (event.key === "Backspace" ||
          event.key === "Delete" ||
          (event.ctrlKey && event.key.toLowerCase() === "d")) &&
        selectedCount > 0
      ) {
        event.preventDefault();
        void handleBulkDelete();
        return;
      }
      if (event.key === "Escape" && (selectionMode || selectedCount > 0)) {
        event.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    clearSelection,
    hasNonFileSelection,
    selectedCount,
    selectedVideoIds.size,
    selectionMode,
    selectAllVisible,
  ]);

  // Not found state
  if (context === null || project === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#6E6E73]">Project not found</div>
      </div>
    );
  }

  // Loading state — Convex queries return `undefined` until the first
  // result arrives. The body below assumes `project._id` exists, so we
  // bail out cleanly until it does.
  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#6E6E73]">Loading project…</div>
      </div>
    );
  }

  const canUpload = project?.role !== "viewer";

  return (
    <div className="flex h-full flex-col bg-[#FFF]] font-['Inter_Tight',system-ui,sans-serif] text-[#131315]">
      {/* Floating selection toolbar — surfaces only when the user has
          multi-selected items. Drives the ad-hoc bundle share flow. */}
      {selectionMode || selectedCount > 0 ? (
        <div className="fixed bottom-6 left-1/2 z-40 flex max-w-[95vw] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border border-[#E8E8EC] bg-white px-3 py-2 shadow-[0_8px_24px_rgba(19,19,21,0.10)]">
          <span className="mr-1 shrink-0 text-[13px] font-medium text-[#6E6E73]">
            {selectedCount} selected
          </span>
          <button
            type="button"
            disabled={Boolean(bulkBusy)}
            onClick={selectAllVisible}
            className={SELECTION_BAR_BUTTON}
          >
            Select all <span className="text-[11px] text-[#A0A0A5]">⌘A</span>
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy) || hasNonFileSelection || selectedVideoIds.size === 0}
            onClick={() => setSelectionShareOpen(true)}
            className={cn(
              SELECTION_BAR_BUTTON,
              "bg-[#131315] text-white hover:bg-[#131315] hover:opacity-85",
            )}
          >
            <LinkIcon className="inline h-3.5 w-3.5 mr-1" />
            Share
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy) || hasNonFileSelection || selectedVideoIds.size === 0}
            onClick={() => void handleBulkDownload()}
            className={SELECTION_BAR_BUTTON}
          >
            <Download className="inline h-3.5 w-3.5 mr-1" />
            {bulkBusy === "download" ? "Downloading…" : "Download"}
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy) || hasNonFileSelection || selectedVideoIds.size === 0}
            onClick={() => setMoveOpen(true)}
            className={SELECTION_BAR_BUTTON}
          >
            <FolderInput className="inline h-3.5 w-3.5 mr-1" />
            Move
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy) || hasNonFileSelection || selectedVideoIds.size === 0}
            onClick={() => void handleBulkDuplicate()}
            className={SELECTION_BAR_BUTTON}
          >
            <Copy className="inline h-3.5 w-3.5 mr-1" />
            {bulkBusy === "duplicate" ? (
              "Duplicating…"
            ) : (
              <>Duplicate <span className="text-[11px] text-[#A0A0A5]">⌘D</span></>
            )}
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy) || hasNonFileSelection || selectedVideoIds.size === 0}
            onClick={() => setBulkRenameOpen(true)}
            className={SELECTION_BAR_BUTTON}
          >
            <Pencil className="inline h-3.5 w-3.5 mr-1" />
            Rename
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy) || hasNonFileSelection || selectedVideoIds.size === 0}
            onClick={() => setBulkMetaOpen(true)}
            className={SELECTION_BAR_BUTTON}
          >
            <Tags className="inline h-3.5 w-3.5 mr-1" />
            Metadata
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy) || selectedCount === 0}
            onClick={() => void handleBulkDelete()}
            className={cn(
              SELECTION_BAR_BUTTON,
              "text-[#D8434F] hover:bg-[#FFF5F5] hover:text-[#D8434F]",
            )}
          >
            <Trash2 className="inline h-3.5 w-3.5 mr-1" />
            {bulkBusy === "delete" ? (
              "Deleting…"
            ) : (
              <>Delete <span className="text-[11px] text-[#A0A0A5]">⌘⌫</span></>
            )}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className={cn(SELECTION_BAR_BUTTON, "text-[#6E6E73]")}
          >
            Done <span className="text-[11px] text-[#A0A0A5]">Esc</span>
          </button>
        </div>
      ) : null}

      <ShareSelectionDialog
        videoIds={selectedVideoIdsArray}
        defaultName={project?.name ? `${project.name} selection` : undefined}
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
                "inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                selectionMode
                  ? "border-[#F0D2C3] bg-[#FFF0E6] text-[#D14E00] hover:bg-[#FFE8D8]"
                  : "border-[#D8D8DE] bg-white text-[#131315] hover:bg-[#F1F1F3]",
              )}
              title={
                selectionMode
                  ? "Exit select mode"
                  : "Select multiple items for bulk actions"
              }
            >
              <CheckSquare className="h-4 w-4" />
              <span className="hidden sm:inline">
                {selectionMode ? "Done" : "Select"}
              </span>
            </button>
          ) : null}
          {currentFolderId && canUpload ? (
            <button
              type="button"
              onClick={() => {
                navigator.vibrate?.(8);
                setFolderShareOpen(true);
              }}
              className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full border border-[#D8D8DE] bg-white px-3.5 text-[13px] font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3]"
              title="Share this folder & everything in it"
            >
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">Share folder</span>
            </button>
          ) : null}
          {!currentFolderId && canUpload && resolvedProjectId ? (
            <button
              type="button"
              onClick={() => void handleShareProject()}
              disabled={isSharingProject}
              className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full border border-[#D8D8DE] bg-white px-3.5 text-[13px] font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3] disabled:opacity-50"
              title="Share the whole project, every file in every folder. The link is copied to your clipboard."
            >
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">
                {isSharingProject ? "Creating…" : "Share project"}
              </span>
            </button>
          ) : null}
          {resolvedProjectId && canUpload ? (
            <ProjectAddButton
              projectId={resolvedProjectId}
              teamSlug={resolvedTeamSlug}
              currentFolderId={currentFolderId}
              onAddFiles={openFilePicker}
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
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          availableKindBuckets={availableKindBuckets}
          onDropVideoOnBreadcrumb={(videoId, targetFolderId) => {
            if (selectedVideoIds.has(videoId)) {
              void handleBulkMove(targetFolderId, [videoId]);
            } else {
              void handleMoveVideo(videoId, targetFolderId);
            }
          }}
          onDropVideosOnBreadcrumb={(videoIds, targetFolderId) =>
            void handleBulkMove(targetFolderId, videoIds)
          }
          onDropFolderOnBreadcrumb={(droppedFolderId, targetFolderId) => {
            void handleMoveFolder(droppedFolderId, targetFolderId).then(() => {
              if (selectedFolderIds.has(droppedFolderId)) clearSelection();
            });
          }}
        />
      ) : null}

      {resolvedProjectId ? (
        <ProjectFileActivity projectId={resolvedProjectId} />
      ) : null}

      {/* Content — also the scroll container the file grid windows against. */}
      <div ref={contentScrollRef} className="flex-1 overflow-auto">
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
          <ProjectBackgroundMenu
            canEdit={canUpload}
            onNewFolder={() => void handleNewFolder()}
            onUploadFiles={openFilePicker}
            onNewDocument={() => void handleCreateDoc("document")}
            onNewContract={() => void handleCreateDoc("contract")}
          >
          <div className={cn(
            "min-h-full transition-opacity duration-300",
            isLoadingData ? "opacity-0" : "opacity-100"
          )}>
            <FolderRow
              teamSlug={resolvedTeamSlug}
              projectId={project._id}
              folders={filteredFolders ?? []}
              canEdit={canUpload}
              selectedFolderIds={selectedFolderIds}
              selectionMode={selectionMode}
              onSelectToggle={(folderId) => handleFolderSelectionToggle(folderId)}
              onDragSelectOnly={handleFolderDragSelectOnly}
              onDropVideo={(videoId, folderId) => {
                if (selectedVideoIds.has(videoId)) {
                  void handleBulkMove(folderId, [videoId]);
                } else {
                  void handleMoveVideo(videoId, folderId);
                }
              }}
              onDropVideos={(videoIds, folderId) =>
                void handleBulkMove(folderId, videoIds)
              }
              onDropFolder={(droppedId, targetId) => {
                void handleMoveFolder(droppedId, targetId).then(() => {
                  if (selectedFolderIds.has(droppedId)) clearSelection();
                });
              }}
              onDropFiles={(files, targetId) =>
                requestUpload(files, project._id, targetId)
              }
              renameFolderId={renameFolderId}
              onRenameConsumed={() => setRenameFolderId(null)}
            />
            {/* Contracts share folder-tile styling and sit alongside
                them as the project's organizational/metadata strip.
                Hidden when empty AND the viewer can't create one. */}
            {currentFolderId === null && (
              <ContractListSection
                projectId={project._id}
                teamSlug={resolvedTeamSlug}
                items={contractDocuments}
                search={search}
                selectedIds={selectedContractIds}
                selectionMode={selectionMode}
                onSelectToggle={handleContractSelectionToggle}
              />
            )}
            <div className="px-6 pt-4 pb-6">
              {(filteredFolders?.length ?? 0) > 0 ? (
                <div className="mb-2 font-['Geist_Mono',system-ui,sans-serif] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
                  Files
                </div>
              ) : null}
              <ProjectFileGrid
                videos={filteredVideos ?? []}
                actions={tileActions}
                selectedVideoIds={selectedVideoIds}
                selectionMode={selectionMode}
                canEdit={canUpload}
                presenceCounts={projectPresenceCounts?.counts}
                scrollRef={contentScrollRef}
              />
            </div>
          </div>
          </ProjectBackgroundMenu>
        ) : (
          /* List View - Horizontal rows */
          <ProjectBackgroundMenu
            canEdit={canUpload}
            onNewFolder={() => void handleNewFolder()}
            onUploadFiles={openFilePicker}
            onNewDocument={() => void handleCreateDoc("document")}
            onNewContract={() => void handleCreateDoc("contract")}
          >
          <div className={cn(
            "min-h-full transition-opacity duration-300",
            isLoadingData ? "opacity-0" : "opacity-100"
          )}>
            <FolderRow
              teamSlug={resolvedTeamSlug}
              projectId={project._id}
              folders={filteredFolders ?? []}
              canEdit={canUpload}
              selectedFolderIds={selectedFolderIds}
              selectionMode={selectionMode}
              onSelectToggle={(folderId) => handleFolderSelectionToggle(folderId)}
              onDragSelectOnly={handleFolderDragSelectOnly}
              onDropVideo={(videoId, folderId) => {
                if (selectedVideoIds.has(videoId)) {
                  void handleBulkMove(folderId, [videoId]);
                } else {
                  void handleMoveVideo(videoId, folderId);
                }
              }}
              onDropVideos={(videoIds, folderId) =>
                void handleBulkMove(folderId, videoIds)
              }
              onDropFolder={(droppedId, targetId) => {
                void handleMoveFolder(droppedId, targetId).then(() => {
                  if (selectedFolderIds.has(droppedId)) clearSelection();
                });
              }}
              onDropFiles={(files, targetId) =>
                requestUpload(files, project._id, targetId)
              }
              renameFolderId={renameFolderId}
              onRenameConsumed={() => setRenameFolderId(null)}
            />
            {currentFolderId === null && (
              <ContractListSection
                projectId={project._id}
                teamSlug={resolvedTeamSlug}
                items={contractDocuments}
                search={search}
                selectedIds={selectedContractIds}
                selectionMode={selectionMode}
                onSelectToggle={handleContractSelectionToggle}
              />
            )}
            <ProjectFileList
              videos={filteredVideos ?? []}
              actions={tileActions}
              selectedVideoIds={selectedVideoIds}
              selectionMode={selectionMode}
              canEdit={canUpload}
              presenceCounts={projectPresenceCounts?.counts}
            />
          </div>
          </ProjectBackgroundMenu>
        )}
        {/* Timeline history used to live here as a panel under the grid.
            Pulled out so each file owns its own per-file version dropdown
            in its top bar (Google-Docs style). */}
      </div>

      {shareToast ? (
        <div className="fixed right-4 top-4 z-50" aria-live="polite">
          <div
            className={cn(
              "rounded-[12px] border bg-white px-3 py-2 text-[13px] font-medium shadow-[0_8px_24px_rgba(19,19,21,0.10)]",
              shareToast.tone === "success"
                ? "border-[#E8E8EC] text-[#131315]"
                : "border-[#F0D2D4] bg-[#FFF5F5] text-[#D8434F]",
            )}
          >
            {shareToast.message}
          </div>
        </div>
      ) : null}
    </div>
  );
}
