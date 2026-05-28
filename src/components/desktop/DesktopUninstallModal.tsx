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
            This removes the app and its local data — the drive unmounts and
            macFUSE stays installed. Your cloud files are not affected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider border-2 border-[#1a1a1a] bg-[#f0f0e8] text-[#1a1a1a] hover:bg-[#e8e8e0] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider border-2 border-[#b91c1c] bg-[#b91c1c] text-[#f0f0e8] hover:bg-[#9a1010] transition-colors disabled:opacity-50"
          >
            {busy ? "Uninstalling…" : "Uninstall"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
