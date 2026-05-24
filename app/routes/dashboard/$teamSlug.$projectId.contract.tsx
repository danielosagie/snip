import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { ConvexYjsProvider } from "@/lib/convexYjsProvider";
import { ContractWizardFullScreen } from "@/components/contracts/ContractWizardFullScreen";
import {
  ContractSectionOutline,
  ContractSectionOutlineCollapsedToggle,
} from "@/components/contracts/ContractSectionOutline";
import { SectionAnswerFields } from "@/components/contracts/SectionAnswerFields";
import { AddSectionDialog } from "@/components/contracts/AddSectionDialog";
import { ContractFileMenubar } from "@/components/contracts/ContractFileMenubar";
import { ContractCommentsPanel } from "@/components/contracts/ContractCommentsPanel";
import { ContractVersionsPanel } from "@/components/contracts/ContractVersionsPanel";
import { ContractShareDialog } from "@/components/contracts/ContractShareDialog";
import { ContractToolbar } from "@/components/contracts/ContractToolbar";
import type {
  ProjectType,
  WizardAnswers,
} from "@convex/contractTemplates";
import {
  ArrowLeft,
  Share2,
  MessageSquare,
  History,
  FilePlus2,
  Undo2,
  Redo2,
  Printer,
  PanelLeft,
  PanelLeftClose,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ContractEditor } from "@/components/contracts/ContractEditor";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { renderClausesAsHtml } from "@convex/contractTemplates";
import {
  docxFileToHtml,
  htmlToDocxBlob,
  triggerBlobDownload,
} from "@/lib/docx";
import { cn } from "@/lib/utils";
import { seoHead } from "@/lib/seo";
import { projectPath } from "@/lib/routes";
import { useSidebarState } from "@/lib/sidebarContext";

export const Route = createFileRoute("/dashboard/$teamSlug/$projectId/contract")({
  head: () =>
    seoHead({
      title: "Contract",
      description: "Edit the project contract.",
      path: "/dashboard",
      noIndex: true,
    }),
  component: ContractFullPage,
});

const DEFAULT_HTML = `<h1>Statement of Work</h1>
<h2>Scope</h2>
<p>Describe what the agency will deliver. Keep it tight — videos to be produced, length, format, platforms.</p>
<h2>Deliverables</h2>
<ul>
  <li>1× hero 60s edit, ProRes 422, 1920×1080</li>
  <li>3× 15s social cutdowns, H.264, 1080×1920</li>
</ul>
<h2>Revisions</h2>
<p>Up to <strong>2 rounds</strong> of revisions per deliverable.</p>
<h2>Timeline</h2>
<p>Final delivery on <em>[date]</em>. Client review turnaround: 48 hours.</p>
<h2>Payment</h2>
<p>50% due on signature, balance due on final delivery.</p>
<h2>License</h2>
<p>Upon full payment, client receives a perpetual, worldwide license to use the deliverables for their stated purpose.</p>`;

function ContractFullPage() {
  const { teamSlug, projectId } = useParams({ strict: false }) as {
    teamSlug: string;
    projectId: string;
  };
  const navigate = useNavigate();
  // Shared with DashboardSidebar via SidebarProvider (mounted in the
  // /dashboard layout, which wraps this route). This page renders its
  // own top bar instead of DashboardHeader, so it has to surface the
  // collapse toggle itself for parity with the rest of the dashboard.
  const { collapsed, toggle: toggleSidebar } = useSidebarState();

  // ESC bails out of the contract editor back to the project page. Autosave
  // handles in-flight edits so dropping out mid-typing won't lose work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      // Don't intercept ESC while the user is typing in an editor or
      // dismissing a nested popover — bail out only on "ambient" ESC.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      void navigate({
        to: projectPath(teamSlug, projectId as Id<"projects">),
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, teamSlug, projectId]);

  const convexClient = useConvex();
  const project = useQuery(api.projects.get, {
    projectId: projectId as Id<"projects">,
  });
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});
  const upsertContract = useMutation(api.projects.upsertContract);
  const addCustomClause = useMutation(api.contractClauses.addCustomClause);
  const removeClause = useMutation(api.contractClauses.removeClause);
  const sendForSignature = useMutation(api.projects.sendContractForSignature);
  const signContractDemo = useMutation(api.projects.signContractDemo);
  const clearContract = useMutation(api.projects.clearContract);
  const linkDocxFile = useMutation(api.projects.linkContractDocxFile);
  const getUploadUrl = useAction(api.contracts.getContractDocxUploadUrl);
  const resetCollabDoc = useMutation(api.contractDocs.resetDoc);
  const snapshotVersion = useMutation(api.contractVersions.snapshot);

  // Does a server-side collab doc already exist for this project?
  //   undefined → still loading (don't seed yet)
  //   null      → no doc yet → editor must seed from the wizard's
  //               contentHtml (this is the wizard → editor bridge)
  //   object    → doc exists → never reseed (would duplicate content)
  // Must stay above the early returns so hook order is stable.
  const serverContractDoc = useQuery(
    api.contractDocs.getDoc,
    projectId ? { projectId: projectId as Id<"projects"> } : "skip",
  );

  // ─── Real-time collab via Yjs + Convex ─────────────────────────────────
  //
  // One Y.Doc per browser tab on this contract. The ConvexYjsProvider
  // subscribes to api.contractDocs.getDoc and pushes local updates to
  // api.contractDocs.appendUpdate. Yjs handles all the merging.
  //
  // We only create the provider once per session. Re-mounts (e.g. HMR)
  // would race against the subscription — useMemo with a stable key
  // guards that. The provider's destroy() also flushes pending edits.
  // Bumped on clear / wizard re-run so the in-memory Y.Doc is thrown
  // away and rebuilt. Resetting only the server row isn't enough — the
  // old doc lives on in this tab's memory and would keep its stale
  // content, so the freshly-generated contract would never seed in.
  const [docEpoch, setDocEpoch] = useState(0);
  const ydoc = useMemo(() => new Y.Doc(), [projectId, docEpoch]);
  const [collabReady, setCollabReady] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    const provider = new ConvexYjsProvider(
      ydoc,
      convexClient,
      projectId as Id<"projects">,
    );
    setCollabReady(true);
    return () => {
      provider.destroy();
    };
  }, [ydoc, convexClient, projectId]);

  // Clear the server collab doc AND throw away the in-memory Y.Doc so a
  // freshly (re)generated contract actually seeds in. Used by both
  // "Clear" and "Re-run wizard" — without the epoch bump the old doc
  // would keep its stale content and the new contentHtml never lands.
  const regenerateCollabDoc = useCallback(async () => {
    if (!projectId) return;
    await resetCollabDoc({ projectId: projectId as Id<"projects"> });
    setDocEpoch((e) => e + 1);
  }, [resetCollabDoc, projectId]);

  const existing = project?.contract;
  const isSigned = Boolean(existing?.signedAt);
  const isSent = Boolean(existing?.sentForSignatureAt) && !isSigned;

  const [contentHtml, setContentHtml] = useState<string>(DEFAULT_HTML);
  const [scope, setScope] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [revisions, setRevisions] = useState("");
  const [deadline, setDeadline] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [originalFilename, setOriginalFilename] = useState<string | undefined>();
  const [demoSignName, setDemoSignName] = useState("");
  const [busy, setBusy] = useState<null | string>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  // Sidebar + right-panel toggles. Outline open by default on
  // desktop; panels closed so the doc gets the most room until
  // the user opts in.
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState<
    null | "comments" | "versions"
  >(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  // Scroll container for the editor — used to scroll headings into
  // view when the user clicks a section in the outline.
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(
    null,
  );
  // The Tiptap editor instance, lifted into the contract page so we
  // can render its toolbar separately from the page body.
  // Use a helper to treat a destroyed-but-still-referenced editor as
  // null — `editor.can()` and `.chain()` throw when called against a
  // torn-down ProseMirror view (happens briefly when Yjs swaps the
  // ydoc, or in dev when HMR re-mounts). Anywhere we'd call those
  // methods, gate on `usableEditor` instead of the raw state.
  const [tiptapEditor, setTiptapEditor] = useState<TiptapEditor | null>(
    null,
  );
  const usableEditor: TiptapEditor | null =
    tiptapEditor && !tiptapEditor.isDestroyed && tiptapEditor.view
      ? tiptapEditor
      : null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initRef = useRef(false);
  // Body we last auto-snapshotted, so the 5-min timer only saves a version
  // when the contract actually changed (no idle churn). Seeded on hydrate.
  const lastSnapshotHtmlRef = useRef<string | null>(null);

  // Hydrate fields from existing contract once it loads.
  useEffect(() => {
    if (initRef.current) return;
    if (project === undefined) return;
    initRef.current = true;
    setContentHtml(existing?.contentHtml ?? DEFAULT_HTML);
    setScope(existing?.scope ?? "");
    setDeliverables(existing?.deliverablesSummary ?? "");
    setPriceDollars(
      existing?.priceCents != null ? (existing.priceCents / 100).toFixed(2) : "",
    );
    setCurrency(existing?.currency ?? "usd");
    setRevisions(existing?.revisionsAllowed?.toString() ?? "");
    setDeadline(existing?.deadline ?? "");
    setClientName(existing?.clientName ?? "");
    setClientEmail(existing?.clientEmail ?? "");
    setOriginalFilename(existing?.originalFilename ?? undefined);
    // Baseline for the autosnapshot diff so we don't snapshot unchanged content.
    lastSnapshotHtmlRef.current = existing?.contentHtml ?? null;
  }, [project, existing]);

  // Google-Docs-style autosnapshot: every ~5 min, if the contract body changed
  // since the last snapshot, save a labeled version. The debounced autosave
  // above keeps contract.contentHtml current, so the snapshot mutation (which
  // reads the server contract) captures the latest. Refs keep the latest values
  // available without resetting the interval on every keystroke.
  const snapshotStateRef = useRef({ existing, isSigned, contentHtml });
  snapshotStateRef.current = { existing, isSigned, contentHtml };
  useEffect(() => {
    if (!projectId) return;
    const FIVE_MIN = 5 * 60 * 1000;
    const id = window.setInterval(() => {
      const s = snapshotStateRef.current;
      const html = s.existing?.contentHtml ?? s.contentHtml;
      if (!html || html.trim().length === 0) return;
      if (s.isSigned) return; // don't churn versions on a locked contract
      if (lastSnapshotHtmlRef.current === html) return; // unchanged → skip
      lastSnapshotHtmlRef.current = html;
      void snapshotVersion({
        projectId: projectId as Id<"projects">,
        label: "Autosave",
      }).catch((e) => console.error("auto-snapshot failed", e));
    }, FIVE_MIN);
    return () => window.clearInterval(id);
  }, [projectId, snapshotVersion]);

  // After a wizard (re)generation we bump `docEpoch` and reset the collab doc.
  // The freshly generated body lands in `existing.contentHtml` a beat later
  // (separate Convex subscription). Deterministically pull it into
  // `contentHtml` once it actually arrives so the collab seed plants the real
  // contract — not whatever the one-shot init effect captured first. Keyed on
  // epoch + the server value so it can't fire on the initial (epoch 0) load.
  useEffect(() => {
    if (docEpoch === 0) return;
    const html = existing?.contentHtml;
    if (html && html.trim().length > 0) {
      setContentHtml(html);
    }
  }, [docEpoch, existing?.contentHtml]);

  // Debounced autosave. Fires ~1.2s after the user stops typing.
  // MUST live above the early-return guards below or React will
  // throw "rendered more hooks than during the previous render" on
  // the first frame when project is still undefined. Inlines the
  // upsert call so we don't need a forward ref to persistContract
  // (which is defined further down the function body).
  useEffect(() => {
    if (!dirty) return;
    // No signed/sent lock — a contract edits like any document. The
    // upsertContract mutation reverts a signed/sent contract to draft.
    if (project === undefined || !project) return;
    if (busy && busy !== "autosave") return;
    const handle = window.setTimeout(async () => {
      setBusy("autosave");
      try {
        await upsertContract({
          projectId: projectId as Id<"projects">,
          contract: {
            contentHtml,
            scope: scope.trim() || undefined,
            deliverablesSummary: deliverables.trim() || undefined,
            priceCents: priceDollars
              ? Math.round(parseFloat(priceDollars) * 100)
              : undefined,
            currency: currency.toLowerCase() || "usd",
            revisionsAllowed: revisions ? parseInt(revisions, 10) : undefined,
            deadline: deadline.trim() || undefined,
            clientName: clientName.trim() || undefined,
            clientEmail: clientEmail.trim() || undefined,
            originalFilename,
          },
        });
        setDirty(false);
      } catch (e) {
        // Keep "Unsaved" visible so the user notices without a toast.
        console.error("autosave failed", e);
      } finally {
        setBusy(null);
      }
    }, 1200);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- we
    // intentionally watch `dirty` only; the captured state values
    // are read at fire time via the latest closure each render.
  }, [dirty, isSigned, busy, project]);

  // Outline sections derived from the generated clause list. Must
  // sit above the early returns below or React's hook ordering
  // diverges on first vs. subsequent renders.
  const outlineSections = useMemo(() => {
    const clauses = existing?.clauses;
    if (!clauses) return [];
    return [...clauses]
      .sort((a, b) => a.order - b.order)
      .map((c) => ({
        id: c.id,
        title: c.title,
        sectionKey: c.sectionKey,
        required: c.required,
      }));
  }, [existing?.clauses]);

  // Parsed wizard answers — feeds the per-section answer editor
  // inside each outline row.
  const parsedAnswers: WizardAnswers = useMemo(() => {
    if (!existing?.wizardAnswers) return {};
    try {
      return JSON.parse(existing.wizardAnswers) as WizardAnswers;
    } catch {
      return {};
    }
  }, [existing?.wizardAnswers]);
  const contractProjectType =
    (existing?.projectType as ProjectType | undefined) ?? null;

  // Total page count for the floating page counter. Each <div
  // class="page-break"> marks the boundary between pages, so the
  // page count is `breaks + 1`.
  const totalPages = useMemo(() => {
    if (!contentHtml) return 1;
    const matches = contentHtml.match(/class="page-break"/g);
    return (matches?.length ?? 0) + 1;
  }, [contentHtml]);
  const [currentPage, setCurrentPage] = useState(1);

  if (project === undefined) {
    return (
      <div className="min-h-screen bg-[#f0f0e8] flex items-center justify-center text-[#888]">
        Loading contract…
      </div>
    );
  }
  if (!project) {
    return (
      <div className="min-h-screen bg-[#f0f0e8] flex items-center justify-center text-[#888]">
        Project not found.
      </div>
    );
  }

  // No existing contract + not signed → drop straight into the typeform-
  // style wizard. The legacy editor surface is reserved for projects
  // that already have a contract drafted (so users can keep editing
  // it) or for users who explicitly skip the wizard.
  const shouldShowWizard = wizardOpen || (!existing && !isSigned);
  if (shouldShowWizard) {
    return (
      <ContractWizardFullScreen
        projectId={projectId as Id<"projects">}
        projectName={project.name}
        onClose={() => {
          setWizardOpen(false);
          // When there's no contract yet, `shouldShowWizard` stays true
          // (`!existing`), so just toggling `wizardOpen` re-opens the wizard
          // immediately — i.e. Exit appears broken. Leave the contract surface
          // entirely in that case.
          if (!existing) {
            void navigate({ to: projectPath(teamSlug, projectId as Id<"projects">) });
          }
        }}
        onComplete={() => {
          // Rebuild the collab doc so the regenerated clauses/contentHtml
          // replace the old (or empty) editor body. We do NOT poke initRef
          // here — the epoch-keyed re-hydrate effect below deterministically
          // pulls the freshly generated body into `contentHtml` once the
          // project query reflects it, which is what the collab seed plants.
          // (The old `initRef = false` raced the query and often seeded the
          // default/empty body — the data-loss bug.)
          void regenerateCollabDoc();
        }}
      />
    );
  }

  const buildFilename = (): string => {
    const safe = (project.name ?? "contract")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "_");
    return `${safe}-contract.docx`;
  };

  const persistContract = async () => {
    await upsertContract({
      projectId: projectId as Id<"projects">,
      contract: {
        contentHtml,
        scope: scope.trim() || undefined,
        deliverablesSummary: deliverables.trim() || undefined,
        priceCents: priceDollars
          ? Math.round(parseFloat(priceDollars) * 100)
          : undefined,
        currency: currency.toLowerCase() || "usd",
        revisionsAllowed: revisions ? parseInt(revisions, 10) : undefined,
        deadline: deadline.trim() || undefined,
        clientName: clientName.trim() || undefined,
        clientEmail: clientEmail.trim() || undefined,
        originalFilename,
      },
    });
  };

  const handleSave = async () => {
    setError(null);
    setNotice(null);
    setBusy("save");
    try {
      await persistContract();
      setDirty(false);
      setNotice("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async (file: File) => {
    setError(null);
    setNotice(null);
    setBusy("import");
    try {
      const result = await docxFileToHtml(file);
      setContentHtml(result.html);
      setOriginalFilename(file.name);
      setDirty(true);
      setNotice(
        result.warnings.length
          ? `Imported with ${result.warnings.length} compatibility warning(s).`
          : `Imported ${file.name}.`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? `Could not parse .docx: ${e.message}` : "Could not parse .docx",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleExport = async () => {
    setError(null);
    setBusy("export");
    try {
      const blob = await htmlToDocxBlob(contentHtml, { filename: buildFilename() });
      triggerBlobDownload(blob, buildFilename());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleSaveToCloud = async () => {
    if (!(featureStatus?.objectStorage ?? false)) {
      setError("Object storage not configured. Set R2/Railway env to enable.");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("cloud");
    try {
      await persistContract();
      const blob = await htmlToDocxBlob(contentHtml, { filename: buildFilename() });
      const presign = await getUploadUrl({
        projectId: projectId as Id<"projects">,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      if (presign.status === "disabled" || !presign.url || !presign.s3Key) {
        setError(presign.reason ?? "Cloud storage unavailable.");
        return;
      }
      const res = await fetch(presign.url, {
        method: "PUT",
        body: blob,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      await linkDocxFile({
        projectId: projectId as Id<"projects">,
        docxS3Key: presign.s3Key,
      });
      setDirty(false);
      setNotice("Saved .docx to cloud storage.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cloud save failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleSend = async () => {
    setError(null);
    setBusy("send");
    try {
      await sendForSignature({ projectId: projectId as Id<"projects"> });
      setNotice("Sent for signature.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleSign = async () => {
    if (!demoSignName.trim()) {
      setError("Type a name to sign.");
      return;
    }
    setError(null);
    setBusy("sign");
    try {
      await signContractDemo({
        projectId: projectId as Id<"projects">,
        signedByName: demoSignName.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signature failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleClear = async () => {
    if (!confirm("Clear the contract? You'll be able to re-draft it.")) return;
    setError(null);
    setBusy("clear");
    try {
      await clearContract({ projectId: projectId as Id<"projects"> });
      // Wipe collab state (server + in-memory) too, otherwise the next
      // draft starts populated with the cleared contract's old content.
      await regenerateCollabDoc();
      initRef.current = false;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed.");
    } finally {
      setBusy(null);
    }
  };

  const onContentChange = (next: string) => {
    setContentHtml(next);
    setDirty(true);
  };

  return (
    <div className="min-h-screen bg-[#f0f0e8] flex flex-col">
      {/* Slim top bar — breadcrumb on the left, doc-level actions
          on the right. Everything saves automatically; there's no
          longer a Save button (autosave fires on edit + on blur).
          The autosave status sits inline so the user gets confidence
          their work is persisted without having to look for it. */}
      <header className="flex-shrink-0 bg-[#f0f0e8] border-b-2 border-[#1a1a1a] px-4 sm:px-6 py-2 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={toggleSidebar}
          className="hidden md:inline-flex items-center justify-center w-8 h-8 -ml-1 text-[#888] hover:text-[#1a1a1a] hover:bg-[#e8e8e0] transition-colors flex-shrink-0"
          title={collapsed ? "Open sidebar" : "Close sidebar"}
          aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
        <Link
          to={projectPath(teamSlug, projectId as Id<"projects">)}
          className="inline-flex items-center gap-1 text-[#888] hover:text-[#1a1a1a] text-sm font-bold"
          title="Back to project"
        >
          <ArrowLeft className="h-4 w-4" />
          {project.name}
        </Link>
        <span className="text-[#888]">/</span>
        <div className="text-[#1a1a1a] font-black tracking-tight text-sm uppercase">
          Contract
        </div>
        {isSigned ? (
          <Badge variant="success">Signed</Badge>
        ) : isSent ? (
          <Badge variant="secondary">Awaiting signature</Badge>
        ) : existing ? (
          <Badge variant="secondary">Draft</Badge>
        ) : (
          <Badge variant="secondary">New</Badge>
        )}
        <AutosaveIndicator
          dirty={dirty}
          busy={busy === "autosave"}
          lastSavedAt={existing?.lastSavedAt}
        />

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = "";
            }}
          />
          {/* Icon-only chips — Undo / Redo / Print sit next to the
              toggle row. All rendered through TopBarIconButton so
              every control in the strip is exactly h-9. */}
          <TopBarIconButton
            onClick={() => usableEditor?.chain().focus().undo().run()}
            disabled={!usableEditor || !usableEditor.can().undo()}
            title="Undo (⌘Z)"
            aria-label="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </TopBarIconButton>
          <TopBarIconButton
            onClick={() => usableEditor?.chain().focus().redo().run()}
            disabled={!usableEditor || !usableEditor.can().redo()}
            title="Redo (⌘⇧Z)"
            aria-label="Redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </TopBarIconButton>
          <TopBarIconButton
            onClick={() => window.print()}
            title="Print (⌘P)"
            aria-label="Print"
          >
            <Printer className="h-3.5 w-3.5" />
          </TopBarIconButton>

          <span className="h-6 w-px bg-[#1a1a1a]/30 mx-1" aria-hidden />

          {/* Right-side panels (Versions, Comments) — same h-9 chrome
              as every other control. */}
          <ToggleChip
            active={panelOpen === "versions"}
            onClick={() =>
              setPanelOpen(panelOpen === "versions" ? null : "versions")
            }
            label="Versions"
            icon={<History className="h-3.5 w-3.5" />}
          />
          <ToggleChip
            active={panelOpen === "comments"}
            onClick={() =>
              setPanelOpen(panelOpen === "comments" ? null : "comments")
            }
            label="Comments"
            icon={<MessageSquare className="h-3.5 w-3.5" />}
          />

          {/* Upload / Download / Delete live in the File menu now.
              Only Share stays as a top-bar primary action since it's
              the most-used outbound flow. */}
          <Button
            className="h-9 bg-[#FF6600] hover:bg-[#FF7A1F]"
            onClick={() => setShareOpen(true)}
          >
            <Share2 className="h-3.5 w-3.5 mr-1" />
            Share
          </Button>
        </div>
      </header>

      {/* Google-Docs-style file menubar. Sits directly under the
          breadcrumb row and gives keyboard access to every action
          the top bar exposes plus the editor's format commands. */}
      <ContractFileMenubar
        editor={usableEditor}
        readOnly={false}
        onUploadDocx={() => fileInputRef.current?.click()}
        onDownloadDocx={() => void handleExport()}
        onPrint={() => window.print()}
        onShare={() => setShareOpen(true)}
        onDeleteContract={
          existing ? () => void handleClear() : undefined
        }
        onToggleVersions={() =>
          setPanelOpen(panelOpen === "versions" ? null : "versions")
        }
        onToggleComments={() =>
          setPanelOpen(panelOpen === "comments" ? null : "comments")
        }
        onToggleOutline={() => setOutlineOpen((o) => !o)}
        onAddPage={() => {
          if (usableEditor) {
            usableEditor
              .chain()
              .focus("end")
              .insertContent(
                `<div class="page-break"></div><h2>New page</h2><p></p>`,
              )
              .run();
          }
        }}
        onAddSection={() => setAddSectionOpen(true)}
        onReRunWizard={() => setWizardOpen(true)}
      />

      {/* Status / errors. Distraction-free notification strip. */}
      {(notice || error) && (
        <div className="px-4 sm:px-8 py-2 border-b-2 border-[#1a1a1a] flex items-center gap-2 text-sm">
          {error ? (
            <span className="text-[#dc2626] font-bold">{error}</span>
          ) : (
            <span className="text-[#FF6600] font-bold">{notice}</span>
          )}
          <button
            type="button"
            className="ml-auto text-xs text-[#888] hover:text-[#1a1a1a]"
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Three-column body:
            ┌──────────────────────────────────────────┐
            │ [outline]  [doc canvas]  [comments/vers] │
            └──────────────────────────────────────────┘
          The outline rail is Google-Docs-style (toggleable). The
          right panel is contextual (comments OR versions, depending
          on which top-bar toggle is on). The center is the doc
          canvas — full-bleed white page, no junk below. */}
      <div className="flex-1 flex min-h-0 bg-[#e8e8e0]">
        {outlineOpen ? (
          <ContractSectionOutline
            sections={outlineSections}
            activeSectionId={activeSectionId}
            onSelect={(id) => {
              setActiveSectionId(id);
              const target = outlineSections.find((s) => s.id === id);
              if (!target) return;
              // Scroll the matching heading in the editor into view.
              const root = editorScrollRef.current;
              if (!root) return;
              const headings = root.querySelectorAll(
                "h1, h2, h3",
              );
              for (const h of Array.from(headings)) {
                if (
                  (h.textContent ?? "").trim().toLowerCase() ===
                  target.title.toLowerCase()
                ) {
                  h.scrollIntoView({ behavior: "smooth", block: "start" });
                  break;
                }
              }
            }}
            onCollapse={() => setOutlineOpen(false)}
            renderSectionBody={(section) => (
              <SectionAnswerFields
                projectId={projectId as Id<"projects">}
                sectionKey={section.sectionKey}
                projectType={contractProjectType}
                answers={parsedAnswers}
                readOnly={false}
              />
            )}
            onOpenAddSection={() => setAddSectionOpen(true)}
            onDeleteSection={async (clauseId) => {
              try {
                await removeClause({
                  projectId: projectId as Id<"projects">,
                  clauseId,
                });
              } catch (e) {
                alert(
                  e instanceof Error
                    ? e.message
                    : "Couldn't remove section.",
                );
              }
            }}
            onRunWizard={() => setWizardOpen(true)}
            runWizardLabel={
              existing?.clauses ? "Re-run wizard" : "Run setup wizard"
            }
          />
        ) : null}

        <div className="flex-1 relative flex flex-col min-w-0">
          {!outlineOpen ? (
            <ContractSectionOutlineCollapsedToggle
              onExpand={() => setOutlineOpen(true)}
            />
          ) : null}

          {/* Persistent formatting toolbar (font, size, bold/italic, headings,
              lists, alignment, links). Binds to the lifted editor instance; the
              selection bubble + gutter "+" still work alongside it. */}
          <ContractToolbar editor={usableEditor} />


          {/* Scroll container — owns the scroll for the whole stack
              of pages so the floating page counter can sit relative
              to it. */}
          <div
            className="flex-1 overflow-y-auto relative"
            ref={editorScrollRef}
            onScroll={(e) => {
              // Naive current-page tracker: divide scrollTop by an
              // approximate page height. Good enough for the floating
              // indicator; exact tracking would need per-page refs.
              const root = e.currentTarget;
              const approxPageHeight = root.clientHeight - 80;
              const idx = Math.floor(root.scrollTop / approxPageHeight) + 1;
              setCurrentPage(Math.max(1, Math.min(totalPages, idx)));
            }}
          >
            <div className="py-10 sm:py-16">
              {/* Ghost-style writing surface — no white paper, no
                  border, no shadow. Just a generous centered column
                  on the gray surface, big serif-ish body, ample
                  line-height. Bubble + floating menus carry the
                  formatting UI; the persistent toolbar is gone. */}
              <div
                className="mx-auto w-full max-w-[740px] min-h-[calc(100vh-260px)] px-4 sm:px-0"
                style={{
                  fontFamily:
                    '"Source Serif Pro", "Iowan Old Style", "Charter", Georgia, serif',
                  lineHeight: 1.75,
                  fontSize: "19px",
                  // Bind text + heading colors to the theme token so
                  // the contract canvas flips to light text in dark
                  // mode automatically.
                  color: "var(--foreground)",
                }}
              >
                <style>{`
                  .snip-contract-canvas h1, .snip-contract-canvas h2, .snip-contract-canvas h3 {
                    font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
                    font-weight: 800;
                    letter-spacing: -0.015em;
                    color: var(--foreground);
                    line-height: 1.2;
                  }
                  .snip-contract-canvas h1 {
                    font-size: 42px;
                    margin: 0.4em 0 0.6em;
                    font-weight: 900;
                  }
                  .snip-contract-canvas h2 {
                    font-size: 28px;
                    margin: 1.4em 0 0.4em;
                  }
                  .snip-contract-canvas h3 {
                    font-size: 22px;
                    margin: 1.2em 0 0.3em;
                  }
                  .snip-contract-canvas p {
                    margin: 0 0 1em 0;
                    color: var(--foreground);
                  }
                  .snip-contract-canvas ul, .snip-contract-canvas ol {
                    margin: 0 0 1em 1.6em;
                    color: var(--foreground);
                  }
                  .snip-contract-canvas li { margin: 0.3em 0; }
                  .snip-contract-canvas strong { font-weight: 700; }
                  .snip-contract-canvas em { font-style: italic; }
                  .snip-contract-canvas blockquote {
                    border-left: 3px solid #FF6600;
                    padding-left: 1em;
                    margin: 1.2em 0;
                    font-style: italic;
                    color: var(--foreground-muted);
                  }
                  .snip-contract-canvas hr {
                    border: none;
                    border-top: 1px solid var(--foreground);
                    margin: 2em auto;
                    width: 60%;
                  }
                  .snip-contract-canvas .ProseMirror {
                    outline: none;
                    min-height: calc(100vh - 360px);
                    color: var(--foreground);
                  }
                  .snip-contract-canvas .page-break {
                    border: none;
                    border-top: 2px dashed var(--foreground-subtle);
                    margin: 3.5em -2em;
                    position: relative;
                  }
                  .snip-contract-canvas .page-break::after {
                    content: 'PAGE BREAK';
                    position: absolute;
                    top: -10px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: var(--background);
                    color: var(--foreground-muted);
                    font-family: ui-monospace, monospace;
                    font-size: 9px;
                    font-weight: 700;
                    letter-spacing: 0.15em;
                    padding: 0 8px;
                  }
                `}</style>
                <div className="snip-contract-canvas">
                  <ContractEditor
                    // Seed source: prefer the server's generated body so the
                    // collab seed can never plant the default/empty template
                    // during the post-wizard state settle. In collab mode this
                    // prop is ONLY used for seeding; live edits flow via onChange.
                    contentHtml={
                      existing?.contentHtml && existing.contentHtml.trim().length > 0
                        ? existing.contentHtml
                        : contentHtml
                    }
                    onChange={onContentChange}
                    editable
                    ydoc={collabReady ? ydoc : null}
                    seedHtmlIfEmpty={
                      serverContractDoc === null &&
                      Boolean(
                        existing?.contentHtml &&
                          existing.contentHtml.trim().length > 0,
                      )
                    }
                    chromeMode="bare"
                    onEditorReady={setTiptapEditor}
                  />
                </div>
              </div>

              {/* Ghost page — appends a new page when clicked. Append
                  is done via Tiptap's command chain when an editor is
                  available so the user's current content + cursor are
                  preserved (string concat used to clobber selection
                  state on autosave). */}
              <button
                type="button"
                onClick={() => {
                  if (usableEditor) {
                    usableEditor
                      .chain()
                      .focus("end")
                      .insertContent(
                        `<div class="page-break"></div><h2>New page</h2><p></p>`,
                      )
                      .run();
                  } else {
                    // Fallback: append the raw HTML if the editor
                    // hasn't mounted yet for some reason.
                    onContentChange(
                      `${contentHtml}<div class="page-break"></div><h2>New page</h2><p></p>`,
                    );
                  }
                }}
                className="mt-10 mx-auto w-full max-w-[740px] block group px-4 sm:px-0"
                title="Add a new page"
              >
                <div className="text-[#888] border-2 border-dashed border-[#1a1a1a]/25 py-10 flex flex-col items-center justify-center gap-2 group-hover:border-[#1a1a1a]/60 group-hover:text-[#1a1a1a] transition-colors">
                  <FilePlus2 className="h-5 w-5" />
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider">
                    Add page
                  </span>
                </div>
              </button>


            {originalFilename ? (
              <div className="max-w-[740px] mx-auto mt-3 text-center text-xs font-mono text-[#888]">
                Originally imported from{" "}
                <strong>{originalFilename}</strong>
              </div>
            ) : null}
            </div>
          </div>

          {/* Floating page counter — sits in the bottom-left corner
              of the gray scroll area. Sticky to the editor column so
              it stays visible while you scroll the doc. */}
          <div className="pointer-events-none absolute left-4 bottom-4 z-10">
            <div className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1 border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[10px] font-mono font-bold uppercase tracking-wider">
              <span>page</span>
              <span className="text-[#1a1a1a]">{currentPage}</span>
              <span className="text-[#888]">/</span>
              <span>{totalPages}</span>
            </div>
          </div>
        </div>

        {/* Right panel — Versions OR Comments, whichever is on. */}
        {panelOpen === "versions" ? (
          <SidePanel title="Versions" onClose={() => setPanelOpen(null)}>
            <ContractVersionsPanel
              projectId={projectId as Id<"projects">}
              readOnly={false}
              onRestored={() => void regenerateCollabDoc()}
            />
          </SidePanel>
        ) : null}
        {panelOpen === "comments" ? (
          <SidePanel title="Comments" onClose={() => setPanelOpen(null)}>
            <ContractCommentsPanel
              projectId={projectId as Id<"projects">}
            />
          </SidePanel>
        ) : null}
      </div>

      {/* Share dialog — replaces the old "Send for signature" button
          with a multi-tab modal (signer / reviewer / editor). The
          demo-sign affordance lives inside the dialog so it doesn't
          loiter at the bottom of the doc anymore. */}
      <ContractShareDialog
        projectId={projectId as Id<"projects">}
        teamSlug={teamSlug}
        open={shareOpen}
        onOpenChange={setShareOpen}
        contractState={
          isSigned
            ? "signed"
            : isSent
              ? "awaiting"
              : existing
                ? "draft"
                : "none"
        }
        signedByName={existing?.signedByName}
        signedAt={existing?.signedAt}
      />

      <AddSectionDialog
        open={addSectionOpen}
        onOpenChange={setAddSectionOpen}
        onConfirm={async (title) => {
          await addCustomClause({
            projectId: projectId as Id<"projects">,
            title,
          });
        }}
      />
    </div>
  );
}

function FullPageField({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={full ? "col-span-2 block" : "block"}>
      <div className="text-[10px] uppercase tracking-[0.15em] text-[#888] font-bold mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}

/**
 * Compact on/off chip used in the top bar for Versions + Comments.
 * Same `h-9` chrome as every other control in the row so the strip
 * doesn't look ragged.
 */
function ToggleChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Brutalist drop-shadow + 2px border so every chip in the
        // strip reads the same way as the Share/Download buttons.
        "inline-flex h-9 items-center gap-1.5 px-3 border-2 border-[#1a1a1a] text-xs font-bold uppercase tracking-wider transition-all shadow-[4px_4px_0px_0px_var(--shadow-color)] active:translate-y-[2px] active:translate-x-[2px]",
        active
          ? "bg-[#1a1a1a] text-[#f0f0e8]"
          : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e8e8e0] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_var(--shadow-color)]",
      )}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

/**
 * Icon-only h-9 button used for Undo / Redo / Print / Delete in the
 * top bar. Disabled state dims; `variant="danger"` paints red on
 * hover for destructive actions.
 */
function TopBarIconButton({
  onClick,
  disabled,
  title,
  variant = "default",
  children,
  ...rest
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  variant?: "default" | "danger";
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        // Same drop-shadow chrome as ToggleChip so the icon buttons
        // sit on the same visual baseline as Versions / Comments.
        "inline-flex h-9 w-9 items-center justify-center border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[4px_4px_0px_0px_var(--shadow-color)] active:translate-y-[2px] active:translate-x-[2px] disabled:shadow-none hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_var(--shadow-color)]",
        variant === "danger"
          ? "hover:bg-[#dc2626] hover:text-[#f0f0e8] hover:border-[#dc2626]"
          : "hover:bg-[#1a1a1a] hover:text-[#f0f0e8]",
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Right-edge panel used for Versions and Comments. Mirrors the
 * outline rail visually (2px border-l, cream background) so the
 * doc canvas reads as the central focus.
 */
function SidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside className="hidden lg:flex w-72 flex-shrink-0 flex-col border-l-2 border-[#1a1a1a] bg-[#f0f0e8]">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b-2 border-[#1a1a1a]">
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
          {title}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-[#888] hover:text-[#1a1a1a] hover:bg-[#e8e8e0]"
          title="Close panel"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">{children}</div>
    </aside>
  );
}

/**
 * Inline pill that reflects the autosave state. Three modes:
 *   - "Saving…" while the autosave mutation is in flight
 *   - "Unsaved" right after a keystroke (waiting for the debounce)
 *   - "Saved {time}" once the round-trip completes
 *
 * Doesn't show anything until something has happened (no save yet
 * AND not dirty), which keeps a fresh contract page quiet.
 */
function AutosaveIndicator({
  dirty,
  busy,
  lastSavedAt,
}: {
  dirty: boolean;
  busy: boolean;
  lastSavedAt: number | undefined;
}) {
  if (busy) {
    return (
      <span className="text-xs font-mono text-[#888]">Saving…</span>
    );
  }
  if (dirty) {
    return (
      <span className="text-xs font-mono text-[#b45309]">Unsaved</span>
    );
  }
  if (lastSavedAt) {
    return (
      <span className="text-xs font-mono text-[#888]">
        Saved {new Date(lastSavedAt).toLocaleTimeString()}
      </span>
    );
  }
  return null;
}
