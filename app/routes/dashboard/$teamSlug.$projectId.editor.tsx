import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { DashboardHeader } from "@/components/DashboardHeader";
import { TimelineEditor } from "@/components/editor/TimelineEditor";

export const Route = createFileRoute(
  "/dashboard/$teamSlug/$projectId/editor",
)({
  component: TimelineEditorRoute,
});

function TimelineEditorRoute() {
  const { teamSlug, projectId: rawProjectId } = Route.useParams();
  const projectId = rawProjectId as Id<"projects">;
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});

  if (featureStatus === undefined) {
    return <div className="p-8 font-mono text-sm">Checking flag</div>;
  }

  if (!featureStatus.demoMode) {
    return (
      <div className="flex h-full flex-col bg-[#f0f0e8] text-[#1a1a1a]">
        <DashboardHeader paths={[{ label: "Timeline editor" }]} />
        <main className="grid flex-1 place-items-center p-8">
          <section className="max-w-lg border-2 border-[#1a1a1a] bg-[#f0f0e8] p-8 shadow-[8px_8px_0_0_#1a1a1a]">
            <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#C2410C]">
              Demo feature
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight">
              Editor disabled
            </h1>
            <p className="mt-4 font-mono text-xs font-bold uppercase text-[#66665f]">
              Set DEMO_MODE
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f0f0e8]">
      <DashboardHeader
        paths={[
          {
            label: "Project",
            href: `/dashboard/${teamSlug}/${projectId}`,
          },
          { label: "Timeline editor" },
        ]}
      />
      <TimelineEditor teamSlug={teamSlug} projectId={projectId} />
    </div>
  );
}
