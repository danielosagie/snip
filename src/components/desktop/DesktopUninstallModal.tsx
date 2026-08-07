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

/**
 * snip-branded confirm for "Uninstall snip Desktop". The native app menu item
 * (electron-main buildAppMenu) fires window.api.app.onUninstallRequested, which
 * opens this modal — so we never fall back to a stock OS confirm dialog. On
 * confirm, the main process unmounts the drive, deletes local app data, moves
 * the bundle to the Trash, and quits.
 */
export function DesktopUninstallModal() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.api?.app?.onUninstallRequested) {
      return;
    }
    return window.api.app.onUninstallRequested(() => setOpen(true));
  }, []);

  const confirm = async () => {
    if (!window.api) return;
    setBusy(true);
    try {
      // Resolves just before the app quits; the window tears down after.
      await window.api.app.uninstall();
    } catch {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Uninstall snip Desktop</DialogTitle>
          <DialogDescription>
            This removes the app and its local data. The drive unmounts and
            macFUSE stays installed. Your cloud files are not affected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="rounded-full border border-[#D8D8DE] bg-white px-4 py-2 text-xs font-medium text-[#131315] transition-colors hover:bg-[#F1F1F3] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="rounded-full px-4 py-2 text-xs font-medium text-[#D8434F] transition-colors hover:bg-[#FFF5F5] disabled:opacity-50"
          >
            {busy ? "Uninstalling…" : "Uninstall"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
