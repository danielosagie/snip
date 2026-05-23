"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Bulk rename for the selected videos. Three modes — Add Text (prefix/suffix),
 * Replace Text (find & replace), and Format (name + counter or a custom
 * pattern). The file extension is always preserved; a live preview shows the
 * before → after for each item. Persists via videos.bulkSetTitles.
 */

interface RenameItem {
  _id: Id<"videos">;
  title: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: RenameItem[];
  onDone?: () => void;
}

type Mode = "add" | "replace" | "format";
type Position = "after" | "before";
type FormatKind = "nameCounter" | "counter";

function splitExt(name: string): [string, string] {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return [name, ""];
  return [name.slice(0, idx), name.slice(idx)];
}

const TAB_CLASS = (active: boolean) =>
  cn(
    "flex-1 px-3 py-1.5 text-sm font-bold transition-colors",
    active
      ? "bg-[#f0f0e8] text-[#1a1a1a] border-2 border-[#1a1a1a]"
      : "text-[#888] hover:text-[#1a1a1a]",
  );

const SELECT_CLASS =
  "h-9 border-2 border-[#1a1a1a] bg-[#f0f0e8] px-2 text-sm font-bold text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#C2410C]";

export function BulkRenameDialog({ open, onOpenChange, items, onDone }: Props) {
  const bulkSetTitles = useMutation(api.videos.bulkSetTitles);

  const [mode, setMode] = useState<Mode>("add");
  const [addText, setAddText] = useState("");
  const [addPosition, setAddPosition] = useState<Position>("after");
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [formatKind, setFormatKind] = useState<FormatKind>("nameCounter");
  const [formatPosition, setFormatPosition] = useState<Position>("after");
  const [customFormat, setCustomFormat] = useState("");
  const [startAt, setStartAt] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transform = useMemo(() => {
    return (title: string, index: number): string => {
      const [base, ext] = splitExt(title);
      let nextBase = base;
      if (mode === "add") {
        if (addText) {
          nextBase = addPosition === "after" ? base + addText : addText + base;
        }
      } else if (mode === "replace") {
        if (findText) nextBase = base.split(findText).join(replaceText);
      } else {
        const n = startAt + index;
        if (customFormat.trim()) {
          nextBase = `${customFormat}${n}`;
        } else if (formatKind === "counter") {
          nextBase = `${n}`;
        } else {
          nextBase =
            formatPosition === "after" ? `${base} ${n}` : `${n} ${base}`;
        }
      }
      return `${nextBase}${ext}`;
    };
  }, [
    mode,
    addText,
    addPosition,
    findText,
    replaceText,
    formatKind,
    formatPosition,
    customFormat,
    startAt,
  ]);

  const previews = useMemo(
    () => items.map((it, i) => ({ ...it, next: transform(it.title, i) })),
    [items, transform],
  );

  const changedCount = previews.filter((p) => p.next !== p.title).length;

  const handleRename = async () => {
    if (changedCount === 0) return;
    setBusy(true);
    setError(null);
    try {
      await bulkSetTitles({
        items: previews
          .filter((p) => p.next !== p.title && p.next.trim().length > 0)
          .map((p) => ({ videoId: p._id, title: p.next })),
      });
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk rename</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-2 border-[#1a1a1a] bg-[#e8e8e0] p-1 gap-1">
          <button type="button" className={TAB_CLASS(mode === "add")} onClick={() => setMode("add")}>
            Add Text
          </button>
          <button type="button" className={TAB_CLASS(mode === "replace")} onClick={() => setMode("replace")}>
            Replace Text
          </button>
          <button type="button" className={TAB_CLASS(mode === "format")} onClick={() => setMode("format")}>
            Format
          </button>
        </div>

        {/* Controls */}
        {mode === "add" ? (
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="Text to add"
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              className="flex-1"
            />
            <select
              aria-label="Position"
              value={addPosition}
              onChange={(e) => setAddPosition(e.target.value as Position)}
              className={SELECT_CLASS}
            >
              <option value="after">after name</option>
              <option value="before">before name</option>
            </select>
          </div>
        ) : mode === "replace" ? (
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="Find"
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              className="flex-1"
            />
            <Input
              placeholder="Replace with"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              className="flex-1"
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <select
                aria-label="Format type"
                value={formatKind}
                onChange={(e) => setFormatKind(e.target.value as FormatKind)}
                className={SELECT_CLASS}
              >
                <option value="nameCounter">Name and Counter</option>
                <option value="counter">Counter only</option>
              </select>
              {formatKind === "nameCounter" && !customFormat.trim() ? (
                <select
                  aria-label="Counter position"
                  value={formatPosition}
                  onChange={(e) => setFormatPosition(e.target.value as Position)}
                  className={SELECT_CLASS}
                >
                  <option value="after">after name</option>
                  <option value="before">before name</option>
                </select>
              ) : null}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-sm font-bold text-[#1a1a1a]">
                Custom Format:
              </label>
              <Input
                placeholder="e.g., shot_"
                value={customFormat}
                onChange={(e) => setCustomFormat(e.target.value)}
                className="flex-1 min-w-[160px]"
              />
              <label className="text-sm font-bold text-[#1a1a1a]">
                Start at:
              </label>
              <Input
                type="number"
                value={startAt}
                onChange={(e) => setStartAt(Number(e.target.value) || 1)}
                className="w-20"
              />
            </div>
          </div>
        )}

        {/* Preview */}
        <div className="max-h-64 overflow-y-auto border-2 border-[#1a1a1a] divide-y-2 divide-[#1a1a1a]">
          {previews.map((p) => (
            <div
              key={p._id}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2 text-sm"
            >
              <span className="truncate text-[#888]">{p.title}</span>
              <span className="text-[#888]">→</span>
              <span
                className={cn(
                  "truncate font-medium",
                  p.next !== p.title ? "text-[#1a1a1a]" : "text-[#888]",
                )}
              >
                {p.next}
              </span>
            </div>
          ))}
        </div>

        {error ? <p className="text-xs text-[#dc2626]">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void handleRename()} disabled={busy || changedCount === 0}>
            {busy
              ? "Renaming…"
              : `Rename ${changedCount} ${changedCount === 1 ? "item" : "items"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
