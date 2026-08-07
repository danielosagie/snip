"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("versionHistory", {
  list: () => ipcRenderer.invoke("versions:list"),
  restoreCopy: (id) => ipcRenderer.invoke("versions:restore-copy", { id }),
  onChanged: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("versions:changed", listener);
    return () => ipcRenderer.off("versions:changed", listener);
  },
});
