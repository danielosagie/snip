"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  Trash2,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Google-Docs-style outline panel for the contract editor.
 *
 *   - Reads section titles directly from the generated clause list.
 *   - Click a row to scroll the editor to the matching heading. The
 *     row also expands inline to show the wizard answers that fed
 *     that section, editable in place.
 *   - Required clauses get the lock chip so the user knows which
 *     sections stay even if they re-run the wizard.
 *
 * The parent owns layout. The optional `renderSectionBody` lets the
 * caller drop the per-section answer editor (which has Convex hooks
 * and project context) directly into the expanded row without this
 * component needing to know about either.
 */

export interface OutlineSection {
  id: string;
  title: string;
  sectionKey: string;
  required: boolean;
}

interface Props {
  sections: OutlineSection[];
  activeSectionId: string | null;
  onSelect: (sectionId: string) => void;
  onCollapse: () => void;
  /**
   * Render-prop for the expanded body of a section row. Caller is
   * free to return null when nothing is editable. Wrapping the
   * editor in a render-prop keeps this component shape-agnostic so
   * it can be reused on the share-side later without dragging in
   * the wizard plumbing.
   */
  renderSectionBody?: (section: OutlineSection) => React.ReactNode;
  /** Optional handler — when present, the outline renders a "+
   *  Add section" button at the bottom. The host opens its own
   *  modal in response (see AddSectionDialog). */
  onOpenAddSection?: () => void;
  /** Optional handler — when present, non-required rows get a small
   *  delete affordance that fires this on confirm. */
  onDeleteSection?: (sectionId: string) => void | Promise<void>;
  /** Optional handler — when present, a wizard button renders directly
   *  below "Add section" in the rail footer. */
  onRunWizard?: () => void;
  /** Label for the wizard button (e.g. "Run setup wizard" vs
   *  "Re-run wizard"). Defaults to "Run wizard". */
  runWizardLabel?: string;
  /** Render to fill a Sheet: drop the fixed-width rail border + the
   *  in-header collapse button (the Sheet supplies its own chrome). */
  inSheet?: boolean;
}

export function ContractSectionOutline({
  sections,
  activeSectionId,
  onSelect,
  onCollapse,
  renderSectionBody,
  onOpenAddSection,
  onDeleteSection,
  onRunWizard,
  runWizardLabel,
  inSheet = false,
}: Props) {
  const confirmDialog = useConfirmDialog();
  // Track which row is currently expanded. We expand at most one at
  // a time so the rail stays scannable; the parent's activeSectionId
  // doubles as the "expanded" marker.
  const [expandedId, setExpandedId] = useState<string | null>(
    activeSectionId,
  );

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col bg-white",
        inSheet
          ? "flex-1 w-full"
          : "hidden w-72 flex-shrink-0 border-r border-[#E8E8EC] lg:flex",
      )}
    >
      {/* In a Sheet the panel header (title + close X) is supplied by the
          host SheetContent, so the rail's own header row is rail-only. */}
      {inSheet ? null : (
        <div className="flex items-center justify-between gap-2 border-b border-[#E8E8EC] px-3 py-2.5">
          <div className="text-[13px] text-[#A0A0A5]">
            Sections
          </div>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-[8px] p-1 text-[#6E6E73] transition-colors hover:bg-[#F1F1F3] hover:text-[#131315]"
            title="Hide outline"
            aria-label="Hide outline"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <nav className="flex-1 overflow-y-auto p-3">
        {sections.length === 0 ? (
          <div className="px-2.5 py-3 text-sm leading-5 text-[#6E6E73]">
            Add a heading to create a section.
          </div>
        ) : (
          sections.map((s) => {
            const isActive = activeSectionId === s.id;
            const isExpanded = Boolean(renderSectionBody) && expandedId === s.id;
            return (
              <div
                key={s.id}
                className={cn(
                  "rounded-[10px]",
                  isExpanded ? "bg-[#FAFAFA]" : "",
                )}
              >
                <div className="group flex items-stretch">
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "bg-[#FFF0E6] font-medium text-[#D14E00]"
                        : "text-[#131315] hover:bg-[#F1F1F3]",
                    )}
                  >
                    {s.required ? (
                      <Lock className="h-3 w-3 flex-shrink-0 opacity-60" />
                    ) : (
                      <span className="w-3" />
                    )}
                    <span className="truncate flex-1">{s.title}</span>
                  </button>
                  {!s.required && onDeleteSection ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void confirmDialog({
                          title: "Delete section",
                          description: `${s.title} and its text will be removed.`,
                          confirmLabel: "Delete",
                          variant: "destructive",
                          action: () => onDeleteSection(s.id),
                          errorMessage: (error) =>
                            error instanceof Error
                              ? error.message
                              : "Couldn't delete section.",
                        });
                      }}
                      className="flex-shrink-0 rounded-[8px] px-2 text-[#A0A0A5] opacity-0 transition-[color,background-color,opacity] hover:bg-[#F1F1F3] hover:text-[#D8434F] group-hover:opacity-100"
                      title="Delete section"
                      aria-label="Delete section"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {renderSectionBody ? (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : s.id)
                      }
                      className="flex-shrink-0 rounded-[8px] px-2 text-[#6E6E73] hover:bg-[#F1F1F3] hover:text-[#131315]"
                      title={isExpanded ? "Collapse section" : "Edit section answers"}
                      aria-label={
                        isExpanded
                          ? "Collapse section"
                          : "Edit section answers"
                      }
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : null}
                </div>
                {isExpanded ? (
                  <div className="border-t border-[#E8E8EC] px-3 py-3">
                    {renderSectionBody ? (
                      renderSectionBody(s)
                    ) : (
                      <div className="text-[13px] text-[#6E6E73]">
                        Nothing to edit here.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </nav>
      {onOpenAddSection || onRunWizard ? (
        <div className="space-y-2 border-t border-[#E8E8EC] p-3">
          {onOpenAddSection ? (
            <button
              type="button"
              onClick={onOpenAddSection}
              className="flex w-full items-center justify-center gap-1.5 rounded-full border border-[#D8D8DE] bg-white px-3.5 py-2 text-[13px] font-medium text-[#131315] transition-colors hover:bg-[#F7F7F8]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add section
            </button>
          ) : null}
          {onRunWizard ? (
            <button
              type="button"
              onClick={onRunWizard}
              className="flex w-full items-center justify-center gap-1.5 rounded-full border border-[#D8D8DE] bg-white px-3.5 py-2 text-[13px] font-medium text-[#131315] transition-colors hover:bg-[#F7F7F8]"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {runWizardLabel ?? "Run wizard"}
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

/**
 * Collapsed-state rail toggle — sits in the gray editor area BELOW the
 * formatting toolbar (top-16 clears the toolbar row) so it never overlaps the
 * toolbar buttons, while the document still takes full width.
 */
export function ContractSectionOutlineCollapsedToggle({
  onExpand,
}: {
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="absolute left-3 top-16 z-10 hidden h-7 w-7 items-center justify-center rounded-full border border-[#D8D8DE] bg-white text-[#131315] transition-colors hover:bg-[#F7F7F8] lg:inline-flex"
      title="Show outline"
      aria-label="Show outline"
    >
      <PanelIcon />
    </button>
  );
}

function PanelIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <rect x="3" y="4" width="18" height="16" rx="0" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  );
}
