"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  PROJECT_TYPE_TEMPLATES,
  UNIVERSAL_QUESTIONS,
  getTemplate,
  type ProjectType,
  type WizardAnswers,
  type WizardQuestion,
} from "@convex/contractTemplates";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Check, FileSignature } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";

interface Props {
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

type Step = "type" | "universal" | "specific" | "review";

export function ContractWizard({ projectId, open, onOpenChange, onComplete }: Props) {
  const startFromWizard = useMutation(api.contractClauses.startFromWizard);
  const [step, setStep] = useState<Step>("type");
  const [projectType, setProjectType] = useState<ProjectType | null>(null);
  const [answers, setAnswers] = useState<WizardAnswers>({
    depositPercent: "50",
    revisionsAllowed: 2,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = projectType ? getTemplate(projectType) : null;
  const specificQuestions = template?.typeSpecificQuestions ?? [];

  const universalProgress = useMemo(
    () =>
      UNIVERSAL_QUESTIONS.filter((q) => q.required).every((q) => {
        const v = answers[q.id];
        return v !== undefined && v !== null && String(v).trim() !== "";
      }),
    [answers],
  );
  const specificProgress = useMemo(
    () =>
      specificQuestions
        .filter((q) => q.required)
        .every((q) => {
          const v = answers[q.id];
          return v !== undefined && v !== null && String(v).trim() !== "";
        }),
    [answers, specificQuestions],
  );

  const reset = () => {
    setStep("type");
    setProjectType(null);
    setAnswers({ depositPercent: "50", revisionsAllowed: 2 });
    setError(null);
    setSubmitting(false);
  };

  const handleSubmit = async () => {
    if (!projectType) return;
    setSubmitting(true);
    setError(null);
    try {
      const entries = Object.entries(answers).map(([key, value]) => ({
        key,
        value: value ?? null,
      }));
      await startFromWizard({
        projectId,
        projectType,
        answers: { entries },
      });
      onComplete();
      onOpenChange(false);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate contract.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="surface-soft max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5" />
            Draft a contract
          </DialogTitle>
          <DialogDescription>
            Answer a few questions and we'll generate a structured contract
            with the right clauses for this kind of work. You can edit any
            section after.
          </DialogDescription>
        </DialogHeader>

        <Stepper step={step} hasType={Boolean(projectType)} />

        {step === "type" ? (
          <TypePicker
            selected={projectType}
            onSelect={(t) => setProjectType(t)}
          />
        ) : step === "universal" ? (
          <QuestionList
            questions={UNIVERSAL_QUESTIONS}
            answers={answers}
            onChange={setAnswers}
          />
        ) : step === "specific" ? (
          specificQuestions.length === 0 ? (
            <div className="py-4 text-sm text-[#6E6E73]">
              This project type doesn't have any extra questions. Click Next to
              review your contract.
            </div>
          ) : (
            <QuestionList
              questions={specificQuestions}
              answers={answers}
              onChange={setAnswers}
            />
          )
        ) : (
          <ReviewStep
            projectType={projectType!}
            answers={answers}
          />
        )}

        {error ? (
          <div className="rounded-[11px] bg-[#FFF5F5] p-3 text-sm text-[#8A2B34]">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t border-[#F1F1F3] pt-3">
          <Button
            variant="outline"
            disabled={step === "type" || submitting}
            onClick={() => {
              if (step === "review") setStep("specific");
              else if (step === "specific") setStep("universal");
              else if (step === "universal") setStep("type");
            }}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </Button>

          {step === "review" ? (
            <Button
              onClick={() => void handleSubmit()}
              disabled={submitting}
            >
              <Check className="mr-1.5 h-4 w-4" />
              {submitting ? "Generating…" : "Generate contract"}
            </Button>
          ) : (
            <Button
              disabled={
                (step === "type" && !projectType) ||
                (step === "universal" && !universalProgress) ||
                (step === "specific" && !specificProgress)
              }
              onClick={() => {
                if (step === "type") setStep("universal");
                else if (step === "universal") setStep("specific");
                else if (step === "specific") setStep("review");
              }}
            >
              Next
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ step, hasType }: { step: Step; hasType: boolean }) {
  const steps: Array<{ id: Step; label: string }> = [
    { id: "type", label: "Project type" },
    { id: "universal", label: "Basics" },
    { id: "specific", label: "Details" },
    { id: "review", label: "Review" },
  ];
  const currentIndex = steps.findIndex((s) => s.id === step);
  return (
    <div className="flex items-center gap-2 mb-4">
      {steps.map((s, i) => {
        const isPast = i < currentIndex;
        const isCurrent = i === currentIndex;
        const reachable = hasType || i === 0;
        return (
          <div key={s.id} className="flex items-center gap-2 flex-1">
            <div
              className={
                "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium " +
                (isPast
                  ? "bg-[#FFF0E6] text-[#D14E00]"
                  : isCurrent
                    ? "bg-[#FFF0E6] text-[#D14E00]"
                    : reachable
                      ? "bg-[#F1F1F3] text-[#6E6E73]"
                      : "bg-[#F1F1F3] text-[#A0A0A5]")
              }
            >
              {isPast ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <div
              className={
                "truncate text-xs font-medium " +
                (isCurrent
                  ? "text-[#D14E00]"
                  : "text-[#6E6E73]")
              }
            >
              {s.label}
            </div>
            {i < steps.length - 1 ? (
              // Track sits on whatever theme background the Dialog uses;
              // use the foreground token at 30% so it stays visible against
              // both cream and dark surfaces.
              <div
                className={
                  "h-1 flex-1 rounded-full " +
                  (isPast || isCurrent ? "bg-[#FF6600]" : "bg-[#E8E8EC]")
                }
              />
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
      <p className="mb-3 text-sm text-[#131315]">
        What kind of project is this? Different types ask different questions
        and generate the relevant clauses.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {PROJECT_TYPE_TEMPLATES.map((t) => {
          const isSelected = selected === t.type;
          return (
            <button
              type="button"
              key={t.type}
              onClick={() => onSelect(t.type)}
              className={
                "flex items-start gap-3 rounded-[14px] border p-4 text-left transition-colors " +
                (isSelected
                  ? "border-[#FFF0E6] bg-[#FFF0E6] text-[#D14E00]"
                  : "border-[#E8E8EC] bg-white text-[#131315] hover:bg-[#FAFAFA]")
              }
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold">{t.label}</div>
                <div
                  className={
                    "text-xs mt-0.5 " +
                    (isSelected ? "text-[#D14E00]" : "text-[#6E6E73]")
                  }
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

function QuestionList({
  questions,
  answers,
  onChange,
}: {
  questions: WizardQuestion[];
  answers: WizardAnswers;
  onChange: (next: WizardAnswers) => void;
}) {
  return (
    <div className="space-y-3">
      {questions.map((q) => (
        <QuestionField
          key={q.id}
          question={q}
          value={answers[q.id]}
          onChange={(v) => onChange({ ...answers, [q.id]: v })}
        />
      ))}
    </div>
  );
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: WizardQuestion;
  value: WizardAnswers[string];
  onChange: (next: WizardAnswers[string]) => void;
}) {
  const id = `q_${question.id}`;
  return (
    <label htmlFor={id} className="block">
      <div className="mb-1 text-[13px] font-medium text-[#6E6E73]">
        {question.prompt}
        {question.required ? (
          <span className="ml-1 text-[#D8434F]">*</span>
        ) : null}
      </div>
      {question.help ? (
        <div className="mb-1.5 text-xs text-[#6E6E73]">{question.help}</div>
      ) : null}
      {question.kind === "textarea" ? (
        <Textarea
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder}
          rows={4}
        />
      ) : question.kind === "select" ? (
        <select
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-[10px] border border-[#D8D8DE] bg-white px-2 py-1.5 text-sm text-[#131315]"
        >
          <option value="" disabled>
            Select…
          </option>
          {question.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : question.kind === "boolean" ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(true)}
            className={
              "rounded-full border px-3.5 py-1.5 text-sm font-medium " +
              (value === true
                ? "border-[#FFF0E6] bg-[#FFF0E6] text-[#D14E00]"
                : "border-[#D8D8DE] bg-white text-[#131315] hover:bg-[#F1F1F3]")
            }
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onChange(false)}
            className={
              "rounded-full border px-3.5 py-1.5 text-sm font-medium " +
              (value === false
                ? "border-[#FFF0E6] bg-[#FFF0E6] text-[#D14E00]"
                : "border-[#D8D8DE] bg-white text-[#131315] hover:bg-[#F1F1F3]")
            }
          >
            No
          </button>
        </div>
      ) : question.kind === "number" ? (
        <Input
          id={id}
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
        />
      ) : question.kind === "date" ? (
        <Input
          id={id}
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : question.kind === "email" ? (
        <Input
          id={id}
          type="email"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder}
        />
      ) : (
        <Input
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder}
        />
      )}
    </label>
  );
}

function ReviewStep({
  projectType,
  answers,
}: {
  projectType: ProjectType;
  answers: WizardAnswers;
}) {
  const template = getTemplate(projectType);
  const allQuestions = [
    ...UNIVERSAL_QUESTIONS,
    ...template.typeSpecificQuestions,
  ];
  return (
    <div className="space-y-3">
      <div className="rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-3">
        <div className="text-sm font-semibold text-[#131315]">
          {template.label}
        </div>
        <div className="mt-0.5 text-xs text-[#6E6E73]">{template.description}</div>
      </div>
      <div className="text-sm text-[#131315]">
        Here's what you entered. Clicking <strong>Generate contract</strong>{" "}
        will build the full document with all the standard clauses (payment,
        IP transfer, kill fee, dispute resolution, etc.) plus the
        type-specific sections.
      </div>
      <div className="divide-y divide-[#F1F1F3] overflow-hidden rounded-[11px] border border-[#E8E8EC] bg-white">
        {allQuestions.map((q) => {
          const v = answers[q.id];
          if (v === undefined || v === null || String(v).trim() === "") return null;
          return (
            <div key={q.id} className="flex gap-3 p-2 text-xs">
              <div className="w-44 flex-shrink-0 font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
                {q.prompt}
              </div>
              <div className="flex-1 break-words text-[#131315]">{String(v)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
