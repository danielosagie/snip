// Native bridge injected by the snip desktop shell (Electron preload). Present
// only when the web app runs inside the desktop app; `undefined` in a browser.
export {};

interface DesktopMountState {
  status: "unmounted" | "mounting" | "mounted" | "unmounting" | "error";
  mountPath: string | null;
  lastError: string | null;
  // Tail of the mount log (last ~30 lines) so the UI can show live progress
  // while connecting instead of a black-box spinner.
  log?: string[];
}

interface DesktopUpdateState {
  status:
    | "idle"
    | "checking"
    | "available"
    | "none"
    | "downloading"
    | "downloaded"
    | "error";
  version: string | null;
  percent: number;
  error: string | null;
  requiresManualInstall: boolean;
}

export interface DesktopBackupDestination {
  teamSlug: string;
  projectName: string;
  folderPath: string[];
}

export interface DesktopBackupSource {
  id: string;
  kind: "folder" | "volume";
  path: string;
  label: string;
  volumeName: string | null;
  destination: DesktopBackupDestination;
  autoOnConnect: boolean;
  enabled: boolean;
  includeHidden: boolean;
  addedAt: number;
}

export interface DesktopBackupRun {
  sourceId: string;
  state: "idle" | "scanning" | "uploading" | "done" | "error" | "cancelled";
  filesTotal: number;
  filesDone: number;
  filesFailed: number;
  filesSkipped: number;
  bytesTotal: number;
  bytesDone: number;
  currentFile: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  reason: string | null;
}

export interface DesktopVolume {
  path: string;
  name: string;
}

export interface DesktopBackupState {
  enabled: boolean;
  promptOnNewDrive: boolean;
  sweepMinutes: number;
  sources: DesktopBackupSource[];
  runs: DesktopBackupRun[];
  volumes: DesktopVolume[];
  pendingDrive: { path: string; name: string; at: number } | null;
  log: string[];
}

interface DesktopApi {
  app: {
    version: () => Promise<string>;
    uninstall: () => Promise<{ ok: boolean; trashed?: boolean }>;
    onUninstallRequested: (handler: () => void) => () => void;
  };
  update: {
    state: () => Promise<DesktopUpdateState>;
    check: () => Promise<{ ok: boolean; reason?: string }>;
    install: () => Promise<{ ok: boolean; reason?: string; manual?: boolean }>;
    onStatus: (handler: (state: DesktopUpdateState) => void) => () => void;
  };
  settings: {
    get: () => Promise<Record<string, unknown> & { storage: Record<string, unknown> }>;
    set: (next: Record<string, unknown>) => Promise<unknown>;
  };
  convex: {
    // Push the Convex deployment URL + a fresh Clerk-minted Convex JWT to the
    // native layer so the WebDAV drive can authenticate its Convex calls.
    setAuth: (payload: { url: string; token: string }) => Promise<{ ok: boolean }>;
  };
  mount: {
    status: () => Promise<DesktopMountState>;
    start: (args: { mountPath?: string }) => Promise<unknown>;
    stop: () => Promise<unknown>;
    onStatus: (handler: (state: DesktopMountState) => void) => () => void;
  };
  shell: {
    openFolder: (path: string) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
  };
  backup: {
    state: () => Promise<DesktopBackupState>;
    volumes: () => Promise<DesktopVolume[]>;
    addFolder: (args: {
      destination: DesktopBackupDestination;
    }) => Promise<{ ok: boolean; cancelled?: boolean; state?: DesktopBackupState }>;
    addVolume: (args: {
      volumePath: string;
      destination: DesktopBackupDestination;
    }) => Promise<{ ok: boolean; state?: DesktopBackupState }>;
    updateSource: (args: {
      id: string;
      patch: Partial<
        Pick<
          DesktopBackupSource,
          "enabled" | "autoOnConnect" | "includeHidden" | "label"
        >
      > & { destination?: DesktopBackupDestination };
    }) => Promise<{ ok: boolean; state: DesktopBackupState }>;
    removeSource: (args: { id: string }) => Promise<{ ok: boolean; state: DesktopBackupState }>;
    run: (args?: { id?: string }) => Promise<{ ok: boolean }>;
    cancel: (args?: { id?: string }) => Promise<{ ok: boolean }>;
    setOptions: (args: {
      enabled?: boolean;
      promptOnNewDrive?: boolean;
      sweepMinutes?: number;
    }) => Promise<{ ok: boolean; state: DesktopBackupState }>;
    dismissDrive: (args?: { name?: string }) => Promise<{ ok: boolean; state: DesktopBackupState }>;
    onState: (handler: (state: DesktopBackupState) => void) => () => void;
  };
}

declare global {
  interface Window {
    snipDesktop?: { isDesktop: boolean; platform: string };
    api?: DesktopApi;
  }
}
