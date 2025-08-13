const { ipcRenderer } = require('electron');

let last = null;
ipcRenderer.send('subscribe:status');
ipcRenderer.on('ioc:status', (_e, s) => {
  last = s;
  if (typeof window.updateFromStatus === 'function') {
    try { window.updateFromStatus(s); } catch {}
  }
});

window.ioc = Object.assign({}, window.ioc, {
  status: async () => last || {},
  rpc: (method, params=[]) => ipcRenderer.invoke('ioc:rpc', method, params)
});
