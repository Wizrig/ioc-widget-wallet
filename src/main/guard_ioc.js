const { ipcMain } = require('electron');
const RPC_CHANNEL = 'ioc:rpc';
if (!global.__iocIpcGuardInstalled) {
  const _handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    try {
      _handle(channel, listener);
    } catch (e) {
      const msg = String(e || '');
      // Ignore only the duplicate-registration case for the RPC channel.
      if (!(channel === RPC_CHANNEL && msg.includes('register a second handler'))) {
        throw e;
      }
    }
  };
  global.__iocIpcGuardInstalled = true;
}
