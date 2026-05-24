"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Link } from "@tiptap/extension-link";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { FontFamily } from "@tiptap/extension-font-family";
import { FontSize } from "./fontSizeExtension";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Google-Doc-style contract preview. Renders the contract HTML inside
 * a paper-styled surface (white background, 8.5" max width, generous
 * page margins, drop shadow) so the user feels like they're looking
 * at a printable document rather than a terminal printout.
 *
 * Backed by Tiptap so the user can type directly into the preview.
 * When `auto` is true (default), the editor stays in sync with the
 * auto-generated `html` prop — answer changes upstream rewrite the
 * preview content. Once the user types into the editor we flip
 * `userTouched` and stop overwriting their edits; a "Reset" affordance
 * lets them snap back to the generated draft.
 */

interface Props {
  html: string;
  /** Called whenever the user manually edits the preview. */
  onChange?: (next: string) => void;
  /** Called once the user makes their first edit; useful for showing
   *  a "Reset to draft" affordance in the parent. */
  onUserEdit?: () => void;
  /** When true, regenerate the editor body from `html` on every
   *  change unless the user has typed (`userTouched`). */
  resyncWithHtml?: boolean;
  editable?: boolean;
  /** Surfaces the Tiptap instance so a parent can render a toolbar. */
  onEditorReady?: (editor: Editor) => void;
}

export function ContractDocPreview({
  html,
  onChange,
  onUserEdit,
  resyncWithHtml = true,
  editable = true,
  onEditorReady,
}: Props) {
  const userTouchedRef = useRef(false);
  const lastAppliedHtmlRef = useRef<string>(html);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
      }),
      Underline,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      FontFamily.configure({ types: ["textStyle"] }),
      FontSize,
    ],
    content: html,
    editable,
    onUpdate: ({ editor }) => {
      // Only treat this as a user edit if the change didn't come
      // from our programmatic `commands.setContent` below.
      const next = editor.getHTML();
      if (next === lastAppliedHtmlRef.current) return;
      if (!userTouchedRef.current) {
        userTouchedRef.current = true;
        onUserEdit?.();
      }
      onChange?.(next);
    },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // No outline / focus ring inside the paper page — the page
        // itself is the visual container.
        class:
          "outline-none focus:outline-none min-h-[600px] cursor-text",
      },
    },
  });

  // Sync incoming `html` into the editor when the upstream auto-draft
  // changes — but only if the user hasn't started typing.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.view) return;
    if (!resyncWithHtml) return;
    if (userTouchedRef.current) return;
    if (html === lastAppliedHtmlRef.current) return;
    lastAppliedHtmlRef.current = html;
    editor.commands.setContent(html, { emitUpdate: false });
  }, [editor, html, resyncWithHtml]);

  // Toggle editability if the prop changes after mount.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.view) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  // Surface the editor instance for an external toolbar.
  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  return (
    <div className="min-h-full px-6 sm:px-10 py-8 flex flex-col items-center bg-[#e8e8e0]">
      {/* Paper page — sized to ~A4 / Letter ratio with generous
          margins. The shadow + 2px border gives it the brutalist
          page-on-desk look without abandoning the rest of the
          palette. */}
      <article
        className={cn(
          "w-full max-w-[816px] bg-white text-[#1a1a1a] border-2 border-[#1a1a1a] shadow-[6px_6px_0px_0px_var(--shadow-color)]",
          // Page padding (1 inch = 96px) — visible on top + bottom
          // so the user can see when content fills the page.
          "px-[96px] py-[96px]",
        )}
        // Force Inter / system sans inside the page even though the
        // rest of the app uses mono — contracts read better as a
        // long-form doc.
        style={{
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          lineHeight: 1.6,
          fontSize: "14px",
        }}
      >
        <style>{`
          .snip-contract-doc h1, .snip-contract-doc h2, .snip-contract-doc h3 {
            font-weight: 700;
            letter-spacing: -0.01em;
            color: #1a1a1a;
            margin-top: 1.4em;
            margin-bottom: 0.4em;
          }
          .snip-contract-doc h1 { font-size: 22px; }
          .snip-contract-doc h2 { font-size: 17px; }
          .snip-contract-doc h3 { font-size: 15px; }
          .snip-contract-doc p {
            margin: 0 0 0.8em 0;
          }
          .snip-contract-doc ul, .snip-contract-doc ol {
            margin: 0 0 0.8em 1.5em;
          }
          .snip-contract-doc li { margin: 0.2em 0; }
          .snip-contract-doc strong { font-weight: 700; }
          .snip-contract-doc em { font-style: italic; }
        `}</style>
        <div className="snip-contract-doc">
          <EditorContent editor={editor} />
        </div>
      </article>
    </div>
  );
}
