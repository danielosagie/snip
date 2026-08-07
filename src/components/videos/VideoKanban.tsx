"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { Link } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { videoPath } from "@/lib/routes";
import { formatDuration, formatRelativeTime, cn } from "@/lib/utils";
import { Clock, Eye, MessageSquare } from "lucide-react";

type WorkflowStatus = "review" | "rework" | "done";

interface VideoLike {
  _id: Id<"videos">;
  _creationTime: number;
  title: string;
  description?: string;
  uploaderName: string;
  duration?: number;
  thumbnailUrl?: string;
  status: string;
  workflowStatus: WorkflowStatus;
  commentCount?: number;
}

interface Props {
  teamSlug: string;
  projectId: Id<"projects">;
  videos: VideoLike[];
  canEdit: boolean;
}

const COLUMNS: Array<{
  status: WorkflowStatus;
  label: string;
  description: string;
  accent: string;
  background: string;
}> = [
  {
    status: "review",
    label: "In review",
    description: "Needs feedback",
    accent: "#D14E00",
    background: "#FAFAFA",
  },
  {
    status: "rework",
    label: "Needs rework",
    description: "Changes requested",
    accent: "#74521D",
    background: "#FAFAFA",
  },
  {
    status: "done",
    label: "Done",
    description: "Ready to deliver",
    accent: "#225B36",
    background: "#FAFAFA",
  },
];

export function VideoKanban({ teamSlug, projectId, videos, canEdit }: Props) {
  const updateStatus = useMutation(api.videos.updateWorkflowStatus);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<WorkflowStatus | null>(null);

  const onDragStart = useCallback(
    (videoId: Id<"videos">) => (e: React.DragEvent) => {
      if (!canEdit) return;
      setDraggingId(videoId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", videoId);
    },
    [canEdit],
  );

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
    setOverColumn(null);
  }, []);

  const onColumnDragOver = useCallback(
    (status: WorkflowStatus) => (e: React.DragEvent) => {
      if (!canEdit || !draggingId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (overColumn !== status) setOverColumn(status);
    },
    [canEdit, draggingId, overColumn],
  );

  const onColumnDrop = useCallback(
    (status: WorkflowStatus) => async (e: React.DragEvent) => {
      e.preventDefault();
      const videoId = e.dataTransfer.getData("text/plain") as Id<"videos">;
      setDraggingId(null);
      setOverColumn(null);
      if (!videoId || !canEdit) return;
      const video = videos.find((v) => v._id === videoId);
      if (!video || video.workflowStatus === status) return;
      try {
        await updateStatus({ videoId, workflowStatus: status });
      } catch (err) {
        console.error("Failed to update workflow status", err);
      }
    },
    [canEdit, updateStatus, videos],
  );

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
      {COLUMNS.map((col) => {
        const items = videos.filter((v) => v.workflowStatus === col.status);
        const isOver = overColumn === col.status;
        return (
          <div
            key={col.status}
            onDragOver={onColumnDragOver(col.status)}
            onDrop={onColumnDrop(col.status)}
            onDragLeave={() =>
              overColumn === col.status ? setOverColumn(null) : undefined
            }
            className={cn(
              "flex min-h-[300px] flex-col overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-[#FAFAFA] transition-colors",
              isOver ? "border-[#FF6600] bg-[#FFF0E6]" : "",
            )}
            style={{ background: isOver ? undefined : col.background }}
          >
            <header
              className="flex items-center justify-between border-b border-[#F1F1F3] bg-[#FAFAFA] px-3 py-2.5"
            >
              <div>
                <div className="text-sm font-semibold tracking-tight" style={{ color: col.accent }}>
                  {col.label}
                </div>
                <div className="sr-only">
                  {col.description}
                </div>
              </div>
              <div className="rounded-full bg-[#F1F1F3] px-2 py-0.5 text-xs font-medium text-[#6E6E73]">{items.length}</div>
            </header>

            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-1 py-3 text-xs text-[#A0A0A5]">
                  {canEdit ? "Drop a video here." : "No videos."}
                </div>
              ) : (
                items.map((video) => (
                  <KanbanCard
                    key={video._id}
                    teamSlug={teamSlug}
                    projectId={projectId}
                    video={video}
                    canEdit={canEdit}
                    dragging={draggingId === video._id}
                    onDragStart={onDragStart(video._id)}
                    onDragEnd={onDragEnd}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  teamSlug,
  projectId,
  video,
  canEdit,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  teamSlug: string;
  projectId: Id<"projects">;
  video: VideoLike;
  canEdit: boolean;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const isReady = video.status === "ready";
  return (
    <article
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white transition-opacity",
        dragging ? "opacity-40" : "opacity-100",
        canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default",
      )}
    >
      <Link
        to={videoPath(teamSlug, projectId, video._id)}
        className="block"
        onClick={(e) => {
          // Suppress link nav while dragging.
          if (dragging) e.preventDefault();
        }}
      >
        <div className="relative aspect-video overflow-hidden border-b border-[#E8E8EC] bg-[#0A0A0B]">
          {video.thumbnailUrl?.startsWith("http") ? (
            <img
              src={video.thumbnailUrl}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="h-full w-full bg-[#0A0A0B]" />
          )}
          {video.duration ? (
            <div className="absolute bottom-1 right-1 rounded-full bg-[#161618]/90 px-1.5 py-0.5 font-mono text-[10px] text-white">
              {formatDuration(video.duration)}
            </div>
          ) : null}
          {!isReady ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0A0A0B]/60 text-xs font-medium capitalize text-white">
              {video.status}
            </div>
          ) : null}
        </div>
        <div className="p-2.5">
          <div className="truncate text-sm font-semibold text-[#131315]">
            {video.title}
          </div>
          {video.description ? (
            <div className="mt-0.5 truncate text-xs text-[#6E6E73]">
              {video.description}
            </div>
          ) : null}
          <div className="mt-2 flex items-center gap-3 text-[11px] text-[#A0A0A5]">
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {video.uploaderName}
            </span>
            {typeof video.commentCount === "number" ? (
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {video.commentCount}
              </span>
            ) : null}
            <span className="flex items-center gap-1 ml-auto">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(video._creationTime)}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
