"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmVariant = "primary" | "destructive";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: ConfirmVariant;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "primary",
  busy = false,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
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
          <Button
            type="button"
            variant={variant === "destructive" ? "destructive" : "primary"}
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy ? `${confirmLabel}…` : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmDialogOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: ConfirmVariant;
  action: () => unknown | Promise<unknown>;
  errorMessage?: string | ((error: unknown) => string);
}

interface ConfirmRequest {
  options: ConfirmDialogOptions;
  resolve: (confirmed: boolean) => void;
}

const ConfirmDialogContext = React.createContext<
  ((options: ConfirmDialogOptions) => Promise<boolean>) | null
>(null);

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestRef = React.useRef<ConfirmRequest | null>(null);

  const close = React.useCallback((confirmed: boolean) => {
    const current = requestRef.current;
    requestRef.current = null;
    setRequest(null);
    setBusy(false);
    setError(null);
    current?.resolve(confirmed);
  }, []);

  const confirm = React.useCallback(
    (options: ConfirmDialogOptions) =>
      new Promise<boolean>((resolve) => {
        requestRef.current?.resolve(false);
        const next = { options, resolve };
        requestRef.current = next;
        setRequest(next);
        setBusy(false);
        setError(null);
      }),
    [],
  );

  React.useEffect(
    () => () => {
      requestRef.current?.resolve(false);
      requestRef.current = null;
    },
    [],
  );

  const handleConfirm = React.useCallback(async () => {
    const current = requestRef.current;
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await current.options.action();
      close(true);
    } catch (caught) {
      const message = current.options.errorMessage;
      setError(
        typeof message === "function"
          ? message(caught)
          : (message ??
              (caught instanceof Error ? caught.message : "Please try again.")),
      );
      setBusy(false);
    }
  }, [busy, close]);

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={request !== null}
        onOpenChange={(open) => {
          if (!open && !busy) close(false);
        }}
        title={request?.options.title ?? "Confirm"}
        description={request?.options.description ?? "Continue?"}
        confirmLabel={request?.options.confirmLabel}
        variant={request?.options.variant}
        busy={busy}
        error={error}
        onConfirm={handleConfirm}
      />
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const context = React.useContext(ConfirmDialogContext);
  if (!context) {
    throw new Error("useConfirmDialog must be used within ConfirmDialogProvider");
  }
  return context;
}
