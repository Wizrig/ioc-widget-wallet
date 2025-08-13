const { ipcMain } = require('electron');
if (!global.__iocIpcGuardInstalled) {
  const _handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    try {
      _handle(channel, listener);
    } catch (e) {
      const msg = String(e || '');
      // Ignore only the duplicate-registration case for the ioc:rpc channel.
      if (!(channel === 'ioc:rpc' && msg.includes('register a second handler'))) {
        throw e;
      }
    }
  };
  global.__iocIpcGuardInstalled = true;
}
