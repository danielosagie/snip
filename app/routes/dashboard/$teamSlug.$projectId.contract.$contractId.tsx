import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { DashboardHeader } from "@/components/DashboardHeader";
import { ContractDocPreview } from "@/components/contracts/ContractDocPreview";
import { cn, formatRelativeTime } from "@/lib/utils";
import { projectPath } from "@/lib/routes";
import {
  ArrowLeft,
  AtSign,
  Calendar,
  CheckSquare,
  ChevronDown,
  FileSignature as FileSignatureIcon,
  GripVertical,
  Pencil,
  Plus,
  Send,
  Trash2,
  Type,
  User,
  X,
} from "lucide-react";

type ContractDetail = NonNullable<FunctionReturnType<typeof api.contractsTable.get>>;
type ContractDoc = ContractDetail["contract"];
type RecipientDoc = ContractDetail["recipients"][number];
type FieldDoc = ContractDetail["fields"][number];
type AuditDoc = ContractDetail["audit"][number];

const FIELD_TYPE_LABELS: Record<FieldDoc["type"], string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date signed",
  text: "Text field",
  checkbox: "Checkbox",
  name: "Name",
  email: "Email",
};

const FIELD_TYPE_ICONS: Record<
  FieldDoc["type"],
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  signature: FileSignatureIcon,
  initials: Pencil,
  date: Calendar,
  text: Type,
  checkbox: CheckSquare,
  name: User,
  email: AtSign,
};

// Grouping inspired by the Google Docs eSignature panel — manually
// filled fields the recipient must complete, then auto-filled fields
// the system stamps at sign time.
const FIELDS_FILLABLE: FieldDoc["type"][] = [
  "signature",
  "initials",
  "name",
  "text",
  "checkbox",
  "email",
];
const FIELDS_AUTO: FieldDoc["type"][] = ["date"];

export const Route = createFileRoute(
  "/dashboard/$teamSlug/$projectId/contract/$contractId",
)({
  component: ContractEditorPage,
});

const KIND_LABELS: Record<string, string> = {
  master: "Master agreement",
  sow: "Statement of work",
  nda: "NDA",
  release: "Release form",
  custom: "Custom",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "border-[#888] text-[#888] bg-[#f0f0e8]",
  pending: "border-[#C2410C] text-[#C2410C] bg-[#FFEDD5]",
  completed: "border-[#16a34a] text-[#16a34a] bg-[#f0f0e8]",
  declined: "border-[#dc2626] text-[#dc2626] bg-[#f0f0e8]",
  voided: "border-[#888] text-[#888] bg-[#f0f0e8] line-through",
  expired: "border-[#888] text-[#888] bg-[#f0f0e8]",
};

function ContractEditorPage() {
  const params = useParams({ strict: false });
  const teamSlug = typeof params.teamSlug === "string" ? params.teamSlug : "";
  const projectId = params.projectId as Id<"projects">;
  const contractId = params.contractId as Id<"contracts">;

  const data = useQuery(api.contractsTable.get, { contractId });

  if (data === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#888]">Loading…</div>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#888]">Contract not found.</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#f0f0e8]">
      <DashboardHeader hideBreadcrumb>
        <div className="flex items-center gap-2 min-w-0 mr-auto">
          <Link
            to={projectPath(teamSlug, projectId)}
            className="inline-flex items-center gap-1 px-3 h-9 border-2 border-[#1a1a1a] text-xs font-bold uppercase tracking-wider bg-[#f0f0e8] text-[#1a1a1a] shadow-[4px_4px_0px_0px_var(--shadow-color)] hover:bg-[#1a1a1a] hover:text-[#f0f0e8] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_var(--shadow-color)] active:translate-y-[2px] active:translate-x-[2px] transition-all flex-shrink-0"
            title="Back to project"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
              {KIND_LABELS[data.contract.kind] ?? data.contract.kind}
            </span>
            <h1 className="text-base font-black tracking-tighter uppercase text-[#1a1a1a] truncate">
              {data.contract.title}
            </h1>
            <span
              className={cn(
                "shrink-0 inline-flex items-center px-2 py-0.5 border-2 text-[10px] font-bold uppercase tracking-wider",
                STATUS_STYLES[data.contract.status] ?? STATUS_STYLES.draft,
              )}
            >
              {data.contract.status}
            </span>
          </div>
        </div>
      </DashboardHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <ContractBody contract={data.contract} />
          <div className="space-y-6">
            <RecipientsPanel
              contract={data.contract}
              recipients={data.recipients}
            />
            <FieldsPanel
              contract={data.contract}
              recipients={data.recipients}
              fields={data.fields}
            />
            <AuditLogPanel audit={data.audit} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ContractBody({ contract }: { contract: ContractDoc }) {
  const update = useMutation(api.contractsTable.update);
  const [body, setBody] = useState<string>(contract.contentHtml ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const isEditable = contract.status === "draft";

  // Re-sync local state if the contract row changes from outside (e.g.
  // a coworker editing) — but only when we don't have local edits in
  // flight, to avoid stomping a half-typed sentence.
  useEffect(() => {
    if (dirty) return;
    setBody(contract.contentHtml ?? "");
  }, [contract._id, contract.contentHtml, dirty]);

  // Debounced autosave: wait 1.2s after the last keystroke. Matches the
  // single-contract editor's feel without a heavy CRDT layer.
  useEffect(() => {
    if (!isEditable || !dirty) return;
    if (body === contract.contentHtml) {
      setDirty(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSaving(true);
      try {
        await update({ contractId: contract._id, contentHtml: body });
        setDirty(false);
      } finally {
        setSaving(false);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [body, contract._id, contract.contentHtml, dirty, isEditable, update]);

  return (
    <div className="border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[4px_4px_0px_0px_#1a1a1a] p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-black uppercase tracking-tighter text-[#1a1a1a]">
          Body
        </h2>
        {isEditable && (
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#888]">
            {saving ? "Saving…" : dirty ? "Unsaved" : "Saved"}
          </span>
        )}
      </div>
      <ContractDocPreview
        html={body}
        editable={isEditable}
        resyncWithHtml={!dirty}
        onChange={(next) => {
          setBody(next);
          setDirty(true);
        }}
      />
    </div>
  );
}

function RecipientsPanel({
  contract,
  recipients,
}: {
  contract: ContractDoc;
  recipients: RecipientDoc[];
}) {
  const addRecipient = useMutation(api.contractsTable.addRecipient);
  const removeRecipient = useMutation(api.contractsTable.removeRecipient);
  const sendForSignature = useMutation(api.contractsTable.sendForSignature);
  const voidContract = useMutation(api.contractsTable.voidContract);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [sending, setSending] = useState(false);
  const isDraft = contract.status === "draft";

  const handleAdd = async () => {
    if (!draftName.trim() || !draftEmail.trim()) return;
    try {
      await addRecipient({
        contractId: contract._id,
        name: draftName.trim(),
        email: draftEmail.trim(),
        role: "signer",
      });
      setDraftName("");
      setDraftEmail("");
    } catch (err) {
      console.error("addRecipient failed", err);
    }
  };

  const handleSend = async () => {
    setSending(true);
    try {
      await sendForSignature({ contractId: contract._id });
    } catch (err) {
      console.error("sendForSignature failed", err);
      alert(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[4px_4px_0px_0px_#1a1a1a] p-5">
      <h3 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#1a1a1a] mb-3">
        Recipients
      </h3>
      <ul className="space-y-2 mb-4">
        {recipients.length === 0 && (
          <li className="text-xs text-[#888] italic">No recipients yet.</li>
        )}
        {recipients.map((r) => (
          <li
            key={r._id}
            className="flex items-start justify-between gap-2 border-2 border-[#1a1a1a]/15 px-3 py-2 bg-[#f0f0e8]"
          >
            <div className="min-w-0">
              <div className="text-sm font-bold text-[#1a1a1a] truncate">
                {r.name}
              </div>
              <div className="text-[11px] text-[#888] truncate">{r.email}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[#C2410C] mt-0.5">
                {r.status}
              </div>
            </div>
            {isDraft && (
              <button
                type="button"
                onClick={() => removeRecipient({ recipientId: r._id })}
                aria-label="Remove recipient"
                className="shrink-0 h-7 w-7 inline-flex items-center justify-center border-2 border-[#1a1a1a] bg-[#f0f0e8] hover:bg-[#dc2626] hover:text-[#f0f0e8] transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {isDraft ? (
        <>
          <div className="space-y-2 mb-3">
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Full name"
              className="border-2 border-[#1a1a1a] bg-[#f0f0e8] rounded-none text-sm"
            />
            <Input
              value={draftEmail}
              onChange={(e) => setDraftEmail(e.target.value)}
              placeholder="signer@example.com"
              type="email"
              className="border-2 border-[#1a1a1a] bg-[#f0f0e8] rounded-none text-sm"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!draftName.trim() || !draftEmail.trim()}
              className="w-full inline-flex items-center justify-center gap-1.5 h-9 text-xs font-bold uppercase tracking-wider border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#FFEDD5] disabled:opacity-50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add signer
            </button>
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || recipients.length === 0}
            className="w-full inline-flex items-center justify-center gap-1.5 h-10 text-xs font-bold uppercase tracking-wider border-2 border-[#1a1a1a] bg-[#1a1a1a] text-[#f0f0e8] hover:bg-[#C2410C] shadow-[4px_4px_0px_0px_#1a1a1a] active:translate-y-[1px] active:translate-x-[1px] active:shadow-[2px_2px_0px_0px_#1a1a1a] disabled:opacity-50 transition-all"
          >
            <Send className="h-3.5 w-3.5" />
            {sending ? "Sending…" : "Send for signature"}
          </button>
        </>
      ) : contract.status === "pending" ? (
        <div className="space-y-3">
          <div className="border-2 border-[#1a1a1a]/20 bg-white p-3 text-xs">
            <div className="font-bold text-[#1a1a1a] mb-2 uppercase tracking-wider text-[10px]">
              Signing links
            </div>
            <ul className="space-y-1.5 font-mono">
              {recipients.map((r) => (
                <li key={r._id} className="break-all">
                  <span className="text-[#888]">{r.email}: </span>
                  <a
                    className="text-[#C2410C] underline hover:no-underline"
                    href={`/sign/${r.token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    /sign/{r.token.slice(0, 12)}…
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => {
              if (confirm("Void this contract? Signing links will stop working.")) {
                voidContract({ contractId: contract._id });
              }
            }}
            className="w-full inline-flex items-center justify-center gap-1.5 h-9 text-xs font-bold uppercase tracking-wider border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#dc2626] hover:text-[#f0f0e8] transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Void
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Brutalist take on the Google Docs eSignature side panel:
 *
 *   1. Header with feather icon + "eSignature" title.
 *   2. "Insert fields for" — recipient selector (avatar circle +
 *      name + chevron). Click cycles through signers.
 *   3. "Fillable fields" — draggable pill list (Signature, Initials,
 *      Name, Text, Checkbox, Email). Each row clickable to add the
 *      field to the currently-selected recipient.
 *   4. "Auto filled fields" — same shape but for system-stamped
 *      fields (Date signed).
 *   5. Per-recipient placed-fields list below.
 *   6. Sticky "Request eSignature" CTA at the bottom that fires the
 *      contract's `sendForSignature` mutation.
 *
 * Drag-on-PDF placement is still v3 — until then "drag" just adds
 * the field with default coords; the placed list shows what's
 * attached to each recipient.
 */
function FieldsPanel({
  contract,
  recipients,
  fields,
}: {
  contract: ContractDoc;
  recipients: RecipientDoc[];
  fields: FieldDoc[];
}) {
  const addField = useMutation(api.contractsTable.addField);
  const removeField = useMutation(api.contractsTable.removeField);
  const sendForSignature = useMutation(api.contractsTable.sendForSignature);
  const [selectedRecipient, setSelectedRecipient] = useState<Id<"contractRecipients"> | "">("");
  const [recipientMenuOpen, setRecipientMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const isDraft = contract.status === "draft";

  // Default the selected recipient to the first signer so a single
  // click adds a sensible field.
  useEffect(() => {
    if (selectedRecipient) return;
    const firstSigner = recipients.find((r) => r.role === "signer");
    if (firstSigner) setSelectedRecipient(firstSigner._id);
  }, [recipients, selectedRecipient]);

  const handleAddType = async (type: FieldDoc["type"]) => {
    if (!selectedRecipient) return;
    try {
      await addField({
        contractId: contract._id,
        recipientId: selectedRecipient,
        type,
      });
    } catch (err) {
      console.error("addField failed", err);
      alert(err instanceof Error ? err.message : "Failed to add field.");
    }
  };

  // Group fields by recipient for the list display.
  const fieldsByRecipient = new Map<string, FieldDoc[]>();
  for (const f of fields) {
    const key = f.recipientId as string;
    const arr = fieldsByRecipient.get(key) ?? [];
    arr.push(f);
    fieldsByRecipient.set(key, arr);
  }

  const currentRecipient = recipients.find((r) => r._id === selectedRecipient);
  const requestDisabled =
    !isDraft || recipients.filter((r) => r.role === "signer").length === 0;

  const handleSend = async () => {
    setSending(true);
    try {
      await sendForSignature({ contractId: contract._id });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't send for signature.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[4px_4px_0px_0px_#1a1a1a] flex flex-col">
      {/* Header strip */}
      <div className="flex items-center justify-between border-b-2 border-[#1a1a1a] px-4 py-3 bg-[#1a1a1a] text-[#f0f0e8]">
        <div className="flex items-center gap-2">
          <FileSignatureIcon className="h-4 w-4 text-[#C2410C]" strokeWidth={2} />
          <h3 className="text-xs font-black uppercase tracking-wider">
            eSignature
          </h3>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* Insert fields for */}
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#1a1a1a] mb-1.5">
            Insert fields for
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setRecipientMenuOpen((v) => !v)}
              disabled={recipients.length === 0 || !isDraft}
              className="w-full inline-flex items-center justify-between gap-2 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-3 h-10 disabled:opacity-50 hover:bg-[#FFEDD5] transition-colors"
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className="h-6 w-6 shrink-0 rounded-full border-2 border-[#1a1a1a] bg-[#FFEDD5]" />
                <span className="text-sm font-bold text-[#1a1a1a] truncate">
                  {currentRecipient?.name ?? "Add a signer first"}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 text-[#1a1a1a] shrink-0" />
            </button>
            {recipientMenuOpen && recipients.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[4px_4px_0px_0px_#1a1a1a]">
                {recipients.map((r) => (
                  <button
                    key={r._id}
                    type="button"
                    onClick={() => {
                      setSelectedRecipient(r._id);
                      setRecipientMenuOpen(false);
                    }}
                    className={cn(
                      "w-full inline-flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-[#FFEDD5]",
                      r._id === selectedRecipient && "bg-[#FFEDD5]",
                    )}
                  >
                    <span className="h-5 w-5 shrink-0 rounded-full border-2 border-[#1a1a1a] bg-[#f0f0e8]" />
                    <span className="font-bold text-[#1a1a1a] flex-1 truncate">
                      {r.name}
                    </span>
                    <span className="text-[10px] font-mono uppercase text-[#888]">
                      {r.role}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Fillable fields */}
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#1a1a1a] mb-1.5">
            Fillable fields
          </div>
          <ul className="space-y-1.5">
            {FIELDS_FILLABLE.map((type) => (
              <FieldChip
                key={type}
                type={type}
                disabled={!isDraft || !selectedRecipient}
                onClick={() => void handleAddType(type)}
              />
            ))}
          </ul>
        </div>

        {/* Auto-filled fields */}
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#1a1a1a] mb-1.5">
            Auto filled fields
          </div>
          <ul className="space-y-1.5">
            {FIELDS_AUTO.map((type) => (
              <FieldChip
                key={type}
                type={type}
                disabled={!isDraft || !selectedRecipient}
                onClick={() => void handleAddType(type)}
              />
            ))}
          </ul>
        </div>

        {/* Placed fields per recipient — kept compact since the panel
            stays a sidebar. */}
        {fields.length > 0 && (
          <div>
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#1a1a1a] mb-1.5">
              Placed fields
            </div>
            <ul className="space-y-2">
              {recipients.map((r) => {
                const rfs = fieldsByRecipient.get(r._id as string) ?? [];
                if (rfs.length === 0) return null;
                return (
                  <li key={r._id}>
                    <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#C2410C]">
                      {r.name}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {rfs.map((f) => {
                        const Icon = FIELD_TYPE_ICONS[f.type];
                        return (
                          <li
                            key={f._id}
                            className="flex items-center gap-2 border border-[#1a1a1a]/15 px-2 py-1 bg-[#f0f0e8] text-xs"
                          >
                            <Icon
                              className="h-3.5 w-3.5 text-[#C2410C]"
                              strokeWidth={1.75}
                            />
                            <span className="font-bold text-[#1a1a1a] flex-1">
                              {FIELD_TYPE_LABELS[f.type]}
                            </span>
                            {isDraft && (
                              <button
                                type="button"
                                onClick={() => removeField({ fieldId: f._id })}
                                aria-label="Remove field"
                                className="h-5 w-5 inline-flex items-center justify-center hover:bg-[#dc2626] hover:text-[#f0f0e8] transition-colors"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Bottom CTA strip — matches the Google Docs pattern. */}
      <div className="border-t-2 border-[#1a1a1a] p-4 space-y-2 bg-[#f0f0e8]">
        {requestDisabled && (
          <p className="text-[10px] text-[#888] text-center leading-snug">
            {!isDraft
              ? "Contract is no longer a draft."
              : "Add at least one signer to enable signing requests."}
          </p>
        )}
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={requestDisabled || sending}
          className={cn(
            "w-full inline-flex items-center justify-center gap-2 h-11 text-xs font-black uppercase tracking-wider border-2 border-[#1a1a1a] transition-all",
            requestDisabled || sending
              ? "bg-[#e8e8e0] text-[#888] cursor-not-allowed"
              : "bg-[#1a1a1a] text-[#f0f0e8] hover:bg-[#C2410C] shadow-[4px_4px_0px_0px_#1a1a1a] active:translate-y-[1px] active:translate-x-[1px] active:shadow-[2px_2px_0px_0px_#1a1a1a]",
          )}
        >
          <Send className="h-3.5 w-3.5" />
          {sending ? "Sending…" : "Request eSignature"}
        </button>
      </div>
    </div>
  );
}

function FieldChip({
  type,
  disabled,
  onClick,
}: {
  type: FieldDoc["type"];
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = FIELD_TYPE_ICONS[type];
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "w-full inline-flex items-center gap-2 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-3 h-10 transition-colors",
          disabled
            ? "opacity-50 cursor-not-allowed"
            : "hover:bg-[#FFEDD5] cursor-grab active:cursor-grabbing",
        )}
        draggable={!disabled}
        title="Click to add a field for the selected recipient"
      >
        <GripVertical className="h-4 w-4 text-[#888]" />
        <Icon className="h-4 w-4 text-[#C2410C]" strokeWidth={1.75} />
        <span className="text-sm font-bold text-[#1a1a1a]">
          {FIELD_TYPE_LABELS[type]}
        </span>
      </button>
    </li>
  );
}

function AuditLogPanel({ audit }: { audit: AuditDoc[] }) {
  return (
    <div className="border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[4px_4px_0px_0px_#1a1a1a] p-5">
      <h3 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#1a1a1a] mb-3">
        Audit log
      </h3>
      <ol className="space-y-2">
        {audit.length === 0 && (
          <li className="text-xs text-[#888] italic">No events yet.</li>
        )}
        {audit.map((e) => (
          <li key={e._id} className="border-l-2 border-[#C2410C] pl-3">
            <div className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]">
              {e.action.replace(/_/g, " ")}
            </div>
            <div className="text-[11px] text-[#888]">
              {e.actorName ? `${e.actorName} · ` : ""}
              {formatRelativeTime(e.createdAt)}
              {e.ip ? ` · ${e.ip}` : ""}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
