const { spawn, execFile, execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, dialog } = require('electron');
const { DATA_DIR, CONF_PATH, LAUNCH_AGENT } = require('../shared/constants');

const DAEMON_PATH = '/usr/local/bin/iocoind';

// ---------------------------------------------------------------------------
// findDaemonBinary — only /usr/local/bin, never bundled
// ---------------------------------------------------------------------------
function findDaemonBinary() {
  if (fs.existsSync(DAEMON_PATH)) {
    return { found: true, path: DAEMON_PATH };
  }
  return { found: false, searched: [DAEMON_PATH] };
}

// ---------------------------------------------------------------------------
// findCliBinary — /usr/local/bin only (iocoin-cli fallback to iocoind)
// ---------------------------------------------------------------------------
function findCliBinary() {
  const paths = ['/usr/local/bin/iocoin-cli', DAEMON_PATH];
  for (const p of paths) {
    if (fs.existsSync(p)) return { found: true, path: p };
  }
  return { found: false, searched: paths };
}

// ---------------------------------------------------------------------------
// getBundledDaemonPath — where the install-source binary lives in the app
// ---------------------------------------------------------------------------
function getBundledDaemonPath() {
  const resourcesPath = process.resourcesPath || path.dirname(app.getAppPath());
  return path.join(resourcesPath, 'iocoind');
}

// ---------------------------------------------------------------------------
// installDaemonWithAdmin — privileged install via osascript
// ---------------------------------------------------------------------------
async function installDaemonWithAdmin() {
  const src = getBundledDaemonPath();
  if (!fs.existsSync(src)) {
    throw new Error(`Bundled iocoind not found at: ${src}`);
  }

  // Escape double-quotes in paths for safe embedding in shell string
  const srcEsc = src.replace(/"/g, '\\"');
  const tgtEsc = DAEMON_PATH.replace(/"/g, '\\"');

  const script = [
    'mkdir -p /usr/local/bin',
    `cp "${srcEsc}" "${tgtEsc}"`,
    `chmod 755 "${tgtEsc}"`,
    `xattr -dr com.apple.quarantine "${tgtEsc}"`
  ].join(' && ');

  console.log('[daemon] Installing iocoind with admin privileges...');
  console.log('[daemon] Source:', src);
  console.log('[daemon] Target:', DAEMON_PATH);

  return new Promise((resolve, reject) => {
    // osascript -e 'do shell script "..." with administrator privileges'
    // The outer quotes are single-quotes; inner script uses double-quotes.
    // Escape single-quotes in the script for AppleScript embedding.
    const appleScript = `do shell script "${script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges`;
    execFile('osascript', ['-e', appleScript], { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[daemon] Admin install failed:', err.message);
        if (stderr) console.error('[daemon] stderr:', stderr);
        reject(new Error(err.message || 'Admin install cancelled or failed'));
      } else {
        console.log('[daemon] Admin install succeeded');
        resolve(true);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// verifyDaemonBinary — confirm it exists, is executable, and can run
// ---------------------------------------------------------------------------
function verifyDaemonBinary() {
  // 1. Exists?
  if (!fs.existsSync(DAEMON_PATH)) {
    return { ok: false, error: `iocoind not found at ${DAEMON_PATH}`, code: 'NOT_FOUND' };
  }

  // 2. Executable bit?
  try {
    const stats = fs.statSync(DAEMON_PATH);
    if (!(stats.mode & 0o100)) {
      return { ok: false, error: `${DAEMON_PATH} is not executable`, code: 'NOT_EXECUTABLE' };
    }
  } catch (e) {
    return { ok: false, error: e.message, code: 'STAT_FAILED' };
  }

  // 3. Quick execution test (--help, 5s timeout)
  try {
    execFileSync(DAEMON_PATH, ['--help'], { timeout: 5000, stdio: 'pipe' });
    console.log('[daemon] Verification passed: iocoind --help succeeded');
    return { ok: true };
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    const exitCode = e.status;

    // Rosetta detection: exit code 86 or "Bad CPU type"
    if (exitCode === 86 || /bad cpu type/i.test(stderr) || /Bad CPU type/i.test(e.message)) {
      return {
        ok: false,
        error: 'Rosetta 2 required. Run in Terminal:\nsoftwareupdate --install-rosetta --agree-to-license',
        code: 'ROSETTA_NEEDED'
      };
    }

    // iocoind --help may exit non-zero but still produce output (common for daemons)
    // If it produced stdout, it ran successfully
    const stdout = (e.stdout || '').toString();
    if (stdout.length > 0) {
      console.log('[daemon] Verification passed: iocoind --help produced output (exit', exitCode, ')');
      return { ok: true };
    }

    // Permission denied
    if (e.code === 'EACCES') {
      return { ok: false, error: `Permission denied: ${DAEMON_PATH}`, code: 'EACCES' };
    }

    return {
      ok: false,
      error: `Verification failed (exit ${exitCode}): ${stderr || e.message}`,
      code: 'EXEC_FAILED'
    };
  }
}

// ---------------------------------------------------------------------------
// ensureDaemon — install if missing, verify, return path or throw
// ---------------------------------------------------------------------------
async function ensureDaemon(sendStatus) {
  const notify = sendStatus || (() => {});

  // Check if already installed and verified
  let verification = verifyDaemonBinary();
  if (verification.ok) {
    console.log('[daemon] iocoind verified at', DAEMON_PATH);
    return DAEMON_PATH;
  }

  // Not installed or not working — need to install
  if (verification.code === 'ROSETTA_NEEDED') {
    throw new Error(verification.error);
  }

  console.log('[daemon] iocoind not ready:', verification.error);
  notify('installing', 'Installing daemon (admin required)...');

  // Attempt privileged install
  await installDaemonWithAdmin();

  // Re-verify after install
  verification = verifyDaemonBinary();
  if (!verification.ok) {
    throw new Error(verification.error);
  }

  console.log('[daemon] iocoind installed and verified at', DAEMON_PATH);
  return DAEMON_PATH;
}

// ---------------------------------------------------------------------------
// isDaemonRunning — RPC check via CLI
// ---------------------------------------------------------------------------
function isDaemonRunning() {
  return new Promise((resolve) => {
    const cli = findCliBinary();
    if (!cli.found) {
      resolve({ running: false, error: 'CLI binary not found' });
      return;
    }

    const child = execFile(cli.path, ['getblockcount', `-datadir=${DATA_DIR}`], { timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve({ running: false, error: err.message || 'daemon not responding' });
      } else {
        const count = parseInt((stdout || '').trim(), 10);
        resolve({ running: true, blockCount: isNaN(count) ? 0 : count });
      }
    });
    child.on('error', (e) => {
      resolve({ running: false, error: e.message || 'cli exec failed' });
    });
  });
}

// ---------------------------------------------------------------------------
// ensureConf — create data dir + iocoin.conf with rpcuser/rpcpassword
// ---------------------------------------------------------------------------
function ensureConf() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONF_PATH)) {
    const rpcPassword = crypto.randomBytes(32).toString('hex');
    const conf = [
      'rpcuser=iocoinrpc',
      `rpcpassword=${rpcPassword}`,
      'addnode=amer.supernode.iocoin.io',
      'addnode=emea.supernode.iocoin.io',
      'addnode=apac.supernode.iocoin.io'
    ].join('\n');
    fs.writeFileSync(CONF_PATH, conf);
  }
}

// ---------------------------------------------------------------------------
// startDetached — spawn daemon with logging
// ---------------------------------------------------------------------------
let daemonChild = null;
let daemonSpawnError = null;
let daemonEarlyExit = null;

function startDetached(iocoindPath) {
  ensureConf();
  const usePath = iocoindPath || DAEMON_PATH;

  // Reset state
  daemonSpawnError = null;
  daemonEarlyExit = null;

  console.log('[daemon] Starting daemon from:', usePath);
  console.log('[daemon] Data dir:', DATA_DIR);

  try {
    daemonChild = spawn(usePath, [`-datadir=${DATA_DIR}`], {
      detached: true,
      stdio: 'ignore'
    });

    const pid = daemonChild.pid;
    console.log('[daemon] Spawned with PID:', pid);

    daemonChild.on('error', (err) => {
      console.error('[daemon] Spawn error:', err.message);
      daemonSpawnError = err.message;
    });

    daemonChild.on('exit', (code, signal) => {
      console.log('[daemon] Process exited — code:', code, 'signal:', signal);
      daemonEarlyExit = { code, signal };
    });

    daemonChild.unref();

    // Check for early crash after 5 seconds
    setTimeout(() => {
      if (daemonEarlyExit) {
        console.error('[daemon] Early exit detected:', daemonEarlyExit);
      }
    }, 5000);

    return true;
  } catch (e) {
    console.error('[daemon] startDetached failed:', e.message);
    daemonSpawnError = e.message;
    return false;
  }
}

function getSpawnError() {
  return daemonSpawnError;
}

function getEarlyExit() {
  return daemonEarlyExit;
}

// ---------------------------------------------------------------------------
// stopViaCli — stop daemon via RPC
// ---------------------------------------------------------------------------
function stopViaCli(iocCliPath) {
  return new Promise((resolve, reject) => {
    const p = spawn(iocCliPath || DAEMON_PATH, ['stop', `-datadir=${DATA_DIR}`], { stdio: 'ignore' });
    p.on('exit', (code) => code === 0 ? resolve(true) : reject(new Error('stop failed')));
    p.on('error', (e) => reject(e));
  });
}

// ---------------------------------------------------------------------------
// Launch agent helpers (unchanged)
// ---------------------------------------------------------------------------
function writeLaunchAgent(iocoindPath) {
  const out = path.join(DATA_DIR, 'iocoind.out.log');
  const errLog = path.join(DATA_DIR, 'iocoind.err.log');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.iocoin.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${iocoindPath}</string>
    <string>-datadir=${DATA_DIR}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${out}</string>
  <key>StandardErrorPath</key><string>${errLog}</string>
</dict></plist>`;
  const dir = path.dirname(LAUNCH_AGENT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LAUNCH_AGENT, plist);
}

async function installLaunchAgent(iocoindPath) {
  ensureConf();
  writeLaunchAgent(iocoindPath);
  return new Promise((resolve, reject) => {
    execFile('launchctl', ['load', LAUNCH_AGENT], (e) => e ? reject(e) : resolve(true));
  });
}

async function unloadLaunchAgent() {
  return new Promise((resolve, reject) => {
    execFile('launchctl', ['unload', LAUNCH_AGENT], (e) => e ? reject(e) : resolve(true));
  });
}

module.exports = {
  DAEMON_PATH,
  ensureConf,
  installLaunchAgent,
  unloadLaunchAgent,
  startDetached,
  stopViaCli,
  findDaemonBinary,
  findCliBinary,
  isDaemonRunning,
  ensureDaemon,
  verifyDaemonBinary,
  installDaemonWithAdmin,
  getSpawnError,
  getEarlyExit
};
