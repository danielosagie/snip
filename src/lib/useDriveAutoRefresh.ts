import { useEffect, useRef } from "react";

type DriveBridge = {
  drive?: { refresh?: (args: { path?: string }) => unknown };
};

/**
 * Desktop only. When the current project's file tree changes in the web app
 * (delete / rename / add / move), push an rclone `vfs/refresh` so the mounted
 * drive reflects it in Finder ~instantly, instead of waiting out the dir-cache
 * TTL. No-op in a plain browser or on a desktop build without the drive bridge.
 *
 * `signature` should change iff the drive-visible tree changes (file ids +
 * names + folder placement) — NOT on incidental updates like a status flip.
 */
export function useDriveAutoRefresh(
  teamSlug: string | undefined,
  projectName: string | undefined,
  signature: string,
): void {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !teamSlug) return;
    const bridge = (window as unknown as { api?: DriveBridge }).api;
    if (!bridge?.drive?.refresh) return;
    // Skip the first observed signature (initial load) — only react to changes.
    if (last.current === null) {
      last.current = signature;
      return;
    }
    if (signature === last.current) return;
    last.current = signature;
    const path = projectName ? `${teamSlug}/${projectName}` : teamSlug;
    void bridge.drive.refresh({ path });
  }, [teamSlug, projectName, signature]);
}
