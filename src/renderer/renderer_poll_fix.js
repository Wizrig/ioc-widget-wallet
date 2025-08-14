const { ipcRenderer } = require('electron');

window.ioc = Object.assign({}, window.ioc, {
  status: () => ipcRenderer.invoke('ioc/status'),
  rpc: (method, params = []) => ipcRenderer.invoke('ioc:rpc', { method, params })
});
