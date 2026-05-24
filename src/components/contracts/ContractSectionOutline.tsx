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
}: Props) {
  // Track which row is currently expanded. We expand at most one at
  // a time so the rail stays scannable; the parent's activeSectionId
  // doubles as the "expanded" marker.
  const [expandedId, setExpandedId] = useState<string | null>(
    activeSectionId,
  );

  return (
    <aside className="hidden lg:flex w-72 flex-shrink-0 flex-col border-r-2 border-[#1a1a1a] bg-[#f0f0e8] min-h-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b-2 border-[#1a1a1a]">
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
          Sections
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="p-1 text-[#888] hover:text-[#1a1a1a] hover:bg-[#e8e8e0]"
          title="Hide outline"
          aria-label="Hide outline"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-1">
        {sections.length === 0 ? (
          <div className="px-3 py-3 text-xs text-[#888]">
            Headings you add to the contract will appear here.
          </div>
        ) : (
          sections.map((s) => {
            const isActive = activeSectionId === s.id;
            const isExpanded = expandedId === s.id;
            return (
              <div
                key={s.id}
                className={cn(
                  "border-b border-[#ccc] last:border-b-0",
                  isExpanded ? "bg-[#e8e8e0]" : "",
                )}
              >
                <div className="group flex items-stretch">
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors flex-1 min-w-0 border-l-2",
                      isActive
                        ? "border-[#FF6600] font-bold text-[#1a1a1a]"
                        : "border-transparent text-[#1a1a1a] hover:bg-[#e8e8e0]",
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
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (
                          !confirm(
                            `Delete section "${s.title}"? The text inside will be removed.`,
                          )
                        )
                          return;
                        await onDeleteSection(s.id);
                      }}
                      className="px-2 text-[#888] hover:text-[#dc2626] hover:bg-[#e8e8e0] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete section"
                      aria-label="Delete section"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : s.id)
                    }
                    className="px-2 text-[#888] hover:text-[#1a1a1a] hover:bg-[#e8e8e0] flex-shrink-0"
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
                </div>
                {isExpanded ? (
                  <div className="px-3 py-3 border-t border-[#ccc]">
                    {renderSectionBody ? (
                      renderSectionBody(s)
                    ) : (
                      <div className="text-[11px] font-mono text-[#888]">
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
        <div className="border-t-2 border-[#1a1a1a] p-2 space-y-2">
          {onOpenAddSection ? (
            <button
              type="button"
              onClick={onOpenAddSection}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 border-2 border-dashed border-[#1a1a1a] text-xs font-bold uppercase tracking-wider text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add section
            </button>
          ) : null}
          {onRunWizard ? (
            <button
              type="button"
              onClick={onRunWizard}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 border-2 border-[#1a1a1a] text-xs font-bold uppercase tracking-wider text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8] transition-colors"
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
      className="hidden lg:inline-flex absolute left-3 top-16 z-10 items-center justify-center w-7 h-7 border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8] transition-colors"
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
