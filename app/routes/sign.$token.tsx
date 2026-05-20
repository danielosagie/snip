import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { SnipMark } from "@/components/SnipMark";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

type SignData = NonNullable<FunctionReturnType<typeof api.contractsTable.getByToken>>;
type SignFieldDoc = SignData["fields"][number];

const FIELD_TYPE_LABELS: Record<SignFieldDoc["type"], string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
  text: "Text",
  checkbox: "Checkbox",
  name: "Name",
  email: "Email",
};

export const Route = createFileRoute("/sign/$token")({
  component: SignPage,
});

/**
 * Public signing page. No Clerk auth — the URL token IS the auth.
 *
 * Flow:
 *   1. Look up the recipient + contract by token.
 *   2. Record a "viewed" audit event on first paint.
 *   3. Show the contract body, ask for typed signature (and optional
 *      drawn signature via SignaturePad) + name + "I agree" gate.
 *   4. Submit → api.contractsTable.sign mutation → success screen.
 *
 * If the contract has already been resolved (completed/declined/etc.)
 * or the token is expired/voided, surface the terminal state instead.
 */

function SignPage() {
  const { token } = useParams({ from: "/sign/$token" });
  const data = useQuery(api.contractsTable.getByToken, { token });
  const recordView = useMutation(api.contractsTable.recordSigningView);

  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const padRef = useRef<SignaturePadHandle | null>(null);

  const sign = useMutation(api.contractsTable.sign);
  const decline = useMutation(api.contractsTable.decline);

  // Capture the viewed event on first load. Best-effort — the
  // mutation no-ops if already viewed.
  useEffect(() => {
    if (!data || !data.recipient) return;
    if (data.recipient.status !== "pending") return;
    recordView({
      token,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    }).catch(() => {
      // Silent — the user-facing experience doesn't depend on this.
    });
  }, [data?.recipient?._id, recordView, token]);

  if (data === undefined) {
    return (
      <CenteredShell>
        <p className="text-[#888]">Loading…</p>
      </CenteredShell>
    );
  }
  if (data === null) {
    return (
      <CenteredShell>
        <TerminalCard title="Invalid signing link">
          We couldn't find a contract for this link. It may have been voided
          or the URL may be malformed.
        </TerminalCard>
      </CenteredShell>
    );
  }
  if (data.finalStatus) {
    return (
      <CenteredShell>
        <TerminalCard title={terminalTitle(data.finalStatus)}>
          {terminalMessage(data.finalStatus)}
        </TerminalCard>
      </CenteredShell>
    );
  }

  if (submitted || data.recipient.status === "signed") {
    return (
      <CenteredShell>
        <TerminalCard title="Signed">
          Thank you. A copy of the signed contract will be emailed to you
          shortly.
        </TerminalCard>
      </CenteredShell>
    );
  }
  if (data.recipient.status === "declined") {
    return (
      <CenteredShell>
        <TerminalCard title="Declined">
          You declined to sign this contract.
        </TerminalCard>
      </CenteredShell>
    );
  }

  // Only fields tagged required gate submit. Checkboxes pass when
  // checked OR explicitly unchecked (any answer is valid as long as
  // the user touched it); we treat missing value as not answered.
  const requiredFields = data.fields.filter((f) => f.required);
  const allRequiredFilled = requiredFields.every((f) => {
    const v = fieldValues[f._id as string];
    if (f.type === "checkbox") return v !== undefined;
    return typeof v === "string" && v.trim().length > 0;
  });

  const canSubmit =
    typedName.trim().length > 1 && agreed && allRequiredFilled && !submitting;

  const handleSign = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const drawn = padRef.current?.toDataUrl();
      const fvPayload = Object.entries(fieldValues)
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([fieldId, value]) => ({
          fieldId: fieldId as Id<"contractFields">,
          value,
        }));
      await sign({
        token,
        typedSignatureName: typedName.trim(),
        signatureDataUrl: drawn,
        fieldValues: fvPayload.length > 0 ? fvPayload : undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      });
      setSubmitted(true);
    } catch (err) {
      console.error("sign failed", err);
      alert(err instanceof Error ? err.message : "Failed to sign.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!declineReason.trim()) return;
    try {
      await decline({
        token,
        reason: declineReason.trim(),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      });
      setSubmitted(true);
    } catch (err) {
      console.error("decline failed", err);
      alert(err instanceof Error ? err.message : "Failed to decline.");
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f0e8]">
      <header className="border-b-2 border-[#1a1a1a] bg-[#f0f0e8] px-6 py-4 flex items-center justify-between">
        <SnipMark />
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
          Signing as {data.recipient.name}
        </span>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-6">
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
            {data.contract.kind}
          </div>
          <h1 className="text-5xl md:text-6xl font-black uppercase tracking-tighter leading-[0.95] mt-2 text-[#1a1a1a]">
            {data.contract.title}
          </h1>
        </div>

        <article className="border-2 border-[#1a1a1a] bg-white p-8">
          <div
            className="prose prose-sm max-w-none text-[#1a1a1a]"
            dangerouslySetInnerHTML={{
              __html: data.contract.contentHtml || "<p><em>(no body)</em></p>",
            }}
          />
        </article>

        {!showDeclineForm ? (
          <section className="border-2 border-[#1a1a1a] bg-[#f0f0e8] p-6 shadow-[4px_4px_0px_0px_#1a1a1a] space-y-4">
            <h2 className="text-xl font-black uppercase tracking-tighter text-[#1a1a1a]">
              Sign
            </h2>

            {data.fields.length > 0 && (
              <FieldInputs
                fields={data.fields}
                values={fieldValues}
                onChange={(id, value) =>
                  setFieldValues((prev) => ({ ...prev, [id]: value }))
                }
                recipientName={data.recipient.name}
                recipientEmail={data.recipient.email}
              />
            )}

            <div>
              <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-1.5">
                Type your full legal name
              </label>
              <Input
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={data.recipient.name}
                className="border-2 border-[#1a1a1a] bg-[#f0f0e8] rounded-none text-base h-12"
              />
              {typedName && (
                <div className="mt-2 border-2 border-[#1a1a1a]/15 bg-white p-4">
                  <span className="font-['Caveat',cursive] text-3xl text-[#1a1a1a]">
                    {typedName}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] mb-1.5">
                Or draw your signature (optional)
              </label>
              <SignaturePad ref={padRef} />
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-1 h-4 w-4 accent-[#C2410C]"
              />
              <span className="text-sm text-[#1a1a1a]">
                I have read the contract above and agree to be bound by its
                terms. I understand my typed name and (optionally) drawn
                signature are an electronic signature with the same legal
                effect as a handwritten one.
              </span>
            </label>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={handleSign}
                disabled={!canSubmit}
                className="flex-1 inline-flex items-center justify-center gap-2 h-12 px-6 text-sm font-black uppercase tracking-wider border-2 border-[#1a1a1a] bg-[#1a1a1a] text-[#f0f0e8] hover:bg-[#C2410C] shadow-[4px_4px_0px_0px_#1a1a1a] active:translate-y-[1px] active:translate-x-[1px] active:shadow-[2px_2px_0px_0px_#1a1a1a] disabled:opacity-50 transition-all"
              >
                <Check className="h-4 w-4" />
                {submitting ? "Signing…" : "Sign contract"}
              </button>
              <button
                type="button"
                onClick={() => setShowDeclineForm(true)}
                className="h-12 px-6 text-sm font-bold uppercase tracking-wider border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#dc2626] hover:text-[#f0f0e8] transition-colors"
              >
                Decline
              </button>
            </div>
          </section>
        ) : (
          <section className="border-2 border-[#1a1a1a] bg-[#f0f0e8] p-6 shadow-[4px_4px_0px_0px_#1a1a1a] space-y-4">
            <h2 className="text-xl font-black uppercase tracking-tighter text-[#1a1a1a]">
              Decline
            </h2>
            <p className="text-sm text-[#1a1a1a]">
              Please briefly explain why you can't sign. The agency that sent
              this contract will see your reason.
            </p>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={4}
              className="w-full border-2 border-[#1a1a1a] bg-[#f0f0e8] p-3 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-[#C2410C]"
              placeholder="e.g. The price has changed since we last discussed…"
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDecline}
                disabled={!declineReason.trim()}
                className="flex-1 inline-flex items-center justify-center gap-2 h-12 text-sm font-bold uppercase tracking-wider border-2 border-[#1a1a1a] bg-[#dc2626] text-[#f0f0e8] hover:bg-[#1a1a1a] disabled:opacity-50 transition-colors"
              >
                <X className="h-4 w-4" />
                Submit decline
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeclineForm(false);
                  setDeclineReason("");
                }}
                className="h-12 px-6 text-sm font-bold uppercase tracking-wider border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#FFEDD5] transition-colors"
              >
                Back
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f0f0e8] flex flex-col">
      <header className="border-b-2 border-[#1a1a1a] bg-[#f0f0e8] px-6 py-4">
        <SnipMark />
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        {children}
      </main>
    </div>
  );
}

function TerminalCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-md w-full border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[8px_8px_0px_0px_#1a1a1a] p-8 text-center">
      <h2 className="text-3xl font-black uppercase tracking-tighter text-[#1a1a1a] mb-3">
        {title}
      </h2>
      <p className="text-sm text-[#1a1a1a]">{children}</p>
    </div>
  );
}

function terminalTitle(status: string): string {
  switch (status) {
    case "completed":
      return "Signed and complete";
    case "declined":
      return "Contract declined";
    case "voided":
      return "Contract voided";
    case "expired":
      return "Link expired";
    default:
      return "Not available";
  }
}

function terminalMessage(status: string): string {
  switch (status) {
    case "completed":
      return "This contract has been fully signed by all required parties.";
    case "declined":
      return "This contract was declined and is no longer active.";
    case "voided":
      return "The agency that sent this contract has voided it. Reach out to them for next steps.";
    case "expired":
      return "This signing link has expired. Ask the sender to issue you a new one.";
    default:
      return "This contract is not currently accepting signatures.";
  }
}

// ─── Signature pad ────────────────────────────────────────────────────

interface SignaturePadHandle {
  toDataUrl: () => string | undefined;
  clear: () => void;
}

const SignaturePad = (() => {
  const SignaturePadImpl = (
    _props: {},
    ref: React.ForwardedRef<SignaturePadHandle>,
  ) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const lastRef = useRef<{ x: number; y: number } | null>(null);
    const [empty, setEmpty] = useState(true);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#1a1a1a";
    }, []);

    const getPos = (e: PointerEvent | React.PointerEvent) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
      return { x, y };
    };

    const onDown = (e: React.PointerEvent) => {
      drawingRef.current = true;
      lastRef.current = getPos(e);
      (e.target as Element).setPointerCapture(e.pointerId);
    };
    const onMove = (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx || !lastRef.current) return;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(lastRef.current.x, lastRef.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      lastRef.current = pos;
      if (empty) setEmpty(false);
    };
    const onUp = () => {
      drawingRef.current = false;
      lastRef.current = null;
    };

    React.useImperativeHandle(ref, () => ({
      toDataUrl: () => {
        if (empty) return undefined;
        return canvasRef.current?.toDataURL("image/png");
      },
      clear: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        setEmpty(true);
      },
    }));

    return (
      <div className="border-2 border-[#1a1a1a] bg-white">
        <canvas
          ref={canvasRef}
          width={600}
          height={150}
          className="block w-full touch-none cursor-crosshair"
          style={{ aspectRatio: "4 / 1" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onUp}
        />
        <div className="border-t-2 border-[#1a1a1a]/15 flex justify-end px-2 py-1">
          <button
            type="button"
            onClick={() => {
              const canvas = canvasRef.current;
              if (canvas) {
                canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
                setEmpty(true);
              }
            }}
            className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888] hover:text-[#1a1a1a]"
          >
            Clear
          </button>
        </div>
      </div>
    );
  };
  return React.forwardRef<SignaturePadHandle, {}>(SignaturePadImpl);
})();

// ─── Field inputs (inline on the signing page) ───────────────────────

function FieldInputs({
  fields,
  values,
  onChange,
  recipientName,
  recipientEmail,
}: {
  fields: SignFieldDoc[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  recipientName: string;
  recipientEmail: string;
}) {
  // "signature" fields are subsumed by the typed-name + drawn-signature
  // controls below, so we don't render an extra input for them.
  const visible = fields.filter((f) => f.type !== "signature");
  if (visible.length === 0) return null;

  return (
    <div className="border-2 border-[#1a1a1a] bg-white p-4">
      <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#C2410C] mb-3">
        Fill these in
      </div>
      <ul className="space-y-3">
        {visible.map((f) => {
          const id = f._id as string;
          const value = values[id] ?? "";
          const label = (
            <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-[#1a1a1a] mb-1">
              {FIELD_TYPE_LABELS[f.type]}
              {f.required && <span className="text-[#C2410C] ml-1">*</span>}
            </label>
          );
          if (f.type === "checkbox") {
            return (
              <li key={id}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={value === "true"}
                    onChange={(e) => onChange(id, e.target.checked ? "true" : "false")}
                    className="mt-1 h-4 w-4 accent-[#C2410C]"
                  />
                  <span className="text-sm text-[#1a1a1a]">
                    {FIELD_TYPE_LABELS[f.type]}
                    {f.required && <span className="text-[#C2410C] ml-1">*</span>}
                  </span>
                </label>
              </li>
            );
          }
          if (f.type === "date") {
            return (
              <li key={id}>
                {label}
                <Input
                  type="date"
                  value={value}
                  onChange={(e) => onChange(id, e.target.value)}
                  className="border-2 border-[#1a1a1a] bg-[#f0f0e8] rounded-none h-10"
                />
              </li>
            );
          }
          if (f.type === "name") {
            return (
              <li key={id}>
                {label}
                <Input
                  value={value || recipientName}
                  onChange={(e) => onChange(id, e.target.value)}
                  className="border-2 border-[#1a1a1a] bg-[#f0f0e8] rounded-none h-10"
                />
              </li>
            );
          }
          if (f.type === "email") {
            return (
              <li key={id}>
                {label}
                <Input
                  type="email"
                  value={value || recipientEmail}
                  onChange={(e) => onChange(id, e.target.value)}
                  className="border-2 border-[#1a1a1a] bg-[#f0f0e8] rounded-none h-10"
                />
              </li>
            );
          }
          // initials, text
          return (
            <li key={id}>
              {label}
              <Input
                value={value}
                onChange={(e) => onChange(id, e.target.value)}
                placeholder={f.type === "initials" ? "AB" : ""}
                maxLength={f.type === "initials" ? 5 : undefined}
                className={cn(
                  "border-2 border-[#1a1a1a] bg-[#f0f0e8] rounded-none h-10",
                  f.type === "initials" && "max-w-[120px] uppercase font-bold tracking-widest",
                )}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
