const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("planner", {
  load: () => ipcRenderer.invoke("planner:load"),
  save: (data) => ipcRenderer.invoke("planner:save", data),
  importImage: () => ipcRenderer.invoke("planner:importImage"),
  saveImageAsset: (payload) => ipcRenderer.invoke("planner:saveImageAsset", payload),
  openItemWindow: (itemId) => ipcRenderer.invoke("planner:openItemWindow", itemId)
});
