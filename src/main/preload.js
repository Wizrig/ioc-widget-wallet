const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('ioc', {
  rpc: (method, params=[]) => ipcRenderer.invoke('ioc:rpc', {method, params}),
  status: () => ipcRenderer.invoke('ioc/status'),
  listAddrs: () => ipcRenderer.invoke('ioc/listaddrs'),
  listTx: (n=50) => ipcRenderer.invoke('ioc/listtx', n),
  newAddr: (label='') => ipcRenderer.invoke('ioc/newaddr', label),
  // First-run and data directory helpers
  getDataDir: () => ipcRenderer.invoke('ioc:getDataDir'),
  isFirstRun: () => ipcRenderer.invoke('ioc:isFirstRun'),
  // Daemon status
  daemonStatus: () => ipcRenderer.invoke('ioc:daemonStatus'),
  // Open external URL
  openExternal: (url) => ipcRenderer.invoke('ioc:openExternal', url)
});
(()=>{const e=require('electron');if(!globalThis.__iocSysExposed){e.contextBridge.exposeInMainWorld('sys',{openFolder:()=>e.ipcRenderer.send('sys:openFolder')});globalThis.__iocSysExposed=true}})();
(()=>{const e=require('electron');if(!globalThis.__iocDiagExposed){e.contextBridge.exposeInMainWorld('diag',{startTail:()=>e.ipcRenderer.send('diag:start'),stopTail:()=>e.ipcRenderer.send('diag:stop'),onData:(cb)=>{e.ipcRenderer.removeAllListeners('diag:data');e.ipcRenderer.on('diag:data',(_,line)=>cb(line))}});globalThis.__iocDiagExposed=true}})();
(()=>{try{
  const { contextBridge, ipcRenderer } = require('electron');
  if (!globalThis.__iocAnyInvoke) {
    contextBridge.exposeInMainWorld('api', { invoke: (ch, ...args) => ipcRenderer.invoke(ch, ...args) });
    contextBridge.exposeInMainWorld('electron', { ipcRenderer: { invoke: (...a) => ipcRenderer.invoke(...a) } });
    globalThis.__iocAnyInvoke = true;
  }
}catch(_){}})();
