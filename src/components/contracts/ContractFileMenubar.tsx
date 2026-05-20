"use client";

import type { Editor } from "@tiptap/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Google-Docs-style file menubar that sits under the breadcrumb row
 * on the contract page. Six top-level menus (File / Edit / View /
 * Insert / Format / Help) each open a dropdown of actions. The
 * actions wrap callbacks the host passes in — the menubar itself is
 * presentational and doesn't know about Convex.
 *
 * Keyboard-accessible via the Radix DropdownMenu primitives.
 */

interface Actions {
  // File
  onUploadDocx: () => void;
  onDownloadDocx: () => void;
  onPrint: () => void;
  onShare: () => void;
  onDeleteContract?: () => void;
  // Edit (most routed through the editor)
  editor: Editor | null;
  // View
  onToggleVersions: () => void;
  onToggleComments: () => void;
  onToggleOutline: () => void;
  // Insert
  onAddPage: () => void;
  onAddSection?: () => void;
  // Format
  onReRunWizard?: () => void;
  // misc
  readOnly: boolean;
}

export function ContractFileMenubar(props: Actions) {
  // Treat a destroyed-but-still-referenced editor as null so the
  // Edit/Format items don't blow up when the underlying ProseMirror
  // view has been torn down (Yjs swap or HMR remount). The host
  // also gates on this, but the second check keeps this component
  // safe in isolation.
  const editor =
    props.editor && !props.editor.isDestroyed && props.editor.view
      ? props.editor
      : null;
  const safeProps: Actions = { ...props, editor };
  return renderMenubar(safeProps);
}

function renderMenubar(props: Actions) {
  return (
    <div className="flex items-center gap-0 px-4 sm:px-6 py-1 border-b-2 border-[#1a1a1a] bg-[#f0f0e8]">
      <FileMenuButton label="File">
        <Item onClick={props.onUploadDocx} disabled={props.readOnly}>
          Upload .docx…
        </Item>
        <Item onClick={props.onDownloadDocx}>Download .docx</Item>
        <DropdownMenuSeparator />
        <Item onClick={props.onPrint}>Print…</Item>
        <Item onClick={props.onShare}>Share…</Item>
        {props.onDeleteContract && !props.readOnly ? (
          <>
            <DropdownMenuSeparator />
            <Item onClick={props.onDeleteContract} danger>
              Delete contract
            </Item>
          </>
        ) : null}
      </FileMenuButton>

      <FileMenuButton label="Edit">
        <Item
          onClick={() => props.editor?.chain().focus().undo().run()}
          disabled={!props.editor?.can().undo()}
          shortcut="⌘Z"
        >
          Undo
        </Item>
        <Item
          onClick={() => props.editor?.chain().focus().redo().run()}
          disabled={!props.editor?.can().redo()}
          shortcut="⌘⇧Z"
        >
          Redo
        </Item>
        <DropdownMenuSeparator />
        <Item
          onClick={() =>
            props.editor?.chain().focus().selectAll().run()
          }
          shortcut="⌘A"
        >
          Select all
        </Item>
      </FileMenuButton>

      <FileMenuButton label="View">
        <Item onClick={props.onToggleOutline}>Toggle outline</Item>
        <Item onClick={props.onToggleVersions}>Versions panel</Item>
        <Item onClick={props.onToggleComments}>Comments panel</Item>
      </FileMenuButton>

      <FileMenuButton label="Insert">
        <Item
          onClick={() =>
            props.editor?.chain().focus().toggleHeading({ level: 1 }).run()
          }
          disabled={props.readOnly}
        >
          Heading 1
        </Item>
        <Item
          onClick={() =>
            props.editor?.chain().focus().toggleHeading({ level: 2 }).run()
          }
          disabled={props.readOnly}
        >
          Heading 2
        </Item>
        <Item
          onClick={() =>
            props.editor?.chain().focus().toggleHeading({ level: 3 }).run()
          }
          disabled={props.readOnly}
        >
          Heading 3
        </Item>
        <DropdownMenuSeparator />
        <Item
          onClick={() =>
            props.editor?.chain().focus().toggleBulletList().run()
          }
          disabled={props.readOnly}
        >
          Bullet list
        </Item>
        <Item
          onClick={() =>
            props.editor?.chain().focus().toggleOrderedList().run()
          }
          disabled={props.readOnly}
        >
          Numbered list
        </Item>
        <Item
          onClick={() =>
            props.editor?.chain().focus().toggleBlockquote().run()
          }
          disabled={props.readOnly}
        >
          Quote
        </Item>
        <Item
          onClick={() =>
            props.editor?.chain().focus().setHorizontalRule().run()
          }
          disabled={props.readOnly}
        >
          Divider
        </Item>
        <DropdownMenuSeparator />
        <Item onClick={props.onAddPage} disabled={props.readOnly}>
          Page break
        </Item>
        {props.onAddSection ? (
          <Item onClick={props.onAddSection} disabled={props.readOnly}>
            Section…
          </Item>
        ) : null}
      </FileMenuButton>

      <FileMenuButton label="Format">
        <Item
          onClick={() => props.editor?.chain().focus().toggleBold().run()}
          disabled={props.readOnly}
          shortcut="⌘B"
        >
          Bold
        </Item>
        <Item
          onClick={() => props.editor?.chain().focus().toggleItalic().run()}
          disabled={props.readOnly}
          shortcut="⌘I"
        >
          Italic
        </Item>
        <Item
          onClick={() =>
            props.editor?.chain().focus().toggleUnderline().run()
          }
          disabled={props.readOnly}
          shortcut="⌘U"
        >
          Underline
        </Item>
        <Item
          onClick={() => props.editor?.chain().focus().toggleStrike().run()}
          disabled={props.readOnly}
        >
          Strikethrough
        </Item>
        <DropdownMenuSeparator />
        <Item
          onClick={() =>
            props.editor?.chain().focus().setTextAlign("left").run()
          }
          disabled={props.readOnly}
        >
          Align left
        </Item>
        <Item
          onClick={() =>
            props.editor?.chain().focus().setTextAlign("center").run()
          }
          disabled={props.readOnly}
        >
          Align center
        </Item>
        <Item
          onClick={() =>
            props.editor?.chain().focus().setTextAlign("right").run()
          }
          disabled={props.readOnly}
        >
          Align right
        </Item>
        {props.onReRunWizard ? (
          <>
            <DropdownMenuSeparator />
            <Item onClick={props.onReRunWizard} disabled={props.readOnly}>
              Re-run wizard…
            </Item>
          </>
        ) : null}
      </FileMenuButton>

      <FileMenuButton label="Help">
        <Item
          onClick={() => window.open("https://snipfilm.vercel.app", "_blank")}
        >
          Documentation
        </Item>
        <Item
          onClick={() =>
            window.open("mailto:support@snip.film", "_blank")
          }
        >
          Contact support
        </Item>
      </FileMenuButton>
    </div>
  );
}

function FileMenuButton({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center px-2.5 py-1 text-[13px] font-mono text-[#1a1a1a] hover:bg-[#e8e8e0] data-[state=open]:bg-[#1a1a1a] data-[state=open]:text-[#f0f0e8]"
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Item({
  onClick,
  disabled,
  shortcut,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  shortcut?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      className={cn(
        "flex items-center justify-between gap-3",
        danger ? "text-[#dc2626] focus:text-[#dc2626]" : "",
      )}
    >
      <span>{children}</span>
      {shortcut ? (
        <span className="text-[10px] font-mono text-[#888]">{shortcut}</span>
      ) : null}
    </DropdownMenuItem>
  );
}
