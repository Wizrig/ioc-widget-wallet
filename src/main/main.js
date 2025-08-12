const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { DATA_DIR } = require('../shared/constants');
const { ensureConf, installLaunchAgent, unloadLaunchAgent, startDetached, stopViaCli } = require('./daemon');
const { rpc, getBlockCount, getConnectionCount, getWalletInfo, getMiningInfo, getStakingInfo, getPeerInfo, getNewAddress, sendToAddress, walletLock, walletPassphrase, listTransactions, getInfo, getEncStatus, getLockStatus, reserveBalance } = require('./rpc');
let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 920, height: 640, minWidth: 880, minHeight: 600,
    transparent: true, vibrancy: 'sidebar', visualEffectState: 'active',
    titleBarStyle: 'hiddenInset', titleBarOverlay: { color: '#00000000', symbolColor: '#d7e6ff', height: 48 },
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}
app.whenReady().then(() => { ensureConf(); createWindow(); });
app.on('window-all-closed', () => app.quit());
ipcMain.handle('env:paths', () => ({ dataDir: DATA_DIR }));
ipcMain.handle('daemon:startDetached', (_e, p) => startDetached(p));
ipcMain.handle('daemon:installLaunchAgent', (_e, p) => installLaunchAgent(p));
ipcMain.handle('daemon:unloadLaunchAgent', () => unloadLaunchAgent());
ipcMain.handle('daemon:stop', (_e, cli) => stopViaCli(cli));
async function safe(fn){ try{ return await fn(); }catch{ return null; } }
ipcMain.handle('rpc:status', async () => {
  const [height, peers, wallet, mining, staking, chain, info, enc, lockst] = await Promise.all([
    safe(()=>getBlockCount()), safe(()=>getConnectionCount()), safe(()=>getWalletInfo()),
    safe(()=>getMiningInfo()), safe(()=>getStakingInfo()), safe(()=>rpc('getblockchaininfo')),
    safe(()=>getInfo()), safe(()=>getEncStatus()), safe(()=>getLockStatus())
  ]);
  return { height, peers, wallet, mining, staking, chain, info, enc, lockst };
});
ipcMain.handle('rpc:newAddress', (_e, label) => getNewAddress(label));
ipcMain.handle('rpc:send', (_e, to, amt, c, ct) => sendToAddress(to, amt, c, ct));
ipcMain.handle('rpc:lock', () => walletLock());
ipcMain.handle('rpc:unlock', (_e, pass, secs) => walletPassphrase(pass, secs));
ipcMain.handle('rpc:listtx', (_e, count=50) => listTransactions(count));
ipcMain.handle('rpc:reserve', (_e, reserve, amount) => reserveBalance(reserve, amount));
ipcMain.handle('open:dir', async (_e, dir) => { await shell.openPath('/System/Applications/Utilities/Terminal.app'); return shell.openPath(dir); });
