"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { X } from "lucide-react";
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
  "h-10 w-full border-2 border-[#1a1a1a] bg-[#f0f0e8] px-2 text-sm font-medium text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#C2410C]";

function FieldLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-sm font-bold text-[#1a1a1a]">
      <span className="text-[#888]">{icon}</span>
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
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk edit metadata</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status */}
          <div className="space-y-1.5">
            <FieldLabel icon={<span className="text-base leading-none">◔</span>}>
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
            <FieldLabel icon={<span className="text-base leading-none">T</span>}>
              Description
            </FieldLabel>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Leave blank to keep existing descriptions"
              className="min-h-[72px]"
            />
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <FieldLabel icon={<span className="text-base leading-none">≣</span>}>
              Tags
            </FieldLabel>
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 border-2 border-[#1a1a1a] bg-[#FFEDD5] px-2 py-0.5 text-xs font-bold text-[#1a1a1a]"
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
            />
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-[#888]">
                Append to existing tags
              </span>
              <button
                type="button"
                onClick={() => setAppendTags((a) => !a)}
                aria-pressed={appendTags}
                className={cn(
                  "px-3 py-1 border-2 border-[#1a1a1a] font-bold text-xs",
                  appendTags
                    ? "bg-[#FF6600] text-[#f0f0e8]"
                    : "bg-[#e8e8e0] text-[#1a1a1a]",
                )}
              >
                {appendTags ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          {error ? <p className="text-xs text-[#dc2626]">{error}</p> : null}

          <div className="space-y-2 pt-2">
            <Button
              className="w-full"
              onClick={() => void handleSave()}
              disabled={busy || fieldCount === 0}
            >
              {busy
                ? "Saving…"
                : `Save ${fieldCount} ${fieldCount === 1 ? "field" : "fields"} to ${videoIds.length} ${videoIds.length === 1 ? "asset" : "assets"}`}
            </Button>
            <Button
              variant="outline"
              className="w-full"
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
