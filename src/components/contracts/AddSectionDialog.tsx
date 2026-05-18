"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Modal for adding a custom section to a contract. Replaces the
 * old `prompt()` call so the UX matches the rest of the app and we
 * can show validation inline.
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (title: string) => void | Promise<void>;
}

export function AddSectionDialog({ open, onOpenChange, onConfirm }: Props) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when the dialog reopens so a previous title /
  // error doesn't linger.
  useEffect(() => {
    if (open) {
      setTitle("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Section title can't be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add section.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New section</DialogTitle>
          <DialogDescription>
            Add a custom clause. Rename or delete it anytime.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void submit(e)} className="space-y-3 pt-2">
          <label className="block">
            <div className="text-[10px] uppercase tracking-[0.15em] text-[#888] font-bold mb-1">
              Section title
            </div>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Late delivery penalty"
              disabled={busy}
            />
          </label>
          {error ? (
            <div className="text-xs font-bold text-[#dc2626]">{error}</div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? "Adding…" : "Add section"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
