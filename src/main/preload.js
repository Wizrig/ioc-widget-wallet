const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ioc', {
  paths: () => ipcRenderer.invoke('env:paths'),
  startDetached: (p) => ipcRenderer.invoke('daemon:startDetached', p),
  installLaunchAgent: (p) => ipcRenderer.invoke('daemon:installLaunchAgent', p),
  unloadLaunchAgent: () => ipcRenderer.invoke('daemon:unloadLaunchAgent'),
  stopAll: (cli) => ipcRenderer.invoke('daemon:stop', cli),
  status: () => ipcRenderer.invoke('rpc:status'),
  newAddress: (label) => ipcRenderer.invoke('rpc:newAddress', label),
  send: (to, amt, c, ct) => ipcRenderer.invoke('rpc:send', to, amt, c, ct),
  lock: () => ipcRenderer.invoke('rpc:lock'),
  unlock: (pass, secs) => ipcRenderer.invoke('rpc:unlock', pass, secs),
  listTx: (count) => ipcRenderer.invoke('rpc:listtx', count),
  reserve: (reserve, amount) => ipcRenderer.invoke('rpc:reserve', reserve, amount),
  openDir: (dir) => ipcRenderer.invoke('open:dir', dir),
});
