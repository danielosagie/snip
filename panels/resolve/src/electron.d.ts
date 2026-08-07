declare module "electron" {
  interface WebContents {
    on(event: "will-navigate", listener: (event: { preventDefault(): void }) => void): void;
    setWindowOpenHandler(handler: () => { action: "deny" }): void;
  }

  export class BrowserWindow {
    constructor(options: Record<string, unknown>);
    static getAllWindows(): BrowserWindow[];
    loadFile(path: string): Promise<void>;
    on(event: "closed", listener: () => void): void;
    setMenu(value: null): void;
    webContents: WebContents;
  }

  export const app: {
    on(event: "activate" | "window-all-closed", listener: () => void): void;
    once(event: "ready", listener: () => void): void;
    quit(): void;
  };

  export const contextBridge: {
    exposeInMainWorld(name: string, api: unknown): void;
  };
}
