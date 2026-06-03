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
    install: () => Promise<{ ok: boolean; reason?: string }>;
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
}

declare global {
  interface Window {
    snipDesktop?: { isDesktop: boolean; platform: string };
    api?: DesktopApi;
  }
}
