import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("appBridge", {
  getRuntimeConfig: () => ipcRenderer.invoke("runtime-config"),
  exportLogs: (payload) => ipcRenderer.invoke("export-logs", payload)
});
