import { useConvex } from "convex/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus, Folder, Briefcase } from "lucide-react";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import { CreateTeamDialog } from "@/components/teams/CreateTeamDialog";
import { cn } from "@/lib/utils";
import { projectPath } from "@/lib/routes";
import { useRoutePrewarmIntent } from "@/lib/useRoutePrewarmIntent";
import { prewarmProject } from "./-project.data";
import { useDashboardIndexData } from "./-index.data";
import { Id } from "@convex/_generated/dataModel";
import { DashboardHeader } from "@/components/DashboardHeader";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardPage,
});

type FlatProject = {
  _id: Id<"projects">;
  name: string;
  videoCount: number;
  teamSlug: string;
  teamName: string;
};

function DashboardProjectCard({
  project,
  onOpen,
}: {
  project: FlatProject;
  onOpen: () => void;
}) {
  const convex = useConvex();
  const prewarmIntentHandlers = useRoutePrewarmIntent(() =>
    prewarmProject(convex, {
      teamSlug: project.teamSlug,
      projectId: project._id,
    }),
  );

  return (
    <Card
      className="group cursor-pointer hover:bg-[#e8e8e0] transition-colors"
      onClick={onOpen}
      {...prewarmIntentHandlers}
    >
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="flex-1 min-w-0">
          <CardTitle className="text-base truncate">{project.name}</CardTitle>
          <CardDescription className="mt-1">
            {project.videoCount} item{project.videoCount !== 1 ? "s" : ""}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between text-xs font-mono text-[#888] group-hover:text-[#1a1a1a] transition-colors">
          <span className="truncate">{project.teamName}</span>
          <span>open →</span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Home page. Renamed from "Dashboard" — the sidebar now shows projects
 * directly, so this page is mostly a poster-style grid of every
 * project you can reach across all your teams, plus a drop zone for
 * sharing general workspace documents.
 *
 * No kanban view, no per-team billing/manage links: those have moved
 * to the sidebar's Account section.
 *
 * Demo controls (seed/clear) only render in dev so reviewers can
 * test the seed → clear loop. Production builds hide them entirely.
 */
export default function DashboardPage() {
  const { teams } = useDashboardIndexData();
  const navigate = useNavigate({});
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const isLoading = teams === undefined;

  // Flatten teams → projects so the user just sees a single grid.
  // Teams are still a concept in the data model (for billing,
  // membership), but they're not surfaced as separate sections here.
  const flatProjects: FlatProject[] =
    teams?.flatMap((t) =>
      t.projects.map((p) => ({
        _id: p._id,
        name: p.name,
        videoCount: p.videoCount,
        teamSlug: t.slug,
        teamName: t.name,
      })),
    ) ?? [];

  // Default team to create a project in — the first team the user
  // owns. If they don't have one yet, we fall back to the team-create
  // dialog (since you need a team to hold a project under the
  // current schema).
  const defaultTeam = teams?.[0];

  const handleNewProject = () => {
    if (defaultTeam) {
      setCreateProjectOpen(true);
    } else {
      setCreateTeamOpen(true);
    }
  };

  // Empty state — user has no teams at all.
  if (teams && teams.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <DashboardHeader />
        <div className="flex-1 flex items-center justify-center p-8 animate-in fade-in duration-300">
          <Card className="max-w-sm w-full text-center">
            <CardHeader>
              <div className="mx-auto w-12 h-12 bg-[#e8e8e0] flex items-center justify-center mb-2">
                <Folder className="h-6 w-6 text-[#888]" />
              </div>
              <CardTitle className="text-lg">Create your workspace</CardTitle>
              <CardDescription>
                Spin up a workspace and start a project — collaborators get
                invited from the team page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={() => setCreateTeamOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Create workspace
              </Button>
            </CardContent>
          </Card>
        </div>
        <CreateTeamDialog
          open={createTeamOpen}
          onOpenChange={setCreateTeamOpen}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <DashboardHeader>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button onClick={handleNewProject}>
            <Plus className="mr-1.5 h-4 w-4" />
            New project
          </Button>
        </div>
      </DashboardHeader>

      <div className="flex-1 overflow-auto p-6 space-y-8">
        {/* No inline DropZone — the entire dashboard catches OS file
            drops via the layout-level handler. Drop anywhere and the
            project picker pops up if we're not already inside one. */}

        <div
          className={cn(
            "transition-opacity duration-300",
            isLoading ? "opacity-0" : "opacity-100",
          )}
        >
          <div className="flex items-center gap-2 mb-3">
            <Briefcase className="h-4 w-4 text-[#888]" />
            <h2 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#888]">
              Projects
            </h2>
          </div>
          {flatProjects.length === 0 ? (
            // Full-width dashed dropzone — matches the empty-folder
            // affordance you get inside a project. Drop files anywhere
            // on the page to upload (the layout-level handler picks
            // them up); use the button if you'd rather pick.
            <div className="border-2 border-dashed border-[#1a1a1a] bg-[#f0f0e8] flex flex-col items-center justify-center text-center px-8 py-16 min-h-[320px]">
              <div className="w-14 h-14 bg-[#e8e8e0] border-2 border-[#1a1a1a] flex items-center justify-center mb-4">
                <Folder className="h-7 w-7 text-[#888]" />
              </div>
              <h3 className="font-black text-xl tracking-tight text-[#1a1a1a]">
                No projects yet
              </h3>
              <p className="text-sm text-[#666] mt-2 max-w-md">
                Drop files anywhere on this page to upload, or start a
                project from scratch with the button above. Everything
                you upload lands in a project — projects act like
                folders for the rest of your team.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {flatProjects.map((project) => (
                <DashboardProjectCard
                  key={project._id}
                  project={project}
                  onOpen={() =>
                    navigate({
                      to: projectPath(project.teamSlug, project._id),
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <CreateTeamDialog
        open={createTeamOpen}
        onOpenChange={setCreateTeamOpen}
      />
      {defaultTeam ? (
        <CreateProjectDialog
          open={createProjectOpen}
          onOpenChange={setCreateProjectOpen}
          teamId={defaultTeam._id}
          teamSlug={defaultTeam.slug}
        />
      ) : null}
    </div>
  );
}
