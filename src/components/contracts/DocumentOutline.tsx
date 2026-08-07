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
    let cancelled = false;
    const compute = () => {
      if (cancelled || editor.isDestroyed) return;
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
      setHeadings((current) => {
        if (
          current.length === hs.length &&
          current.every(
            (heading, index) =>
              heading.level === hs[index]?.level &&
              heading.text === hs[index]?.text &&
              heading.pos === hs[index]?.pos,
          )
        ) {
          return current;
        }
        return hs;
      });
    };
    compute();
    editor.on("transaction", compute);
    return () => {
      cancelled = true;
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
    if (!editor || editor.isDestroyed) return;
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
    // In the sheet, jumping to a heading dismisses the overlay so the
    // reader lands on the scrolled-to spot.
    if (inSheet) onOpenChange?.(false);
  };

  const list =
    headings.length === 0 ? (
      <p className="px-2.5 py-3 text-sm leading-5 text-[#6E6E73]">
        Add a heading to create a section.
      </p>
    ) : (
      <ul className="space-y-0.5">
        {headings.map((h, i) => (
          <li key={`${h.pos}-${i}`}>
            <button
              type="button"
              onClick={() => goTo(h.pos)}
              className={cn(
                "w-full truncate rounded-[8px] px-2.5 py-2 text-left text-sm text-[#131315] transition-colors hover:bg-[#F1F1F3]",
                h.level === 1 && "font-medium",
                h.level === 2 && "pl-5",
                h.level === 3 && "pl-8 text-[13px] text-[#6E6E73]",
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
    return <div className="flex-1 overflow-y-auto p-3">{list}</div>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        title="Show sections"
        aria-label="Show sections"
        className="hidden h-8 w-8 items-center justify-center rounded-full border border-[#D8D8DE] bg-white text-[#131315] transition-colors hover:bg-[#F7F7F8] lg:inline-flex"
      >
        <PanelLeft className="h-4 w-4" />
      </button>
    );
  }

  return (
    <aside className="flex flex-col self-start rounded-[14px] border border-[#E8E8EC] bg-white">
      <div className="flex items-center justify-between border-b border-[#E8E8EC] px-3 py-2.5">
        <span className="text-[13px] text-[#A0A0A5]">
          Sections
        </span>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          title="Hide sections"
          aria-label="Hide sections"
          className="rounded-[8px] p-1 text-[#6E6E73] transition-colors hover:bg-[#F1F1F3] hover:text-[#131315]"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-3">{list}</div>
    </aside>
  );
}
