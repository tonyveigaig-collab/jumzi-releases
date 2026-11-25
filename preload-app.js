// Bridge between the JUMZI site and the desktop app (main window only). The site checks for
// window.jumziDesktop to add desktop touches: unread badge, focusing the window from a notification,
// desktop settings and diagnostics. Nothing here gives the page access to files or Node.
const { contextBridge, ipcRenderer } = require("electron");

const info = ipcRenderer.sendSync("desktop:info");

contextBridge.exposeInMainWorld("jumziDesktop", {
  version: info.version,
  platform: info.platform,
  arch: info.arch,
  /** Unread count on the dock / taskbar icon (0 clears it). */
  setBadge: (count) => ipcRenderer.send("desktop:badge", Math.max(0, Math.min(999, Number(count) || 0))),
  /** Bring the window to the front (e.g. when a notification is clicked). */
  focus: () => ipcRenderer.send("desktop:focus"),
  /** Flash the taskbar button / bounce the dock icon to get attention. */
  attention: () => ipcRenderer.send("desktop:attention"),
  openDiagnostics: () => ipcRenderer.send("desktop:diagnostics"),
  checkForUpdates: () => ipcRenderer.send("desktop:check-updates"),
  getSettings: () => ipcRenderer.invoke("desktop:settings"),
  setSetting: (key, value) => ipcRenderer.invoke("desktop:set-setting", String(key), Boolean(value)),
  onUpdate: (fn) => {
    const handler = (_e, state) => fn(state);
    ipcRenderer.on("desktop:update", handler);
    return () => ipcRenderer.removeListener("desktop:update", handler);
  },
});
