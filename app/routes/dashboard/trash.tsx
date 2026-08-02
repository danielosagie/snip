import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, Trash2, Briefcase, Film, FileSignature, FileText } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { contractPath, documentPath, projectPath, videoPath } from "@/lib/routes";
import { friendlyError } from "@/lib/friendlyError";
import { seoHead } from "@/lib/seo";

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
      alert(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(null);
    }
  };

  const handlePurgeProject = async (id: Id<"projects">, name: string) => {
    if (
      !confirm(
        `Permanently delete "${name}"? Every video, contract, and comment goes with it. This can't be undone.`,
      )
    ) {
      return;
    }
    setBusy(id);
    try {
      await purgeProject({ projectId: id });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Permanent delete failed.");
    } finally {
      setBusy(null);
    }
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
      alert(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(null);
    }
  };

  const handlePurgeVideo = async (id: Id<"videos">, title: string) => {
    if (
      !confirm(
        `Permanently delete "${title}"? Every comment and share link goes with it. This can't be undone.`,
      )
    ) {
      return;
    }
    setBusy(id);
    try {
      await purgeVideo({ videoId: id });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Permanent delete failed.");
    } finally {
      setBusy(null);
    }
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
      alert(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(null);
    }
  };

  const handlePurgeContract = async (
    id: Id<"trashedContracts">,
    projectName: string,
  ) => {
    if (
      !confirm(
        `Permanently delete the contract for "${projectName}"? This can't be undone.`,
      )
    ) {
      return;
    }
    setBusy(id);
    try {
      await purgeContract({ trashedContractId: id });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Permanent delete failed.");
    } finally {
      setBusy(null);
    }
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
      alert(friendlyError(error, "Restore failed."));
    } finally {
      setBusy(null);
    }
  };

  const handlePurgeDocumentItem = async (
    id: Id<"contracts">,
    title: string,
  ) => {
    if (!confirm(`Permanently delete “${title}”? This can't be undone.`)) return;
    setBusy(id);
    try {
      await purgeDocumentItem({ contractId: id });
    } catch (error) {
      alert(friendlyError(error, "Permanent delete failed."));
    } finally {
      setBusy(null);
    }
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

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-black tracking-tight text-[#1a1a1a]">
            Recently deleted
          </h1>
          <p className="text-sm text-[#666] mt-1 max-w-prose">
            Anything you delete lands here: projects, files, contracts, and
            documents. Restore brings it back into its project. Permanent delete
            cascades through every related row and can't be undone.
          </p>

          <div className="mt-6">
            {isLoading ? (
              <div className="text-sm text-[#888]">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="border-2 border-dashed border-[#1a1a1a] p-8 text-center text-sm text-[#888]">
                Nothing here. Deleted projects, files, contracts, and documents show up in this
                list and stay restorable until you purge them.
              </div>
            ) : (
              <div className="border-2 border-[#1a1a1a] divide-y-2 divide-[#1a1a1a]">
                {rows.map((row) => {
                  if (row.kind === "documentItem") {
                    const isDocument = row.docType === "document";
                    const Icon = isDocument ? FileText : FileSignature;
                    return (
                      <div key={row.id} className="flex items-center gap-4 px-4 py-3">
                        <div className="w-9 h-9 flex-shrink-0 bg-[#e8e8e0] border-2 border-[#1a1a1a] flex items-center justify-center">
                          <Icon className="h-4 w-4 text-[#888]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm text-[#1a1a1a] truncate flex items-center gap-2">
                            {row.title}
                            <Badge variant="secondary">
                              {isDocument ? "Document" : "Contract"}
                            </Badge>
                            <Badge variant="secondary">{row.projectName}</Badge>
                            <Badge variant="secondary">{row.teamName}</Badge>
                          </div>
                          <div className="text-xs font-mono text-[#888]">
                            Deleted {formatRelativeTime(row.deletedAt)}
                            {row.deletedByName ? ` by ${row.deletedByName}` : ""}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleRestoreDocumentItem(row)}
                          disabled={busy !== null}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />
                          {busy === row.id ? "…" : "Restore"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handlePurgeDocumentItem(row.id, row.title)}
                          disabled={busy !== null}
                          className="text-[#dc2626] hover:text-[#dc2626] hover:bg-[#fef2f2]"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Forever
                        </Button>
                      </div>
                    );
                  }
                  if (row.kind === "contract") {
                    return (
                      <div
                        key={row.id}
                        className="flex items-center gap-4 px-4 py-3"
                      >
                        <div className="w-9 h-9 flex-shrink-0 bg-[#e8e8e0] border-2 border-[#1a1a1a] flex items-center justify-center">
                          <FileSignature className="h-4 w-4 text-[#888]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm text-[#1a1a1a] truncate flex items-center gap-2">
                            Contract — {row.projectName}
                            <Badge variant="secondary">Contract</Badge>
                            <Badge variant="secondary">{row.teamName}</Badge>
                          </div>
                          <div className="text-xs font-mono text-[#888]">
                            {row.clientName ? `Client: ${row.clientName} · ` : ""}
                            Deleted {formatRelativeTime(row.deletedAt)}
                            {row.deletedByName ? ` by ${row.deletedByName}` : ""}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
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
                          onClick={() =>
                            void handlePurgeContract(row.id, row.projectName)
                          }
                          disabled={busy !== null}
                          className="text-[#dc2626] hover:text-[#dc2626] hover:bg-[#fef2f2]"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Forever
                        </Button>
                      </div>
                    );
                  }
                  return row.kind === "project" ? (
                    <div
                      key={row.id}
                      className="flex items-center gap-4 px-4 py-3"
                    >
                      <div className="w-9 h-9 flex-shrink-0 bg-[#e8e8e0] border-2 border-[#1a1a1a] flex items-center justify-center">
                        <Briefcase className="h-4 w-4 text-[#888]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-[#1a1a1a] truncate flex items-center gap-2">
                          {row.name}
                          <Badge variant="secondary">Project</Badge>
                          <Badge variant="secondary">{row.teamName}</Badge>
                        </div>
                        <div className="text-xs font-mono text-[#888]">
                          Deleted {formatRelativeTime(row.deletedAt)}
                          {row.deletedByName ? ` by ${row.deletedByName}` : ""}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
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
                        onClick={() => void handlePurgeProject(row.id, row.name)}
                        disabled={busy !== null}
                        className="text-[#dc2626] hover:text-[#dc2626] hover:bg-[#fef2f2]"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Forever
                      </Button>
                    </div>
                  ) : (
                    <div
                      key={row.id}
                      className="flex items-center gap-4 px-4 py-3"
                    >
                      <div className="w-9 h-9 flex-shrink-0 bg-[#e8e8e0] border-2 border-[#1a1a1a] flex items-center justify-center overflow-hidden">
                        {row.thumbnailUrl ? (
                          <img
                            src={row.thumbnailUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Film className="h-4 w-4 text-[#888]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-[#1a1a1a] truncate flex items-center gap-2">
                          {row.title}
                          <Badge variant="secondary">Video</Badge>
                          <Badge variant="secondary">{row.projectName}</Badge>
                          <Badge variant="secondary">{row.teamName}</Badge>
                        </div>
                        <div className="text-xs font-mono text-[#888]">
                          Deleted {formatRelativeTime(row.deletedAt)}
                          {row.deletedByName ? ` by ${row.deletedByName}` : ""}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
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
                        onClick={() => void handlePurgeVideo(row.id, row.title)}
                        disabled={busy !== null}
                        className="text-[#dc2626] hover:text-[#dc2626] hover:bg-[#fef2f2]"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Forever
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
