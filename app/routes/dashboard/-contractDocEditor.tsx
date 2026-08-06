import { Link, Navigate, useNavigate, useParams } from "@tanstack/react-router";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { FunctionReturnType } from "convex/server";
import * as Y from "yjs";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { ContractEditor } from "@/components/contracts/ContractEditor";
import { ContractToolbar } from "@/components/contracts/ContractToolbar";
import { DocumentOutline, useHeadings } from "@/components/contracts/DocumentOutline";
import { ContractSectionOutline } from "@/components/contracts/ContractSectionOutline";
import { SignatureFieldsSheet } from "@/components/contracts/SignatureFieldsSheet";
import { ContractWizardFullScreen } from "@/components/contracts/ContractWizardFullScreen";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn, formatRelativeTime } from "@/lib/utils";
import { contractPath, documentPath, projectPath } from "@/lib/routes";
import { friendlyError } from "@/lib/friendlyError";
import {
  contractYjsField,
  ConvexYjsProvider,
} from "@/lib/convexYjsProvider";
import {
  ArrowLeft,
  AtSign,
  Calendar,
  Camera,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  Copy,
  FileText,
  FileSignature as FileSignatureIcon,
  GripVertical,
  History,
  PanelLeft,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Share2,
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
type ContractListItem = FunctionReturnType<typeof api.contractsTable.list>[number];

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

const TOP_BUTTON =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-[#D8D8DE] bg-white px-3.5 text-[13px] font-medium text-[#131315] transition-colors hover:bg-[#F7F7F8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315] disabled:cursor-not-allowed disabled:opacity-40";
const TOP_BUTTON_PRIMARY =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-[#131315] bg-[#131315] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[#2A2A2E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315] disabled:cursor-not-allowed disabled:opacity-40";

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
  const convexClient = useConvex();

  const data = useQuery(api.contractsTable.get, { contractId });
  const projectItems = useQuery(api.contractsTable.list, { projectId });
  const project = useQuery(api.projects.get, { projectId });
  const deleteContract = useMutation(api.contractsTable.softDelete);
  const promoteDocument = useMutation(
    api.contractsTable.promoteDocumentToContract,
  );
  const applyWizard = useMutation(api.contractsTable.applyWizard);
  const createDocument = useMutation(api.contractsTable.create);
  const resetItemDoc = useMutation(api.contractDocs.resetItemDoc);
  const [fieldsSheetOpen, setFieldsSheetOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [signingOpen, setSigningOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [pendingSeedHtml, setPendingSeedHtml] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const seedRejectionsRef = useRef(0);

  useEffect(() => {
    seedRejectionsRef.current = 0;
    setSeedError(null);
  }, [contractId]);
  const [tabsCollapsed, setTabsCollapsed] = useState(false);
  const tabsPreferenceLoadedRef = useRef(false);
  const shareTimerRef = useRef<number | null>(null);

  // One project Y.Doc stores multiple items in named fragments. The provider
  // must finish applying the remote snapshot before Tiptap mounts, otherwise
  // an empty local editor can flash and then create a divergent seed.
  const [docEpoch, setDocEpoch] = useState(0);
  const ydoc = useMemo(() => new Y.Doc(), [contractId, docEpoch]);
  const yjsField = useMemo(() => contractYjsField(contractId), [contractId]);
  const providerRef = useRef<ConvexYjsProvider | null>(null);
  const syncKey = `${contractId}:${docEpoch}`;
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  const collabReady = syncedKey === syncKey;

  useEffect(() => {
    let active = true;
    const provider = new ConvexYjsProvider(ydoc, convexClient, projectId, {
      contractId,
      onSynced: () => {
        if (active) setSyncedKey(syncKey);
      },
    });
    providerRef.current = provider;
    return () => {
      active = false;
      if (providerRef.current === provider) providerRef.current = null;
      provider.destroy();
    };
  }, [contractId, convexClient, projectId, syncKey, ydoc]);

  useEffect(() => {
    setTabsCollapsed(
      window.localStorage.getItem("snip:doctabs:collapsed") === "true",
    );
    tabsPreferenceLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!tabsPreferenceLoadedRef.current) return;
    window.localStorage.setItem(
      "snip:doctabs:collapsed",
      String(tabsCollapsed),
    );
  }, [tabsCollapsed]);

  useEffect(
    () => () => {
      if (shareTimerRef.current !== null) {
        window.clearTimeout(shareTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (
      pendingSeedHtml !== null &&
      data?.contract.contentHtml === pendingSeedHtml
    ) {
      setPendingSeedHtml(null);
    }
  }, [data?.contract.contentHtml, pendingSeedHtml]);

  // Sections for contracts. Primary source: the wizard-generated
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
        level: 1,
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
        level: h.level,
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
    // Picking a section dismisses the overlay so you land on the scroll spot.
    setOutlineOpen(false);
  };

  const handleInitialSeed = useCallback(
    async (update: Uint8Array) => {
      const provider = providerRef.current;
      if (!provider) return false;
      try {
        const applied = await provider.seed(update);
        if (applied) setSeedError(null);
        return applied;
      } catch (error) {
        console.error("Convex Yjs seed failed", error);
        // A server error is not a lost seed race. Keep the locally planted
        // content editable (contentHtml autosave still protects the work)
        // and surface the failure instead of remount-looping.
        setSeedError(
          friendlyError(error, "This document could not sync. Edits save locally."),
        );
        return true;
      }
    },
    [],
  );

  const handleSeedRejected = useCallback(() => {
    // Another tab planted the seed first: rebuild once from the canonical
    // state. Repeated rejections mean something is wrong server-side, and
    // rebuilding again would spin — stop and surface it.
    seedRejectionsRef.current += 1;
    if (seedRejectionsRef.current > 2) {
      setSeedError("This document could not sync. Reload to try again.");
      return;
    }
    setDocEpoch((epoch) => epoch + 1);
  }, []);

  const handleCreateDocument = async () => {
    if (creatingDocument) return;
    setCreatingDocument(true);
    try {
      const documentId = await createDocument({
        projectId,
        title: "Untitled document",
        kind: "custom",
        docType: "document",
        contentHtml: "",
      });
      await navigate({ to: documentPath(teamSlug, projectId, documentId) });
    } catch (error) {
      alert(friendlyError(error, "Could not create a document."));
    } finally {
      // The rail survives the param-only navigation, so the flag must
      // reset on success too or the button stays stuck on "Creating".
      setCreatingDocument(false);
    }
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareCopied(true);
      if (shareTimerRef.current !== null) {
        window.clearTimeout(shareTimerRef.current);
      }
      shareTimerRef.current = window.setTimeout(() => {
        setShareCopied(false);
        shareTimerRef.current = null;
      }, 1800);
    } catch (error) {
      alert(friendlyError(error, "Could not copy the link."));
    }
  };

  const handleVersionRestored = useCallback(
    async (restoredHtml: string) => {
      await resetItemDoc({ projectId, contractId });
      setPendingSeedHtml(restoredHtml);
      setDocEpoch((epoch) => epoch + 1);
    },
    [contractId, projectId, resetItemDoc],
  );

  if (data === undefined) {
    return (
      <div className="surface-soft flex h-full flex-col bg-[#FAFAFA] font-['Inter_Tight',system-ui,sans-serif]">
        <div className="h-16 border-b border-[#E8E8EC] bg-white" />
        <div className="h-10 border-b border-[#E8E8EC] bg-white" />
        <div className="flex flex-1 items-start justify-center p-8">
          <div className="h-[560px] w-full max-w-[850px] animate-pulse rounded-[14px] border border-[#E8E8EC] bg-white" />
        </div>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="surface-soft flex h-full items-center justify-center bg-[#FAFAFA] font-['Inter_Tight',system-ui,sans-serif]">
        <div className="rounded-[14px] border border-[#E8E8EC] bg-white px-6 py-5 text-sm text-[#6E6E73]">
          {mode === "document" ? "Document not found." : "Contract not found."}
        </div>
      </div>
    );
  }

  // Route ⇄ row mismatch: send the user to the URL that matches what
  // the row actually is. Covers direct links to a document under
  // /contract/ (and vice versa) and promotion from document to contract.
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
  const canEdit = project !== undefined && project.role !== "viewer";
  const canDelete = project?.role === "admin";
  const usableEditor =
    canEdit && editor && !editor.isDestroyed && editor.view ? editor : null;
  const currentHtml =
    usableEditor?.getHTML() ?? data.contract.contentHtml ?? "";
  const initialSeedAllowed =
    canEdit &&
    data.contract.status === "draft" &&
    collabReady &&
    ydoc.getXmlFragment(yjsField).length === 0;

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
    <div className="surface-soft flex h-full min-w-0 flex-col overflow-hidden bg-[#FAFAFA] font-['Inter_Tight',system-ui,sans-serif] text-[#131315] antialiased">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#E8E8EC] bg-white px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            to={projectPath(teamSlug, projectId)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#D8D8DE] bg-white text-[#131315] transition-colors hover:bg-[#F7F7F8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315]"
            title="Back to project"
            aria-label="Back to project"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <InlineTitle
              key={data.contract._id}
              contractId={contractId}
              title={data.contract.title}
              editable={canEdit && data.contract.status === "draft"}
              kind={isDocument ? "document" : "contract"}
            />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {!isDocument ? (
              <span className="hidden shrink-0 rounded-full bg-[#F1F1F3] px-2.5 py-1 text-xs font-medium capitalize text-[#6E6E73] sm:inline-flex">
                {data.contract.status}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex min-w-0 max-w-[55%] items-center gap-2 overflow-x-auto lg:max-w-none">
          {/* Desktop gets the outline in the left rail; this opens the
              slide-over on small screens where the rail is hidden. */}
          <button
            type="button"
            onClick={() => setOutlineOpen(true)}
            className={cn(TOP_BUTTON, "md:hidden")}
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className={TOP_BUTTON}
          >
            <History className="h-4 w-4" />
            <span className="hidden lg:inline">History</span>
          </button>
          {!isDocument && canEdit && data.contract.status === "draft" ? (
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className={TOP_BUTTON}
            >
              Setup
            </button>
          ) : null}
          {isDocument ? (
            <button
              type="button"
              onClick={() => void handleShare()}
              className={TOP_BUTTON}
            >
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">
                {shareCopied ? "Copied" : "Share"}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSigningOpen(true)}
              className={TOP_BUTTON_PRIMARY}
            >
              <Send className="h-4 w-4" />
              Send
            </button>
          )}
          {isDocument ? (
            <button
              type="button"
              disabled={
                !canEdit || promoting || data.contract.status !== "draft"
              }
              onClick={() => void handlePromote()}
              className={TOP_BUTTON_PRIMARY}
              title="Add signers and signature fields"
            >
              <FileSignatureIcon className="h-4 w-4" />
              <span className="hidden sm:inline">
                {promoting ? "Preparing…" : "Prepare"}
              </span>
            </button>
          ) : null}
          {canDelete ? (
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
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#D8D8DE] bg-white text-[#D8434F] transition-colors hover:bg-[#F7F7F8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315] disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </header>

      <ContractToolbar editor={usableEditor} />

      {promoteError ? (
        <div role="alert" className="border-b border-[#E8B9BD] bg-[#FFF5F5] px-4 py-2 text-center text-sm text-[#8A2B34]">
          {promoteError}
        </div>
      ) : null}

      {seedError ? (
        <div role="alert" className="border-b border-[#E8B9BD] bg-[#FFF5F5] px-4 py-2 text-center text-sm text-[#8A2B34]">
          {seedError}
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        <DocumentTabsRail
          collapsed={tabsCollapsed}
          onToggleCollapsed={() => setTabsCollapsed((c) => !c)}
          sections={outlineSections}
          activeSectionId={activeSectionId}
          onSelectSection={scrollToSection}
          items={projectItems}
          currentId={contractId}
          projectId={projectId}
          teamSlug={teamSlug}
          canCreate={canEdit}
          creating={creatingDocument}
          onCreate={() => void handleCreateDocument()}
        />
        <ContractBody
          key={syncKey}
          contract={data.contract}
          ydoc={ydoc}
          yjsField={yjsField}
          collabReady={collabReady}
          initialSeedAllowed={initialSeedAllowed}
          seedHtml={pendingSeedHtml ?? data.contract.contentHtml ?? ""}
          canEdit={canEdit}
          onInitialSeed={handleInitialSeed}
          onSeedRejected={handleSeedRejected}
          onEditorReady={setEditor}
        />
      </div>

      {/* Sections outline — slide-over Sheet, identical affordance for both
          documents (live H1–H3 headings) and contracts (wizard clauses, with
          a heading fallback + Generate-sections action). */}
      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="left" className="flex w-full max-w-sm flex-col border-r border-[#E8E8EC] bg-white p-0 shadow-none">
          <SheetHeader className="border-b border-[#E8E8EC] px-5 py-4">
            <SheetTitle className="text-base font-semibold text-[#131315]">
              Sections
            </SheetTitle>
          </SheetHeader>
          {isDocument ? (
            <DocumentOutline editor={editor} onOpenChange={setOutlineOpen} inSheet />
          ) : (
            <ContractSectionOutline
              inSheet
              sections={outlineSections}
              activeSectionId={activeSectionId}
              onSelect={scrollToSection}
              onCollapse={() => setOutlineOpen(false)}
              renderSectionBody={() => (
                <div className="text-sm text-[#6E6E73]">
                  Edit this section directly in the document.
                </div>
              )}
              onRunWizard={
                canEdit && data.contract.status === "draft"
                  ? () => setWizardOpen(true)
                  : undefined
              }
              runWizardLabel={
                clauseSections ? "Re-run wizard" : "Generate sections"
              }
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="flex w-full max-w-sm flex-col border-l border-[#E8E8EC] bg-white p-0 shadow-none">
          <SheetHeader className="border-b border-[#E8E8EC] px-5 py-4">
            <SheetTitle className="text-base font-semibold text-[#131315]">
              History
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <VersionHistoryPanel
              contract={data.contract}
              canEdit={canEdit}
              currentHtml={currentHtml}
              onRestored={handleVersionRestored}
            />
          </div>
        </SheetContent>
      </Sheet>

      {!isDocument ? (
        <Sheet open={signingOpen} onOpenChange={setSigningOpen}>
          <SheetContent className="w-full overflow-y-auto border-l border-[#E8E8EC] bg-[#FAFAFA] p-0 shadow-none sm:max-w-md">
            <SheetHeader className="border-b border-[#E8E8EC] bg-white px-5 py-4">
              <SheetTitle className="text-base font-semibold text-[#131315]">
                Send
              </SheetTitle>
            </SheetHeader>
            <div className="space-y-3 p-4">
              <RecipientsPanel
                contract={data.contract}
                recipients={data.recipients}
                canEdit={canEdit}
                currentHtml={currentHtml}
              />
              <FieldsPanel
                contract={data.contract}
                recipients={data.recipients}
                fields={data.fields}
                onOpenPlacement={() => setFieldsSheetOpen(true)}
                canEdit={canEdit}
                currentHtml={currentHtml}
              />
              <AuditLogPanel audit={data.audit} />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {!isDocument && (
        <SignatureFieldsSheet
          open={fieldsSheetOpen}
          onOpenChange={setFieldsSheetOpen}
          contractId={data.contract._id}
          contentHtml={currentHtml}
          recipients={data.recipients}
          fields={data.fields}
          isDraft={canEdit && data.contract.status === "draft"}
        />
      )}

      {!isDocument && wizardOpen ? (
        <ContractWizardFullScreen
          projectId={projectId}
          projectName={data.contract.title}
          onClose={() => setWizardOpen(false)}
          onComplete={() => {
            setWizardOpen(false);
          }}
          onGenerate={async (projectType, answers) => {
            const generatedHtml = await applyWizard({
              contractId,
              projectType,
              answers,
            });
            await resetItemDoc({ projectId, contractId });
            setPendingSeedHtml(generatedHtml);
            setDocEpoch((epoch) => epoch + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function ContractBody({
  contract,
  ydoc,
  yjsField,
  collabReady,
  initialSeedAllowed,
  seedHtml,
  canEdit,
  onInitialSeed,
  onSeedRejected,
  onEditorReady,
}: {
  contract: ContractDoc;
  ydoc: Y.Doc;
  yjsField: string;
  collabReady: boolean;
  initialSeedAllowed: boolean;
  seedHtml: string;
  canEdit: boolean;
  onInitialSeed: (update: Uint8Array) => Promise<boolean>;
  onSeedRejected: () => void;
  onEditorReady: (editor: Editor | null) => void;
}) {
  const update = useMutation(api.contractsTable.update);
  const [body, setBody] = useState<string>(contract.contentHtml ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const revisionRef = useRef(0);
  const isEditable = canEdit && contract.status === "draft";
  const hasCollaborativeContent = ydoc.getXmlFragment(yjsField).length > 0;

  useEffect(() => {
    if (dirty) return;
    setBody(contract.contentHtml ?? "");
  }, [contract._id, contract.contentHtml, dirty]);

  // Unsaved work must survive a stray Cmd+W. Browsers show their own
  // generic prompt; returnValue just has to be set.
  useEffect(() => {
    if (!isEditable || (!dirty && !saveError)) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saveError, isEditable]);

  useEffect(() => {
    if (!isEditable || !dirty) return;
    if (body === contract.contentHtml) {
      setDirty(false);
      setSaving(false);
      setSaveError(null);
      return;
    }
    const revision = revisionRef.current;
    let active = true;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      try {
        await update({ contractId: contract._id, contentHtml: body });
        if (active && revisionRef.current === revision) {
          setDirty(false);
          setSaveError(null);
        }
      } catch (error) {
        if (active) {
          setSaveError(
            error instanceof Error ? error.message : "Could not save changes.",
          );
        }
      } finally {
        if (active) setSaving(false);
      }
    }, 1200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [body, contract._id, contract.contentHtml, dirty, isEditable, update]);

  const handleEditorReady = useCallback(
    (nextEditor: Editor | null) => {
      onEditorReady(nextEditor);
      if (!nextEditor || initialSeedAllowed) return;
      const next = nextEditor.getHTML();
      if (next !== contract.contentHtml) {
        revisionRef.current += 1;
        setBody(next);
        setDirty(true);
      }
    },
    [contract.contentHtml, initialSeedAllowed, onEditorReady],
  );

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-[#FAFAFA] px-3 py-4 sm:px-6 sm:py-7 lg:px-10 lg:py-8">
      {saveError ? (
        <div className="mx-auto mb-3 flex max-w-[850px] items-center justify-between gap-3 rounded-[11px] border border-[#E8B9BD] bg-[#FFF5F5] px-3 py-2 text-sm text-[#8A2B34]" role="alert">
          <span>{saveError}</span>
          <button
            type="button"
            onClick={() => {
              setSaveError(null);
              setDirty(true);
            }}
            className="rounded-full border border-[#D8D8DE] bg-white px-3 py-1.5 text-[13px] font-medium text-[#131315] hover:bg-[#F7F7F8]"
          >
            Retry
          </button>
        </div>
      ) : null}
      <article className="relative mx-auto min-h-full w-full max-w-[850px] rounded-[14px] border border-[#E8E8EC] bg-white px-5 py-8 sm:px-10 sm:py-10 lg:px-16 lg:py-14">
        {isEditable ? (
          <div className="absolute right-4 top-3 text-xs text-[#A0A0A5]" aria-live="polite">
            {saving ? "Saving…" : dirty ? "Unsaved" : "Saved"}
          </div>
        ) : null}
        {collabReady ? (
          <ContractEditor
            contentHtml={seedHtml}
            onChange={(next) => {
              revisionRef.current += 1;
              setBody(next);
              setDirty(next !== contract.contentHtml);
              setSaveError(null);
            }}
            editable={isEditable}
            ydoc={isEditable || hasCollaborativeContent ? ydoc : null}
            yjsField={yjsField}
            seedHtmlIfEmpty={initialSeedAllowed}
            onInitialSeed={onInitialSeed}
            onSeedRejected={onSeedRejected}
            chromeMode="bare"
            onEditorReady={handleEditorReady}
          />
        ) : (
          <div className="space-y-4 py-8" aria-label="Loading editor">
            <div className="h-7 w-2/3 animate-pulse rounded-[8px] bg-[#F1F1F3]" />
            <div className="h-4 w-full animate-pulse rounded-[8px] bg-[#F1F1F3]" />
            <div className="h-4 w-5/6 animate-pulse rounded-[8px] bg-[#F1F1F3]" />
          </div>
        )}
      </article>
    </main>
  );
}

function InlineTitle({
  contractId,
  title,
  editable,
  kind,
}: {
  contractId: Id<"contracts">;
  title: string;
  editable: boolean;
  kind: "document" | "contract";
}) {
  const update = useMutation(api.contractsTable.update);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const focusedRef = useRef(false);
  const dirtyRef = useRef(false);
  const revisionRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (focusedRef.current || dirtyRef.current) return;
    setDraft(title);
  }, [title]);

  const save = async () => {
    focusedRef.current = false;
    const next = draft.trim();
    if (!next || next === title) {
      setDraft(title);
      dirtyRef.current = false;
      return;
    }
    const revision = revisionRef.current;
    setError(null);
    try {
      await update({ contractId, title: next });
      if (revisionRef.current === revision) dirtyRef.current = false;
    } catch (saveError) {
      if (!mountedRef.current) return;
      if (revisionRef.current !== revision) return;
      setError(friendlyError(saveError, "Could not rename this item."));
      setDraft(title);
      dirtyRef.current = false;
    }
  };

  if (!editable) {
    return <h1 className="max-w-[28rem] truncate text-base font-semibold leading-5 text-[#131315]">{title}</h1>;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        value={draft}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(event) => {
          revisionRef.current += 1;
          dirtyRef.current = true;
          setDraft(event.target.value);
        }}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            revisionRef.current += 1;
            dirtyRef.current = false;
            setDraft(title);
            event.currentTarget.blur();
          }
        }}
        aria-label={`Rename ${kind}`}
        maxLength={160}
        className="min-w-[8rem] max-w-[28rem] truncate border-0 bg-transparent p-0 text-base font-semibold leading-5 text-[#131315] outline-none focus-visible:ring-0"
        size={Math.min(Math.max(draft.length, 12), 42)}
      />
      {error ? <span className="text-xs text-[#D8434F]" role="alert">{error}</span> : null}
    </div>
  );
}

type RailSection = {
  id: string;
  title: string;
  sectionKey: string;
  required: boolean;
  level: number;
};

function DocumentTabsRail({
  collapsed,
  onToggleCollapsed,
  sections,
  activeSectionId,
  onSelectSection,
  items,
  currentId,
  projectId,
  teamSlug,
  canCreate,
  creating,
  onCreate,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sections: RailSection[];
  activeSectionId: string | null;
  onSelectSection: (sectionId: string) => void;
  items: ContractListItem[] | undefined;
  currentId: Id<"contracts">;
  projectId: Id<"projects">;
  teamSlug: string;
  canCreate: boolean;
  creating: boolean;
  onCreate: () => void;
}) {
  if (collapsed) {
    // Google-Docs-style: the closed rail leaves a floating handle over the
    // canvas instead of a docked strip.
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        title="Show outline"
        aria-label="Show outline"
        className="absolute left-4 top-4 z-10 hidden h-9 w-9 items-center justify-center rounded-full border border-[#E8E8EC] bg-white text-[#6E6E73] shadow-[0_1px_2px_rgba(19,19,21,0.06)] transition-colors hover:bg-[#F7F7F8] hover:text-[#131315] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131315] md:inline-flex"
      >
        <PanelLeft className="h-4 w-4" />
      </button>
    );
  }
  const documents = items?.filter((item) => item.docType === "document");
  const contracts = items?.filter(
    (item) => (item.docType ?? "contract") === "contract",
  );

  const rowClass = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#131315]",
      active
        ? "bg-[#FFF0E6] font-medium text-[#D14E00]"
        : "text-[#131315] hover:bg-[#F1F1F3]",
    );

  return (
    <aside className="hidden w-[232px] shrink-0 flex-col overflow-y-auto border-r border-[#E8E8EC] bg-white px-3 py-4 md:flex">
      <div className="flex items-center justify-between pb-2 pl-2.5 pr-1">
        <span className="text-[13px] leading-[18px] text-[#A0A0A5]">Outline</span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Hide outline"
          aria-label="Hide outline"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#A0A0A5] transition-colors hover:bg-[#F1F1F3] hover:text-[#131315] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#131315]"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
      <nav className="space-y-0.5">
        {sections.length === 0 ? (
          <p className="px-2.5 py-1 text-[13px] leading-[18px] text-[#A0A0A5]">
            Headings appear here.
          </p>
        ) : (
          sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelectSection(section.id)}
              className={cn(
                "flex w-full items-center rounded-[10px] py-1.5 pr-2.5 text-left text-[13px] leading-[18px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#131315]",
                section.level <= 1
                  ? "pl-2.5"
                  : section.level === 2
                    ? "pl-5"
                    : "pl-7",
                section.id === activeSectionId
                  ? "bg-[#FFF0E6] font-medium text-[#D14E00]"
                  : "text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]",
              )}
            >
              <span className="truncate">{section.title}</span>
            </button>
          ))
        )}
      </nav>

      <div className="mt-6 px-2.5 pb-2 text-[13px] leading-[18px] text-[#A0A0A5]">Documents</div>
      <nav className="space-y-0.5">
        {documents?.map((item) => (
          <Link
            key={item._id}
            to={documentPath(teamSlug, projectId, item._id)}
            className={rowClass(item._id === currentId)}
          >
            <FileText className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{item.title}</span>
          </Link>
        ))}
        {items === undefined ? (
          <div className="mx-2.5 h-8 animate-pulse rounded-[10px] bg-[#F1F1F3]" />
        ) : null}
      </nav>

      {contracts && contracts.length > 0 ? (
        <>
          <div className="mt-5 px-2.5 pb-2 text-[13px] leading-[18px] text-[#A0A0A5]">Contracts</div>
          <nav className="space-y-0.5">
            {contracts.map((item) => (
              <Link
                key={item._id}
                to={contractPath(teamSlug, projectId, item._id)}
                className={rowClass(item._id === currentId)}
              >
                <FileSignatureIcon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{item.title}</span>
              </Link>
            ))}
          </nav>
        </>
      ) : null}

      {canCreate ? (
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="mt-auto flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-sm text-[#6E6E73] transition-colors hover:bg-[#F1F1F3] hover:text-[#131315] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#131315] disabled:opacity-40"
        >
          <Plus className="h-4 w-4 shrink-0" />
          {creating ? "Creating…" : "New document"}
        </button>
      ) : null}
    </aside>
  );
}

function RecipientsPanel({
  contract,
  recipients,
  canEdit,
  currentHtml,
}: {
  contract: ContractDoc;
  recipients: RecipientDoc[];
  canEdit: boolean;
  currentHtml: string;
}) {
  const addRecipient = useMutation(api.contractsTable.addRecipient);
  const removeRecipient = useMutation(api.contractsTable.removeRecipient);
  const sendForSignature = useMutation(api.contractsTable.sendForSignature);
  const voidContract = useMutation(api.contractsTable.voidContract);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const isDraft = canEdit && contract.status === "draft";

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
      await sendForSignature({
        contractId: contract._id,
        contentHtml: currentHtml,
      });
    } catch (err) {
      setPanelError(friendlyError(err, "Failed to send."));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-[14px] border border-[#E8E8EC] bg-white p-5">
      <h3 className="mb-3 text-base font-semibold text-[#131315]">
        Recipients
      </h3>
      {panelError ? (
        <div
          className="mb-3 rounded-[11px] border border-[#E8B9BD] bg-[#FFF5F5] px-3 py-2 text-sm text-[#8A2B34]"
          role="alert"
        >
          {panelError}
        </div>
      ) : null}
      <ul className="space-y-2 mb-4">
        {recipients.length === 0 && (
          <li className="text-sm text-[#6E6E73]">No recipients yet.</li>
        )}
        {recipients.map((r) => (
          <li
            key={r._id}
            className="flex items-start justify-between gap-2 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] px-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[#131315]">
                {r.name}
              </div>
              <div className="truncate text-[13px] text-[#6E6E73]">{r.email}</div>
              <div className="mt-1 inline-flex rounded-full bg-[#F1F1F3] px-2 py-0.5 text-xs capitalize text-[#6E6E73]">
                {r.status}
              </div>
            </div>
            {isDraft && (
              <button
                type="button"
                onClick={() => removeRecipient({ recipientId: r._id })}
                aria-label="Remove recipient"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#D8D8DE] bg-white text-[#6E6E73] transition-colors hover:bg-[#F7F7F8] hover:text-[#D8434F]"
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
              className="rounded-[11px] border-[#D8D8DE] bg-white text-sm"
            />
            <Input
              value={draftEmail}
              onChange={(e) => setDraftEmail(e.target.value)}
              placeholder="signer@example.com"
              type="email"
              className="rounded-[11px] border-[#D8D8DE] bg-white text-sm"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!draftName.trim() || !draftEmail.trim()}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-[#D8D8DE] bg-white text-[13px] font-medium text-[#131315] transition-colors hover:bg-[#F7F7F8] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add signer
            </button>
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || recipients.length === 0}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full border border-[#131315] bg-[#131315] text-[13px] font-medium text-white transition-colors hover:bg-[#2A2A2E] disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {sending ? "Sending…" : "Send for signature"}
          </button>
        </>
      ) : contract.status === "pending" ? (
        <div className="space-y-3">
          <div className="rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-3 text-sm">
            <div className="mb-2 text-[13px] font-medium text-[#131315]">
              Signing links
            </div>
            <ul className="space-y-2">
              {recipients.map((r) => (
                <li key={r._id} className="flex items-center gap-2">
                  <a
                    className="min-w-0 flex-1 truncate text-[#D14E00] underline hover:no-underline"
                    href={`/sign/${r.token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {r.email}
                  </a>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#D8D8DE] bg-white transition-colors hover:bg-[#F7F7F8]"
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
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-[#D8D8DE] bg-white text-[13px] font-medium text-[#D8434F] transition-colors hover:bg-[#FFF5F5]"
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
 * Google Docs-style eSignature side panel:
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
  canEdit,
  currentHtml,
}: {
  contract: ContractDoc;
  recipients: RecipientDoc[];
  fields: FieldDoc[];
  onOpenPlacement: () => void;
  canEdit: boolean;
  currentHtml: string;
}) {
  const addField = useMutation(api.contractsTable.addField);
  const removeField = useMutation(api.contractsTable.removeField);
  const sendForSignature = useMutation(api.contractsTable.sendForSignature);
  const [selectedRecipient, setSelectedRecipient] = useState<Id<"contractRecipients"> | "">("");
  const [recipientMenuOpen, setRecipientMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const isDraft = canEdit && contract.status === "draft";

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
      await sendForSignature({
        contractId: contract._id,
        contentHtml: currentHtml,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't send for signature.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col rounded-[14px] border border-[#E8E8EC] bg-white">
      {/* Header strip */}
      <div className="flex items-center justify-between border-b border-[#E8E8EC] px-4 py-3">
        <div className="flex items-center gap-2">
          <FileSignatureIcon className="h-4 w-4 text-[#D14E00]" strokeWidth={2} />
          <h3 className="text-base font-semibold text-[#131315]">
            eSignature
          </h3>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* Drag-and-drop placement on the document */}
        <button
          type="button"
          onClick={onOpenPlacement}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-[#131315] bg-[#131315] text-[13px] font-medium text-white transition-colors hover:bg-[#2A2A2E]"
        >
          Place fields
        </button>

        {/* Insert fields for */}
        <div>
          <div className="mb-1.5 text-[13px] text-[#A0A0A5]">
            Insert fields for
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setRecipientMenuOpen((v) => !v)}
              disabled={recipients.length === 0 || !isDraft}
              className="inline-flex h-10 w-full items-center justify-between gap-2 rounded-[11px] border border-[#D8D8DE] bg-white px-3 transition-colors hover:bg-[#F7F7F8] disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className="h-6 w-6 shrink-0 rounded-full border border-[#D8D8DE] bg-[#FFF0E6]" />
                <span className="truncate text-sm font-medium text-[#131315]">
                  {currentRecipient?.name ?? "Add a signer first"}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-[#6E6E73]" />
            </button>
            {recipientMenuOpen && recipients.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-[11px] border border-[#E8E8EC] bg-white p-1">
                {recipients.map((r) => (
                  <button
                    key={r._id}
                    type="button"
                    onClick={() => {
                      setSelectedRecipient(r._id);
                      setRecipientMenuOpen(false);
                    }}
                    className={cn(
                      "inline-flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm transition-colors hover:bg-[#F1F1F3]",
                      r._id === selectedRecipient && "bg-[#FFF0E6] text-[#D14E00]",
                    )}
                  >
                    <span className="h-5 w-5 shrink-0 rounded-full border border-[#D8D8DE] bg-white" />
                    <span className="flex-1 truncate font-medium">
                      {r.name}
                    </span>
                    <span className="text-xs capitalize text-[#6E6E73]">
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
          <div className="mb-1.5 text-[13px] text-[#A0A0A5]">
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
          <div className="mb-1.5 text-[13px] text-[#A0A0A5]">
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
            <div className="mb-1.5 text-[13px] text-[#A0A0A5]">
              Placed fields
            </div>
            <ul className="space-y-2">
              {recipients.map((r) => {
                const rfs = fieldsByRecipient.get(r._id as string) ?? [];
                if (rfs.length === 0) return null;
                return (
                  <li key={r._id}>
                    <div className="text-[13px] font-medium text-[#D14E00]">
                      {r.name}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {rfs.map((f) => {
                        const Icon = FIELD_TYPE_ICONS[f.type];
                        return (
                          <li
                            key={f._id}
                            className="flex items-center gap-2 rounded-[8px] border border-[#E8E8EC] bg-[#FAFAFA] px-2 py-1.5 text-[13px]"
                          >
                            <Icon
                              className="h-3.5 w-3.5 text-[#D14E00]"
                              strokeWidth={1.75}
                            />
                            <span className="flex-1 font-medium text-[#131315]">
                              {FIELD_TYPE_LABELS[f.type]}
                            </span>
                            {isDraft && (
                              <button
                                type="button"
                                onClick={() => removeField({ fieldId: f._id })}
                                aria-label="Remove field"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#6E6E73] transition-colors hover:bg-[#F1F1F3] hover:text-[#D8434F]"
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
      <div className="space-y-2 border-t border-[#E8E8EC] bg-white p-4">
        {requestDisabled && (
          <p className="text-center text-[13px] leading-[18px] text-[#6E6E73]">
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
            "inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border text-[13px] font-medium transition-colors",
            requestDisabled || sending
              ? "cursor-not-allowed border-[#D8D8DE] bg-[#F1F1F3] text-[#A0A0A5]"
              : "border-[#131315] bg-[#131315] text-white hover:bg-[#2A2A2E]",
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
          "inline-flex h-10 w-full items-center gap-2 rounded-[10px] border border-[#D8D8DE] bg-white px-3 transition-colors",
          disabled
            ? "opacity-50 cursor-not-allowed"
            : "cursor-grab hover:bg-[#F7F7F8] active:cursor-grabbing",
        )}
        draggable={!disabled}
        title="Click to add a field for the selected recipient"
      >
        <GripVertical className="h-4 w-4 text-[#A0A0A5]" />
        <Icon className="h-4 w-4 text-[#D14E00]" strokeWidth={1.75} />
        <span className="text-sm font-medium text-[#131315]">
          {FIELD_TYPE_LABELS[type]}
        </span>
      </button>
    </li>
  );
}

function VersionHistoryPanel({
  contract,
  canEdit,
  currentHtml,
  onRestored,
}: {
  contract: ContractDoc;
  canEdit: boolean;
  currentHtml: string;
  onRestored?: (restoredHtml: string) => void | Promise<void>;
}) {
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
        contentHtml: currentHtml,
      });
      setLabel("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not save version.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-[#131315]">
          Saved versions
        </h3>
        <span className="text-xs text-[#A0A0A5]">
          {versions?.length ?? 0} saved
        </span>
      </div>

      {canEdit && contract.status === "draft" ? (
        <div className="mb-4 flex gap-2">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Version label"
            className="min-w-0 flex-1 rounded-[11px] border-[#D8D8DE] bg-white text-sm"
          />
          <button
            type="button"
            onClick={() => void handleSnapshot()}
            disabled={working}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#131315] bg-[#131315] text-white transition-colors hover:bg-[#2A2A2E] disabled:opacity-50"
            title="Save current version"
            aria-label="Save current version"
          >
            <Camera className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <ol>
        {versions === undefined ? (
          <li className="text-sm text-[#6E6E73]">Loading…</li>
        ) : versions.length === 0 ? (
          <li className="text-sm leading-5 text-[#6E6E73]">
            Save a version before a major edit. Sending for signature also saves one automatically.
          </li>
        ) : (
          versions.map((version) => (
            <li
              key={version._id}
              className="flex items-center gap-2 border-t border-[#F1F1F3] py-3 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[#131315]">
                  {version.label || `Version ${version.versionNumber}`}
                </div>
                <div className="text-xs text-[#6E6E73]">
                  {version.createdByName} · {formatRelativeTime(version._creationTime)}
                  {version.isCurrent ? " · current" : ""}
                </div>
              </div>
              {canEdit && contract.status === "draft" && !version.isCurrent ? (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Restore ${version.label || `version ${version.versionNumber}`}?`)) {
                      void (async () => {
                        try {
                          const restoredHtml = await restore({
                            contractId: contract._id,
                            versionId: version._id,
                          });
                          await onRestored?.(restoredHtml);
                        } catch (error) {
                          alert(
                            error instanceof Error
                              ? error.message
                              : "Could not restore this version.",
                          );
                        }
                      })();
                    }
                  }}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#D8D8DE] bg-white transition-colors hover:bg-[#F7F7F8]"
                  title="Restore this version"
                  aria-label="Restore this version"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {canEdit ? <button
                type="button"
                onClick={() => {
                  if (confirm("Delete this saved version?")) {
                    void remove({ contractId: contract._id, versionId: version._id });
                  }
                }}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#D8D8DE] bg-white text-[#D8434F] transition-colors hover:bg-[#FFF5F5]"
                title="Delete this version"
                aria-label="Delete this version"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button> : null}
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

function AuditLogPanel({ audit }: { audit: AuditDoc[] }) {
  return (
    <div className="rounded-[14px] border border-[#E8E8EC] bg-white p-5">
      <h3 className="mb-3 text-base font-semibold text-[#131315]">
        Audit log
      </h3>
      <ol>
        {audit.length === 0 && (
          <li className="text-sm text-[#6E6E73]">No events yet.</li>
        )}
        {audit.map((e) => (
          <li key={e._id} className="border-t border-[#F1F1F3] py-3 first:border-t-0">
            <div className="text-sm font-medium capitalize text-[#131315]">
              {e.action.replace(/_/g, " ")}
            </div>
            <div className="text-xs text-[#6E6E73]">
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
