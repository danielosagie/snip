"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  PROJECT_TYPE_TEMPLATES,
  UNIVERSAL_QUESTIONS,
  getTemplate,
  generateClausesFromAnswers,
  renderClausesAsHtml,
  type ProjectType,
  type WizardAnswers,
  type WizardQuestion,
} from "@convex/contractTemplates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiCombobox } from "@/components/ui/multi-combobox";
import { ContractDocPreview } from "@/components/contracts/ContractDocPreview";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileSignature,
  RotateCcw,
  X,
  Camera,
  Clapperboard,
  Film,
  Globe,
  Mic2,
  Palette,
  PenLine,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Id } from "@convex/_generated/dataModel";

/**
 * Full-screen typeform-style contract wizard.
 *
 *   Left pane: one question at a time, dominant typography, keyboard
 *               navigation (Enter to advance, Shift+Enter for newline,
 *               Esc to leave).
 *   Right pane: live contract preview rebuilt from the current answers
 *               on every keystroke so the user can watch the document
 *               assemble itself.
 *   Top:        4-stage progress stepper (Type → Basics → Details →
 *               Review) plus an in-stage progress bar showing how many
 *               questions are left in the current stage.
 *
 * On Generate, calls api.contractClauses.startFromWizard which persists
 * the structured clause list on the project.
 */

type Stage = "type" | "universal" | "specific" | "review";

/**
 * Lucide icon per project type — replaces the emoji that used to
 * live on the template itself. Centralized here so all wizard
 * surfaces (type picker, review pane) pick the same glyph for each
 * type.
 */
const ICON_FOR_TYPE: Record<ProjectType, LucideIcon> = {
  video_production: Clapperboard,
  logo_design: Palette,
  web_design: Globe,
  photography: Camera,
  brand_identity: ShoppingBag,
  copywriting: PenLine,
  music: Mic2,
  animation: Film,
  custom: Sparkles,
};

interface Props {
  projectId: Id<"projects">;
  projectName: string;
  /** Where to navigate / close to. The component itself doesn't render
   *  a top-level route — it just renders a full-screen surface. The
   *  parent passes a handler so it can decide what to do on close
   *  (e.g. swap back to the freeform editor). */
  onClose: () => void;
  /** Fired after a successful generation; the parent can re-hydrate
   *  the editor with the newly generated clauses. */
  onComplete: () => void;
  /** When provided, the wizard calls this instead of writing the legacy
   *  project.contract — lets the unified multi-contract editor apply the
   *  generated clauses onto a specific contract row. */
  onGenerate?: (
    projectType: ProjectType,
    answers: {
      entries: Array<{ key: string; value: string | number | boolean | null }>;
    },
  ) => Promise<void>;
}

export function ContractWizardFullScreen({
  projectId,
  projectName,
  onClose,
  onComplete,
  onGenerate,
}: Props) {
  const startFromWizard = useMutation(api.contractClauses.startFromWizard);

  const [stage, setStage] = useState<Stage>("type");
  const [projectType, setProjectType] = useState<ProjectType | null>(null);
  // Seed the project name from the actual project so the user doesn't
  // have to retype it — they can still override it inside the wizard.
  const [answers, setAnswers] = useState<WizardAnswers>(() => ({
    depositPercent: "50",
    revisionsAllowed: 2,
    projectName,
  }));
  const [universalIndex, setUniversalIndex] = useState(0);
  const [specificIndex, setSpecificIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // The user can type directly into the preview pane. We track their
  // edits separately so the answer-driven re-generation doesn't
  // clobber them. Reset chip clears both back to the auto-draft.
  const [previewUserEdited, setPreviewUserEdited] = useState(false);
  const [previewOverrideHtml, setPreviewOverrideHtml] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const template = projectType ? getTemplate(projectType) : null;
  const specificQuestions = template?.typeSpecificQuestions ?? [];

  // Live preview — rebuilt on every answer change. Pure functions, so
  // no debounce needed; React reconciliation is plenty fast for the
  // clause sizes we deal with.
  const previewHtml = useMemo(() => {
    if (!projectType) return null;
    try {
      const clauses = generateClausesFromAnswers(projectType, answers);
      return renderClausesAsHtml(clauses);
    } catch {
      return null;
    }
  }, [projectType, answers]);

  // Which question we're currently looking at, per stage.
  const currentQuestion: WizardQuestion | null =
    stage === "universal"
      ? (UNIVERSAL_QUESTIONS[universalIndex] ?? null)
      : stage === "specific"
        ? (specificQuestions[specificIndex] ?? null)
        : null;

  const stageIsAnswered = (q: WizardQuestion): boolean => {
    const v = answers[q.id];
    if (!q.required) return true;
    return v !== undefined && v !== null && String(v).trim() !== "";
  };

  const canAdvance = (() => {
    if (stage === "type") return projectType !== null;
    if (stage === "universal")
      return currentQuestion ? stageIsAnswered(currentQuestion) : true;
    if (stage === "specific")
      return currentQuestion ? stageIsAnswered(currentQuestion) : true;
    return true;
  })();

  const advance = () => {
    if (!canAdvance) return;
    if (stage === "type") {
      setStage("universal");
      setUniversalIndex(0);
      return;
    }
    if (stage === "universal") {
      if (universalIndex < UNIVERSAL_QUESTIONS.length - 1) {
        setUniversalIndex((i) => i + 1);
      } else {
        setStage("specific");
        setSpecificIndex(0);
      }
      return;
    }
    if (stage === "specific") {
      if (specificIndex < specificQuestions.length - 1) {
        setSpecificIndex((i) => i + 1);
      } else {
        setStage("review");
      }
      return;
    }
  };

  const goBack = () => {
    if (stage === "review") {
      if (specificQuestions.length > 0) {
        setStage("specific");
        setSpecificIndex(specificQuestions.length - 1);
      } else {
        setStage("universal");
        setUniversalIndex(UNIVERSAL_QUESTIONS.length - 1);
      }
      return;
    }
    if (stage === "specific") {
      if (specificIndex > 0) {
        setSpecificIndex((i) => i - 1);
      } else {
        setStage("universal");
        setUniversalIndex(UNIVERSAL_QUESTIONS.length - 1);
      }
      return;
    }
    if (stage === "universal") {
      if (universalIndex > 0) {
        setUniversalIndex((i) => i - 1);
      } else {
        setStage("type");
      }
      return;
    }
  };

  // Global keyboard handling.
  // Enter advances (Shift+Enter falls through to textarea linebreak).
  // Esc closes the wizard entirely.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const target = e.target as HTMLElement | null;
        // Don't hijack Enter inside a textarea unless they meant submit.
        if (target?.tagName === "TEXTAREA") return;
        e.preventDefault();
        if (stage === "review") {
          void handleSubmit();
        } else {
          advance();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // We deliberately recompute on stage/index/answers — the captured
    // `advance` reads them, and we want the latest closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stage,
    universalIndex,
    specificIndex,
    projectType,
    answers,
    submitting,
  ]);

  const handleSubmit = async () => {
    if (!projectType || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const entries = Object.entries(answers).map(([key, value]) => ({
        key,
        value: value ?? null,
      }));
      if (onGenerate) {
        await onGenerate(projectType, { entries });
      } else {
        await startFromWizard({
          projectId,
          projectType,
          answers: { entries },
        });
      }
      onComplete();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate contract.");
    } finally {
      setSubmitting(false);
    }
  };

  // Stage-level progress for the bar in the stepper.
  const stageProgress = (() => {
    if (stage === "type") return projectType ? 1 : 0;
    if (stage === "universal")
      return (universalIndex + 1) / Math.max(UNIVERSAL_QUESTIONS.length, 1);
    if (stage === "specific")
      return specificQuestions.length === 0
        ? 1
        : (specificIndex + 1) / specificQuestions.length;
    return 1;
  })();

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f0f0e8]">
      {/* Top bar: stepper + close */}
      <header className="flex-shrink-0 border-b-2 border-[#1a1a1a] px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2 font-black text-sm uppercase tracking-tight">
          <FileSignature className="h-4 w-4 text-[#FF6600]" />
          New contract
          <span className="text-[#888] font-normal normal-case ml-2 truncate max-w-[40ch]">
            · {projectName}
          </span>
        </div>
        <div className="flex-1">
          <Stepper stage={stage} stageProgress={stageProgress} />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 px-2 py-1 border-2 border-[#1a1a1a] text-xs font-bold uppercase tracking-wider hover:bg-[#1a1a1a] hover:text-[#f0f0e8]"
          title="Exit wizard (Esc)"
        >
          <X className="h-3.5 w-3.5" />
          Exit
        </button>
      </header>

      {/* Two-pane body. Left = question. Right = live preview. */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] min-h-0">
        <section className="overflow-y-auto p-8 sm:p-12 flex flex-col border-r-0 lg:border-r-2 border-[#1a1a1a]">
          {stage === "type" ? (
            <TypePicker
              selected={projectType}
              onSelect={(t) => setProjectType(t)}
            />
          ) : stage === "review" ? (
            <ReviewPane
              projectType={projectType!}
              answers={answers}
              specificQuestions={specificQuestions}
            />
          ) : currentQuestion ? (
            <SingleQuestion
              question={currentQuestion}
              positionLabel={
                stage === "universal"
                  ? `${universalIndex + 1} / ${UNIVERSAL_QUESTIONS.length}`
                  : `${specificIndex + 1} / ${specificQuestions.length}`
              }
              value={answers[currentQuestion.id]}
              onChange={(v) =>
                setAnswers((a) => ({ ...a, [currentQuestion.id]: v }))
              }
              onSubmit={advance}
            />
          ) : (
            <div className="text-[#888] text-sm">
              No questions for this stage — click <strong>Next</strong>.
            </div>
          )}

          {error ? (
            <div className="mt-4 text-sm text-[#dc2626] border-l-2 border-[#dc2626] pl-2">
              {error}
            </div>
          ) : null}

          {/* Bottom action bar — sits at the bottom of the left pane so
              the layout stays poster-like, with the action where the
              eye lands after answering. */}
          <div className="mt-auto pt-8 flex items-center justify-between gap-3">
            <Button
              variant="outline"
              onClick={goBack}
              disabled={stage === "type" || submitting}
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back
            </Button>
            <div className="text-[10px] font-mono text-[#888] uppercase tracking-wider hidden sm:block">
              Press <kbd className="px-1 border border-[#1a1a1a] bg-[#e8e8e0]">Enter</kbd>
              {" "}to continue
            </div>
            {stage === "review" ? (
              <Button
                onClick={() => void handleSubmit()}
                disabled={submitting}
                className="bg-[#FF6600] hover:bg-[#FF7A1F]"
              >
                <Check className="h-4 w-4 mr-1.5" />
                {submitting ? "Generating…" : "Generate contract"}
              </Button>
            ) : (
              <Button onClick={advance} disabled={!canAdvance}>
                Next
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            )}
          </div>
        </section>

        <section className="border-t-2 lg:border-t-0 border-[#1a1a1a] bg-[#e8e8e0] overflow-y-auto flex flex-col">
          <div className="sticky top-0 z-10 px-4 py-2 bg-[#1a1a1a] text-[#f0f0e8] text-[10px] font-bold uppercase tracking-wider flex items-center justify-between">
            <span>Live preview</span>
            <div className="flex items-center gap-2">
              {previewUserEdited ? (
                <button
                  type="button"
                  onClick={() => {
                    setPreviewUserEdited(false);
                    setPreviewOverrideHtml(null);
                  }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e8e8e0]"
                  title="Discard your edits and re-sync with the wizard answers"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </button>
              ) : null}
              <span className="font-mono opacity-70">
                {!projectType
                  ? "waiting on project type"
                  : previewUserEdited
                    ? "edited"
                    : "draft"}
              </span>
            </div>
          </div>
          {previewHtml ? (
            <ContractDocPreview
              html={previewOverrideHtml ?? previewHtml}
              onChange={(next) => setPreviewOverrideHtml(next)}
              onUserEdit={() => setPreviewUserEdited(true)}
              resyncWithHtml={!previewUserEdited}
            />
          ) : (
            <div className="p-8 text-sm text-[#666]">
              The contract will start drafting itself here once you pick a
              project type on the left.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────

function Stepper({
  stage,
  stageProgress,
}: {
  stage: Stage;
  stageProgress: number;
}) {
  const stages: Array<{ id: Stage; label: string }> = [
    { id: "type", label: "Project type" },
    { id: "universal", label: "Basics" },
    { id: "specific", label: "Details" },
    { id: "review", label: "Review" },
  ];
  const currentIndex = stages.findIndex((s) => s.id === stage);
  return (
    <div className="flex items-center gap-2">
      {stages.map((s, i) => {
        const isPast = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <div key={s.id} className="flex items-center gap-2 flex-1 min-w-0">
            <div
              className={cn(
                "flex items-center justify-center w-6 h-6 text-[10px] font-bold border-2 border-[var(--border)] flex-shrink-0",
                isPast
                  ? "bg-[#FF6600] text-[#f0f0e8]"
                  : isCurrent
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "bg-[var(--background)] text-[var(--foreground-muted)]",
              )}
            >
              {isPast ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <div
              className={cn(
                "text-[10px] font-bold uppercase tracking-wider truncate hidden md:block",
                isCurrent
                  ? "text-[var(--foreground)]"
                  : "text-[var(--foreground-muted)]",
              )}
            >
              {s.label}
            </div>
            {i < stages.length - 1 ? (
              // Use the foreground token at 30% so the track reads on both
              // the forced-light wizard backdrop AND any future theme-
              // respecting variant. Bumped from /20 → /30 for visibility.
              <div className="flex-1 h-[2px] bg-[var(--foreground)]/30 relative overflow-hidden">
                {isCurrent ? (
                  <div
                    className="absolute inset-y-0 left-0 bg-[#FF6600] transition-all"
                    style={{ width: `${Math.round(stageProgress * 100)}%` }}
                  />
                ) : isPast ? (
                  <div className="absolute inset-0 bg-[#FF6600]" />
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TypePicker({
  selected,
  onSelect,
}: {
  selected: ProjectType | null;
  onSelect: (t: ProjectType) => void;
}) {
  return (
    <div>
      <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#888] mb-2">
        Step 1 of 4
      </div>
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-[#1a1a1a] leading-tight">
        What kind of project is this?
      </h1>
      <p className="text-sm text-[#666] mt-2 max-w-prose">
        Different project types ask different questions and generate
        type-specific clauses (e.g. raw footage ownership for video, source
        files for design, sync rights for music).
      </p>
      <div className="mt-6 grid gap-2 grid-cols-1 sm:grid-cols-2">
        {PROJECT_TYPE_TEMPLATES.map((t) => {
          const isSelected = selected === t.type;
          const Icon = ICON_FOR_TYPE[t.type] ?? Sparkles;
          return (
            <button
              type="button"
              key={t.type}
              onClick={() => onSelect(t.type)}
              className={cn(
                "flex items-start gap-3 p-3 border-2 border-[#1a1a1a] text-left transition-colors",
                isSelected
                  ? "bg-[#FF6600] text-[#f0f0e8]"
                  : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e8e8e0]",
              )}
            >
              <div className="flex-shrink-0">
                <Icon className="h-6 w-6" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <div className="font-black text-sm">{t.label}</div>
                <div
                  className={cn(
                    "text-xs mt-0.5",
                    isSelected ? "opacity-80" : "text-[#666]",
                  )}
                >
                  {t.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SingleQuestion({
  question,
  positionLabel,
  value,
  onChange,
  onSubmit,
}: {
  question: WizardQuestion;
  positionLabel: string;
  value: WizardAnswers[string];
  onChange: (next: WizardAnswers[string]) => void;
  onSubmit: () => void;
}) {
  // Auto-focus the input/textarea when the question changes — typeforms
  // do this so the keyboard is always primed for the next answer.
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, [question.id]);

  return (
    <div className="max-w-2xl">
      <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#888] mb-2">
        {positionLabel}
      </div>
      <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#1a1a1a] leading-tight">
        {question.prompt}
        {question.required ? (
          <span className="ml-2 text-[#dc2626]">*</span>
        ) : null}
      </h1>
      {question.help ? (
        <p className="text-sm text-[#666] mt-2 max-w-prose">{question.help}</p>
      ) : null}

      <div className="mt-6">
        {question.kind === "textarea" ? (
          <Textarea
            ref={inputRef as React.Ref<HTMLTextAreaElement>}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder}
            rows={5}
            className="text-base"
          />
        ) : question.kind === "select" ? (
          <Select
            value={(value as string) ?? ""}
            onValueChange={(v) => onChange(v)}
          >
            <SelectTrigger className="text-base">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {question.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : question.kind === "multiselect" ? (
          <MultiCombobox
            value={(value as string) ?? ""}
            onChange={(next) => onChange(next)}
            options={question.options}
            placeholder={question.placeholder}
          />
        ) : question.kind === "boolean" ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onChange(true);
                // For boolean, auto-advance once the user makes a
                // choice — feels typeform-y and keeps momentum.
                queueMicrotask(onSubmit);
              }}
              className={cn(
                "px-4 py-2 border-2 border-[#1a1a1a] text-base font-bold",
                value === true
                  ? "bg-[#FF6600] text-[#f0f0e8]"
                  : "bg-[#f0f0e8] hover:bg-[#e8e8e0]",
              )}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(false);
                queueMicrotask(onSubmit);
              }}
              className={cn(
                "px-4 py-2 border-2 border-[#1a1a1a] text-base font-bold",
                value === false
                  ? "bg-[#FF6600] text-[#f0f0e8]"
                  : "bg-[#f0f0e8] hover:bg-[#e8e8e0]",
              )}
            >
              No
            </button>
          </div>
        ) : question.kind === "number" ? (
          <Input
            ref={inputRef as React.Ref<HTMLInputElement>}
            type="number"
            value={(value as number | string) ?? ""}
            onChange={(e) =>
              onChange(
                e.target.value === ""
                  ? null
                  : Number.isFinite(parseFloat(e.target.value))
                    ? parseFloat(e.target.value)
                    : e.target.value,
              )
            }
            placeholder={question.placeholder}
            className="text-base"
          />
        ) : question.kind === "date" ? (
          <DatePicker
            value={(value as string) ?? ""}
            onChange={(next) => onChange(next)}
            placeholder="Pick a date"
            size="lg"
          />
        ) : question.kind === "email" ? (
          <Input
            ref={inputRef as React.Ref<HTMLInputElement>}
            type="email"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder}
            className="text-base"
          />
        ) : (
          <>
            <Input
              ref={inputRef as React.Ref<HTMLInputElement>}
              value={(value as string) ?? ""}
              onChange={(e) => onChange(e.target.value)}
              placeholder={question.placeholder}
              className="text-base"
            />
            {/* Quick-option chips for free-text fields. Lets the user
                grab a common answer with one click instead of typing
                it, while still allowing free text. */}
            {question.kind === "text" && question.quickOptions
              ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {question.quickOptions.map((q) => {
                    const active = value === q.value;
                    return (
                      <button
                        key={q.value}
                        type="button"
                        onClick={() => onChange(q.value)}
                        className={cn(
                          "px-2 py-1 border-2 border-[#1a1a1a] text-xs font-bold transition-colors",
                          active
                            ? "bg-[#FF6600] text-[#f0f0e8]"
                            : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e8e8e0]",
                        )}
                      >
                        {q.label}
                      </button>
                    );
                  })}
                </div>
              )
              : null}
          </>
        )}
      </div>
    </div>
  );
}

function ReviewPane({
  projectType,
  answers,
  specificQuestions,
}: {
  projectType: ProjectType;
  answers: WizardAnswers;
  specificQuestions: WizardQuestion[];
}) {
  const template = getTemplate(projectType);
  const allQuestions = [...UNIVERSAL_QUESTIONS, ...specificQuestions];
  return (
    <div className="max-w-2xl">
      <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#888] mb-2">
        Step 4 of 4
      </div>
      <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#1a1a1a] leading-tight">
        Ready to generate?
      </h1>
      <p className="text-sm text-[#666] mt-2 max-w-prose">
        Pressing <strong>Generate contract</strong> creates the full
        structured document on the right with all standard clauses
        (payment, IP transfer, kill fee, dispute resolution) plus the
        type-specific sections. You can edit anything after.
      </p>
      <div className="mt-4 inline-flex items-center gap-2 px-3 py-2 border-2 border-[#1a1a1a] bg-[#e8e8e0]">
        {(() => {
          const Icon = ICON_FOR_TYPE[projectType] ?? Sparkles;
          return <Icon className="h-5 w-5" strokeWidth={1.75} />;
        })()}
        <span className="font-black text-sm">{template.label}</span>
      </div>
      <div className="mt-4 border-2 border-[#1a1a1a] divide-y divide-[#ccc] bg-[#f0f0e8]">
        {allQuestions.map((q) => {
          const v = answers[q.id];
          if (v === undefined || v === null || String(v).trim() === "") return null;
          return (
            <div key={q.id} className="flex gap-3 p-2 text-xs">
              <div className="w-44 flex-shrink-0 font-mono text-[#888] uppercase tracking-wider">
                {q.prompt}
              </div>
              <div className="flex-1 text-[#1a1a1a] break-words">
                {String(v)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
