
import { useAuth } from "@clerk/tanstack-react-start";
import { useQuery } from "convex/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

import {
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UploadQueuePanel } from "@/components/upload/UploadQueuePanel";
import { useVideoUploadManager } from "./-useVideoUploadManager";
import { DashboardUploadProvider } from "@/lib/dashboardUploadContext";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { UploadActivityIndicator } from "@/components/UploadActivityIndicator";
import { SidebarProvider } from "@/lib/sidebarContext";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { DesktopUninstallModal } from "@/components/desktop/DesktopUninstallModal";

// The desktop shell hides the native title bar (titleBarStyle: hiddenInset),
// so we reserve a short draggable strip at the very top for the traffic lights
// to live in without colliding with the sidebar. `app-region: drag` makes the
// whole strip a window-move handle.
const DESKTOP_DRAG_REGION = {
  WebkitAppRegion: "drag",
} as unknown as CSSProperties;

function getDroppedFiles(files: FileList | null) {
  // No file-type filter. The dashboard accepts every file the user
  // can drag in — videos, source files, PDFs, .docx, images, archives,
  // anything. The upload manager + FileTile renderer already handle
  // non-video assets correctly.
  if (!files) return [];
  return Array.from(files);
}

function dragEventHasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export default function DashboardLayout() {
  const { isLoaded, userId } = useAuth();
  const location = useLocation();
  const { pathname, searchStr } = location;
  const params = useParams({ strict: false });
  const isDesktop = useIsDesktop();
  const teamSlug =
    typeof params.teamSlug === "string" ? params.teamSlug : undefined;
  const routeProjectId =
    typeof params.projectId === "string"
      ? (params.projectId as Id<"projects">)
      : undefined;
  const routeVideoId =
    typeof params.videoId === "string" ? params.videoId : undefined;
  const routeFolderId = useMemo(() => {
    const value = new URLSearchParams(searchStr).get("folder");
    return value ? (value as Id<"folders">) : undefined;
  }, [searchStr]);
  const publicPlaybackId = useQuery(
    api.videos.getPublicIdByVideoId,
    routeVideoId ? { videoId: routeVideoId } : "skip",
  );
  const uploadTargets = useQuery(
    api.projects.listUploadTargets,
    teamSlug ? { teamSlug } : {},
  );
  const {
    uploads,
    uploadFilesToProject,
    cancelUpload,
    pauseUpload,
    resumeUpload,
    retryUpload,
    dismissUpload,
  } = useVideoUploadManager();
  const [isGlobalDragActive, setIsGlobalDragActive] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const dragDepthRef = useRef(0);
  const uploadableProjectIds = useMemo(
    () => new Set((uploadTargets ?? []).map((target) => target.projectId)),
    [uploadTargets],
  );
  const canUploadToCurrentProject = routeProjectId
    ? uploadableProjectIds.has(routeProjectId)
    : false;

  const requestUpload = useCallback(
    (
      inputFiles: File[],
      preferredProjectId?: Id<"projects">,
      preferredFolderId?: Id<"folders">,
    ) => {
      // Accept anything the user dragged in. Non-video assets still
      // route through the same upload pipeline; the file renderer
      // picks an icon based on contentType / extension downstream.
      const files = inputFiles;
      if (files.length === 0) return;

      if (preferredProjectId) {
        void uploadFilesToProject(
          preferredProjectId,
          files,
          preferredFolderId,
        );
        return;
      }

      if (
        routeProjectId &&
        (canUploadToCurrentProject || uploadTargets === undefined)
      ) {
        // Global Finder/browser drops still belong to the folder currently
        // shown in the dashboard. The mutation validates that the folder is
        // part of this project before accepting it.
        void uploadFilesToProject(routeProjectId, files, routeFolderId);
        return;
      }

      if (uploadTargets && uploadTargets.length === 0) {
        window.alert("You do not have upload access to any projects.");
        return;
      }

      setPendingFiles(files);
      setProjectPickerOpen(true);
    },
    [
      canUploadToCurrentProject,
      routeProjectId,
      routeFolderId,
      uploadFilesToProject,
      uploadTargets,
    ],
  );

  const handleProjectSelected = useCallback(
    (projectId: Id<"projects">) => {
      const files = pendingFiles;
      if (!files || files.length === 0) return;

      setProjectPickerOpen(false);
      setPendingFiles(null);
      void uploadFilesToProject(projectId, files);
    },
    [pendingFiles, uploadFilesToProject],
  );

  const handleProjectPickerOpenChange = useCallback((open: boolean) => {
    setProjectPickerOpen(open);
    if (!open) {
      setPendingFiles(null);
    }
  }, []);

  // Routes where the global "drop a file to upload" overlay is
  // disabled. The contract/document editors handle their own
  // paste/drop via Tiptap, and the wizard would just swallow the file
  // anyway. Match on path suffix so any nested route counts.
  const isDropDisabledRoute =
    pathname.endsWith("/contract") ||
    pathname.includes("/contract/") ||
    pathname.includes("/doc/");

  useEffect(() => {
    const handleDragEnter = (event: DragEvent) => {
      if (isDropDisabledRoute) return;
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      const overFolder =
        event.target instanceof Element &&
        Boolean(event.target.closest('[data-snip-folder-drop-target="true"]'));
      setIsGlobalDragActive(!overFolder);
    };

    const handleDragOver = (event: DragEvent) => {
      if (isDropDisabledRoute) return;
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      const overFolder =
        event.target instanceof Element &&
        Boolean(event.target.closest('[data-snip-folder-drop-target="true"]'));
      setIsGlobalDragActive(!overFolder);
    };

    const handleDragLeave = (event: DragEvent) => {
      if (isDropDisabledRoute) return;
      if (!dragEventHasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsGlobalDragActive(false);
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (isDropDisabledRoute) return;
      if (!dragEventHasFiles(event)) return;
      const handledByTarget = event.defaultPrevented;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsGlobalDragActive(false);

      if (handledByTarget) return;

      const files = getDroppedFiles(event.dataTransfer?.files ?? null);
      if (files.length === 0) return;
      requestUpload(files);
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [requestUpload, isDropDisabledRoute]);

  const uploadContext = useMemo(
    () => ({
      requestUpload,
      uploads,
      cancelUpload,
      pauseUpload,
      resumeUpload,
      retryUpload,
      dismissUpload,
    }),
    [
      requestUpload,
      uploads,
      cancelUpload,
      pauseUpload,
      resumeUpload,
      retryUpload,
      dismissUpload,
    ],
  );
  const navigate = useNavigate();
  const isResolvingPublicPlaybackExemption =
    Boolean(isLoaded && !userId && routeVideoId) && publicPlaybackId === undefined;

  // Client-side navigation, NOT window.location: a full-page navigation
  // inside the desktop shell trips its will-navigate guard on installed
  // binaries that still trust only the legacy origin, which kicks the
  // sign-in page out to the system browser and strands the app window.
  // pushState routing never hits that guard.
  const spaNavigate = navigate as unknown as (opts: {
    to: string;
    search?: Record<string, string>;
    replace?: boolean;
  }) => void;
  useEffect(() => {
    if (!isLoaded || userId) return;
    if (typeof window === "undefined") return;

    if (routeVideoId) {
      if (publicPlaybackId === undefined) return;
      if (publicPlaybackId) {
        spaNavigate({ to: `/watch/${publicPlaybackId}`, replace: true });
        return;
      }
    }

    const redirectUrl = `${pathname}${searchStr}`;
    spaNavigate({
      to: "/sign-in",
      search: { redirect_url: redirectUrl },
      replace: true,
    });
  }, [isLoaded, userId, pathname, searchStr, routeVideoId, publicPlaybackId, spaNavigate]);

  if (!isLoaded) {
    return (
      <div className="h-full flex items-center justify-center bg-[#FAFAFA]">
        <div className="text-[#6E6E73]">Loading...</div>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="h-full flex items-center justify-center bg-[#FAFAFA]">
        <div className="text-[#6E6E73]">
          {isResolvingPublicPlaybackExemption
            ? "Checking public playback access..."
            : "Redirecting to sign in..."}
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
    <div className={cn("relative h-full flex flex-col bg-[#FAFAFA]")}>
      {isDesktop ? (
        <div
          className="h-7 w-full flex-shrink-0 bg-white"
          style={DESKTOP_DRAG_REGION}
        />
      ) : null}
      <div className="relative flex-1 flex min-h-0">
      <DashboardSidebar />
      {/* Main content */}
      <main className="flex-1 overflow-auto flex flex-col min-w-0">
        <DashboardUploadProvider value={uploadContext}>
          <Outlet />
        </DashboardUploadProvider>
      </main>

      {/* Global upload activity — surfaces drive + browser uploads in flight. */}
      <UploadActivityIndicator />

      {isGlobalDragActive && (
        <div className="pointer-events-none fixed inset-0 z-40">
          <div className="absolute inset-0 bg-[#131315]/20" />
          <div className="absolute inset-4 flex items-center justify-center rounded-[14px] border border-[#FF6600]/50 bg-[#FFF0E6]/80">
            <div className="rounded-[14px] border border-[#E8E8EC] bg-white px-5 py-4 text-center">
              <p className="text-sm font-semibold tracking-tight text-[#131315]">
                Drop files to upload
              </p>
              <p className="mt-1 text-xs text-[#6E6E73]">
                {routeProjectId
                  ? "Added to this project"
                  : "Choose a project next"}
              </p>
            </div>
          </div>
        </div>
      )}

      {uploads.length > 0 ? (
        <UploadQueuePanel
          uploads={uploads}
          onCancel={cancelUpload}
          onPause={pauseUpload}
          onResume={resumeUpload}
          onRetry={retryUpload}
          onDismiss={dismissUpload}
        />
      ) : null}

      <Dialog open={projectPickerOpen} onOpenChange={handleProjectPickerOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a project</DialogTitle>
            <DialogDescription>
              {pendingFiles?.length ? `Upload ${pendingFiles.length} file${pendingFiles.length > 1 ? "s" : ""} to:` : "Pick a project to start uploading."}
            </DialogDescription>
          </DialogHeader>
          {uploadTargets === undefined ? (
            <p className="text-sm text-[#6E6E73]">Loading projects...</p>
          ) : uploadTargets.length === 0 ? (
            <p className="text-sm text-[#6E6E73]">
              No uploadable projects found for your account.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-[11px] border border-[#E8E8EC] bg-white divide-y divide-[#F1F1F3]">
              {uploadTargets.map((target) => (
                <button
                  key={target.projectId}
                  type="button"
                  className="w-full px-4 py-3 text-left transition-colors hover:bg-[#FAFAFA]"
                  onClick={() => handleProjectSelected(target.projectId)}
                >
                  <p className="font-medium text-[#131315]">{target.projectName}</p>
                  <p className="text-xs text-[#6E6E73]">{target.teamName}</p>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
      {isDesktop ? <DesktopUninstallModal /> : null}
    </div>
    </SidebarProvider>
  );
}
