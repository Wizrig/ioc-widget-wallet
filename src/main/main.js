try {
  if (!global.__IOC_LOCKED_WINDOW__) {
    const { app, BrowserWindow , Menu} = require('electron');
    app.on('browser-window-created', (_evt, win) => {
      // Lock size once it has its final dimensions
      win.once('ready-to-show', () => {
        try {
          const [w, h] = win.getSize();
          win.setResizable(false);
          win.setMinimumSize(w, h);
          win.setMaximumSize(w, h);
        } catch {}
      });
    });
    global.__IOC_LOCKED_WINDOW__ = true;
  }
} catch {}

try { require('./ipc-ui'); } catch {}
try { require('./rpc-compat').init(); } catch {}
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

ipcMain.handle('ioc:rpc', async (_e, {method, params}) => {
  return await safeRpc(method, params, null);
});

// ===== First-run and data directory IPC handlers =====
const { DATA_DIR, isFirstRun } = require('../shared/constants');
const { ensureConf, findDaemonBinary, findCliBinary, isDaemonRunning, startDetached } = require('./daemon');

ipcMain.handle('ioc:getDataDir', async () => {
  return DATA_DIR;
});

ipcMain.handle('ioc:isFirstRun', async () => {
  return isFirstRun();
});

// ===== Daemon status and control IPC =====
let daemonState = { running: false, pid: null, error: null, binaryPath: null, startedByUs: false };

ipcMain.handle('ioc:daemonStatus', async () => {
  const status = await isDaemonRunning();
  daemonState.running = status.running;
  daemonState.error = status.error || null;
  return {
    running: daemonState.running,
    pid: daemonState.pid,
    error: daemonState.error,
    binaryPath: daemonState.binaryPath,
    startedByUs: daemonState.startedByUs
  };
});

/**
 * Auto-start daemon on app launch if not already running.
 * Called from app.whenReady().
 */
async function initDaemon() {
  ensureConf();

  // Check if daemon is already running
  const status = await isDaemonRunning();
  if (status.running) {
    console.log('[daemon] Already running, attaching...');
    daemonState.running = true;
    daemonState.startedByUs = false;
    return { ok: true, attached: true };
  }

  // Find daemon binary
  const binary = findDaemonBinary();
  if (!binary.found) {
    const errorMsg = `iocoind not found. Searched: ${binary.searched.join(', ')}`;
    console.error('[daemon]', errorMsg);
    daemonState.error = errorMsg;
    return { ok: false, error: errorMsg, searched: binary.searched };
  }

  daemonState.binaryPath = binary.path;
  console.log('[daemon] Starting daemon from:', binary.path);

  // Start daemon
  const started = startDetached(binary.path);
  if (started) {
    daemonState.startedByUs = true;
    console.log('[daemon] Daemon started successfully');
    return { ok: true, started: true, path: binary.path };
  } else {
    daemonState.error = 'Failed to start daemon';
    return { ok: false, error: 'Failed to start daemon' };
  }
}
// ===== End daemon IPC =====

// ===== Open external URL IPC =====
const { shell } = require('electron');
ipcMain.handle('ioc:openExternal', async (_e, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
    return { ok: true };
  }
  return { ok: false, error: 'Invalid URL' };
});
// ===== End openExternal IPC =====

// ===== Bootstrap IPC handlers =====
const bootstrap = require('./bootstrap');

ipcMain.handle('ioc:needsBootstrap', async () => {
  return bootstrap.needsBootstrap();
});

// Track download state for progress events
let bootstrapDownloadAbort = null;

ipcMain.handle('ioc:downloadBootstrap', async (event) => {
  // Send progress events to the renderer
  const sendProgress = (progress) => {
    try {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('bootstrap:progress', progress);
      }
    } catch (_) {}
  };

  const result = await bootstrap.downloadBootstrap(sendProgress);
  return result;
});

ipcMain.handle('ioc:applyBootstrap', async () => {
  // 1. Extract the bootstrap
  const extractResult = await bootstrap.extractBootstrap();
  if (!extractResult.ok) {
    return extractResult;
  }

  // 2. Clean up the zip file
  bootstrap.cleanupBootstrap();

  // 3. Restart daemon with new chain data
  const { stopViaCli, startDetached, findDaemonBinary, findCliBinary } = require('./daemon');

  // Stop daemon if running
  const cli = findCliBinary();
  if (cli.found) {
    try {
      await stopViaCli(cli.path);
      // Wait a moment for clean shutdown
      await new Promise(r => setTimeout(r, 2000));
    } catch (_) {
      // Daemon might not be running, that's OK
    }
  }

  // Start daemon
  const binary = findDaemonBinary();
  if (binary.found) {
    startDetached(binary.path);
  }

  return { ok: true, restarted: true };
});

ipcMain.handle('ioc:bootstrapCleanup', async () => {
  return bootstrap.cleanupBootstrap();
});
// ===== End Bootstrap IPC =====

// ===== Exit Confirmation Dialog (Step D) =====
const { dialog, nativeImage } = require('electron');
const { execSync } = require('child_process');

// Track if we should skip the confirmation (user already chose)
let exitConfirmed = false;

// Path to IOCoin icon for dialog
const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'icon.png');

/**
 * Show exit confirmation dialog.
 * Returns: 0 (No - quit) or 1 (Yes - hide)
 */
async function showExitConfirmation(win) {
  const iconImage = fs.existsSync(ICON_PATH) ? nativeImage.createFromPath(ICON_PATH) : undefined;
  const result = await dialog.showMessageBox(win, {
    type: 'none',
    icon: iconImage,
    buttons: ['No', 'Yes'],
    defaultId: 1,
    cancelId: 1,
    message: 'Leave demon running (recommended)?'
  });
  return result.response;
}

/**
 * Poll isDaemonRunning until it returns false or timeout.
 * @param {number} timeoutMs - Max time to wait
 * @param {number} intervalMs - Poll interval
 * @returns {Promise<boolean>} - true if stopped, false if still running
 */
async function waitForDaemonStop(timeoutMs, intervalMs = 500) {
  const { isDaemonRunning } = require('./daemon');
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const status = await isDaemonRunning();
    if (!status.running) {
      console.log('[exit] Daemon confirmed stopped');
      return true;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Find daemon PID from pidfile or pgrep.
 * @returns {number|null}
 */
function findDaemonPid() {
  // Check pidfile
  const pidFile = path.join(DATA_DIR, 'iocoind.pid');
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (pid > 0) {
        console.log('[exit] Found daemon PID from pidfile:', pid);
        return pid;
      }
    } catch (_) {}
  }

  // Fallback: use pgrep on unix
  if (process.platform !== 'win32') {
    try {
      const output = execSync('pgrep -x iocoind', { encoding: 'utf8', timeout: 3000 });
      const pid = parseInt(output.trim().split('\n')[0], 10);
      if (pid > 0) {
        console.log('[exit] Found daemon PID from pgrep:', pid);
        return pid;
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Force kill daemon by PID.
 * @param {number} pid
 * @param {string} signal - 'SIGTERM' or 'SIGKILL'
 */
function killDaemonByPid(pid, signal) {
  try {
    console.log(`[exit] Sending ${signal} to PID ${pid}`);
    process.kill(pid, signal);
    return true;
  } catch (err) {
    console.error(`[exit] Failed to kill PID ${pid}:`, err.message);
    return false;
  }
}

/**
 * Force kill daemon by process name (last resort).
 */
function killDaemonByName(signal) {
  if (process.platform === 'win32') return false;
  const sigFlag = signal === 'SIGKILL' ? '-KILL' : '-TERM';
  try {
    console.log(`[exit] Running pkill ${sigFlag} iocoind`);
    execSync(`pkill ${sigFlag} iocoind`, { timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Hard guarantee stop daemon and quit.
 * Will not return until daemon is confirmed stopped or all attempts exhausted.
 */
async function stopDaemonAndQuitHard() {
  const { stopViaCli, findCliBinary, isDaemonRunning } = require('./daemon');

  console.log('[exit] Starting hard shutdown sequence...');

  // Step A: Attempt graceful stop via CLI
  const cli = findCliBinary();
  if (cli.found) {
    console.log('[exit] Sending stop command via CLI...');
    try {
      await stopViaCli(cli.path);
    } catch (err) {
      console.error('[exit] CLI stop failed:', err.message);
    }

    // Poll for up to 20 seconds
    const stopped = await waitForDaemonStop(20000, 500);
    if (stopped) {
      console.log('[exit] Daemon stopped gracefully');
      app.exit(0);
      return;
    }
  }

  // Step B: Try SIGTERM by PID
  let pid = findDaemonPid();
  if (pid) {
    killDaemonByPid(pid, 'SIGTERM');
    const stopped = await waitForDaemonStop(10000, 500);
    if (stopped) {
      console.log('[exit] Daemon stopped after SIGTERM');
      app.exit(0);
      return;
    }

    // Try SIGKILL
    killDaemonByPid(pid, 'SIGKILL');
    const stoppedKill = await waitForDaemonStop(5000, 500);
    if (stoppedKill) {
      console.log('[exit] Daemon stopped after SIGKILL');
      app.exit(0);
      return;
    }
  }

  // Step C: Last resort - pkill by name
  const status = await isDaemonRunning();
  if (status.running) {
    console.log('[exit] Daemon still running, using pkill...');
    killDaemonByName('SIGTERM');
    let stopped = await waitForDaemonStop(5000, 500);
    if (!stopped) {
      killDaemonByName('SIGKILL');
      stopped = await waitForDaemonStop(3000, 500);
    }
  }

  // Step D: Quit regardless
  console.log('[exit] Exiting Electron...');
  app.exit(0);
}

ipcMain.handle('ioc:quitApp', async (event, stopDaemon) => {
  exitConfirmed = true;
  if (stopDaemon) {
    await stopDaemonAndQuitHard();
  } else {
    app.exit(0);
  }
  return { ok: true };
});

ipcMain.handle('ioc:hideWindow', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (process.platform === 'darwin') {
      app.hide();
    } else {
      win.hide();
    }
  }
  return { ok: true };
});
// ===== End Exit Confirmation =====

/** ---- Coalesced, cached status snapshot ---- */
const statusCache = { ts: 0, data: null, inflight: null };
async function computeStatus() {
  const now = Date.now();

  // ---- SLOW wallet cache (15s) ----
  if (!global.__iocWalletCache) global.__iocWalletCache = { ts: 0, data: { info: {}, staking: {}, lockst: {} } };
  const wc = global.__iocWalletCache;
  const walletFresh = wc.data && (now - wc.ts) < 15000;

  const walletPromise = walletFresh ? Promise.resolve(wc.data) : (async () => {
    const [info, stake, lockst] = await Promise.all([
      safeRpc('getinfo', [], {}) || {},
      safeRpc('getstakinginfo', [], {}) || {},
      (async () => (await safeRpc('walletlockstatus', [], null)) || {})()
    ]);
    const data = { info, staking: stake, lockst };
    wc.data = data;
    wc.ts = Date.now();
    return data;
  })();

  // ---- FAST chain+peers (every status call) ----
  const chainPromise = (async () => {
    const bi = await safeRpc('getblockchaininfo', [], null);
    if (bi) return bi;
    const blocks = await safeRpc('getblockcount', [], 0);
    return { blocks, headers: blocks, verificationprogress: blocks ? 1 : 0 };
  })();

  const peersPromise = safeRpc('getconnectioncount', [], 0);

  const [wallet, chain, peers] = await Promise.all([walletPromise, chainPromise, peersPromise]);
  return { info: wallet.info, chain, peers, staking: wallet.staking, lockst: wallet.lockst };
}
ipcMain.handle('ioc/status', async () => {
  const now = Date.now();
  if (statusCache.inflight) {
    console.log('[ioc/status] Coalescing request (in-flight)');
    return await statusCache.inflight;
  }
  if (statusCache.data && (now - statusCache.ts) < 3000) {
    console.log(`[ioc/status] Serving from cache (age: ${now - statusCache.ts}ms)`);
    return statusCache.data; // fresh enough (<=1s old)
  }
  const startTime = Date.now();
  console.log('[ioc/status] Starting new RPC batch');
  statusCache.inflight = computeStatus()
    .then(data => {
      const elapsed = Date.now() - startTime;
      console.log(`[ioc/status] RPC batch completed in ${elapsed}ms`);
      statusCache.data = data;
      statusCache.ts = Date.now();
      return data;
    })
    .catch(err => {
      const elapsed = Date.now() - startTime;
      console.error(`[ioc/status] RPC batch failed after ${elapsed}ms:`, err && err.message ? err.message : err);
      throw err;
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

  // Handle window close with confirmation dialog
  win.on('close', async (e) => {
    if (exitConfirmed) return; // Already confirmed, let it close

    e.preventDefault();
    const response = await showExitConfirmation(win);

    if (response === 1) {
      // Yes - quit app, keep daemon running
      exitConfirmed = true;
      app.quit();
    } else {
      // No - stop daemon and quit completely
      exitConfirmed = true;
      await stopDaemonAndQuitHard();
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  // Set dock icon on macOS (shows IOCoin icon instead of Electron in dev mode)
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
    if (fs.existsSync(dockIconPath)) {
      const dockIcon = nativeImage.createFromPath(dockIconPath);
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon);
      }
    }
  }

  // Initialize daemon before showing window
  const daemonResult = await initDaemon();
  console.log('[app] Daemon init result:', daemonResult);
  createWindow();
});
app.on('window-all-closed', () => {
  // Both Yes and No paths set exitConfirmed and quit, so always quit here
  app.quit();
});
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

// ===== IOC_CONTEXT_EDIT_MENU_V2 =====
const { Menu } = require('electron');
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('context-menu', (_evt, params) => {
    const tpl = [
      { role: 'cut',   enabled: params.isEditable },
      { role: 'copy',  enabled: (params.selectionText || '').length > 0 },
      { role: 'paste', enabled: params.isEditable },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.isEditable }
    ];
    const menu = Menu.buildFromTemplate(tpl);
    menu.popup({ window: win });
  });
});
// ===== /IOC_CONTEXT_EDIT_MENU_V2 =====
