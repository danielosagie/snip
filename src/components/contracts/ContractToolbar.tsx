"use client";

import { useEffect, useReducer, useState } from "react";
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
  ChevronDown,
  Check,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { NamePromptDialog } from "@/components/ui/name-prompt-dialog";

/** Soft select replacement (native <select> can't be themed consistently). */
function ToolbarSelect({
  label,
  options,
  value,
  onPick,
  disabled,
  minWidth = 84,
}: {
  label: string;
  options: Array<{ label: string; value: string }>;
  value: string;
  onPick: (value: string) => void;
  disabled?: boolean;
  minWidth?: number;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          title={label}
          className="inline-flex h-7 items-center justify-between gap-1 rounded-[8px] border border-transparent bg-white px-2 text-[13px] font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#131315] disabled:opacity-40"
          style={{ minWidth }}
        >
          <span className="truncate">{current?.label ?? ""}</span>
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[140px]">
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value || "default"}
            onClick={() => onPick(o.value)}
            className="flex items-center justify-between text-[13px] font-medium"
          >
            {o.label}
            {o.value === value ? <Check className="h-3.5 w-3.5 text-[#D14E00]" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Persistent formatting toolbar for the contract document editor — the row the
 * Ghost-mode surface was missing (font, size, bold/italic/underline, headings,
 * lists, alignment, links). Binds to the lifted Tiptap editor instance and
 * re-renders on selection change so active states + the current font/size stay
 * accurate.
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
        "inline-flex h-7 w-7 items-center justify-center rounded-[8px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#131315] disabled:opacity-40",
        active
          ? "bg-[#FFF0E6] text-[#D14E00]"
          : "bg-white text-[#131315] hover:bg-[#F1F1F3]",
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
  return <div className="mx-1 h-5 w-px shrink-0 bg-[#E8E8EC]" />;
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
  const [linkPromptOpen, setLinkPromptOpen] = useState(false);
  const [linkInitialValue, setLinkInitialValue] = useState("https://");
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
    setLinkInitialValue(prev ?? "https://");
    setLinkPromptOpen(true);
  };

  return (
    <div className="flex min-h-10 flex-nowrap items-center gap-1.5 overflow-x-auto border-b border-[#E8E8EC] bg-white px-3 py-1.5 sm:px-4">
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
        <ToolbarSelect
          label="Font family"
          disabled={disabled}
          value={currentFamily}
          minWidth={92}
          options={[
            { label: "Default", value: "" },
            ...FONT_FAMILIES.map((f) => ({ label: f.label, value: f.value })),
          ]}
          onPick={(next) => {
            if (!next) editor!.chain().focus().unsetFontFamily().run();
            else editor!.chain().focus().setFontFamily(next).run();
          }}
        />
        <ToolbarSelect
          label="Font size"
          disabled={disabled}
          value={currentSize}
          minWidth={72}
          options={[
            { label: "Auto", value: "" },
            ...FONT_SIZES.map((s) => ({ label: s, value: s })),
          ]}
          onPick={(next) => {
            if (!next) editor!.chain().focus().unsetFontSize().run();
            else editor!.chain().focus().setFontSize(next).run();
          }}
        />
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
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#131315] bg-[#131315] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#2A2A2E]"
          >
            <PenTool className="h-3.5 w-3.5" />
            Fields
          </button>
        </>
      ) : null}
      <NamePromptDialog
        open={linkPromptOpen}
        onOpenChange={setLinkPromptOpen}
        title="Edit link"
        inputLabel="URL"
        initialValue={linkInitialValue}
        actionLabel="Apply"
        allowEmpty
        onSubmit={(url) => {
          if (!editor) return;
          if (url === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
          } else {
            editor
              .chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href: url })
              .run();
          }
          setLinkPromptOpen(false);
        }}
      />
    </div>
  );
}
