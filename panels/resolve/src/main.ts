import { join } from "node:path";
import { app, BrowserWindow } from "electron";

let mainWindow: BrowserWindow | undefined;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 700,
    minWidth: 320,
    minHeight: 520,
    useContentSize: true,
    autoHideMenuBar: true,
    backgroundColor: "#15171a",
    title: "Snip Resolve",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  void mainWindow.loadFile(join(__dirname, "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

app.once("ready", createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
