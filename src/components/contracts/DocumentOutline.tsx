"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { PanelLeftClose, PanelLeft } from "lucide-react";

/**
 * Sections outline for the unified contract/document editor — the "best of
 * both" port of the legacy editor's Sections rail. Derived from the live
 * heading nodes (H1–H3) in the Tiptap doc, so it works for any document
 * regardless of whether it came from the wizard. Click a heading to scroll to
 * it. Collapsible; when collapsed, a small toggle re-opens it.
 */

export type Heading = { level: number; text: string; pos: number };

/**
 * Live H1–H3 headings from the Tiptap doc. Exported so the contract
 * editor can fall back to heading-derived sections when a contract has
 * no wizard clauses yet (the left rail should never just be missing).
 */
export function useHeadings(editor: Editor | null): Heading[] {
  const [headings, setHeadings] = useState<Heading[]>([]);
  useEffect(() => {
    if (!editor) return;
    const compute = () => {
      const hs: Heading[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          hs.push({
            level: (node.attrs.level as number) ?? 1,
            text: node.textContent || "Untitled",
            pos,
          });
        }
      });
      setHeadings(hs);
    };
    compute();
    editor.on("update", compute);
    editor.on("transaction", compute);
    return () => {
      editor.off("update", compute);
      editor.off("transaction", compute);
    };
  }, [editor]);
  return headings;
}

export function DocumentOutline({
  editor,
  open,
  onOpenChange,
  inSheet = false,
}: {
  editor: Editor | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render the bare list to fill a Sheet (no rail border / collapse
   *  button — the Sheet provides its own panel chrome and close). */
  inSheet?: boolean;
}) {
  const headings = useHeadings(editor);

  const goTo = (pos: number) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
    // In the sheet, jumping to a heading dismisses the overlay so the
    // reader lands on the scrolled-to spot.
    if (inSheet) onOpenChange?.(false);
  };

  const list =
    headings.length === 0 ? (
      <p className="px-1 py-2 text-xs text-[#888] leading-relaxed">
        Headings you add (H1–H3) appear here.
      </p>
    ) : (
      <ul className="space-y-0.5">
        {headings.map((h, i) => (
          <li key={`${h.pos}-${i}`}>
            <button
              type="button"
              onClick={() => goTo(h.pos)}
              className={cn(
                "w-full truncate text-left px-2 py-1 text-sm hover:bg-[#FFEDD5] transition-colors",
                h.level === 1 && "font-bold text-[#1a1a1a]",
                h.level === 2 && "pl-4 text-[#1a1a1a]",
                h.level === 3 && "pl-6 text-[#666] text-xs",
              )}
              title={h.text}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    );

  if (inSheet) {
    return <div className="flex-1 overflow-y-auto p-2">{list}</div>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        title="Show sections"
        aria-label="Show sections"
        className="hidden lg:inline-flex h-8 w-8 items-center justify-center border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8] transition-colors"
      >
        <PanelLeft className="h-4 w-4" />
      </button>
    );
  }

  return (
    <aside className="border-2 border-[#1a1a1a] bg-[#f0f0e8] shadow-[4px_4px_0px_0px_#1a1a1a] flex flex-col self-start">
      <div className="flex items-center justify-between border-b-2 border-[#1a1a1a] px-3 py-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#888]">
          Sections
        </span>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          title="Hide sections"
          aria-label="Hide sections"
          className="text-[#888] hover:text-[#1a1a1a]"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <div className="p-2 max-h-[60vh] overflow-y-auto">{list}</div>
    </aside>
  );
}
