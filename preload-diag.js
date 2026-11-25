// Diagnostics window only.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("diag", {
  collect: () => ipcRenderer.invoke("diag:collect"),
  copy: () => ipcRenderer.invoke("diag:copy"),
  openLogs: () => ipcRenderer.invoke("diag:logs"),
  send: () => ipcRenderer.invoke("diag:send"),
});
