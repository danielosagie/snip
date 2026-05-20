import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardHeader } from "@/components/DashboardHeader";
import { cn, formatRelativeTime } from "@/lib/utils";
import { projectPath } from "@/lib/routes";
import { ArrowLeft, Plus, Send, Trash2, X } from "lucide-react";

type ContractDetail = NonNullable<FunctionReturnType<typeof api.contractsTable.get>>;
type ContractDoc = ContractDetail["contract"];
type RecipientDoc = ContractDetail["recipients"][number];
type AuditDoc = ContractDetail["audit"][number];

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
  const isEditable = contract.status === "draft";

  useEffect(() => {
    setBody(contract.contentHtml ?? "");
  }, [contract._id, contract.contentHtml]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await update({ contractId: contract._id, contentHtml: body });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[4px_4px_0px_0px_#1a1a1a] p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-black uppercase tracking-tighter text-[#1a1a1a]">
          Body
        </h2>
        {isEditable && (
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={saving || body === contract.contentHtml}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      {isEditable ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={20}
          className="w-full border-2 border-[#1a1a1a] bg-[#f0f0e8] p-4 font-mono text-sm rounded-none resize-y focus:outline-none focus:ring-2 focus:ring-[#C2410C]"
          placeholder="Paste or write the contract body. HTML is supported — the signing page renders it as-is."
        />
      ) : (
        <div
          className="prose prose-sm max-w-none border-2 border-[#1a1a1a]/10 bg-white p-4"
          dangerouslySetInnerHTML={{ __html: contract.contentHtml || "<p><em>(empty)</em></p>" }}
        />
      )}
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
