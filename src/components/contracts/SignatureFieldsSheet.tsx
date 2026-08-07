"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";

/**
 * Drag-and-drop signature field placement (Documenso-style, clean-room). Opens
 * as a right sheet from the editor toolbar. Renders the contract body as a
 * positioned surface; each field is an absolutely-placed chip at its normalized
 * (x, y). Drag a chip to reposition (saved via updateField on drop); pick a
 * recipient + field type to drop a new one. Draft-only.
 */

type RecipientDoc = Doc<"contractRecipients">;
type FieldDoc = Doc<"contractFields">;

const FIELD_TYPES: FieldDoc["type"][] = [
  "signature",
  "initials",
  "date",
  "name",
  "email",
  "text",
  "checkbox",
];
const FIELD_LABELS: Record<FieldDoc["type"], string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
  name: "Name",
  email: "Email",
  text: "Text",
  checkbox: "Checkbox",
};
// Distinct soft-token accents per recipient (cycled by order).
const RECIPIENT_COLORS = [
  { accent: "#D14E00", tint: "#FFF0E6" },
  { accent: "#225B36", tint: "#F2FBF5" },
  { accent: "#74521D", tint: "#FFF9EC" },
  { accent: "#8A2B34", tint: "#FFF5F5" },
  { accent: "#6E6E73", tint: "#F1F1F3" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: Id<"contracts">;
  contentHtml: string;
  recipients: RecipientDoc[];
  fields: FieldDoc[];
  isDraft: boolean;
}

export function SignatureFieldsSheet({
  open,
  onOpenChange,
  contractId,
  contentHtml,
  recipients,
  fields,
  isDraft,
}: Props) {
  const addField = useMutation(api.contractsTable.addField);
  const updateField = useMutation(api.contractsTable.updateField);
  const removeField = useMutation(api.contractsTable.removeField);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<Id<"contractFields"> | null>(null);
  const [localPos, setLocalPos] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [selectedRecipient, setSelectedRecipient] = useState<
    Id<"contractRecipients"> | ""
  >(recipients[0]?._id ?? "");
  const [error, setError] = useState<string | null>(null);

  const colorFor = (recipientId: string) => {
    const idx = recipients.findIndex((r) => r._id === recipientId);
    return RECIPIENT_COLORS[(idx < 0 ? 0 : idx) % RECIPIENT_COLORS.length];
  };

  const handleAdd = async (type: FieldDoc["type"]) => {
    if (!selectedRecipient) return;
    setError(null);
    try {
      // Land near the top-left so it's visible, then the user drags it.
      await addField({
        contractId,
        recipientId: selectedRecipient,
        type,
        x: 0.08,
        y: 0.08,
        width: type === "signature" ? 0.28 : 0.18,
        height: 0.05,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add field.");
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragId || !surfaceRef.current) return;
    const rect = surfaceRef.current.getBoundingClientRect();
    const x = Math.min(0.97, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(0.98, Math.max(0, (e.clientY - rect.top) / rect.height));
    setLocalPos((p) => ({ ...p, [dragId]: { x, y } }));
  };

  const onPointerUp = async () => {
    if (!dragId) return;
    const id = dragId;
    const pos = localPos[id];
    setDragId(null);
    if (pos) {
      try {
        await updateField({ fieldId: id, x: pos.x, y: pos.y });
      } catch {
        // keep optimistic position; a later save will reconcile
      }
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="surface-soft flex w-full flex-col sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Place signature fields</SheetTitle>
          <SheetDescription>
            {isDraft
              ? "Pick a signer, drop fields, and drag them onto the document."
              : "This contract is no longer a draft. Fields are read-only."}
          </SheetDescription>
        </SheetHeader>

        {/* Recipient picker + field palette */}
        <div className="space-y-3 border-y border-[#F1F1F3] py-3">
          <div>
            <div className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
              Signer
            </div>
            {recipients.length === 0 ? (
              <p className="text-xs italic text-[#6E6E73]">
                Add a signer in the Recipients panel first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {recipients.map((r) => (
                  <button
                    key={r._id}
                    type="button"
                    onClick={() => setSelectedRecipient(r._id)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                      r._id === selectedRecipient
                        ? "border-[#FFF0E6] bg-[#FFF0E6] text-[#D14E00]"
                        : "border-[#D8D8DE] bg-white text-[#131315] hover:bg-[#F1F1F3]",
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: colorFor(r._id).accent }}
                    />
                    {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
              Add field
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FIELD_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={!isDraft || !selectedRecipient}
                  onClick={() => void handleAdd(t)}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-[#D8D8DE] bg-white px-3 text-xs font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3] disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" />
                  {FIELD_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <p className="text-xs font-bold text-[#DC2626]" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        {/* Document drag surface */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#FAFAFA] p-4">
          <div
            ref={surfaceRef}
            onPointerMove={onPointerMove}
            onPointerUp={() => void onPointerUp()}
            onPointerLeave={() => void onPointerUp()}
            className="relative mx-auto w-full max-w-[640px] rounded-[14px] border border-[#E8E8EC] bg-white p-8"
            style={{ touchAction: dragId ? "none" : undefined }}
          >
            {/* Read-only contract body. The author edits text in the main
                editor; this is just the placement backdrop. */}
            <div
              className="contract-preview pointer-events-none select-none text-[13px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
            {/* Field chips */}
            {fields.map((f) => {
              const pos = localPos[f._id] ?? { x: f.x, y: f.y };
              const color = colorFor(f.recipientId as string);
              return (
                <div
                  key={f._id}
                  onPointerDown={(e) => {
                    if (!isDraft) return;
                    e.preventDefault();
                    setDragId(f._id);
                  }}
                  className={cn(
                    "absolute flex items-center justify-between gap-1 rounded-full border px-2 py-1 text-[10px] font-medium select-none",
                    isDraft ? "cursor-move" : "cursor-default",
                  )}
                  style={{
                    left: `${pos.x * 100}%`,
                    top: `${pos.y * 100}%`,
                    width: `${Math.max(0.12, f.width) * 100}%`,
                    borderColor: color.accent,
                    backgroundColor: color.tint,
                    color: "#131315",
                    zIndex: dragId === f._id ? 30 : 10,
                  }}
                  title={`${FIELD_LABELS[f.type]}, drag to place`}
                >
                  <span className="truncate">{FIELD_LABELS[f.type]}</span>
                  {isDraft && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => void removeField({ fieldId: f._id })}
                      className="shrink-0 rounded-full text-[#6E6E73] hover:bg-[#FFF5F5] hover:text-[#D8434F]"
                      aria-label="Remove field"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
