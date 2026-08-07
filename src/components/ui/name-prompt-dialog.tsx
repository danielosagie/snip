"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface NamePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  inputLabel: string;
  initialValue: string;
  actionLabel: string;
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  allowEmpty?: boolean;
  onSubmit: (value: string) => void | Promise<void>;
}

export function NamePromptDialog({
  open,
  onOpenChange,
  title,
  inputLabel,
  initialValue,
  actionLabel,
  busy = false,
  busyLabel,
  error,
  allowEmpty = false,
  onSubmit,
}: NamePromptDialogProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [value, setValue] = React.useState(initialValue);

  React.useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialValue, open]);

  const canSubmit = allowEmpty || value.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit || busy) return;
            void onSubmit(value);
          }}
        >
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-[#6E6E73]">
              {inputLabel}
            </span>
            <Input
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={busy}
            />
          </label>
          {error ? (
            <div className="text-xs font-bold text-[#DC2626]" role="alert">
              {error}
            </div>
          ) : null}
          <DialogFooter className="flex-row justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || busy}>
              {busy ? (busyLabel ?? actionLabel) : actionLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
