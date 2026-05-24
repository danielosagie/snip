"use client";

import { useEffect, useReducer } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link2,
  Undo2,
  Redo2,
  PenTool,
} from "lucide-react";

/**
 * Persistent formatting toolbar for the contract document editor — the row the
 * Ghost-mode surface was missing (font, size, bold/italic/underline, headings,
 * lists, alignment, links). Binds to the lifted Tiptap editor instance and
 * re-renders on selection change so active states + the current font/size stay
 * accurate. Snip brutalist styling.
 */

const FONT_FAMILIES: Array<{ label: string; value: string }> = [
  { label: "Serif", value: '"Source Serif Pro", Georgia, serif' },
  { label: "Sans", value: 'ui-sans-serif, system-ui, sans-serif' },
  { label: "Mono", value: 'ui-monospace, "SF Mono", Menlo, monospace' },
];
const FONT_SIZES = ["12px", "14px", "16px", "19px", "24px", "32px", "48px"];

function ToolButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={[
        "inline-flex h-7 w-7 items-center justify-center border-2 border-[#1a1a1a] transition-colors disabled:opacity-40",
        active
          ? "bg-[#1a1a1a] text-[#f0f0e8]"
          : "bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#FFEDD5]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-[#1a1a1a]/30" />;
}

export function ContractToolbar({
  editor,
  onOpenFields,
}: {
  editor: Editor | null;
  /** When provided, shows a "Fields" button that opens the signature-field
   *  placement sheet (only meaningful on a signable multi-contract). */
  onOpenFields?: () => void;
}) {
  // Tiptap mutates outside React; subscribe so active states stay live.
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    const update = () => force();
    editor.on("transaction", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  const disabled = !editor;
  const currentFamily =
    (editor?.getAttributes("textStyle").fontFamily as string | undefined) ?? "";
  const currentSize =
    (editor?.getAttributes("textStyle").fontSize as string | undefined) ?? "";

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b-2 border-[#1a1a1a] bg-[#f0f0e8] px-3 py-2">
      <Group>
        <ToolButton
          title="Undo (⌘Z)"
          disabled={disabled || !editor!.can().undo()}
          onClick={() => editor!.chain().focus().undo().run()}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Redo (⌘⇧Z)"
          disabled={disabled || !editor!.can().redo()}
          onClick={() => editor!.chain().focus().redo().run()}
        >
          <Redo2 className="h-3.5 w-3.5" />
        </ToolButton>
      </Group>
      <Divider />
      <Group>
        <ToolButton
          title="Paragraph"
          disabled={disabled}
          active={editor?.isActive("paragraph")}
          onClick={() => editor!.chain().focus().setParagraph().run()}
        >
          <Pilcrow className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Heading 1"
          disabled={disabled}
          active={editor?.isActive("heading", { level: 1 })}
          onClick={() => editor!.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Heading 2"
          disabled={disabled}
          active={editor?.isActive("heading", { level: 2 })}
          onClick={() => editor!.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Heading 3"
          disabled={disabled}
          active={editor?.isActive("heading", { level: 3 })}
          onClick={() => editor!.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 className="h-3.5 w-3.5" />
        </ToolButton>
      </Group>
      <Divider />
      <Group>
        <select
          aria-label="Font family"
          title="Font family"
          disabled={disabled}
          value={currentFamily}
          onChange={(e) => {
            const next = e.target.value;
            if (!next) editor!.chain().focus().unsetFontFamily().run();
            else editor!.chain().focus().setFontFamily(next).run();
          }}
          className="h-7 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-1.5 text-xs font-bold uppercase tracking-wider hover:bg-[#e8e8e0] focus:outline-none disabled:opacity-40"
        >
          <option value="">Default</option>
          {FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Font size"
          title="Font size"
          disabled={disabled}
          value={currentSize}
          onChange={(e) => {
            const next = e.target.value;
            if (!next) editor!.chain().focus().unsetFontSize().run();
            else editor!.chain().focus().setFontSize(next).run();
          }}
          className="h-7 w-[68px] border-2 border-[#1a1a1a] bg-[#f0f0e8] px-1.5 text-xs font-mono font-bold hover:bg-[#e8e8e0] focus:outline-none disabled:opacity-40"
        >
          <option value="">Auto</option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Group>
      <Divider />
      <Group>
        <ToolButton
          title="Bold (⌘B)"
          disabled={disabled}
          active={editor?.isActive("bold")}
          onClick={() => editor!.chain().focus().toggleBold().run()}
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Italic (⌘I)"
          disabled={disabled}
          active={editor?.isActive("italic")}
          onClick={() => editor!.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Underline (⌘U)"
          disabled={disabled}
          active={editor?.isActive("underline")}
          onClick={() => editor!.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Strikethrough"
          disabled={disabled}
          active={editor?.isActive("strike")}
          onClick={() => editor!.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolButton>
      </Group>
      <Divider />
      <Group>
        <ToolButton
          title="Bullet list"
          disabled={disabled}
          active={editor?.isActive("bulletList")}
          onClick={() => editor!.chain().focus().toggleBulletList().run()}
        >
          <List className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Numbered list"
          disabled={disabled}
          active={editor?.isActive("orderedList")}
          onClick={() => editor!.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolButton>
      </Group>
      <Divider />
      <Group>
        <ToolButton
          title="Align left"
          disabled={disabled}
          active={editor?.isActive({ textAlign: "left" })}
          onClick={() => editor!.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Align center"
          disabled={disabled}
          active={editor?.isActive({ textAlign: "center" })}
          onClick={() => editor!.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Align right"
          disabled={disabled}
          active={editor?.isActive({ textAlign: "right" })}
          onClick={() => editor!.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight className="h-3.5 w-3.5" />
        </ToolButton>
      </Group>
      <Divider />
      <Group>
        <ToolButton
          title="Link"
          disabled={disabled}
          active={editor?.isActive("link")}
          onClick={setLink}
        >
          <Link2 className="h-3.5 w-3.5" />
        </ToolButton>
      </Group>
      {onOpenFields ? (
        <>
          <div className="ml-auto" />
          <button
            type="button"
            onClick={onOpenFields}
            title="Place signature fields"
            className="inline-flex items-center gap-1.5 border-2 border-[#1a1a1a] bg-[#1a1a1a] px-3 h-7 text-[11px] font-bold uppercase tracking-wider text-[#f0f0e8] hover:bg-[#C2410C] transition-colors"
          >
            <PenTool className="h-3.5 w-3.5" />
            Fields
          </button>
        </>
      ) : null}
    </div>
  );
}
