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
  try { return await callCli(method, params); } catch { return fallback; }
}

ipcMain.handle('ioc:rpc', async (_e, {method, params}) => {
  return await safeRpc(method, params, null);
});

// ===== First-run and data directory IPC handlers =====
const { DATA_DIR, isFirstRun } = require('../shared/constants');
const { ensureConf, findDaemonBinary, findCliBinary, isDaemonRunning, isDaemonProcessAlive,
        startDetached, ensureDaemon, verifyDaemonBinary, DAEMON_PATH, getSpawnError,
        getEarlyExit, getSpawnedPid, readSavedPid, cleanupPidFile,
        validatePidIsIocoind, findDaemonPidByPgrep } = require('./daemon');

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
  if (status.running) {
    daemonState.error = null;
  }
  return {
    running: daemonState.running,
    pid: daemonState.pid,
    error: daemonState.error,
    binaryPath: daemonState.binaryPath,
    startedByUs: daemonState.startedByUs,
    needsBootstrap: daemonState.needsBootstrap || false,
    blockCount: status.blockCount || 0,
    spawnError: getSpawnError(),
    earlyExit: getEarlyExit()
  };
});

// ===== isDaemonProcessAlive IPC — used by renderer for warmup polling =====
ipcMain.handle('ioc:isDaemonProcessAlive', async () => {
  const result = await isDaemonProcessAlive();
  return result; // { alive, pid, source }
});

/**
 * Auto-start daemon on app launch if not already running.
 * Decision rule (PID-first, then RPC):
 *   1. Validated PID file → processAlive=true, attach (we have shutdown control)
 *   2. RPC responds → processAlive=true, attach (limited shutdown: CLI stop only)
 *   3. Neither → not running, proceed to bootstrap/start
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

  // Step 2: Check if daemon is already running — PID first, then RPC
  const processCheck = await isDaemonProcessAlive();

  if (processCheck.alive) {
    console.log('[daemon] Daemon already running (source:', processCheck.source,
                 ', PID:', processCheck.pid, ') — attaching');
    daemonState.running = processCheck.source !== 'rpc'; // RPC means warming up or already running
    daemonState.startedByUs = processCheck.source === 'spawned';
    daemonState.pid = processCheck.pid;
    daemonState.hasPidControl = processCheck.pid != null; // Can we force-kill?
    return { ok: true, attached: true, pid: processCheck.pid, hasPidControl: processCheck.pid != null };
  }

  // Step 3: Not running — check if bootstrap is needed BEFORE starting daemon
  if (bootstrap.needsBootstrap()) {
    console.log('[daemon] Bootstrap needed — deferring daemon start to renderer flow');
    daemonState.needsBootstrap = true;
    return { ok: true, deferred: true, needsBootstrap: true };
  }

  // Step 4: No bootstrap needed — start daemon directly
  console.log('[daemon] Starting daemon from:', DAEMON_PATH);
  const started = startDetached(DAEMON_PATH);
  if (started) {
    daemonState.startedByUs = true;
    daemonState.pid = getSpawnedPid();
    daemonState.hasPidControl = true;
    console.log('[daemon] Daemon started, PID:', daemonState.pid);
    return { ok: true, started: true, path: DAEMON_PATH };
  } else {
    const spawnErr = getSpawnError();
    daemonState.error = spawnErr || 'Failed to start daemon';
    return { ok: false, error: daemonState.error };
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
    // 1. Extract bootstrap to temp folder
    console.log('[bootstrap] Extracting bootstrap zip...');
    sendProgress('extracting', 'Extracting blockchain files...');
    const extractResult = await bootstrap.extractBootstrap();
    if (!extractResult.ok) {
      return extractResult;
    }

    // 2. Apply bootstrap files — daemon has NOT been started yet.
    // applyBootstrapFiles() only copies blk*.dat and txleveldb/
    // and NEVER touches wallet.dat.
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

    // 4. Start daemon from installed binary (already verified)
    console.log('[bootstrap] Starting daemon with bootstrap data...');
    sendProgress('starting', 'Starting daemon...');
    const started = startDetached(DAEMON_PATH);
    if (!started) {
      const spawnErr = getSpawnError();
      return { ok: false, error: spawnErr || 'Failed to start daemon' };
    }
    daemonState.startedByUs = true;
    daemonState.binaryPath = DAEMON_PATH;
    daemonState.needsBootstrap = false;
    daemonState.pid = getSpawnedPid();
    daemonState.hasPidControl = true;

    // 5. Poll until RPC responds OR process dies (no hard timeout).
    // After bootstrap with large chain data, block index loading can take minutes.
    // NEVER fatal-error while processAlive=true.
    console.log('[bootstrap] Waiting for daemon to respond (no hard timeout)...');
    const startTime = Date.now();
    while (true) {
      await new Promise(r => setTimeout(r, 1000));
      const elapsed = Math.floor((Date.now() - startTime) / 1000);

      const msg = elapsed < 10 ? `Starting daemon... (${elapsed}s)` :
                  `Loading block index... (${elapsed}s)`;
      sendProgress('starting', msg);

      // Check if process is still alive
      const processCheck = await isDaemonProcessAlive();
      if (!processCheck.alive) {
        const earlyExit = getEarlyExit();
        const spawnErr = getSpawnError();
        const lockError = earlyExit && earlyExit.lockError;
        if (lockError) {
          // Another daemon grabbed the lock — attach to it instead
          console.log('[bootstrap] Lock error — another daemon owns our datadir, attaching');
          daemonState.startedByUs = false;
          daemonState.hasPidControl = false;
          daemonState.pid = null;
          // Fall through — renderer will poll until RPC responds
          return { ok: true, started: true, attached: true };
        }
        const errMsg = spawnErr || `Daemon exited (code ${earlyExit?.code || 'unknown'})`;
        console.error('[bootstrap] Daemon died:', errMsg);
        return { ok: false, error: errMsg };
      }

      // Check if RPC is responding
      const rpcStatus = await isDaemonRunning();
      if (rpcStatus.running) {
        console.log('[bootstrap] Daemon is running, block count:', rpcStatus.blockCount);
        daemonState.running = true;
        return { ok: true, started: true };
      }
    }
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
 * Poll until daemon process is truly dead (not just RPC unresponsive).
 * Checks both RPC and process existence via PID + pgrep.
 * @param {number} timeoutMs - Max time to wait
 * @param {number} intervalMs - Poll interval
 * @param {number|null} knownPid - PID to check directly (optional)
 * @returns {Promise<boolean>} - true if stopped, false if still running
 */
async function waitForDaemonStop(timeoutMs, intervalMs = 500, knownPid = null) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    // Check 1: if we have a known PID, check if process is alive
    if (knownPid) {
      try {
        process.kill(knownPid, 0);
        // Still alive — wait
        await new Promise(r => setTimeout(r, intervalMs));
        continue;
      } catch (_) {
        // Process gone
        console.log('[exit] Daemon PID', knownPid, 'confirmed dead');
        return true;
      }
    }

    // Check 2: pgrep fallback — is any iocoind running for our datadir?
    const pgrepPid = findDaemonPidByPgrep();
    if (!pgrepPid) {
      // Check 3: RPC also not responding
      const { isDaemonRunning } = require('./daemon');
      const status = await isDaemonRunning();
      if (!status.running) {
        console.log('[exit] Daemon confirmed stopped (no PID, no RPC)');
        return true;
      }
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Find daemon PID — datadir-scoped, fully validated.
 * Sources checked in order:
 *   1. In-memory spawned PID (validated: alive + is iocoind)
 *   2. Persisted PID file (validated: datadir match + alive + is iocoind)
 * Does NOT use pgrep/tasklist — those can't be datadir-scoped.
 * @returns {number|null}
 */
function findDaemonPid() {
  // Source 1: in-memory spawned PID
  const spawnedPid = getSpawnedPid();
  if (spawnedPid) {
    try {
      process.kill(spawnedPid, 0);
      if (validatePidIsIocoind(spawnedPid)) {
        console.log('[exit] Found spawned daemon PID:', spawnedPid);
        return spawnedPid;
      }
    } catch (_) {}
  }

  // Source 2: persisted PID file (readSavedPid validates datadir + process name)
  const saved = readSavedPid();
  if (saved) {
    console.log('[exit] Found validated PID from file:', saved.pid);
    return saved.pid;
  }

  // Source 3: pgrep fallback — find iocoind with our datadir in command line
  const pgrepPid = findDaemonPidByPgrep();
  if (pgrepPid) {
    console.log('[exit] Found validated PID from pgrep:', pgrepPid);
    return pgrepPid;
  }

  console.log('[exit] No validated PID found');
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
 * Hard guarantee stop daemon and quit.
 * Uses validated PID for force-kill. If PID unknown (external daemon),
 * only attempts CLI stop — never pkill globally.
 */
async function stopDaemonAndQuitHard() {
  const { stopViaCli, findCliBinary, isDaemonRunning } = require('./daemon');

  console.log('[exit] Starting hard shutdown sequence...');

  // Step 1: Attempt graceful stop via CLI (always safe — targets our datadir)
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
      console.log('[exit] Daemon stopped gracefully via CLI');
      cleanupPidFile();
      app.exit(0);
      return;
    }
  }

  // Step 2: Try force-kill by validated PID
  const pid = findDaemonPid();
  if (pid) {
    // We have a validated PID (confirmed iocoind for our datadir) — safe to kill
    console.log('[exit] CLI stop failed/timed out, sending SIGTERM to PID:', pid);
    killDaemonByPid(pid, 'SIGTERM');
    let stopped = await waitForDaemonStop(10000, 500, pid);
    if (stopped) {
      console.log('[exit] Daemon stopped after SIGTERM');
      cleanupPidFile();
      app.exit(0);
      return;
    }

    // Escalate to SIGKILL
    console.log('[exit] SIGTERM timed out, sending SIGKILL to PID:', pid);
    killDaemonByPid(pid, 'SIGKILL');
    stopped = await waitForDaemonStop(5000, 500, pid);
    if (stopped) {
      console.log('[exit] Daemon stopped after SIGKILL');
      cleanupPidFile();
      app.exit(0);
      return;
    }
  } else {
    // No validated PID — daemon was not started by us or PID file is gone.
    // We already tried CLI stop above. Cannot safely force-kill.
    const rpcCheck = await isDaemonRunning();
    if (rpcCheck.running) {
      console.log('[exit] Daemon still running but PID unknown — cannot force-kill safely');
      // Try CLI stop one more time
      if (cli.found) {
        try { await stopViaCli(cli.path); } catch (_) {}
        const stopped = await waitForDaemonStop(10000, 500);
        if (stopped) {
          console.log('[exit] Daemon stopped on retry CLI stop');
          cleanupPidFile();
          app.exit(0);
          return;
        }
      }
      // Still running — quit UI only, warn in console
      console.warn('[exit] Daemon running but PID unknown; quitting UI only');
    }
  }

  // Step 3: Quit regardless
  console.log('[exit] Exiting Electron...');
  cleanupPidFile();
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

  // Fetch remote tip in parallel (non-blocking)
  const remoteTipPromise = fetchRemoteTip().catch(() => 0);

  const [wallet, chain, peers, remoteTip] = await Promise.all([walletPromise, chainPromise, peersPromise, remoteTipPromise]);
  return { info: wallet.info, chain, peers, staking: wallet.staking, lockst: wallet.lockst, remoteTip };
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
      // Close UI Only - hide window, keep daemon running
      if (process.platform === 'darwin') {
        app.hide();
      } else {
        win.hide();
      }
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
