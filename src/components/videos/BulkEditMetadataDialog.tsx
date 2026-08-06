"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { AlignLeft, CircleDot, Tags as TagsIcon, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  softButton,
  softButtonPrimary,
  softInput,
} from "@/components/soft";

/**
 * Bulk-edit metadata across the selected videos. Only fields you fill in are
 * applied; blank fields are left untouched. Tags are a multi-value field with an
 * "append to existing" toggle (on = merge, off = replace). Status maps to
 * snip's review workflow. Persists via videos.bulkEditMetadata.
 *
 * (Custom field schemas — Asset Type, Shot Type, etc. — are a separate, larger
 * feature; this edits snip's built-in metadata.)
 */

type WorkflowStatus = "review" | "rework" | "done";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoIds: Id<"videos">[];
  onDone?: () => void;
}

const SELECT_CLASS =
  "h-10 w-full rounded-[10px] border border-[#E8E8EC] bg-white px-3 text-sm font-medium text-[#131315] outline-none focus:border-[#FF6600]";

function FieldLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#6E6E73]">
      <span className="text-[#A0A0A5]">{icon}</span>
      {children}
    </div>
  );
}

export function BulkEditMetadataDialog({
  open,
  onOpenChange,
  videoIds,
  onDone,
}: Props) {
  const bulkEdit = useMutation(api.videos.bulkEditMetadata);

  const [status, setStatus] = useState<"" | WorkflowStatus>("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [appendTags, setAppendTags] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldCount = useMemo(() => {
    let n = 0;
    if (status) n += 1;
    if (description.trim()) n += 1;
    if (tags.length > 0) n += 1;
    return n;
  }, [status, description, tags]);

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,$/, "").trim();
    if (!t) return;
    setTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagInput("");
  };

  const reset = () => {
    setStatus("");
    setDescription("");
    setTags([]);
    setTagInput("");
    setAppendTags(true);
    setError(null);
  };

  const handleSave = async () => {
    if (fieldCount === 0) return;
    setBusy(true);
    setError(null);
    try {
      await bulkEdit({
        videoIds,
        workflowStatus: status || undefined,
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        appendTags: tags.length > 0 ? appendTags : undefined,
      });
      reset();
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="surface-soft max-h-[85vh] max-w-md overflow-y-auto rounded-[14px] border border-[#E8E8EC] bg-white text-[#131315] shadow-[0_8px_24px_rgba(19,19,21,0.10)]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold normal-case tracking-[-0.01em] text-[#131315]">
            Bulk edit metadata
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status */}
          <div className="space-y-1.5">
            <FieldLabel icon={<CircleDot className="h-4 w-4" />}>
              Approval status
            </FieldLabel>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "" | WorkflowStatus)}
              className={SELECT_CLASS}
            >
              <option value="">Leave unchanged</option>
              <option value="review">Needs review</option>
              <option value="rework">Rework</option>
              <option value="done">Done</option>
            </select>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <FieldLabel icon={<AlignLeft className="h-4 w-4" />}>
              Description
            </FieldLabel>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Leave blank to keep existing descriptions"
              className={cn(softInput, "min-h-[72px]")}
            />
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <FieldLabel icon={<TagsIcon className="h-4 w-4" />}>
              Tags
            </FieldLabel>
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-[#FFF0E6] px-2.5 py-1 text-xs font-medium text-[#D14E00]"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                      aria-label={`Remove ${t}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              onBlur={() => addTag(tagInput)}
              placeholder="Type a tag and press Enter"
              className={softInput}
            />
            <div className="flex items-center justify-between pt-1">
              <span className="text-[13px] text-[#6E6E73]">
                Append to existing tags
              </span>
              <button
                type="button"
                onClick={() => setAppendTags((a) => !a)}
                aria-pressed={appendTags}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  appendTags
                    ? "bg-[#131315] text-white"
                    : "bg-[#F1F1F3] text-[#6E6E73]",
                )}
              >
                {appendTags ? "On" : "Off"}
              </button>
            </div>
          </div>

          {error ? <p className="text-xs text-[#D8434F]">{error}</p> : null}

          <div className="space-y-2 pt-2">
            <Button
              className={cn(softButtonPrimary, "w-full")}
              onClick={() => void handleSave()}
              disabled={busy || fieldCount === 0}
            >
              {busy
                ? "Saving…"
                : `Save ${fieldCount} ${fieldCount === 1 ? "field" : "fields"} to ${videoIds.length} ${videoIds.length === 1 ? "asset" : "assets"}`}
            </Button>
            <Button
              variant="outline"
              className={cn(softButton, "w-full")}
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
