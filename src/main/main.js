try {
  if (!global.__IOC_LOCKED_WINDOW__) {
    const { app, BrowserWindow } = require('electron');
    app.on('browser-window-created', (_evt, win) => {
      win.once('ready-to-show', () => {
        try {
          // Lock at compact widget size on startup
          win.setResizable(false);
          win.setMinimumSize(280, 160);
          win.setMaximumSize(280, 160);
          win.setSize(280, 160, true);
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
  const { findCliBinary } = require('./daemon');
  const result = findCliBinary();
  if (result.found) return result.path;
  // Fallback: bare command name, let PATH resolve it
  return process.platform === 'win32' ? 'iocoind.exe' : 'iocoin-cli';
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
  try {
    const { rpc: httpRpc } = require('./rpc');
    return await httpRpc(method, params);
  } catch { return fallback; }
}

ipcMain.handle('ioc:rpc', async (_e, {method, params}) => {
  return await safeRpc(method, params, null);
});

ipcMain.handle('ioc:tryRpc', async (_e, {method, params}) => {
  try {
    const { rpcDirect } = require('./rpc');
    return { ok: true, result: await rpcDirect(method, params) };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ===== First-run and data directory IPC handlers =====
const { DATA_DIR, isFirstRun } = require('../shared/constants');
const { ensureConf, findDaemonBinary, findCliBinary, isDaemonRunning,
        startDetached, ensureDaemon, DAEMON_PATH } = require('./daemon');

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
    startedByUs: daemonState.startedByUs,
    needsBootstrap: daemonState.needsBootstrap || false,
    blockCount: status.blockCount || 0
  };
});

/**
 * Auto-start daemon on app launch if not already running.
 * RC3-stable pattern: RPC check → if not running, ensure binary → start.
 */
async function initDaemon() {
  ensureConf();

  // Step 1: Ensure daemon binary is installed and verified
  try {
    await ensureDaemon((step, msg) => {
      console.log(`[daemon] ${step}: ${msg}`);
      daemonState.statusMessage = msg;
    });
  } catch (err) {
    console.error('[daemon] ensureDaemon failed:', err.message);
    daemonState.error = err.message;
    return { ok: false, error: err.message };
  }

  daemonState.binaryPath = DAEMON_PATH;

  // Step 2: Check if daemon is already running via RPC
  const status = await isDaemonRunning();
  if (status.running) {
    console.log('[daemon] Already running, attaching...');
    daemonState.running = true;
    daemonState.startedByUs = false;
    return { ok: true, attached: true };
  }

  // Step 2b: RPC failed — but the process may still be alive (busy syncing).
  // Check pidfile / pgrep before spawning to avoid double-spawn.
  const existingPid = findDaemonPid();
  if (existingPid) {
    console.log('[daemon] RPC unresponsive but process alive (PID', existingPid + '), attaching...');
    daemonState.running = true;
    daemonState.startedByUs = false;
    daemonState.pid = existingPid;
    return { ok: true, attached: true };
  }

  // Step 3: Check if bootstrap is needed BEFORE starting daemon
  if (bootstrap.needsBootstrap()) {
    console.log('[daemon] Bootstrap needed — deferring daemon start to renderer flow');
    daemonState.needsBootstrap = true;
    return { ok: true, deferred: true, needsBootstrap: true };
  }

  // Step 4: Start daemon
  console.log('[daemon] Starting daemon from:', DAEMON_PATH);
  const started = startDetached(DAEMON_PATH);
  if (started) {
    daemonState.startedByUs = true;
    console.log('[daemon] Daemon started successfully');
    return { ok: true, started: true, path: DAEMON_PATH };
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

ipcMain.handle('ioc:applyBootstrap', async (event) => {
  const sendProgress = (step, message) => {
    try {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('bootstrap:progress', { step, message });
      }
    } catch (_) {}
  };

  try {
    // 1. Extract the bootstrap
    console.log('[bootstrap] Extracting bootstrap zip...');
    sendProgress('extracting', 'Extracting blockchain files...');
    const extractResult = await bootstrap.extractBootstrap();
    if (!extractResult.ok) {
      return extractResult;
    }

    // 2. Apply bootstrap files
    console.log('[bootstrap] Installing bootstrap files to DATA_DIR...');
    sendProgress('applying', 'Installing blockchain files...');
    const applyResult = await bootstrap.applyBootstrapFiles();
    if (!applyResult.ok) {
      return applyResult;
    }

    // 3. Clean up temp files
    console.log('[bootstrap] Cleaning up temp files...');
    sendProgress('cleanup', 'Cleaning up...');
    bootstrap.cleanupBootstrap();

    // 4. Start daemon
    console.log('[bootstrap] Starting daemon with bootstrap data...');
    sendProgress('starting', 'Starting daemon...');
    startDetached(DAEMON_PATH);
    daemonState.startedByUs = true;
    daemonState.binaryPath = DAEMON_PATH;
    daemonState.needsBootstrap = false;

    return { ok: true, restarted: true };
  } catch (err) {
    console.error('[bootstrap] Apply error:', err);
    return { ok: false, error: err.message || String(err) };
  }
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
 * Returns: 0 = Close Wallet Completely, 1 = Close UI Only, 2 = Cancel
 */
async function showExitConfirmation(win) {
  const iconImage = fs.existsSync(ICON_PATH) ? nativeImage.createFromPath(ICON_PATH) : undefined;
  const result = await dialog.showMessageBox(win, {
    type: 'none',
    icon: iconImage,
    buttons: ['Close Wallet Completely', 'Close UI Only', 'Cancel'],
    defaultId: 1,
    cancelId: 2,
    message: 'How would you like to close?'
  });
  return result.response;
}

/**
 * Poll isDaemonRunning until it returns false or timeout.
 */
async function waitForDaemonStop(timeoutMs, intervalMs = 500) {
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
 */
function findDaemonPid() {
  // Check iocoind.pid (daemon's own pidfile)
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
 * RC3-stable: CLI stop → SIGTERM by PID → SIGKILL by PID → pkill last resort.
 */
async function stopDaemonAndQuitHard() {
  const { stopViaCli, findCliBinary } = require('./daemon');

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
  // Exit Electron process, keep daemon running
  exitConfirmed = true;
  app.exit(0);
  return { ok: true };
});

ipcMain.handle('ioc:restartDaemon', async () => {
  // Wait for daemon to fully stop (encryptwallet shuts it down)
  console.log('[daemon] Waiting for daemon to stop after encryption...');
  const stopped = await waitForDaemonStop(15000, 500);
  if (!stopped) {
    console.warn('[daemon] Daemon did not stop within timeout, attempting start anyway');
  }
  // Invalidate wallet cache so fresh lockst is fetched
  if (global.__iocWalletCache) global.__iocWalletCache.ts = 0;
  if (statusCache) statusCache.ts = 0;
  // Start daemon fresh
  console.log('[daemon] Restarting daemon...');
  const ok = startDetached(DAEMON_PATH);
  daemonState.startedByUs = true;
  daemonState.running = ok;
  return { ok };
});
// ===== End Exit Confirmation =====

/** ---- Remote tip cache (network block height from explorer) ---- */
const remoteTipCache = { ts: 0, height: 0 };
async function fetchRemoteTip() {
  const now = Date.now();
  // Refresh every 30s while syncing, 60s when synced
  const cacheAge = now - remoteTipCache.ts;
  if (remoteTipCache.height > 0 && cacheAge < 30000) {
    return remoteTipCache.height;
  }

  try {
    // Use cryptoid.info IOC explorer API
    const https = require('https');
    const height = await new Promise((resolve, reject) => {
      const req = https.get('https://chainz.cryptoid.info/ioc/api.dws?q=getblockcount', {
        timeout: 5000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const h = parseInt(data.trim(), 10);
          if (h > 0) {
            resolve(h);
          } else {
            reject(new Error('Invalid response'));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });

    remoteTipCache.height = height;
    remoteTipCache.ts = now;
    console.log('[status] Remote tip updated:', height);
    return height;
  } catch (err) {
    console.warn('[status] Failed to fetch remote tip:', err.message);
    // Return cached value if available, otherwise 0
    return remoteTipCache.height || 0;
  }
}

/** ---- Coalesced, cached status snapshot ---- */
const statusCache = { ts: 0, data: null, inflight: null };
async function computeStatus() {
  const now = Date.now();

  // ---- SLOW wallet cache (5s) — never blocks the fast path ----
  if (!global.__iocWalletCache) global.__iocWalletCache = { ts: 0, data: { info: {}, staking: {}, lockst: {} }, refreshing: false };
  const wc = global.__iocWalletCache;
  const walletFresh = wc.data && (now - wc.ts) < 5000;

  // Kick off background wallet refresh if stale (don't await it)
  if (!walletFresh && !wc.refreshing) {
    wc.refreshing = true;
    (async () => {
      try {
        const info = (await safeRpc('getinfo', [], {})) || {};
        const stake = (await safeRpc('getstakinginfo', [], {})) || {};
        const lockst = (await safeRpc('walletlockstatus', [], null)) || {};
        wc.data = { info, staking: stake, lockst };
        wc.ts = Date.now();
      } catch {}
      wc.refreshing = false;
    })();
  }

  // ---- FAST path: chain, peers, balance, remoteTip in parallel ----
  const [chain, peers, balance, remoteTip] = await Promise.all([
    safeRpc('getblockchaininfo', [], null)
      .then(r => r || safeRpc('getblockcount', [], 0).then(b => ({ blocks: b, headers: 0, verificationprogress: 0 }))),
    safeRpc('getconnectioncount', [], 0),
    safeRpc('getbalance', [], null),
    fetchRemoteTip().catch(() => 0)
  ]);

  // Merge fast balance into info so renderer always gets current balance
  const info = { ...wc.data.info };
  if (typeof balance === 'number') info.balance = balance;

  return { info, chain, peers, staking: wc.data.staking, lockst: wc.data.lockst, remoteTip };
}
ipcMain.handle('ioc/status', async () => {
  const now = Date.now();
  if (statusCache.inflight) {
    console.log('[ioc/status] Coalescing request (in-flight)');
    return await statusCache.inflight;
  }
  // During sync (vp < 1), use shorter cache to keep splash responsive
  const vp = statusCache.data?.chain?.verificationprogress || 0;
  const maxAge = vp < 0.999 ? 1000 : 3000;
  if (statusCache.data && (now - statusCache.ts) < maxAge) {
    return statusCache.data;
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
  const rows = [];
  const seen = new Set();

  // 1. listaddressgroupings — addresses with transaction history
  const groupings = await safeRpc('listaddressgroupings', [], null);
  if (Array.isArray(groupings)) {
    groupings.forEach(g => {
      (g || []).forEach(([addr, amount, label]) => {
        if (!seen.has(addr)) {
          seen.add(addr);
          rows.push({address: addr, amount: amount || 0, label: label || ''});
        }
      });
    });
  }

  // 2. listreceivedbyaddress 0 true — returns ALL addresses including empty
  //    ones, with the account/label field. Not gated by enableaccounts.
  const received = await safeRpc('listreceivedbyaddress', [0, true], []);
  if (Array.isArray(received)) {
    for (const entry of received) {
      const addr = entry.address;
      if (addr && !seen.has(addr)) {
        seen.add(addr);
        rows.push({address: addr, amount: entry.amount || 0, label: entry.account || ''});
      }
    }
  }

  // 3. getaddressesbyaccount '' — catch any remaining default keypool addresses
  //    that listreceivedbyaddress might not include
  const defaultAddrs = await safeRpc('getaddressesbyaccount', [''], []);
  if (Array.isArray(defaultAddrs)) {
    for (const a of defaultAddrs) {
      if (a && !seen.has(a)) {
        seen.add(a);
        rows.push({address: a, amount: 0, label: ''});
      }
    }
  }

  return rows;
});

ipcMain.handle('ioc/setlabel', async (_e, address, label) => {
  try {
    // Try setlabel first (newer RPC), fall back to setaccount (legacy)
    const r1 = await safeRpc('setlabel', [address, label], '__FAIL__');
    if (r1 === '__FAIL__') {
      await safeRpc('setaccount', [address, label], null);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'failed' };
  }
});

ipcMain.handle('ioc/listtx', async (_e, n = 50) => {
  const tx = await safeRpc('listtransactions', ['*', n], []);
  return Array.isArray(tx) ? tx : [];
});

/** Create a new receiving address and label it.
 *  getnewaddress already assigns the account/label — no separate setaccount needed.
 */
async function createLabeledAddress(label='') {
  const addr = await safeRpc('getnewaddress', label ? [label] : [], null);
  if (!addr || typeof addr !== 'string') throw new Error('could not create address');
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
  // Start in compact widget size - will expand when user clicks stars icon
  win = new BrowserWindow({
    width: 280,
    height: 160,
    backgroundColor: '#050A12',
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
    if (exitConfirmed) return;

    e.preventDefault();

    const response = await showExitConfirmation(win);

    if (response === 0) {
      // Close Wallet Completely - stop daemon and quit
      exitConfirmed = true;
      await stopDaemonAndQuitHard();
      return;
    }

    if (response === 1) {
      // Close UI Only - exit Electron, keep daemon running
      exitConfirmed = true;
      app.exit(0);
      return;
    }

    // response === 2: Cancel - do nothing, app continues
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  // Deny ALL permission requests (eliminates Location Services prompt)
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log('[permissions] Denied request for:', permission);
    callback(false);
  });

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

  // Initialize daemon (install+verify, check bootstrap, start if ready)
  const daemonResult = await initDaemon();
  console.log('[app] Daemon init result:', daemonResult);

  // If daemon install/verify failed with a blocking error, show dialog
  if (!daemonResult.ok && daemonResult.error) {
    const isRosetta = daemonResult.error.includes('Rosetta');
    const response = dialog.showMessageBoxSync({
      type: 'error',
      title: isRosetta ? 'Rosetta 2 Required' : 'Daemon Error',
      message: daemonResult.error,
      buttons: isRosetta ? ['Quit'] : ['Retry', 'Quit'],
      defaultId: isRosetta ? 0 : 1
    });
    if (isRosetta || response === 1) {
      app.quit();
      return;
    }
    // Retry
    const retryResult = await initDaemon();
    if (!retryResult.ok) {
      dialog.showErrorBox('Daemon Error', retryResult.error || 'Failed to initialize daemon');
      app.quit();
      return;
    }
  }

  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    if (exitConfirmed) app.quit();
    return;
  }
  app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ===== Compact Widget Mode IPC =====
(() => {
  if (global.__iocCompactRegistered) return;
  global.__iocCompactRegistered = true;
  const { ipcMain, BrowserWindow } = require('electron');

  const FULL_SIZE = { width: 600, height: 525 };
  const COMPACT_SIZE = { width: 280, height: 160 };

  ipcMain.handle('ioc:setCompactMode', (event, isCompact) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;

    const size = isCompact ? COMPACT_SIZE : FULL_SIZE;

    // Temporarily allow resize to change size
    win.setResizable(true);
    win.setMinimumSize(size.width, size.height);
    win.setMaximumSize(size.width, size.height);
    win.setSize(size.width, size.height, true);
    win.setResizable(false);

    return true;
  });
})();

(()=>{if(global.__iocSysRegistered)return;global.__iocSysRegistered=true;const e=require('electron');e.ipcMain.on('sys:openFolder',()=>{e.shell.openPath(DATA_DIR)})})();
(()=>{if(global.__iocDiagRegistered)return;global.__iocDiagRegistered=true;const e=require('electron');const cp=require('child_process');const pathMod=require('path');const procs=new Map();const debugLog=pathMod.join(DATA_DIR,'debug.log');function start(wc){if(procs.has(wc.id))return;let p;if(process.platform==='win32'){p=cp.spawn('powershell.exe',['-Command',`Get-Content -Path "${debugLog}" -Wait -Tail 0`],{stdio:['ignore','pipe','pipe']})}else{p=cp.spawn('tail',['-F','-n0',debugLog],{stdio:['ignore','pipe','pipe']})}procs.set(wc.id,p);const send=d=>{try{wc.send('diag:data',String(d))}catch{}};p.stdout.on('data',send);p.stderr.on('data',send);p.on('close',()=>{procs.delete(wc.id)});wc.once('destroyed',()=>{try{p.kill()}catch{} procs.delete(wc.id)})}function stop(wc){const p=procs.get(wc.id);if(p){try{p.kill()}catch{} procs.delete(wc.id)}}e.ipcMain.on('diag:start',ev=>start(ev.sender));e.ipcMain.on('diag:stop',ev=>stop(ev.sender))})();

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
