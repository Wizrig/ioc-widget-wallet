const { contextBridge, ipcRenderer } = require('electron');

function rpc(method, params = []) {
  return ipcRenderer.invoke('ioc:rpc', method, params);
}
function status() {
  return ipcRenderer.invoke('ioc:status');
}

contextBridge.exposeInMainWorld('ioc', { rpc, status });
// Back-compat alias some of your code uses:
contextBridge.exposeInMainWorld('callRpc', rpc);
