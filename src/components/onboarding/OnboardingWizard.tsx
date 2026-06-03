import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check, HardDrive, Upload } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { projectPath } from "@/lib/routes";
import { useIsDesktop } from "@/lib/useIsDesktop";

/**
 * First-run onboarding. Deliberately SHORT (3 screens) and value-first: the
 * goal is to get a new user from "signed in" to "a workspace with a project,
 * ready for their first clip" with the fewest inputs possible. Mounted by the
 * dashboard index when the user has zero teams.
 *
 * Surface-aware: inside the desktop shell (window.snipDesktop) the payoff step
 * leads with the local drive — the desktop's superpower — instead of browser
 * upload. The same component therefore serves the web first-sign-in, the
 * desktop first-launch, and the post-signup (marketing funnel) moment.
 *
 * The parent keeps this mounted via its own `open` flag until `onComplete`
 * fires — we can't gate on `teams.length === 0`, because step 1 creates a team
 * and would otherwise unmount the wizard out from under the user.
 */

const SNIP = (
  <>
    snip<span className="text-[#C2410C]">.</span>
  </>
);

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Convex wraps thrown ConvexErrors; surface the readable tail.
  const m = msg.match(/message"?:\s*"?([^"}]+)/);
  return (m?.[1] || msg || "Something went wrong — try again.").slice(0, 160);
}

function WizardField({
  label,
  value,
  onChange,
  onEnter,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block text-left">
      <span className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-[#888]">
        {label}
      </span>
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          }
        }}
        placeholder={placeholder}
        className="w-full border-2 border-[#1a1a1a] bg-white px-4 py-3 text-base text-[#1a1a1a] placeholder:text-[#bbb] focus:border-[#C2410C] focus:outline-none"
      />
    </label>
  );
}

export function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const createTeam = useMutation(api.teams.create);
  const createProject = useMutation(api.projects.create);

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [workspace, setWorkspace] = useState("");
  const [projectName, setProjectName] = useState("First project");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<{ teamId: Id<"teams">; slug: string } | null>(
    null,
  );
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null);

  const submitWorkspace = async () => {
    const name = workspace.trim();
    if (!name) {
      setError("Give your workspace a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createTeam({ name });
      setTeam(created);
      setStep(1);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitProject = async (skip = false) => {
    if (!team) return;
    if (skip) {
      setStep(2);
      return;
    }
    const name = projectName.trim() || "First project";
    setBusy(true);
    setError(null);
    try {
      const pid = await createProject({ teamId: team.teamId, name });
      setProjectId(pid as Id<"projects">);
      setStep(2);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    onComplete();
    if (team && projectId) {
      navigate({ to: projectPath(team.slug, projectId) });
    } else {
      navigate({ to: "/dashboard" });
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#f0f0e8] p-6 animate-in fade-in duration-300">
      <div className="w-full max-w-md">
        {/* brand + progress */}
        <div className="mb-6 flex items-center justify-between">
          <span className="text-xl font-black tracking-tight text-[#1a1a1a]">
            {SNIP}
          </span>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={
                  "h-1.5 w-6 " +
                  (i <= step ? "bg-[#C2410C]" : "bg-[#d8d8d0]")
                }
              />
            ))}
          </div>
        </div>

        <div className="border-2 border-[#1a1a1a] bg-[#f0f0e8] p-8 shadow-[4px_4px_0px_0px_#1a1a1a]">
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-3xl font-black leading-tight tracking-tight text-[#1a1a1a]">
                  Welcome to {SNIP}
                </h1>
                <p className="mt-2 text-sm text-[#666]">
                  Name your workspace and you're in. It's where your projects,
                  reviews, and clients live.
                </p>
              </div>
              <WizardField
                label="Workspace name"
                value={workspace}
                onChange={setWorkspace}
                onEnter={() => void submitWorkspace()}
                placeholder="Acme Films"
                autoFocus
              />
              {error ? (
                <p className="text-sm text-[#C2410C]">{error}</p>
              ) : null}
              <Button
                className="w-full"
                onClick={() => void submitWorkspace()}
                disabled={busy}
              >
                {busy ? "Creating…" : "Continue"}
                {!busy && <ArrowRight className="ml-1.5 h-4 w-4" />}
              </Button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-3xl font-black leading-tight tracking-tight text-[#1a1a1a]">
                  Your first project
                </h1>
                <p className="mt-2 text-sm text-[#666]">
                  Projects hold your clips and review threads. You can rename or
                  add more anytime.
                </p>
              </div>
              <WizardField
                label="Project name"
                value={projectName}
                onChange={setProjectName}
                onEnter={() => void submitProject()}
                placeholder="First project"
                autoFocus
              />
              {error ? (
                <p className="text-sm text-[#C2410C]">{error}</p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => submitProject(true)}
                  disabled={busy}
                >
                  Skip
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => void submitProject()}
                  disabled={busy}
                >
                  {busy ? "Creating…" : "Continue"}
                  {!busy && <ArrowRight className="ml-1.5 h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <div className="mb-3 flex h-10 w-10 items-center justify-center border-2 border-[#1a1a1a] bg-[#FDBA74]">
                  <Check className="h-5 w-5 text-[#1a1a1a]" />
                </div>
                <h1 className="text-3xl font-black leading-tight tracking-tight text-[#1a1a1a]">
                  You're all set
                </h1>
                <p className="mt-2 text-sm text-[#666]">
                  Free workspaces include{" "}
                  <span className="font-semibold text-[#1a1a1a]">50 GB</span> —
                  no card required. Get your first clip in:
                </p>
              </div>

              {/* surface-aware payoff */}
              <div className="border-2 border-[#1a1a1a] bg-white p-4">
                {isDesktop ? (
                  <div className="flex items-start gap-3">
                    <HardDrive className="mt-0.5 h-5 w-5 shrink-0 text-[#C2410C]" />
                    <div>
                      <p className="font-semibold text-[#1a1a1a]">
                        Mount your drive
                      </p>
                      <p className="mt-0.5 text-sm text-[#666]">
                        Click{" "}
                        <span className="font-semibold text-[#1a1a1a]">
                          Enable drive
                        </span>{" "}
                        in the sidebar to mount your media locally — edit
                        straight off it, no full download.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <Upload className="mt-0.5 h-5 w-5 shrink-0 text-[#C2410C]" />
                    <div>
                      <p className="font-semibold text-[#1a1a1a]">
                        Upload a clip
                      </p>
                      <p className="mt-0.5 text-sm text-[#666]">
                        Drag a video into your project to start a review. Want a
                        local drive?{" "}
                        <a
                          href="/downloads/snip-desktop.pkg"
                          className="underline hover:text-[#1a1a1a]"
                        >
                          Get the desktop app
                        </a>
                        .
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <Button className="w-full" onClick={finish}>
                {team && projectId ? "Open project" : "Go to dashboard"}
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
