const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appBridge", {
  getRuntimeConfig: () => ipcRenderer.invoke("runtime-config"),
  exportLogs: (payload) => ipcRenderer.invoke("export-logs", payload),
  exportStrategies: (payload) => ipcRenderer.invoke("export-strategies", payload),
  importStrategies: () => ipcRenderer.invoke("import-strategies"),
  onBackendLog: (handler) => ipcRenderer.on("backend-log", (_event, payload) => handler(payload)),
  checkForUpdates: () => ipcRenderer.invoke("update-check"),
  downloadUpdate: () => ipcRenderer.invoke("update-download"),
  restartUpdate: () => ipcRenderer.invoke("update-install"),
  onUpdateEvent: (handler) => ipcRenderer.on("update-event", (_event, payload) => handler(payload))
});
