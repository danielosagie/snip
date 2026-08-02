import { Link, Navigate, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { DashboardHeader } from "@/components/DashboardHeader";
import { ContractDocPreview } from "@/components/contracts/ContractDocPreview";
import { ContractToolbar } from "@/components/contracts/ContractToolbar";
import { useHeadings } from "@/components/contracts/DocumentOutline";
import { ContractSectionOutline } from "@/components/contracts/ContractSectionOutline";
import { SignatureFieldsSheet } from "@/components/contracts/SignatureFieldsSheet";
import { ContractWizardFullScreen } from "@/components/contracts/ContractWizardFullScreen";
import { cn, formatRelativeTime } from "@/lib/utils";
import { contractPath, documentPath, projectPath } from "@/lib/routes";
import { friendlyError } from "@/lib/friendlyError";
import {
  ArrowLeft,
  AtSign,
  Calendar,
  Camera,
  CheckSquare,
  ChevronDown,
  Copy,
  FileSignature as FileSignatureIcon,
  GripVertical,
  History,
  PanelLeft,
  Pencil,
  Plus,
  RotateCcw,
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

/**
 * Shared editor page behind two routes: /…/contract/$contractId
 * (mode "contract") and /…/doc/$contractId (mode "document"). `mode`
 * comes from the route, not the row — when the row's docType disagrees
 * (direct URL to the wrong kind, or the user flips the type toggle in
 * the header) we redirect to the matching route, so a document is
 * never presented under a contract URL and vice versa.
 */
export function DocumentEditorPage({
  mode,
}: {
  mode: "contract" | "document";
}) {
  const params = useParams({ strict: false });
  const teamSlug = typeof params.teamSlug === "string" ? params.teamSlug : "";
  const projectId = params.projectId as Id<"projects">;
  const contractId = params.contractId as Id<"contracts">;
  const navigate = useNavigate();

  const data = useQuery(api.contractsTable.get, { contractId });
  const updateContract = useMutation(api.contractsTable.update);
  const deleteContract = useMutation(api.contractsTable.softDelete);
  const promoteDocument = useMutation(
    api.contractsTable.promoteDocumentToContract,
  );
  const applyWizard = useMutation(api.contractsTable.applyWizard);
  const [fieldsSheetOpen, setFieldsSheetOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(mode === "contract");
  const [mobileOutlineOpen, setMobileOutlineOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.contract.title) setTitleDraft(data.contract.title);
  }, [data?.contract.title]);

  // Left-rail sections for contracts. Primary source: the wizard-generated
  // clause list on the contract row (reactive — applyWizard patches `clauses`
  // and this query updates). Fallback when the wizard hasn't run: derive
  // sections from the live H1–H3 headings (same approach as DocumentOutline)
  // so the rail is never just missing.
  const clauses = data?.contract.clauses;
  const clauseSections = useMemo(() => {
    if (!clauses || clauses.length === 0) return null;
    return [...clauses]
      .sort((a, b) => a.order - b.order)
      .map((c) => ({
        id: c.id,
        title: c.title,
        sectionKey: c.sectionKey,
        required: c.required,
      }));
  }, [clauses]);
  const headings = useHeadings(editor);
  const headingSections = useMemo(
    () =>
      headings.map((h) => ({
        // Encode the doc position in the id so a click can scroll without
        // a text search. Clause ids never collide with these (uuid-ish).
        id: String(h.pos),
        title: h.text,
        sectionKey: "",
        required: false,
      })),
    [headings],
  );
  const outlineSections = clauseSections ?? headingSections;

  // Scroll the editor to the heading that matches the clicked section.
  // Clauses don't carry document positions — but renderClausesAsHtml emits
  // exactly one `<h2>{title}</h2>` per clause, so matching the clause title
  // against the live heading nodes finds the anchor. Heading-derived
  // sections already carry their position in the id.
  const scrollToSection = (sectionId: string) => {
    setActiveSectionId(sectionId);
    if (!editor || editor.isDestroyed) return;
    let pos: number | null = null;
    if (clauseSections) {
      const target = clauseSections.find((s) => s.id === sectionId);
      if (!target) return;
      const wanted = target.title.trim().toLowerCase();
      editor.state.doc.descendants((node, p) => {
        if (pos !== null) return false;
        if (
          node.type.name === "heading" &&
          node.textContent.trim().toLowerCase() === wanted
        ) {
          pos = p;
          return false;
        }
        return true;
      });
    } else {
      const parsed = Number(sectionId);
      pos = Number.isFinite(parsed) ? parsed : null;
    }
    if (pos === null) return;
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .scrollIntoView()
      .run();
  };

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
        <div className="text-[#888]">
          {mode === "document" ? "Document not found." : "Contract not found."}
        </div>
      </div>
    );
  }

  // Route ⇄ row mismatch: send the user to the URL that matches what
  // the row actually is. Covers direct links to a document under
  // /contract/ (and vice versa) and the header type toggle below.
  const actualType: "contract" | "document" =
    (data.contract.docType ?? "contract") === "document"
      ? "document"
      : "contract";
  if (actualType !== mode) {
    return (
      <Navigate
        to={
          actualType === "document"
            ? documentPath(teamSlug, projectId, contractId)
            : contractPath(teamSlug, projectId, contractId)
        }
        replace
      />
    );
  }

  const isDocument = mode === "document";
  const saveTitle = async () => {
    const next = titleDraft.trim();
    if (!next || next === data.contract.title) {
      setTitleDraft(data.contract.title);
      return;
    }
    setTitleError(null);
    try {
      await updateContract({ contractId, title: next });
    } catch (error) {
      setTitleError(friendlyError(error, "Could not rename this item."));
      setTitleDraft(data.contract.title);
    }
  };

  const handleDelete = async () => {
    const label = isDocument ? "document" : "contract";
    if (!confirm(`Move “${data.contract.title}” to Recently deleted?`)) return;
    setDeleting(true);
    try {
      await deleteContract({ contractId });
      await navigate({ to: projectPath(teamSlug, projectId) });
    } catch (error) {
      alert(friendlyError(error, `Could not delete this ${label}.`));
      setDeleting(false);
    }
  };

  const handlePromote = async () => {
    if (promoting) return;
    setPromoting(true);
    setPromoteError(null);
    try {
      await promoteDocument({ documentId: contractId });
      await navigate({ to: contractPath(teamSlug, projectId, contractId) });
    } catch (error) {
      setPromoteError(
        friendlyError(error, "Could not prepare this document for signing."),
      );
      setPromoting(false);
    }
  };

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
              {isDocument
                ? "Document"
                : KIND_LABELS[data.contract.kind] ?? data.contract.kind}
            </span>
            {data.contract.status === "draft" ? (
              <input
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setTitleDraft(data.contract.title);
                    event.currentTarget.blur();
                  }
                }}
                aria-label={`Rename ${isDocument ? "document" : "contract"}`}
                className={cn(
                  "min-w-0 max-w-[32rem] border-0 border-b-2 border-transparent bg-transparent px-0 text-base font-black tracking-tight text-[#1a1a1a] outline-none hover:border-[#888] focus:border-[#FF6600]",
                  !isDocument && "uppercase tracking-tighter",
                )}
              />
            ) : (
              <h1
                className={cn(
                  "truncate text-base font-black tracking-tight text-[#1a1a1a]",
                  !isDocument && "uppercase tracking-tighter",
                )}
              >
                {data.contract.title}
              </h1>
            )}
            {titleError ? (
              <span className="text-[10px] font-mono text-[#dc2626]" role="alert">
                {titleError}
              </span>
            ) : null}
            {!isDocument ? (
              <span
                className={cn(
                  "hidden sm:inline-flex shrink-0 items-center px-2 py-0.5 border-2 text-[10px] font-bold uppercase tracking-wider",
                  STATUS_STYLES[data.contract.status] ?? STATUS_STYLES.draft,
                )}
              >
                {data.contract.status}
              </span>
            ) : null}
          </div>
        </div>

        {isDocument ? (
          <>
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-pressed={detailsOpen}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 border-2 border-[#1a1a1a] px-3 text-[10px] font-bold uppercase tracking-wider transition-colors",
                detailsOpen
                  ? "bg-[#1a1a1a] text-[#f0f0e8]"
                  : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#FFEDD5]",
              )}
            >
              <History className="h-3.5 w-3.5" />
              History
            </button>
            <button
              type="button"
              disabled={promoting || data.contract.status !== "draft"}
              onClick={() => void handlePromote()}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-3 text-[10px] font-bold uppercase tracking-wider text-[#1a1a1a] transition-colors hover:bg-[#FFEDD5] disabled:cursor-not-allowed disabled:opacity-40"
              title="Add recipients, signature fields, and a signing workflow"
            >
              <FileSignatureIcon className="h-3.5 w-3.5" />
              {promoting ? "Preparing…" : "Prepare for signing"}
            </button>
          </>
        ) : null}
        <button
          type="button"
          disabled={deleting || data.contract.status === "pending"}
          onClick={() => void handleDelete()}
          title={
            data.contract.status === "pending"
              ? "Void active signing links before deleting"
              : `Delete ${isDocument ? "document" : "contract"}`
          }
          aria-label={`Delete ${isDocument ? "document" : "contract"}`}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#dc2626] hover:bg-[#dc2626] hover:text-[#f0f0e8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </DashboardHeader>

      {promoteError ? (
        <div
          role="alert"
          className="border-b-2 border-[#dc2626] bg-[#fef2f2] px-4 py-2 text-center text-xs font-medium text-[#991b1b]"
        >
          {promoteError}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto grid max-w-7xl grid-cols-1 gap-6 px-3 py-3 sm:px-6 sm:py-8",
            isDocument
              ? detailsOpen
                ? "lg:grid-cols-[auto_minmax(0,1fr)_320px]"
                : "lg:grid-cols-[auto_minmax(0,1fr)]"
              : "lg:grid-cols-[auto_minmax(0,1fr)_320px]",
          )}
        >
          <div className="lg:hidden">
            <button
              type="button"
              onClick={() => setMobileOutlineOpen((open) => !open)}
              className="flex min-h-11 w-full items-center justify-between border-2 border-[#1a1a1a] bg-[#f0f0e8] px-3 text-xs font-bold uppercase tracking-wider"
              aria-expanded={mobileOutlineOpen}
            >
              <span className="inline-flex items-center gap-2">
                <PanelLeft className="h-4 w-4" />
                {isDocument ? "Outline" : "Sections & templates"}
              </span>
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", mobileOutlineOpen && "rotate-180")}
              />
            </button>
            {mobileOutlineOpen ? (
              <ContractSectionOutline
                label={isDocument ? "Outline" : "Sections"}
                mobile
                sections={outlineSections}
                activeSectionId={activeSectionId}
                onSelect={(sectionId) => {
                  scrollToSection(sectionId);
                  setMobileOutlineOpen(false);
                }}
                onCollapse={() => setMobileOutlineOpen(false)}
                renderSectionBody={
                  isDocument
                    ? undefined
                    : () => (
                        <div className="text-[11px] font-mono text-[#888]">
                          Edit this section directly in the document.
                        </div>
                      )
                }
                onRunWizard={
                  !isDocument && data.contract.status === "draft"
                    ? () => setWizardOpen(true)
                    : undefined
                }
                runWizardLabel={
                  clauseSections ? "Re-run wizard" : "Generate sections"
                }
              />
            ) : null}
          </div>
          {outlineOpen ? (
            <div className="hidden lg:flex self-start max-h-[calc(100vh-10rem)] border-y-2 border-l-2 border-[#1a1a1a] shadow-[4px_4px_0px_0px_#1a1a1a]">
              <ContractSectionOutline
                label={isDocument ? "Outline" : "Sections"}
                sections={outlineSections}
                activeSectionId={activeSectionId}
                onSelect={scrollToSection}
                onCollapse={() => setOutlineOpen(false)}
                renderSectionBody={
                  isDocument
                    ? undefined
                    : () => (
                        <div className="text-[11px] font-mono text-[#888]">
                          Edit this section directly in the document.
                        </div>
                      )
                }
                onRunWizard={
                  !isDocument && data.contract.status === "draft"
                    ? () => setWizardOpen(true)
                    : undefined
                }
                runWizardLabel={
                  clauseSections ? "Re-run wizard" : "Generate sections"
                }
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOutlineOpen(true)}
              title="Show sections"
              aria-label="Show sections"
              className="hidden lg:inline-flex h-8 w-8 items-center justify-center self-start border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8] transition-colors"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
          <DocumentCanvas
            contract={data.contract}
            editor={editor}
            isDocument={isDocument}
            onEditorReady={setEditor}
            onRunWizard={
              !isDocument && data.contract.status === "draft"
                ? () => setWizardOpen(true)
                : undefined
            }
            onOpenFields={
              isDocument ? undefined : () => setFieldsSheetOpen(true)
            }
          />
          {!isDocument ? (
            <div className="space-y-6">
              <RecipientsPanel
                contract={data.contract}
                recipients={data.recipients}
              />
              <FieldsPanel
                contract={data.contract}
                recipients={data.recipients}
                fields={data.fields}
                onOpenPlacement={() => setFieldsSheetOpen(true)}
              />
              <VersionHistoryPanel contract={data.contract} />
              <AuditLogPanel audit={data.audit} />
            </div>
          ) : detailsOpen ? (
            <aside className="space-y-6">
              <VersionHistoryPanel contract={data.contract} />
            </aside>
          ) : null}
        </div>
      </div>

      {!isDocument ? (
        <SignatureFieldsSheet
          open={fieldsSheetOpen}
          onOpenChange={setFieldsSheetOpen}
          contractId={data.contract._id}
          contentHtml={data.contract.contentHtml ?? ""}
          recipients={data.recipients}
          fields={data.fields}
          isDraft={data.contract.status === "draft"}
        />
      ) : null}

      {!isDocument && wizardOpen ? (
        <ContractWizardFullScreen
          projectId={projectId}
          projectName={data.contract.title}
          onClose={() => setWizardOpen(false)}
          onComplete={() => {
            // The body re-syncs from contract.contentHtml on the next query
            // tick (DocumentCanvas resyncs while not dirty).
          }}
          onGenerate={async (projectType, answers) => {
            await applyWizard({ contractId, projectType, answers });
          }}
        />
      ) : null}
    </div>
  );
}

function DocumentCanvas({
  contract,
  editor,
  isDocument,
  onEditorReady,
  onOpenFields,
  onRunWizard,
}: {
  contract: ContractDoc;
  editor: Editor | null;
  isDocument: boolean;
  onEditorReady: (editor: Editor) => void;
  /** Opens the shared signature-field placement surface. */
  onOpenFields?: () => void;
  /** Omitted unless the contract is a draft — opens the setup wizard. */
  onRunWizard?: () => void;
}) {
  const update = useMutation(api.contractsTable.update);
  const [body, setBody] = useState<string>(contract.contentHtml ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const latestBodyRef = useRef(body);
  const persistedBodyRef = useRef(contract.contentHtml ?? "");
  const isEditable = contract.status === "draft";

  latestBodyRef.current = body;
  persistedBodyRef.current = contract.contentHtml ?? "";

  // Route changes should not discard the final sub-second edit that has not
  // reached the debounce yet. Convex mutations survive the component unmount.
  useEffect(
    () => () => {
      if (
        isEditable &&
        latestBodyRef.current !== persistedBodyRef.current
      ) {
        void update({
          contractId: contract._id,
          contentHtml: latestBodyRef.current,
        });
      }
    },
    [contract._id, isEditable, update],
  );

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
        setSaveError(null);
      } catch (error) {
        setSaveError(friendlyError(error, "Autosave failed."));
      } finally {
        setSaving(false);
      }
    }, saveAttempt > 0 ? 0 : 800);
    return () => clearTimeout(timer);
  }, [body, contract._id, contract.contentHtml, dirty, isEditable, saveAttempt, update]);

  const saveStatus = isEditable ? (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider",
        saveError ? "text-[#dc2626]" : "text-[#888]",
      )}
      role={saveError ? "alert" : undefined}
    >
      {saving
        ? "Saving…"
        : saveError
          ? saveError
          : dirty
            ? "Unsaved"
            : "Saved"}
      {saveError ? (
        <button
          type="button"
          onClick={() => {
            setSaveError(null);
            setSaveAttempt((attempt) => attempt + 1);
          }}
          className="border-2 border-[#dc2626] px-2 py-1 font-bold hover:bg-[#dc2626] hover:text-[#f0f0e8]"
        >
          Retry
        </button>
      ) : null}
    </span>
  ) : (
    <span className="text-[10px] font-mono uppercase tracking-wider text-[#888]">
      Read only
    </span>
  );

  return (
    <div
      className={cn(
        "-mx-3 border-y-2 border-[#1a1a1a] bg-[#f0f0e8] sm:mx-0 sm:border-2",
        isDocument
          ? "overflow-hidden"
          : "p-3 sm:p-6 sm:shadow-[4px_4px_0px_0px_#1a1a1a]",
      )}
    >
      {isDocument ? (
        <div className="flex min-h-8 items-center justify-end border-b-2 border-[#1a1a1a] px-3 py-1.5">
          {saveStatus}
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black uppercase tracking-tighter text-[#1a1a1a]">
            Contract body
          </h2>
          <div className="flex items-center gap-3">
            {onRunWizard ? (
              <button
                type="button"
                onClick={onRunWizard}
                className="inline-flex min-h-11 items-center gap-1.5 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-2.5 text-[10px] font-bold uppercase tracking-wider text-[#1a1a1a] transition-colors hover:bg-[#FFEDD5] sm:min-h-7"
                title="Generate the contract from a few questions"
              >
                Run setup wizard
              </button>
            ) : null}
            {saveStatus}
          </div>
        </div>
      )}
      <ContractToolbar
        editor={editor && !editor.isDestroyed ? editor : null}
        onOpenFields={onOpenFields}
      />
      <ContractDocPreview
        html={body}
        editable={isEditable}
        resyncWithHtml={!dirty}
        onEditorReady={onEditorReady}
        onChange={(next) => {
          setBody(next);
          setDirty(true);
          setSaveError(null);
          setSaveAttempt(0);
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
  const [panelError, setPanelError] = useState<string | null>(null);
  const isDraft = contract.status === "draft";

  const handleAdd = async () => {
    if (!draftName.trim() || !draftEmail.trim()) return;
    setPanelError(null);
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
      setPanelError(friendlyError(err, "Could not add that signer."));
    }
  };

  const handleSend = async () => {
    setSending(true);
    setPanelError(null);
    try {
      await sendForSignature({ contractId: contract._id });
    } catch (err) {
      setPanelError(friendlyError(err, "Failed to send."));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[4px_4px_0px_0px_#1a1a1a] p-5">
      <h3 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#1a1a1a] mb-3">
        Recipients
      </h3>
      {panelError ? (
        <div
          className="mb-3 border-2 border-[#dc2626] bg-[#fef2f2] px-3 py-2 text-xs text-[#991b1b]"
          role="alert"
        >
          {panelError}
        </div>
      ) : null}
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
            <ul className="space-y-2 font-mono">
              {recipients.map((r) => (
                <li key={r._id} className="flex items-center gap-2">
                  <a
                    className="min-w-0 flex-1 truncate text-[#C2410C] underline hover:no-underline"
                    href={`/sign/${r.token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {r.email}
                  </a>
                  <button
                    type="button"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center border-2 border-[#1a1a1a] hover:bg-[#FFEDD5] sm:h-8 sm:w-8"
                    title={`Copy signing link for ${r.email}`}
                    aria-label={`Copy signing link for ${r.email}`}
                    onClick={() =>
                      void navigator.clipboard.writeText(
                        `${window.location.origin}/sign/${r.token}`,
                      )
                    }
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
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
  onOpenPlacement,
}: {
  contract: ContractDoc;
  recipients: RecipientDoc[];
  fields: FieldDoc[];
  onOpenPlacement: () => void;
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
        {/* Drag-and-drop placement on the document */}
        <button
          type="button"
          onClick={onOpenPlacement}
          className="w-full inline-flex items-center justify-center gap-1.5 border-2 border-[#1a1a1a] bg-[#1a1a1a] text-[#f0f0e8] h-9 text-[11px] font-bold uppercase tracking-wider hover:bg-[#C2410C] transition-colors"
        >
          Place fields on document →
        </button>

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

function VersionHistoryPanel({ contract }: { contract: ContractDoc }) {
  const versions = useQuery(api.contractsTable.listVersions, {
    contractId: contract._id,
  });
  const snapshot = useMutation(api.contractsTable.snapshotVersion);
  const restore = useMutation(api.contractsTable.restoreVersion);
  const remove = useMutation(api.contractsTable.removeVersion);
  const [label, setLabel] = useState("");
  const [working, setWorking] = useState(false);

  const handleSnapshot = async () => {
    setWorking(true);
    try {
      await snapshot({
        contractId: contract._id,
        label: label.trim() || undefined,
      });
      setLabel("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not save version.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="border-2 border-[#1a1a1a] bg-[#f0f0e8] p-5 shadow-[4px_4px_0px_0px_#1a1a1a]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#1a1a1a]">
          Version history
        </h3>
        <span className="font-mono text-[10px] text-[#888]">
          {versions?.length ?? 0} saved
        </span>
      </div>

      {contract.status === "draft" ? (
        <div className="mb-4 flex gap-2">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Version label (optional)"
            className="min-w-0 flex-1 rounded-none border-2 border-[#1a1a1a] bg-[#f0f0e8] text-sm"
          />
          <button
            type="button"
            onClick={() => void handleSnapshot()}
            disabled={working}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center border-2 border-[#1a1a1a] bg-[#1a1a1a] text-[#f0f0e8] hover:bg-[#C2410C] disabled:opacity-50"
            title="Save current version"
            aria-label="Save current version"
          >
            <Camera className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <ol className="space-y-2">
        {versions === undefined ? (
          <li className="text-xs text-[#888]">Loading history…</li>
        ) : versions.length === 0 ? (
          <li className="text-xs italic text-[#888]">
            Save a version before a major edit. Sending for signature also saves one automatically.
          </li>
        ) : (
          versions.map((version) => (
            <li
              key={version._id}
              className="flex items-center gap-2 border-l-2 border-[#C2410C] py-1 pl-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-[#1a1a1a]">
                  {version.label || `Version ${version.versionNumber}`}
                </div>
                <div className="text-[10px] text-[#888]">
                  {version.createdByName} · {formatRelativeTime(version._creationTime)}
                  {version.isCurrent ? " · current" : ""}
                </div>
              </div>
              {contract.status === "draft" && !version.isCurrent ? (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Restore ${version.label || `version ${version.versionNumber}`}?`)) {
                      void restore({ contractId: contract._id, versionId: version._id });
                    }
                  }}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center border-2 border-[#1a1a1a] hover:bg-[#FFEDD5]"
                  title="Restore this version"
                  aria-label="Restore this version"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (confirm("Delete this saved version?")) {
                    void remove({ contractId: contract._id, versionId: version._id });
                  }
                }}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center border-2 border-[#1a1a1a] hover:bg-[#dc2626] hover:text-white"
                title="Delete this version"
                aria-label="Delete this version"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))
        )}
      </ol>
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
