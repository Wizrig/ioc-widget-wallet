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

ipcMain.handle('ioc/status', async () => {
  const [info, bc, stake, peers, lockst] = await Promise.all([
    safeRpc('getinfo', [], {}),
    (async () => {
      const bi = await safeRpc('getblockchaininfo', [], null);
      if (bi) return bi;
      const blocks = await safeRpc('getblockcount', [], 0);
      return {blocks, headers: blocks, verificationprogress: blocks ? 1 : 0};
    })(),
    safeRpc('getstakinginfo', [], {}),
    safeRpc('getconnectioncount', [], 0),
    (async () => {
      const s = await safeRpc('walletlockstatus', [], null);
      return s || {};
    })()
  ]);
  return { info, chain: bc, peers, staking: stake, lockst };
});

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
