const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  backupWallet: () => ipcRenderer.invoke('ioc:wallet:backup')
});
