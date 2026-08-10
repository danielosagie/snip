/**
 * Which desktop build to offer a visitor.
 *
 * The landing page is prerendered, so this cannot run during SSR: the static
 * HTML is shared by every visitor. Callers render the neutral "unknown" label
 * first and specialise after mount, which also keeps the markup identical
 * between server and client so hydration does not warn.
 */

export type DesktopPlatform = "mac-arm" | "mac-intel" | "windows" | "linux";

export type DesktopDownload = {
  /** Stable URL that redirects to the newest release asset. */
  href: string;
  /** Button label, e.g. "Download for Windows". */
  label: string;
  /** Short name for secondary copy, e.g. "Windows". */
  os: string;
};

const DOWNLOADS: Record<DesktopPlatform, DesktopDownload> = {
  // Apple silicon gets the .pkg: it bundles macFUSE, which the drive needs.
  "mac-arm": {
    href: "/downloads/snip-desktop.pkg",
    label: "Download for Mac",
    os: "Mac",
  },
  "mac-intel": {
    href: "/downloads/snip-desktop-x64.pkg",
    label: "Download for Mac",
    os: "Mac",
  },
  windows: {
    href: "/downloads/snip-desktop-setup.exe",
    label: "Download for Windows",
    os: "Windows",
  },
  linux: {
    href: "/downloads/snip-desktop.AppImage",
    label: "Download for Linux",
    os: "Linux",
  },
};

/** Fallback shown before detection runs and when the platform is unknown. */
export const NEUTRAL_DOWNLOAD: DesktopDownload = {
  href: "/downloads/snip-desktop.pkg",
  label: "Download desktop app",
  os: "desktop",
};

export function downloadFor(platform: DesktopPlatform): DesktopDownload {
  return DOWNLOADS[platform];
}

export function allDownloads(): Array<DesktopDownload & { key: DesktopPlatform }> {
  return (Object.keys(DOWNLOADS) as DesktopPlatform[]).map((key) => ({
    key,
    ...DOWNLOADS[key],
  }));
}

/**
 * Best-effort OS sniff. Returns null when we cannot tell, so the caller keeps
 * the neutral label rather than guessing wrong and handing someone the wrong
 * installer, which is the bug this exists to fix.
 *
 * Apple silicon cannot be detected from the user agent (Safari reports Intel
 * either way), so Mac defaults to the arm64 build: it is the overwhelming
 * majority of Macs sold since 2020, and the Intel build is one click away.
 */
export function detectPlatform(): DesktopPlatform | null {
  if (typeof navigator === "undefined") return null;

  const uaData = (
    navigator as Navigator & {
      userAgentData?: { platform?: string };
    }
  ).userAgentData;
  const raw = `${uaData?.platform ?? ""} ${navigator.userAgent ?? ""}`.toLowerCase();

  // iOS and Android have no desktop build; treat them as unknown so they see
  // the neutral label instead of being told to download a Windows installer.
  if (/iphone|ipad|ipod|android/.test(raw)) return null;

  if (/win/.test(raw)) return "windows";
  if (/mac/.test(raw)) return "mac-arm";
  if (/linux|x11|cros/.test(raw)) return "linux";
  return null;
}
