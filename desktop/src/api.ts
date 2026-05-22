/**
 * Typed wrapper around the preload bridge (window.api). All Electron IPC
 * goes through here so the React code can pretend it's just calling async
 * functions.
 */

/**
 * LucidLink-parity feature flags. Each one gates a background loop or
 * surface in the main process — see electron-main.cjs DEFAULT_FEATURES
 * for the canonical shape. Defaults are all `enabled: false` so the
 * desktop app behaves the same as before until the user opts in.
 */
export interface DesktopFeatureFlags {
  /** File-level presence + soft locks ("Alex has X open in Premiere"). */
  presence: { enabled: boolean };
  /** Predictive prefetch on `.prproj` open — warms rclone's VFS cache. */
  prefetch: { enabled: boolean };
  /** LAN-shared cache (mDNS-discovered peers serve cached files). */
  lanCache: { enabled: boolean; port: number };
  /** Filesystem-level ACLs / team folder permissions. */
  acls: { enabled: boolean };
}

export interface DesktopSettings {
  convexUrl: string;
  convexAuthToken: string;
  storage: {
    provider: "r2" | "railway";
    bucket: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
  };
  rootDir: string;
  /** Which project the Resolve snapshot/restore actions push to / pull from. */
  activeProjectId?: string;
  features: DesktopFeatureFlags;
}

export interface SyncProgress {
  kind: "pull" | "push";
  current: number;
  total: number;
  file: string | null;
  done?: boolean;
}

export type MountStatus = "unmounted" | "mounting" | "mounted" | "unmounting" | "error";

export interface MountState {
  status: MountStatus;
  mountPath: string | null;
  pid: number | null;
  lastError: string | null;
  log: string[];
}

export interface MountPrereqs {
  platform: NodeJS.Platform;
  rclone: boolean;
  fuse: boolean;
  installHint: string;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "none"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  percent: number;
  error: string | null;
}

export interface ResolveStatus {
  ok: boolean;
  error?: string;
  message?: string;
  project_name?: string | null;
  project_id?: string | null;
  timeline_name?: string | null;
  timeline_id?: string | null;
  timeline_count?: number;
  resolve_product?: string | null;
  resolve_version?: string | null;
}

interface DesktopApi {
  app: {
    version: () => Promise<string>;
  };
  update: {
    state: () => Promise<UpdateState>;
    check: () => Promise<{ ok: boolean; reason?: string }>;
    install: () => Promise<{ ok: boolean; reason?: string }>;
    onStatus: (handler: (state: UpdateState) => void) => () => void;
  };
  settings: {
    get: () => Promise<DesktopSettings>;
    set: (next: DesktopSettings) => Promise<DesktopSettings>;
  };
  dialog: {
    pickFolder: () => Promise<string | null>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
    openFolder: (path: string) => Promise<void>;
  };
  sync: {
    pull: (args: { s3Prefix: string; localPath: string }) => Promise<{ fileCount: number }>;
    push: (args: { s3Prefix: string; localPath: string }) => Promise<{
      fileCount: number;
      sizeBytes: number;
    }>;
    onProgress: (handler: (progress: SyncProgress) => void) => () => void;
  };
  mount: {
    status: () => Promise<MountState>;
    prereqs: () => Promise<MountPrereqs>;
    start: (args: { mountPath?: string }) => Promise<{ status: MountStatus; mountPath: string }>;
    stop: () => Promise<{ status: MountStatus }>;
    onStatus: (handler: (state: MountState) => void) => () => void;
  };
  resolve: {
    status: () => Promise<ResolveStatus>;
    snapshot: (args: { message: string; branch?: string }) => Promise<{
      value?: { _id: string; branch: string };
    }>;
    restore: (args: { fcpxml: string }) => Promise<{
      ok: boolean;
      imported_as?: string;
      timeline_id?: string;
    }>;
    setActiveProject: (args: { projectId: string }) => Promise<{ ok: boolean }>;
  };
  premiere: {
    pickFile: () => Promise<string | null>;
    snapshot: (args: {
      filePath: string;
      message: string;
      branch?: string;
    }) => Promise<unknown>;
    restoreDownload: (args: {
      fcpxml: string;
      suggestedName?: string;
    }) => Promise<{ ok: boolean; cancelled?: boolean; path?: string }>;
  };
  lanCache: {
    peers: () => Promise<LanCachePeer[]>;
    listFromPeer: (args: {
      clientId: string;
      dir?: string;
    }) => Promise<{ dir: string; entries: { name: string; isDirectory: boolean }[]; truncated: boolean }>;
    pullFromPeer: (args: {
      clientId: string;
      remotePath: string;
    }) => Promise<{ ok: boolean; path: string; bytes: number }>;
    onPeers: (handler: (peers: LanCachePeer[]) => void) => () => void;
  };
}

export interface LanCachePeer {
  clientId: string;
  name: string;
  host: string;
  port: number;
  mountPath: string;
  lastSeen: number;
}

declare global {
  interface Window {
    api: DesktopApi;
  }
}

export const api: DesktopApi = window.api;
