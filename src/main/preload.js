const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('ioc', {
  rpc: (method, params=[]) => ipcRenderer.invoke('ioc:rpc', {method, params}),
  status: () => ipcRenderer.invoke('ioc/status'),
  listAddrs: () => ipcRenderer.invoke('ioc/listaddrs'),
  listTx: (n=50) => ipcRenderer.invoke('ioc/listtx', n),
  newAddr: (label='') => ipcRenderer.invoke('ioc/newaddr', label)
});
(()=>{const e=require('electron');if(!globalThis.__iocSysExposed){e.contextBridge.exposeInMainWorld('sys',{openFolder:()=>e.ipcRenderer.send('sys:openFolder')});globalThis.__iocSysExposed=true}})();
(()=>{const e=require('electron');if(!globalThis.__iocDiagExposed){e.contextBridge.exposeInMainWorld('diag',{startTail:()=>e.ipcRenderer.send('diag:start'),stopTail:()=>e.ipcRenderer.send('diag:stop'),onData:(cb)=>{e.ipcRenderer.removeAllListeners('diag:data');e.ipcRenderer.on('diag:data',(_,line)=>cb(line))}});globalThis.__iocDiagExposed=true}})();
