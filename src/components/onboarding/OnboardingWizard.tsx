import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { HardDrive, Plus, Upload } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { SnipMark } from "@/components/SnipMark";
import { projectPath } from "@/lib/routes";
import { useIsDesktop } from "@/lib/useIsDesktop";

const MAKES_OPTIONS = ["Video", "Photo", "Design", "Something else"] as const;
const SIZE_OPTIONS = ["Just me", "2 to 5", "6 to 20", "20 plus"] as const;

type MakesAnswer = (typeof MAKES_OPTIONS)[number];
type SizeAnswer = (typeof SIZE_OPTIONS)[number];
type Step = 0 | 1 | 2 | 3;

type InviteRow = {
  id: number;
  email: string;
  error?: string;
  sent?: boolean;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const primaryButtonClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#131315] px-5 text-sm font-medium text-white transition-colors hover:bg-[#2A2A2D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#131315] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-full px-4 text-sm font-medium text-[#6E6E73] transition-colors hover:text-[#131315] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#131315] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const readable =
    message.match(/Uncaught Error:\s*([^\n]+)/)?.[1] ??
    message.match(/message"?:\s*"([^"]+)/)?.[1] ??
    message;

  return (readable || "Something went wrong. Try again.")
    .replace(/^Error:\s*/, "")
    .split("\n")[0]
    .slice(0, 160);
}

function WizardField({
  label,
  value,
  onChange,
  onEnter,
  placeholder,
  autoFocus,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block text-left">
      <span className="mb-1.5 block text-[13px] font-medium leading-[18px] text-[#6E6E73]">
        {label}
      </span>
      <span className="field-shell flex min-h-11 items-center rounded-[10px] border border-[#E8E8EC] bg-white px-3 transition-[border-color,box-shadow]">
        <input
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onEnter();
            }
          }}
          placeholder={placeholder}
          className="field-bare min-w-0 flex-1 text-sm text-[#131315] placeholder:text-[#A0A0A5]"
        />
      </span>
    </label>
  );
}

function ChoiceGroup<T extends string>({
  question,
  options,
  value,
  onChange,
}: {
  question: string;
  options: readonly T[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2.5 text-sm font-medium text-[#131315]">
        {question}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option)}
              className={
                "min-h-10 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#131315] focus-visible:ring-offset-2 " +
                (selected
                  ? "border border-transparent bg-[#FFF0E6] text-[#D14E00]"
                  : "border border-[#D8D8DE] bg-white text-[#131315] hover:bg-[#FAFAFA]")
              }
            >
              {option}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ErrorMessage({ children }: { children: string }) {
  return (
    <p className="text-[13px] leading-[18px] text-[#D8434F]" role="alert">
      {children}
    </p>
  );
}

export function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const createTeam = useMutation(api.teams.create);
  const updateTeam = useMutation(api.teams.update);
  const inviteMember = useMutation(api.teams.inviteMember);
  const createProject = useMutation(api.projects.create);

  const [step, setStep] = useState<Step>(0);
  const [workspace, setWorkspace] = useState("");
  const [makes, setMakes] = useState<MakesAnswer | null>(null);
  const [size, setSize] = useState<SizeAnswer | null>(null);
  const [inviteRows, setInviteRows] = useState<InviteRow[]>([]);
  const [projectName, setProjectName] = useState("First project");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<{
    teamId: Id<"teams">;
    slug: string;
  } | null>(null);

  const openInviteStep = (teamSize: SizeAnswer | null) => {
    const rowCount = teamSize === "Just me" ? 1 : 3;
    setInviteRows(
      Array.from({ length: rowCount }, (_, id) => ({ id, email: "" })),
    );
    setError(null);
    setStep(2);
  };

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
    } catch (submissionError) {
      setError(friendlyError(submissionError));
    } finally {
      setBusy(false);
    }
  };

  const submitQuestions = async () => {
    if (!makes || !size) {
      setError("Choose an answer for both questions.");
      return;
    }
    if (!team) {
      setError("Workspace not found. Try again.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await updateTeam({
        teamId: team.teamId,
        onboarding: { makes, size },
      });
      openInviteStep(size);
    } catch (submissionError) {
      setError(friendlyError(submissionError));
    } finally {
      setBusy(false);
    }
  };

  const updateInviteRow = (id: number, email: string) => {
    setInviteRows((rows) =>
      rows.map((row) =>
        row.id === id
          ? { id: row.id, email, error: undefined, sent: false }
          : row,
      ),
    );
  };

  const submitInvites = async () => {
    if (!team) {
      setError("Workspace not found. Skip this step and try again later.");
      return;
    }

    const rowsToSend = inviteRows.filter(
      (row) => !row.sent && row.email.trim().length > 0,
    );

    if (rowsToSend.length === 0) {
      setError(null);
      setStep(3);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const results = await Promise.all(
        rowsToSend.map(async (row) => {
          const email = row.email.trim();
          if (!EMAIL_PATTERN.test(email)) {
            return { id: row.id, error: "Enter a valid email." };
          }

          try {
            await inviteMember({
              teamId: team.teamId,
              email,
              role: "member",
            });
            return { id: row.id, sent: true as const };
          } catch (inviteError) {
            return { id: row.id, error: friendlyError(inviteError) };
          }
        }),
      );

      const resultById = new Map(results.map((result) => [result.id, result]));
      const hasFailures = results.some((result) => "error" in result);

      setInviteRows((rows) =>
        rows.map((row) => {
          const result = resultById.get(row.id);
          if (!result) return row;
          if ("error" in result) {
            return { ...row, error: result.error, sent: false };
          }
          return { ...row, error: undefined, sent: true };
        }),
      );

      if (!hasFailures) setStep(3);
    } finally {
      setBusy(false);
    }
  };

  const finishProject = async () => {
    if (!team) {
      setError("Workspace not found. Go to the dashboard and try again.");
      return;
    }

    const name = projectName.trim() || "First project";
    setBusy(true);
    setError(null);
    try {
      const projectId = await createProject({ teamId: team.teamId, name });
      onComplete();
      void navigate({
        to: projectPath(team.slug, projectId as Id<"projects">),
      });
    } catch (submissionError) {
      setError(friendlyError(submissionError));
    } finally {
      setBusy(false);
    }
  };

  const goToDashboard = () => {
    onComplete();
    void navigate({ to: "/dashboard" });
  };

  const justMeWithEmptyInvite =
    size === "Just me" && inviteRows.every((row) => !row.email.trim());

  return (
    <div className="surface-soft fixed inset-0 z-[60] overflow-y-auto bg-[#FAFAFA] px-4 py-8 text-[#131315]">
      <div className="mx-auto flex min-h-full w-full max-w-[440px] flex-col justify-center">
        <div className="mb-5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <SnipMark size={28} />
            <span className="text-lg font-semibold tracking-[-0.02em] text-[#131315]">
              snip.
            </span>
          </div>
          <div
            className="flex w-28 gap-1.5"
            role="progressbar"
            aria-label={`Step ${step + 1} of 4`}
            aria-valuemin={1}
            aria-valuemax={4}
            aria-valuenow={step + 1}
          >
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                aria-hidden="true"
                className={
                  "h-1.5 flex-1 rounded-full " +
                  (index <= step ? "bg-[#FF6600]" : "bg-[#E8E8EC]")
                }
              />
            ))}
          </div>
        </div>

        <main
          className="rounded-[14px] border border-[#E8E8EC] bg-white p-8"
          style={{ boxShadow: "0 8px 24px rgba(19,19,21,0.10)" }}
        >
          {step === 0 ? (
            <div className="space-y-6">
              <h1 className="text-2xl font-semibold leading-8 tracking-[-0.02em] text-[#131315]">
                Name your workspace
              </h1>
              <WizardField
                label="Workspace name"
                value={workspace}
                onChange={(value) => {
                  setWorkspace(value);
                  setError(null);
                }}
                onEnter={() => void submitWorkspace()}
                placeholder="Acme Films"
                autoComplete="organization"
                autoFocus
              />
              {error ? <ErrorMessage>{error}</ErrorMessage> : null}
              <button
                type="button"
                className={primaryButtonClass}
                onClick={() => void submitWorkspace()}
                disabled={busy}
              >
                {busy ? "Creating…" : "Continue"}
              </button>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-6">
              <h1 className="text-2xl font-semibold leading-8 tracking-[-0.02em] text-[#131315]">
                Tell us about your work
              </h1>
              <div className="space-y-5">
                <ChoiceGroup
                  question="What do you make?"
                  options={MAKES_OPTIONS}
                  value={makes}
                  onChange={(answer) => {
                    setMakes(answer);
                    setError(null);
                  }}
                />
                <ChoiceGroup
                  question="Who's working on it?"
                  options={SIZE_OPTIONS}
                  value={size}
                  onChange={(answer) => {
                    setSize(answer);
                    setError(null);
                  }}
                />
              </div>
              {error ? <ErrorMessage>{error}</ErrorMessage> : null}
              <div className="space-y-1">
                <button
                  type="button"
                  className={primaryButtonClass}
                  onClick={() => void submitQuestions()}
                  disabled={busy || !makes || !size}
                >
                  {busy ? "Saving…" : "Continue"}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass + " w-full"}
                  onClick={() => openInviteStep(size)}
                  disabled={busy}
                >
                  Skip
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-semibold leading-8 tracking-[-0.02em] text-[#131315]">
                  Invite your team
                </h1>
                <p className="mt-1.5 text-sm leading-5 text-[#6E6E73]">
                  Everyone joins as a member.
                </p>
              </div>

              <div className="space-y-3">
                {inviteRows.map((row, index) => (
                  <div key={row.id}>
                    <label className="field-shell flex min-h-11 items-center rounded-[10px] border border-[#E8E8EC] bg-white px-3 transition-[border-color,box-shadow]">
                      <span className="sr-only">Email {index + 1}</span>
                      <input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={row.email}
                        onChange={(event) =>
                          updateInviteRow(row.id, event.target.value)
                        }
                        placeholder="teammate@studio.com"
                        disabled={busy || row.sent}
                        className="field-bare min-w-0 flex-1 text-sm text-[#131315] placeholder:text-[#A0A0A5] disabled:cursor-not-allowed disabled:text-[#6E6E73]"
                      />
                    </label>
                    {row.error ? (
                      <div className="mt-1.5">
                        <ErrorMessage>{row.error}</ErrorMessage>
                      </div>
                    ) : null}
                    {row.sent ? (
                      <p className="mt-1.5 text-[13px] leading-[18px] text-[#225B36]">
                        Invite sent.
                      </p>
                    ) : null}
                  </div>
                ))}

                {inviteRows.length < 10 ? (
                  <button
                    type="button"
                    className={secondaryButtonClass + " gap-1.5 px-2"}
                    onClick={() =>
                      setInviteRows((rows) => [
                        ...rows,
                        { id: rows.length, email: "" },
                      ])
                    }
                    disabled={busy}
                  >
                    <Plus className="h-4 w-4" />
                    Add another
                  </button>
                ) : null}
              </div>

              {error ? <ErrorMessage>{error}</ErrorMessage> : null}
              <div className="space-y-1">
                <button
                  type="button"
                  className={primaryButtonClass}
                  onClick={() => void submitInvites()}
                  disabled={busy}
                >
                  {busy
                    ? "Sending…"
                    : justMeWithEmptyInvite
                      ? "Skip for now"
                      : "Continue"}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass + " w-full"}
                  onClick={() => {
                    setError(null);
                    setStep(3);
                  }}
                  disabled={busy}
                >
                  Skip
                </button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-6">
              <h1 className="text-2xl font-semibold leading-8 tracking-[-0.02em] text-[#131315]">
                Create your first project
              </h1>
              <WizardField
                label="Project name"
                value={projectName}
                onChange={(value) => {
                  setProjectName(value);
                  setError(null);
                }}
                onEnter={() => void finishProject()}
                placeholder="First project"
                autoComplete="off"
                autoFocus
              />

              <div className="rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-4">
                {isDesktop ? (
                  <div className="flex items-start gap-3">
                    <HardDrive className="mt-0.5 h-5 w-5 shrink-0 text-[#D14E00]" />
                    <div>
                      <p className="text-sm font-semibold text-[#131315]">
                        Mount your drive
                      </p>
                      <p className="mt-1 text-sm leading-5 text-[#6E6E73]">
                        Select Enable drive in the sidebar to mount your media
                        locally and edit without a full download.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <Upload className="mt-0.5 h-5 w-5 shrink-0 text-[#D14E00]" />
                    <div>
                      <p className="text-sm font-semibold text-[#131315]">
                        Upload a clip
                      </p>
                      <p className="mt-1 text-sm leading-5 text-[#6E6E73]">
                        Drag a video into your project to start a review. Want a
                        local drive?{" "}
                        <a
                          href="/downloads/snip-desktop.pkg"
                          className="font-medium text-[#131315] underline decoration-[#D8D8DE] underline-offset-2 hover:decoration-[#131315]"
                        >
                          Get the desktop app
                        </a>
                        .
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {error ? <ErrorMessage>{error}</ErrorMessage> : null}
              <div className="space-y-1">
                <button
                  type="button"
                  className={primaryButtonClass}
                  onClick={() => void finishProject()}
                  disabled={busy}
                >
                  {busy ? "Creating…" : "Finish"}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass + " w-full"}
                  onClick={goToDashboard}
                  disabled={busy}
                >
                  Go to dashboard
                </button>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
