"use client";

import { useEditor, EditorContent, Editor } from "@tiptap/react";
import { BubbleMenu, FloatingMenu } from "@tiptap/react/menus";
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Link } from "@tiptap/extension-link";
import { TextAlign } from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Collaboration } from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { FontFamily } from "@tiptap/extension-font-family";
import { Placeholder } from "@tiptap/extension-placeholder";
import { FontSize } from "./fontSizeExtension";
import * as Y from "yjs";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Link as LinkIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Table as TableIcon,
  Undo2,
  Redo2,
  Eraser,
  Plus,
  Minus,
  Image as ImageIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  contentHtml: string;
  onChange: (html: string) => void;
  editable?: boolean;
  /**
   * Optional Yjs document for real-time collab. When provided, the editor
   * binds to it via the Collaboration extension and `contentHtml` becomes
   * a one-time seed (used only if the Yjs doc is empty on first mount).
   * All subsequent edits flow through Yjs and propagate to other clients
   * via the bound provider.
   */
  ydoc?: Y.Doc | null;
  /**
   * "framed" (default): the editor renders with its own 2px border + a
   * built-in toolbar bar on top. Use this when the editor stands on its
   * own surface (older share dialog previews, etc).
   *
   * "bare": no outer border, no internal toolbar. The host page is
   * expected to render its own toolbar (using `ContractToolbar` with
   * the editor returned via `onEditorReady`) and provide its own
   * framing (paper page, shadow, padding).
   */
  chromeMode?: "framed" | "bare";
  /**
   * Called once the Tiptap editor is ready. Use this to keep a ref
   * to the editor instance in the parent so a separately-rendered
   * `ContractToolbar` can bind to it.
   */
  onEditorReady?: (editor: Editor) => void;
  /**
   * Collab mode only. When true, the parent has confirmed the server-side
   * Yjs doc is empty (no `contractDocs` row), so `contentHtml` should be
   * planted into the shared doc exactly once as the initial content —
   * this is what bridges the wizard's generated clauses into the editor.
   * Gated by the parent on `api.contractDocs.getDoc === null` so we never
   * duplicate an existing document.
   */
  seedHtmlIfEmpty?: boolean;
}

/**
 * Tiptap WYSIWYG editor for contracts. Outputs HTML that round-trips with
 * .docx through mammoth (import) and html-to-docx (export). The default
 * extensions cover everything a normal Statement of Work needs: headings,
 * bold/italic/underline, lists, blockquotes, links, tables, alignment.
 *
 * When a `ydoc` is supplied, the editor switches to collab mode — Yjs
 * becomes the source of truth, multiple browsers stay in sync via the
 * bound ConvexYjsProvider. Without a ydoc the editor works locally on a
 * controlled HTML string the parent owns.
 */
export function ContractEditor({
  contentHtml,
  onChange,
  editable = true,
  ydoc = null,
  chromeMode = "framed",
  onEditorReady,
  seedHtmlIfEmpty = false,
}: Props) {
  const collabMode = Boolean(ydoc);
  const seededRef = useRef(false);

  // The seed guard is per-mount, but the parent swaps in a brand-new empty
  // Y.Doc on "Clear" / "Re-run wizard" / wizard-complete (a `docEpoch` bump).
  // Without resetting the guard, that fresh doc would never get seeded and the
  // regenerated contract would render empty — the data-loss symptom. Reset on
  // every ydoc identity change; the empty-fragment check below still prevents
  // double-seeding a doc that already has content.
  useEffect(() => {
    seededRef.current = false;
  }, [ydoc]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
        // The Collaboration extension owns undo/redo when active. We
        // disable StarterKit's built-in history to avoid double tracking.
        ...(collabMode ? { history: false } : {}),
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      FontFamily.configure({ types: ["textStyle"] }),
      FontSize,
      // Ghost-style empty-line affordance — "Type / for commands…"
      // hint on empty paragraphs, and a big "Heading" placeholder
      // on the first H1 to mimic an article title.
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading" && node.attrs.level === 1) {
            return "Title";
          }
          if (node.type.name === "paragraph") {
            return "Press '/' for commands, or just start writing…";
          }
          return "";
        },
        emptyEditorClass: "is-editor-empty",
        emptyNodeClass: "is-empty",
      }),
      ...(ydoc
        ? [
            Collaboration.configure({
              document: ydoc,
              field: "default",
            }),
          ]
        : []),
    ],
    // In collab mode Yjs owns content. In local mode the parent's HTML
    // string seeds the editor.
    content: collabMode ? undefined : contentHtml,
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    immediatelyRender: false,
  }, [ydoc]);

  // Local mode only: keep the editor in sync when the parent swaps the
  // HTML (e.g. after a .docx import). In collab mode this would fight
  // Yjs, so we skip.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.view || collabMode) return;
    if (editor.getHTML() !== contentHtml) {
      editor.commands.setContent(contentHtml || "<p></p>", { emitUpdate: false });
    }
  }, [editor, contentHtml, collabMode]);

  // Surface the editor instance once it's ready so a separately-
  // rendered toolbar can bind to it.
  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  // Collab seed: plant the wizard-generated HTML into the shared Yjs doc
  // the first time it's opened. Without this the editor binds to an empty
  // collab doc and the wizard's clauses never render (the doc comment
  // above promised this seed; the implementation was missing). Strictly
  // guarded so it can only ever populate a provably-empty doc:
  //   - parent passes seedHtmlIfEmpty only when getDoc === null
  //   - we re-check the bound fragment is empty (defends the rare race
  //     where a remote update lands between the query and this effect)
  //   - seededRef makes it at-most-once per mount (HMR / re-render safe)
  // setContent is NOT idempotent across sessions, so seeding a non-empty
  // doc would duplicate the whole contract — hence the belt-and-braces.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.view) return;
    if (!collabMode || !ydoc) return;
    if (!seedHtmlIfEmpty || seededRef.current) return;
    if (!contentHtml || contentHtml.trim().length === 0) return;
    if (ydoc.getXmlFragment("default").length > 0) return;
    seededRef.current = true;
    editor.commands.setContent(contentHtml, { emitUpdate: false });
  }, [editor, collabMode, ydoc, seedHtmlIfEmpty, contentHtml]);

  if (!editor) {
    return chromeMode === "bare" ? (
      <div className="text-sm text-[#888] p-4">Loading editor…</div>
    ) : (
      <div className="border-2 border-[#1a1a1a] p-6 text-sm text-[#888]">
        Loading editor…
      </div>
    );
  }

  // Bare mode — caller controls all framing + renders its own toolbar.
  // Ghost-style affordances ride along: a floating "+" menu on empty
  // lines (insert block) and a selection bubble menu (format text).
  if (chromeMode === "bare") {
    return (
      <>
        <EditorContent
          editor={editor}
          className="contract-editor text-[18px] leading-[1.75]"
        />
        {editable ? <EditorSelectionBubble editor={editor} /> : null}
        {editable ? <EditorBlockMenu editor={editor} /> : null}
        <ContractEditorStyles />
      </>
    );
  }

  return (
    <div className="border-2 border-[#1a1a1a] bg-[#f0f0e8]">
      {editable ? <Toolbar editor={editor} /> : null}
      <div className="bg-white border-t-2 border-[#1a1a1a]">
        <EditorContent
          editor={editor}
          className="contract-editor min-h-[400px] max-h-[55vh] overflow-y-auto px-6 py-5 text-[15px] leading-relaxed"
        />
      </div>
      <style>{`
        .contract-editor .ProseMirror {
          outline: none;
          color: #1a1a1a;
          font-family: 'Times New Roman', Georgia, serif;
        }
        .contract-editor .ProseMirror h1 {
          font-size: 26px;
          font-weight: 900;
          margin: 1em 0 0.5em;
          letter-spacing: -0.01em;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .contract-editor .ProseMirror h2 {
          font-size: 20px;
          font-weight: 800;
          margin: 1.2em 0 0.4em;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .contract-editor .ProseMirror h3 {
          font-size: 17px;
          font-weight: 700;
          margin: 1em 0 0.3em;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .contract-editor .ProseMirror p { margin: 0.5em 0; }
        .contract-editor .ProseMirror ul,
        .contract-editor .ProseMirror ol {
          padding-left: 24px;
          margin: 0.6em 0;
        }
        .contract-editor .ProseMirror li { margin: 0.2em 0; }
        .contract-editor .ProseMirror blockquote {
          border-left: 3px solid #FF6600;
          padding-left: 12px;
          color: #555;
          margin: 0.8em 0;
        }
        .contract-editor .ProseMirror a {
          color: #FF6600;
          text-decoration: underline;
        }
        .contract-editor .ProseMirror table {
          border-collapse: collapse;
          width: 100%;
          margin: 0.8em 0;
        }
        .contract-editor .ProseMirror th,
        .contract-editor .ProseMirror td {
          border: 1px solid #1a1a1a;
          padding: 6px 10px;
          vertical-align: top;
        }
        .contract-editor .ProseMirror th {
          background: #e8e8e0;
          font-weight: 700;
        }
        .contract-editor .ProseMirror[contenteditable="false"] {
          color: #1a1a1a;
        }
      `}</style>
    </div>
  );
}

/**
 * Standalone toolbar — exported so callers (like the contract editor
 * page) can render the toolbar somewhere else on screen, separate
 * from the editor body. The body component still uses this same
 * Toolbar internally when chromeMode is "framed".
 */
export function ContractToolbar({ editor }: { editor: Editor }) {
  return <Toolbar editor={editor} />;
}

/**
 * The scoped <style> block that styles `.contract-editor .ProseMirror`
 * descendants. Pulled out so `chromeMode="bare"` callers also pick up
 * the typography rules; the framed variant inlines this inside its
 * border wrapper.
 */
function ContractEditorStyles() {
  return (
    <style>{`
      .contract-editor .ProseMirror {
        outline: none;
        color: var(--foreground);
        font-family: inherit;
      }
      .contract-editor .ProseMirror p { margin: 0.5em 0; }
      .contract-editor .ProseMirror ul,
      .contract-editor .ProseMirror ol {
        padding-left: 24px;
        margin: 0.6em 0;
      }
      .contract-editor .ProseMirror li { margin: 0.2em 0; }
      .contract-editor .ProseMirror blockquote {
        border-left: 3px solid #FF6600;
        padding-left: 12px;
        color: #555;
        margin: 0.8em 0;
      }
      .contract-editor .ProseMirror a {
        color: #FF6600;
        text-decoration: underline;
      }
      .contract-editor .ProseMirror table {
        border-collapse: collapse;
        width: 100%;
        margin: 0.8em 0;
      }
      .contract-editor .ProseMirror th,
      .contract-editor .ProseMirror td {
        border: 1px solid #1a1a1a;
        padding: 6px 10px;
        vertical-align: top;
      }
      .contract-editor .ProseMirror th {
        background: #e8e8e0;
        font-weight: 700;
      }
      .contract-editor .ProseMirror[contenteditable="false"] {
        color: var(--foreground);
      }
      /* Ghost-style placeholder — a gray ghost-text on empty
         paragraphs + heading so users see what to type. */
      .contract-editor .ProseMirror p.is-empty::before,
      .contract-editor .ProseMirror h1.is-empty::before,
      .contract-editor .ProseMirror h2.is-empty::before,
      .contract-editor .ProseMirror h3.is-empty::before {
        content: attr(data-placeholder);
        float: left;
        color: #b5b5ad;
        pointer-events: none;
        height: 0;
      }
    `}</style>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  // Defensive: the editor view can be null briefly when Yjs is
  // (re)initializing or when the underlying ProseMirror view has been
  // torn down but the parent hasn't unmounted us yet. Calling
  // `editor.can()` against a destroyed view throws on its internal
  // chain, so we bail out and render nothing for that frame. The
  // useEditor reactivity will re-render us once the view is ready.
  if (!editor || editor.isDestroyed || !editor.view) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5 p-1 bg-[#e8e8e0]">
      <ToolbarGroup>
        <ToolButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </ToolButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive("heading", { level: 1 })}
          title="Heading 1"
        >
          <Heading1 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          title="Heading 2"
        >
          <Heading2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          title="Heading 3"
        >
          <Heading3 className="h-3.5 w-3.5" />
        </ToolButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <FontFamilySelect editor={editor} />
        <FontSizeSelect editor={editor} />
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold (⌘B)"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic (⌘I)"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="Underline (⌘U)"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="Strikethrough"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          title="Blockquote"
        >
          <Quote className="h-3.5 w-3.5" />
        </ToolButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          active={editor.isActive({ textAlign: "left" })}
          title="Align left"
        >
          <AlignLeft className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          active={editor.isActive({ textAlign: "center" })}
          title="Align center"
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          active={editor.isActive({ textAlign: "right" })}
          title="Align right"
        >
          <AlignRight className="h-3.5 w-3.5" />
        </ToolButton>
      </ToolbarGroup>

      <ToolbarGroup>
        <ToolButton
          onClick={() => {
            const url = window.prompt("Link URL");
            if (!url) return;
            editor.chain().focus().setLink({ href: url }).run();
          }}
          active={editor.isActive("link")}
          title="Add link"
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
          title="Insert table"
        >
          <TableIcon className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          onClick={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
          title="Clear formatting"
        >
          <Eraser className="h-3.5 w-3.5" />
        </ToolButton>
      </ToolbarGroup>
    </div>
  );
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 pr-1 mr-1 border-r-2 border-[#1a1a1a] last:border-r-0 last:mr-0">
      {children}
    </div>
  );
}

function ToolButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={
        "inline-flex h-7 w-7 items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed " +
        (active
          ? "bg-[#1a1a1a] text-[#f0f0e8]"
          : "text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8]")
      }
    >
      {children}
    </button>
  );
}

/**
 * Bubble menu — formatting controls that float just above the
 * current selection. Modeled after Ghost's Koenig editor: the
 * persistent toolbar is gone, and formatting is always at the tip of
 * your cursor when you actually need it.
 */
function EditorSelectionBubble({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      options={{
        placement: "top",
        offset: 8,
      }}
    >
      <div className="inline-flex items-center gap-0.5 border-2 border-[#1a1a1a] bg-[#1a1a1a] text-[#f0f0e8] p-1 shadow-[4px_4px_0px_0px_var(--shadow-color)]">
        <BubbleBtn
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </BubbleBtn>
        <BubbleBtn
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </BubbleBtn>
        <BubbleBtn
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </BubbleBtn>
        <BubbleBtn
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strikethrough"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </BubbleBtn>
        <span className="w-px self-stretch bg-[#f0f0e8]/30 mx-1" />
        <BubbleBtn
          active={editor.isActive("heading", { level: 1 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          title="Heading 1"
        >
          <Heading1 className="h-3.5 w-3.5" />
        </BubbleBtn>
        <BubbleBtn
          active={editor.isActive("heading", { level: 2 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          title="Heading 2"
        >
          <Heading2 className="h-3.5 w-3.5" />
        </BubbleBtn>
        <BubbleBtn
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Quote"
        >
          <Quote className="h-3.5 w-3.5" />
        </BubbleBtn>
        <span className="w-px self-stretch bg-[#f0f0e8]/30 mx-1" />
        <BubbleBtn
          active={editor.isActive("link")}
          onClick={() => {
            const previous = (editor.getAttributes("link").href as
              | string
              | undefined) ?? "";
            const next = prompt("URL (leave empty to unlink)", previous);
            if (next === null) return;
            if (next === "") {
              editor.chain().focus().unsetLink().run();
              return;
            }
            editor
              .chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href: next })
              .run();
          }}
          title="Link"
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </BubbleBtn>
      </div>
    </BubbleMenu>
  );
}

function BubbleBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Keep the editor selection — don't let the toolbar steal focus.
        e.preventDefault();
        onClick();
      }}
      title={title}
      aria-label={title}
      className={
        "inline-flex h-6 w-6 items-center justify-center transition-colors " +
        (active
          ? "bg-[#f0f0e8] text-[#1a1a1a]"
          : "text-[#f0f0e8] hover:bg-[#f0f0e8]/15")
      }
    >
      {children}
    </button>
  );
}

/**
 * Floating "+" menu on empty lines. Click → expands to a quick
 * inserter (heading, list, quote, divider, page break). Same idea as
 * Ghost's Koenig "+" gutter affordance.
 */
function EditorBlockMenu({ editor }: { editor: Editor }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <FloatingMenu
      editor={editor}
      options={{ placement: "left-start", offset: 8 }}
    >
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            setExpanded((v) => !v);
          }}
          className="inline-flex h-7 w-7 items-center justify-center border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f0f0e8] transition-colors"
          title="Insert block"
          aria-label="Insert block"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {expanded ? (
          <div className="inline-flex items-center gap-0.5 border-2 border-[#1a1a1a] bg-[#1a1a1a] text-[#f0f0e8] p-1 shadow-[4px_4px_0px_0px_var(--shadow-color)]">
            <BubbleBtn
              active={false}
              onClick={() => {
                editor.chain().focus().toggleHeading({ level: 1 }).run();
                setExpanded(false);
              }}
              title="Heading 1"
            >
              <Heading1 className="h-3.5 w-3.5" />
            </BubbleBtn>
            <BubbleBtn
              active={false}
              onClick={() => {
                editor.chain().focus().toggleHeading({ level: 2 }).run();
                setExpanded(false);
              }}
              title="Heading 2"
            >
              <Heading2 className="h-3.5 w-3.5" />
            </BubbleBtn>
            <BubbleBtn
              active={false}
              onClick={() => {
                editor.chain().focus().toggleHeading({ level: 3 }).run();
                setExpanded(false);
              }}
              title="Heading 3"
            >
              <Heading3 className="h-3.5 w-3.5" />
            </BubbleBtn>
            <BubbleBtn
              active={false}
              onClick={() => {
                editor.chain().focus().toggleBulletList().run();
                setExpanded(false);
              }}
              title="Bullet list"
            >
              <List className="h-3.5 w-3.5" />
            </BubbleBtn>
            <BubbleBtn
              active={false}
              onClick={() => {
                editor.chain().focus().toggleOrderedList().run();
                setExpanded(false);
              }}
              title="Numbered list"
            >
              <ListOrdered className="h-3.5 w-3.5" />
            </BubbleBtn>
            <BubbleBtn
              active={false}
              onClick={() => {
                editor.chain().focus().toggleBlockquote().run();
                setExpanded(false);
              }}
              title="Quote"
            >
              <Quote className="h-3.5 w-3.5" />
            </BubbleBtn>
            <BubbleBtn
              active={false}
              onClick={() => {
                editor.chain().focus().setHorizontalRule().run();
                setExpanded(false);
              }}
              title="Divider"
            >
              <Minus className="h-3.5 w-3.5" />
            </BubbleBtn>
            <BubbleBtn
              active={false}
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .insertContent(
                    `<div class="page-break"></div><h2>New page</h2><p></p>`,
                  )
                  .run();
                setExpanded(false);
              }}
              title="Page break"
            >
              <ImageIcon className="h-3.5 w-3.5" />
            </BubbleBtn>
          </div>
        ) : null}
      </div>
    </FloatingMenu>
  );
}

const FONT_FAMILIES = [
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "Sans", value: "ui-sans-serif, system-ui, sans-serif" },
  { label: "Serif", value: "'Times New Roman', Georgia, serif" },
  { label: "Mono", value: "ui-monospace, 'JetBrains Mono', monospace" },
  { label: "Display", value: "Georgia, 'Times New Roman', serif" },
];

const FONT_SIZES = [
  "10px",
  "11px",
  "12px",
  "13px",
  "14px",
  "16px",
  "18px",
  "20px",
  "24px",
  "30px",
  "36px",
  "48px",
];

/**
 * Native <select> styled to match the brutalist palette. Used for
 * font family + size so the toolbar stays compact. We use the
 * native control rather than a Radix Select to avoid the popover
 * portal stacking against the Tiptap editor view.
 */
function FontFamilySelect({ editor }: { editor: Editor }) {
  const current = editor.getAttributes("textStyle").fontFamily as
    | string
    | undefined;
  return (
    <select
      aria-label="Font family"
      title="Font family"
      value={current ?? ""}
      onChange={(e) => {
        const next = e.target.value;
        if (!next) {
          editor.chain().focus().unsetFontFamily().run();
        } else {
          editor.chain().focus().setFontFamily(next).run();
        }
      }}
      className="h-7 px-1.5 border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] text-xs font-bold uppercase tracking-wider hover:bg-[#e8e8e0] focus:outline-none"
    >
      <option value="">Default</option>
      {FONT_FAMILIES.map((f) => (
        <option key={f.value} value={f.value}>
          {f.label}
        </option>
      ))}
    </select>
  );
}

function FontSizeSelect({ editor }: { editor: Editor }) {
  const current = editor.getAttributes("textStyle").fontSize as
    | string
    | undefined;
  return (
    <select
      aria-label="Font size"
      title="Font size"
      value={current ?? ""}
      onChange={(e) => {
        const next = e.target.value;
        if (!next) {
          editor.chain().focus().unsetFontSize().run();
        } else {
          editor.chain().focus().setFontSize(next).run();
        }
      }}
      className="h-7 px-1.5 border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] text-xs font-mono font-bold hover:bg-[#e8e8e0] focus:outline-none w-[68px]"
    >
      <option value="">Auto</option>
      {FONT_SIZES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
