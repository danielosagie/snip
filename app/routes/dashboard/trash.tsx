import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { RotateCcw, Trash2, Briefcase, Film, FileSignature, FileText } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { contractPath, documentPath, projectPath, videoPath } from "@/lib/routes";
import { friendlyError } from "@/lib/friendlyError";
import { seoHead } from "@/lib/seo";
import {
  softButton,
  softButtonDanger,
  SoftPage,
  SoftPill,
  SoftRow,
} from "@/components/soft";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

export const Route = createFileRoute("/dashboard/trash")({
  head: () =>
    seoHead({
      title: "Recently deleted",
      description: "Restore or permanently delete trashed projects and videos.",
      path: "/dashboard/trash",
      noIndex: true,
    }),
  component: TrashRoute,
});

/**
 * "Recently deleted" page. Lists every soft-deleted project AND video
 * across the user's teams with restore + permanent-delete actions.
 *
 * Both projects and videos soft-delete to `deletedAt`; restore clears
 * that marker. Purge cascades through dependent rows (videos for a
 * project, comments + share links for a video). Videos whose parent
 * project is also trashed are hidden — restoring the project brings
 * them back automatically, so showing them separately would just
 * double-count.
 */
function TrashRoute() {
  const trashedProjects = useQuery(api.projects.listDeleted, {});
  const trashedVideos = useQuery(api.videos.listDeleted, {});
  const trashedContracts = useQuery(api.projects.listDeletedContracts, {});
  const trashedDocumentItems = useQuery(api.contractsTable.listDeleted, {});
  const restoreProject = useMutation(api.projects.restore);
  const purgeProject = useMutation(api.projects.purge);
  const restoreVideo = useMutation(api.videos.restore);
  const purgeVideo = useMutation(api.videos.purge);
  const restoreContract = useMutation(api.projects.restoreContract);
  const purgeContract = useMutation(api.projects.purgeContract);
  const restoreDocumentItem = useMutation(api.contractsTable.restore);
  const purgeDocumentItem = useMutation(api.contractsTable.purge);
  const navigate = useNavigate();
  const confirmDialog = useConfirmDialog();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const handleRestoreProject = async (
    id: Id<"projects">,
    teamSlug: string,
  ) => {
    setBusy(id);
    try {
      await restoreProject({ projectId: id });
      // Drop the user into the just-restored project so the restore
      // feels actionable rather than a list reshuffle.
      navigate({ to: projectPath(teamSlug, id) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(null);
    }
  };

  const handlePurgeProject = async (id: Id<"projects">, name: string) => {
    await confirmDialog({
      title: "Delete forever",
      description: `${name} and everything inside it will be deleted.`,
      confirmLabel: "Delete forever",
      variant: "destructive",
      action: async () => {
        setBusy(id);
        try {
          await purgeProject({ projectId: id });
        } finally {
          setBusy(null);
        }
      },
      errorMessage: (error) =>
        error instanceof Error ? error.message : "Permanent delete failed.",
    });
  };

  const handleRestoreVideo = async (
    id: Id<"videos">,
    teamSlug: string,
    projectId: Id<"projects">,
  ) => {
    setBusy(id);
    try {
      await restoreVideo({ videoId: id });
      navigate({ to: videoPath(teamSlug, projectId, id) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(null);
    }
  };

  const handlePurgeVideo = async (id: Id<"videos">, title: string) => {
    await confirmDialog({
      title: "Delete forever",
      description: `${title}, its comments, and its links will be deleted.`,
      confirmLabel: "Delete forever",
      variant: "destructive",
      action: async () => {
        setBusy(id);
        try {
          await purgeVideo({ videoId: id });
        } finally {
          setBusy(null);
        }
      },
      errorMessage: (error) =>
        error instanceof Error ? error.message : "Permanent delete failed.",
    });
  };

  const handleRestoreContract = async (
    id: Id<"trashedContracts">,
    teamSlug: string,
    projectId: Id<"projects">,
  ) => {
    setBusy(id);
    try {
      await restoreContract({ trashedContractId: id });
      // Drop the user into the contract editor so the restore feels
      // immediate.
      navigate({
        to: `/dashboard/${teamSlug}/${projectId}/contract`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(null);
    }
  };

  const handlePurgeContract = async (
    id: Id<"trashedContracts">,
    projectName: string,
  ) => {
    await confirmDialog({
      title: "Delete forever",
      description: `${projectName}'s contract will be permanently deleted.`,
      confirmLabel: "Delete forever",
      variant: "destructive",
      action: async () => {
        setBusy(id);
        try {
          await purgeContract({ trashedContractId: id });
        } finally {
          setBusy(null);
        }
      },
      errorMessage: (error) =>
        error instanceof Error ? error.message : "Permanent delete failed.",
    });
  };

  const handleRestoreDocumentItem = async (item: {
    id: Id<"contracts">;
    docType: "contract" | "document";
    teamSlug: string;
    projectId: Id<"projects">;
  }) => {
    setBusy(item.id);
    try {
      await restoreDocumentItem({ contractId: item.id });
      navigate({
        to:
          item.docType === "document"
            ? documentPath(item.teamSlug, item.projectId, item.id)
            : contractPath(item.teamSlug, item.projectId, item.id),
      });
    } catch (error) {
      toast.error(friendlyError(error, "Restore failed."));
    } finally {
      setBusy(null);
    }
  };

  const handlePurgeDocumentItem = async (
    id: Id<"contracts">,
    title: string,
  ) => {
    await confirmDialog({
      title: "Delete forever",
      description: `${title} will be permanently deleted.`,
      confirmLabel: "Delete forever",
      variant: "destructive",
      action: async () => {
        setBusy(id);
        try {
          await purgeDocumentItem({ contractId: id });
        } finally {
          setBusy(null);
        }
      },
      errorMessage: (error) => friendlyError(error, "Permanent delete failed."),
    });
  };

  // Merge projects + videos + contracts into one chronological feed
  // so the user sees "most recently deleted" first regardless of type.
  type Row =
    | {
        kind: "project";
        id: Id<"projects">;
        name: string;
        teamSlug: string;
        teamName: string;
        deletedAt: number;
        deletedByName?: string;
      }
    | {
        kind: "video";
        id: Id<"videos">;
        title: string;
        teamSlug: string;
        teamName: string;
        projectId: Id<"projects">;
        projectName: string;
        deletedAt: number;
        deletedByName?: string;
        thumbnailUrl?: string;
      }
    | {
        kind: "contract";
        id: Id<"trashedContracts">;
        teamSlug: string;
        teamName: string;
        projectId: Id<"projects">;
        projectName: string;
        clientName?: string;
        deletedAt: number;
        deletedByName?: string;
      }
    | {
        kind: "documentItem";
        id: Id<"contracts">;
        title: string;
        docType: "contract" | "document";
        teamSlug: string;
        teamName: string;
        projectId: Id<"projects">;
        projectName: string;
        deletedAt: number;
        deletedByName?: string;
      };

  const rows: Row[] = [
    ...(trashedProjects ?? []).map<Row>((p) => ({
      kind: "project",
      id: p._id,
      name: p.name,
      teamSlug: p.teamSlug,
      teamName: p.teamName,
      deletedAt: p.deletedAt,
      deletedByName: p.deletedByName,
    })),
    ...(trashedVideos ?? []).map<Row>((v) => ({
      kind: "video",
      id: v._id,
      title: v.title,
      teamSlug: v.teamSlug,
      teamName: v.teamName,
      projectId: v.projectId,
      projectName: v.projectName,
      deletedAt: v.deletedAt,
      deletedByName: v.deletedByName,
      thumbnailUrl: v.thumbnailUrl,
    })),
    ...(trashedContracts ?? []).map<Row>((c) => ({
      kind: "contract",
      id: c._id,
      teamSlug: c.teamSlug,
      teamName: c.teamName,
      projectId: c.projectId,
      projectName: c.projectName,
      clientName: c.clientName,
      deletedAt: c.deletedAt,
      deletedByName: c.deletedByName,
    })),
    ...(trashedDocumentItems ?? []).map<Row>((item) => ({
      kind: "documentItem",
      id: item._id,
      title: item.title,
      docType: item.docType,
      teamSlug: item.teamSlug,
      teamName: item.teamName,
      projectId: item.projectId,
      projectName: item.projectName,
      deletedAt: item.deletedAt,
      deletedByName: item.deletedByName,
    })),
  ].sort((a, b) => b.deletedAt - a.deletedAt);

  const isLoading =
    trashedProjects === undefined ||
    trashedVideos === undefined ||
    trashedContracts === undefined ||
    trashedDocumentItems === undefined;

  return (
    <div className="h-full flex flex-col">
      <DashboardHeader paths={[{ label: "Recently deleted" }]} />

      <SoftPage title="Recently deleted">
        <div className="max-w-3xl">
            {isLoading ? (
              <div className="text-sm text-[#6E6E73]">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="rounded-[14px] border border-[#E8E8EC] bg-white p-8 text-center text-sm leading-5 text-[#A0A0A5]">
                Deleted items appear here until you remove them forever.
              </div>
            ) : (
              <div className="rounded-[14px] border border-[#E8E8EC] bg-white px-4">
                {rows.map((row) => {
                  if (row.kind === "documentItem") {
                    const isDocument = row.docType === "document";
                    const Icon = isDocument ? FileText : FileSignature;
                    return (
                      <SoftRow key={row.id} className="flex-col sm:flex-row sm:flex-nowrap">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA]">
                          <Icon className="h-4 w-4 text-[#6E6E73]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium leading-5 text-[#131315]">
                            {row.title}
                            <SoftPill>
                              {isDocument ? "Document" : "Contract"}
                            </SoftPill>
                            <SoftPill>{row.projectName}</SoftPill>
                            <SoftPill>{row.teamName}</SoftPill>
                          </div>
                          <div className="text-[13px] leading-[18px] text-[#A0A0A5]">
                            Deleted {formatRelativeTime(row.deletedAt)}
                            {row.deletedByName ? ` by ${row.deletedByName}` : ""}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className={softButton}
                          onClick={() => void handleRestoreDocumentItem(row)}
                          disabled={busy !== null}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />
                          {busy === row.id ? "…" : "Restore"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={softButtonDanger}
                          onClick={() => void handlePurgeDocumentItem(row.id, row.title)}
                          disabled={busy !== null}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Forever
                        </Button>
                      </SoftRow>
                    );
                  }
                  if (row.kind === "contract") {
                    return (
                      <SoftRow
                        key={row.id}
                        className="flex-col sm:flex-row sm:flex-nowrap"
                      >
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA]">
                          <FileSignature className="h-4 w-4 text-[#6E6E73]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium leading-5 text-[#131315]">
                            Contract, {row.projectName}
                            <SoftPill>Contract</SoftPill>
                            <SoftPill>{row.teamName}</SoftPill>
                          </div>
                          <div className="text-[13px] leading-[18px] text-[#A0A0A5]">
                            {row.clientName ? `Client: ${row.clientName}, ` : ""}
                            Deleted {formatRelativeTime(row.deletedAt)}
                            {row.deletedByName ? ` by ${row.deletedByName}` : ""}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className={softButton}
                          onClick={() =>
                            void handleRestoreContract(
                              row.id,
                              row.teamSlug,
                              row.projectId,
                            )
                          }
                          disabled={busy !== null}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />
                          {busy === row.id ? "…" : "Restore"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={softButtonDanger}
                          onClick={() =>
                            void handlePurgeContract(row.id, row.projectName)
                          }
                          disabled={busy !== null}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Forever
                        </Button>
                      </SoftRow>
                    );
                  }
                  return row.kind === "project" ? (
                    <SoftRow
                      key={row.id}
                      className="flex-col sm:flex-row sm:flex-nowrap"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA]">
                        <Briefcase className="h-4 w-4 text-[#6E6E73]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium leading-5 text-[#131315]">
                          {row.name}
                          <SoftPill>Project</SoftPill>
                          <SoftPill>{row.teamName}</SoftPill>
                        </div>
                        <div className="text-[13px] leading-[18px] text-[#A0A0A5]">
                          Deleted {formatRelativeTime(row.deletedAt)}
                          {row.deletedByName ? ` by ${row.deletedByName}` : ""}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className={softButton}
                        onClick={() =>
                          void handleRestoreProject(row.id, row.teamSlug)
                        }
                        disabled={busy !== null}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                        {busy === row.id ? "…" : "Restore"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={softButtonDanger}
                        onClick={() => void handlePurgeProject(row.id, row.name)}
                        disabled={busy !== null}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Forever
                      </Button>
                    </SoftRow>
                  ) : (
                    <SoftRow
                      key={row.id}
                      className="flex-col sm:flex-row sm:flex-nowrap"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA]">
                        {row.thumbnailUrl ? (
                          <img
                            src={row.thumbnailUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Film className="h-4 w-4 text-[#6E6E73]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium leading-5 text-[#131315]">
                          {row.title}
                          <SoftPill>Video</SoftPill>
                          <SoftPill>{row.projectName}</SoftPill>
                          <SoftPill>{row.teamName}</SoftPill>
                        </div>
                        <div className="text-[13px] leading-[18px] text-[#A0A0A5]">
                          Deleted {formatRelativeTime(row.deletedAt)}
                          {row.deletedByName ? ` by ${row.deletedByName}` : ""}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className={softButton}
                        onClick={() =>
                          void handleRestoreVideo(
                            row.id,
                            row.teamSlug,
                            row.projectId,
                          )
                        }
                        disabled={busy !== null}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                        {busy === row.id ? "…" : "Restore"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={softButtonDanger}
                        onClick={() => void handlePurgeVideo(row.id, row.title)}
                        disabled={busy !== null}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Forever
                      </Button>
                    </SoftRow>
                  );
                })}
              </div>
            )}
        </div>
      </SoftPage>
    </div>
  );
}
