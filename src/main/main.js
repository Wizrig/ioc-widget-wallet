const {app, BrowserWindow, ipcMain} = require('electron');
const path = require('path');
const fs = require('fs');
const {execFile} = require('child_process');

let win;

function findCli() {
  const candidates = [
    'iocoin-cli',
    '/usr/local/bin/iocoin-cli',
    '/opt/homebrew/bin/iocoin-cli',
    '/usr/local/bin/iocoind',
    '/opt/homebrew/bin/iocoind'
  ];
  for (const p of candidates) {
    if (p.includes('/') && fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function callCli(method, params = []) {
  return new Promise((resolve, reject) => {
    const cli = findCli();
    const args = [method, ...params.map(v => {
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return JSON.stringify(v);
    })];
    const child = execFile(cli, args, {timeout: 10000}, (err, stdout) => {
      if (err) return reject(new Error('cli not connected'));
      const out = (stdout || '').trim();
      try {
        if (!out) return resolve(null);
        return resolve(JSON.parse(out));
      } catch {
        const num = Number(out);
        if (!Number.isNaN(num)) return resolve(num);
        return resolve(out);
      }
    });
    child.on('error', () => reject(new Error('cli not connected')));
  });
}

async function safeRpc(method, params = [], fallback = null) {
  try { return await callCli(method, params); } catch { return fallback; }
}

ipcMain.handle('ioc/rpc', async (_e, {method, params}) => {
  return await safeRpc(method, params, null);
});

/** ---- Coalesced, cached status snapshot ---- */
const statusCache = { ts: 0, data: null, inflight: null };
async function computeStatus() {
  const [info, bc, stake, peers, lockst] = await Promise.all([
    safeRpc('getinfo', [], {}) || {},
    (async () => {
      const bi = await safeRpc('getblockchaininfo', [], null);
      if (bi) return bi;
      const blocks = await safeRpc('getblockcount', [], 0);
      return {blocks, headers: blocks, verificationprogress: blocks ? 1 : 0};
    })(),
    safeRpc('getstakinginfo', [], {}) || {},
    safeRpc('getconnectioncount', [], 0),
    (async () => (await safeRpc('walletlockstatus', [], null)) || {})()
  ]);
  return { info, chain: bc, peers, staking: stake, lockst };
}

ipcMain.handle('ioc/status', async () => {
  const now = Date.now();
  if (statusCache.inflight) {
    // Another caller already kicked off collection — piggyback on it.
    return await statusCache.inflight;
  }
  if (statusCache.data && (now - statusCache.ts) < 1000) {
    return statusCache.data; // fresh enough (<=1s old)
  }
  statusCache.inflight = computeStatus()
    .then(data => {
      statusCache.data = data;
      statusCache.ts = Date.now();
      return data;
    })
    .finally(() => { statusCache.inflight = null; });
  return await statusCache.inflight;
});
/** ------------------------------------------- */

ipcMain.handle('ioc/listaddrs', async () => {
  const groupings = await safeRpc('listaddressgroupings', [], null);
  if (Array.isArray(groupings)) {
    const rows = [];
    groupings.forEach(g => {
      (g || []).forEach(([addr, amount, label]) => {
        rows.push({address: addr, amount: amount || 0, label: label || ''});
      });
    });
    return rows;
  }
  const addrs = await safeRpc('getaddressesbyaccount', [''], []);
  const rows = [];
  for (const a of addrs) {
    const amt = await safeRpc('getreceivedbyaddress', [a], 0);
    rows.push({address: a, amount: amt || 0, label: ''});
  }
  return rows;
});

ipcMain.handle('ioc/listtx', async (_e, n = 50) => {
  const tx = await safeRpc('listtransactions', ['*', n], []);
  return Array.isArray(tx) ? tx : [];
});

/** Create a new receiving address and label it (compat: setaccount or setlabel). */
async function createLabeledAddress(label='') {
  const addr = await safeRpc('getnewaddress', label ? [label] : [], null);
  if (!addr || typeof addr !== 'string') throw new Error('could not create address');
  await safeRpc('setaccount', [addr, label], null);
  await safeRpc('setlabel', [addr, label], null);
  return {address: addr, label};
}

ipcMain.handle('ioc/newaddr', async (_e, label) => {
  try {
    const res = await createLabeledAddress((label || '').trim());
    return {ok: true, ...res};
  } catch (e) {
    return {ok: false, error: e?.message || 'failed'};
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 600,
    height: 525,
    minWidth: 600,
    minHeight: 525,
    backgroundColor: '#0f171c',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: {x: 14, y: 14},
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
(()=>{if(global.__iocSysRegistered)return;global.__iocSysRegistered=true;const e=require('electron');e.ipcMain.on('sys:openFolder',()=>{const home=process.env.HOME||require('os').homedir();const folder=`${home}/Library/Application Support/IOCoin/`;e.shell.openPath(folder)})})();
(()=>{if(global.__iocDiagRegistered)return;global.__iocDiagRegistered=true;const e=require('electron');const cp=require('child_process');const procs=new Map();function start(wc){if(procs.has(wc.id))return;const p=cp.spawn('tail',['-F','-n0',`${process.env.HOME||require('os').homedir()}/Library/Application Support/IOCoin/debug.log`],{stdio:['ignore','pipe','pipe']});procs.set(wc.id,p);const send=d=>{try{wc.send('diag:data',String(d))}catch{}};p.stdout.on('data',send);p.stderr.on('data',send);p.on('close',()=>{procs.delete(wc.id)});wc.once('destroyed',()=>{try{p.kill()}catch{} procs.delete(wc.id)})}function stop(wc){const p=procs.get(wc.id);if(p){try{p.kill()}catch{} procs.delete(wc.id)}}e.ipcMain.on('diag:start',ev=>start(ev.sender));e.ipcMain.on('diag:stop',ev=>stop(ev.sender))})();

// ===== IOC Wallet Backup IPC (idempotent) =====
(() => {
  try {
    const { ipcMain, app, BrowserWindow, dialog } = require('electron');
    const fs = require('fs');
    const path = require('path');
    if (ipcMain._iocBackupInstalled) return;
    ipcMain._iocBackupInstalled = true;

    const iocDataDir = () => {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'IOCoin');
      if (process.platform === 'win32')  return path.join(process.env.APPDATA || path.join(home, 'AppData','Roaming'), 'IOCoin');
      return path.join(home, '.IOCoin');
    };
    const walletDatPath = () => {
      const base = iocDataDir();
      const p1 = path.join(base, 'wallet.dat');
      const p2 = path.join(base, 'wallets', 'wallet.dat');
      if (fs.existsSync(p1)) return p1;
      if (fs.existsSync(p2)) return p2;
      return p1;
    };

    ipcMain.handle('ioc:wallet:getPath', async () => walletDatPath());

    ipcMain.handle('ioc:wallet:backup', async () => {
      try {
        const src = walletDatPath();
        if (!fs.existsSync(src)) return { ok:false, error:`wallet.dat not found at ${src}` };
        const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
        const defPath = path.join(app.getPath('downloads'), `wallet-${ts}.dat`);
        const win = BrowserWindow.getFocusedWindow();
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: 'Save wallet backup',
          defaultPath: defPath,
          buttonLabel: 'Save Backup',
          filters: [{ name:'Wallet Dat', extensions:['dat'] }]
        });
        if (canceled || !filePath) return { ok:false, canceled:true };
        fs.copyFileSync(src, filePath);
        return { ok:true, src, savedTo:filePath };
      } catch (e) {
        return { ok:false, error: e?.message || String(e) };
      }
    });
  } catch (_) {}
})();
// ===== end IPC =====

// ===== IOC Wallet Backup IPC (idempotent) =====
(() => {
  try {
    const { ipcMain, app, BrowserWindow, dialog } = require('electron');
    const fs = require('fs');
    const path = require('path');
    if (ipcMain._iocBackupInstalled) return;
    ipcMain._iocBackupInstalled = true;

    const iocDataDir = () => {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'IOCoin');
      if (process.platform === 'win32')  return path.join(process.env.APPDATA || path.join(home, 'AppData','Roaming'), 'IOCoin');
      return path.join(home, '.IOCoin');
    };
    const walletDatPath = () => {
      const base = iocDataDir();
      const p1 = path.join(base, 'wallet.dat');
      const p2 = path.join(base, 'wallets', 'wallet.dat');
      if (fs.existsSync(p1)) return p1;
      if (fs.existsSync(p2)) return p2;
      return p1;
    };

    ipcMain.handle('ioc:wallet:getPath', async () => walletDatPath());

    ipcMain.handle('ioc:wallet:backup', async () => {
      try {
        const src = walletDatPath();
        if (!fs.existsSync(src)) return { ok:false, error:`wallet.dat not found at ${src}` };
        const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
        const defPath = path.join(app.getPath('downloads'), `wallet-${ts}.dat`);
        const win = BrowserWindow.getFocusedWindow();
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: 'Save wallet backup',
          defaultPath: defPath,
          buttonLabel: 'Save Backup',
          filters: [{ name:'Wallet Dat', extensions:['dat'] }]
        });
        if (canceled || !filePath) return { ok:false, canceled:true };
        fs.copyFileSync(src, filePath);
        return { ok:true, src, savedTo:filePath };
      } catch (e) {
        return { ok:false, error: e?.message || String(e) };
      }
    });
  } catch (_) {}
})();
// ===== end IPC =====
