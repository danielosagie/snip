// Preload bridge — exposes a minimal IPC surface to the renderer under
// window.api. Keep this list tight so the renderer can't make arbitrary IPC
// calls (Electron security best practice).

const { contextBridge, ipcRenderer } = require("electron");

// Detection flag for the web app: when running inside the desktop shell it can
// surface native-only affordances (the cloud drive) and route uploads/opens
// through window.api instead of the browser.
contextBridge.exposeInMainWorld("snipDesktop", {
  isDesktop: true,
  platform: process.platform,
});

contextBridge.exposeInMainWorld("api", {
  app: {
    version: () => ipcRenderer.invoke("app:version"),
    uninstall: () => ipcRenderer.invoke("app:uninstall"),
    // Fired when the user picks "Uninstall snip Desktop…" from the native
    // app menu. The web app shows its own branded confirm modal and calls
    // uninstall() on confirm.
    onUninstallRequested: (handler) => {
      const listener = () => handler();
      ipcRenderer.on("menu:uninstall", listener);
      return () => ipcRenderer.off("menu:uninstall", listener);
    },
  },
  update: {
    state: () => ipcRenderer.invoke("update:state"),
    check: () => ipcRenderer.invoke("update:check"),
    install: () => ipcRenderer.invoke("update:install"),
    onStatus: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("update:status", listener);
      return () => ipcRenderer.off("update:status", listener);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (next) => ipcRenderer.invoke("settings:set", next),
  },
  convex: {
    // The signed-in web app pushes its Convex deployment URL + a fresh
    // Clerk-minted Convex JWT down so the native WebDAV drive can call Convex.
    setAuth: (payload) => ipcRenderer.invoke("convex:setAuth", payload),
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke("dialog:pick-folder"),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
    openFolder: (path) => ipcRenderer.invoke("local:open-folder", path),
  },
  files: {
    download: (args) => ipcRenderer.invoke("files:download", args),
  },
  sync: {
    pull: (args) => ipcRenderer.invoke("sync:pull", args),
    push: (args) => ipcRenderer.invoke("sync:push", args),
    onProgress: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("sync:progress", listener);
      return () => ipcRenderer.off("sync:progress", listener);
    },
  },
  mount: {
    status: () => ipcRenderer.invoke("mount:status"),
    prereqs: () => ipcRenderer.invoke("mount:prereqs"),
    start: (args) => ipcRenderer.invoke("mount:start", args),
    stop: () => ipcRenderer.invoke("mount:stop"),
    onStatus: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("mount:status", listener);
      return () => ipcRenderer.off("mount:status", listener);
    },
  },
  resolve: {
    status: () => ipcRenderer.invoke("resolve:status"),
    snapshot: (args) => ipcRenderer.invoke("resolve:snapshot", args),
    restore: (args) => ipcRenderer.invoke("resolve:restore", args),
    setActiveProject: (args) => ipcRenderer.invoke("resolve:set-active-project", args),
  },
  premiere: {
    pickFile: () => ipcRenderer.invoke("dialog:pick-prproj"),
    snapshot: (args) => ipcRenderer.invoke("premiere:snapshot", args),
    restoreDownload: (args) => ipcRenderer.invoke("premiere:restore-download", args),
  },
  lanCache: {
    peers: () => ipcRenderer.invoke("lanCache:peers"),
    listFromPeer: (args) => ipcRenderer.invoke("lanCache:listFromPeer", args),
    pullFromPeer: (args) => ipcRenderer.invoke("lanCache:pullFromPeer", args),
    onPeers: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("lanCache:peers", listener);
      return () => ipcRenderer.off("lanCache:peers", listener);
    },
  },
});
