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
  /**
   * Screen sharing: the site draws the list of screens and windows itself. `fn(sources, choose)` is
   * called with the list ({ id, name, thumb, screen }); call `choose(id)` with the pick, or
   * `choose(null)` to cancel. Returns a function that stops listening.
   */
  onPickScreen: (fn) => {
    const handler = (_e, reqId, sources) => fn(sources, (id) => ipcRenderer.send("desktop:pick-screen-result", reqId, typeof id === "string" ? id : null));
    ipcRenderer.on("desktop:pick-screen", handler);
    ipcRenderer.send("desktop:picker-ready");
    return () => {
      ipcRenderer.removeListener("desktop:pick-screen", handler);
      ipcRenderer.send("desktop:picker-gone");
    };
  },
  onUpdate: (fn) => {
    const handler = (_e, state) => fn(state);
    ipcRenderer.on("desktop:update", handler);
    return () => ipcRenderer.removeListener("desktop:update", handler);
  },
});
