"use client";

import { Link } from "@tanstack/react-router";
import { Id } from "@convex/_generated/dataModel";
import { projectPath } from "@/lib/routes";
import { ArrowRight, FileSignature, Check, Send, Folder } from "lucide-react";

export type ProjectStage =
  | "no-contract"
  | "drafting"
  | "awaiting-signature"
  | "in-production"
  | "delivered";

interface ProjectLike {
  _id: Id<"projects">;
  name: string;
  videoCount: number;
  contract?: {
    sentForSignatureAt?: number;
    signedAt?: number;
  } | null;
}

interface TeamGroup {
  _id: Id<"teams">;
  name: string;
  slug: string;
  projects: ProjectLike[];
}

interface Props {
  teams: TeamGroup[];
}

const COLUMNS: Array<{
  stage: ProjectStage;
  label: string;
  hint: string;
  accent: string;
  background: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    stage: "no-contract",
    label: "No contract",
    hint: "Start here",
    accent: "#6E6E73",
    background: "#FAFAFA",
    Icon: Folder,
  },
  {
    stage: "drafting",
    label: "Drafting",
    hint: "Contract in progress",
    accent: "#131315",
    background: "#FAFAFA",
    Icon: FileSignature,
  },
  {
    stage: "awaiting-signature",
    label: "Awaiting signature",
    hint: "Waiting on client",
    accent: "#74521D",
    background: "#FAFAFA",
    Icon: Send,
  },
  {
    stage: "in-production",
    label: "In production",
    hint: "Making deliverables",
    accent: "#D14E00",
    background: "#FAFAFA",
    Icon: Folder,
  },
  {
    stage: "delivered",
    label: "Delivered",
    hint: "Work shipped",
    accent: "#225B36",
    background: "#FAFAFA",
    Icon: Check,
  },
];

function projectStage(project: ProjectLike): ProjectStage {
  if (!project.contract) return "no-contract";
  if (project.contract.signedAt) {
    // Heuristic: a project counts as "delivered" if it has been signed AND
    // has at least one video in it. Once we wire shareLinks/payments into
    // the dashboard data, we'll upgrade this to "delivered" only when a
    // paywalled link is paid.
    if (project.videoCount > 0) return "in-production";
    return "in-production";
  }
  if (project.contract.sentForSignatureAt) return "awaiting-signature";
  return "drafting";
}

export function ProjectKanban({ teams }: Props) {
  // Flatten all projects across teams, keeping team metadata on each card.
  const flat = teams.flatMap((t) =>
    t.projects.map((p) => ({
      project: p,
      teamSlug: t.slug,
      teamName: t.name,
      stage: projectStage(p),
    })),
  );

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-5">
      {COLUMNS.map((col) => {
        const items = flat.filter((entry) => entry.stage === col.stage);
        const { Icon } = col;
        return (
          <div
            key={col.stage}
            className="flex min-h-[300px] flex-col overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-[#FAFAFA]"
            style={{ background: col.background }}
          >
            <header
              className="flex items-center justify-between border-b border-[#F1F1F3] bg-[#FAFAFA] px-3 py-2.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="h-4 w-4 flex-shrink-0 text-[#A0A0A5]" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold tracking-tight text-[#131315]">
                    {col.label}
                  </div>
                  <div className="sr-only">
                    {col.hint}
                  </div>
                </div>
              </div>
              <div className="rounded-full bg-[#F1F1F3] px-2 py-0.5 text-xs font-medium text-[#6E6E73]">{items.length}</div>
            </header>

            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-1 py-3 text-xs text-[#A0A0A5]">
                  Empty
                </div>
              ) : (
                items.map((entry) => (
                  <Link
                    key={entry.project._id}
                    to={projectPath(entry.teamSlug, entry.project._id)}
                    className="block rounded-[14px] border border-[#E8E8EC] bg-white p-2.5 transition-colors hover:bg-[#FAFAFA]"
                  >
                    <div className="truncate text-[11px] text-[#A0A0A5]">
                      {entry.teamName}
                    </div>
                    <div className="mt-0.5 truncate text-sm font-semibold text-[#131315]">
                      {entry.project.name}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-[#6E6E73]">
                      <span>
                        {entry.project.videoCount} video
                        {entry.project.videoCount === 1 ? "" : "s"}
                      </span>
                      <ArrowRight className="h-3 w-3" />
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
