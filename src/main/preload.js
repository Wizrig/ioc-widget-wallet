const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('ioc', {
  rpc: (method, params=[]) => ipcRenderer.invoke('ioc/rpc', {method, params}),
  status: () => ipcRenderer.invoke('ioc/status'),
  listAddrs: () => ipcRenderer.invoke('ioc/listaddrs'),
  listTx: (n=50) => ipcRenderer.invoke('ioc/listtx', n)
});
