// Only used by the screen picker window: lists the screens/windows and returns the choice.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("picker", {
  sources: () => ipcRenderer.invoke("picker:sources"),
  choose: (id) => ipcRenderer.send("picker:choose", id),
});
