const { spawn, execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, dialog } = require('electron');
const { DATA_DIR, CONF_PATH, LAUNCH_AGENT } = require('../shared/constants');

// ---------------------------------------------------------------------------
// Platform-aware daemon path
// ---------------------------------------------------------------------------
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const DAEMON_NAME = IS_WIN ? 'iocoind.exe' : 'iocoind';
const CLI_NAME = IS_WIN ? 'iocoin-cli.exe' : 'iocoin-cli';

function getDaemonInstallPath() {
  if (IS_MAC) return '/usr/local/bin/iocoind';
  if (IS_WIN) {
    const appData = process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local');
    return path.join(appData, 'IOCoin', 'iocoind.exe');
  }
  // Linux
  return '/usr/local/bin/iocoind';
}

const DAEMON_PATH = getDaemonInstallPath();

// ---------------------------------------------------------------------------
// findDaemonBinary — platform-aware search
// ---------------------------------------------------------------------------
function findDaemonBinary() {
  // Check the install path first
  if (fs.existsSync(DAEMON_PATH)) {
    return { found: true, path: DAEMON_PATH };
  }

  // Platform-specific fallback searches
  const extraPaths = [];
  if (IS_WIN) {
    const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const progFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    extraPaths.push(
      path.join(progFiles, 'IOCoin', 'iocoind.exe'),
      path.join(progFiles86, 'IOCoin', 'iocoind.exe')
    );
  }

  for (const p of extraPaths) {
    if (fs.existsSync(p)) return { found: true, path: p };
  }

  return { found: false, searched: [DAEMON_PATH, ...extraPaths] };
}

// ---------------------------------------------------------------------------
// findCliBinary — platform-aware CLI search
// ---------------------------------------------------------------------------
function findCliBinary() {
  const paths = [];

  if (IS_MAC) {
    paths.push('/usr/local/bin/iocoin-cli', DAEMON_PATH);
  } else if (IS_WIN) {
    const dir = path.dirname(DAEMON_PATH);
    paths.push(path.join(dir, CLI_NAME), DAEMON_PATH);
  } else {
    // Linux
    paths.push('/usr/local/bin/iocoin-cli', '/usr/bin/iocoin-cli', DAEMON_PATH);
  }

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
  return path.join(resourcesPath, DAEMON_NAME);
}

// ---------------------------------------------------------------------------
// installDaemonWithAdmin — privileged install (platform-aware)
// ---------------------------------------------------------------------------
async function installDaemonWithAdmin() {
  const src = getBundledDaemonPath();
  if (!fs.existsSync(src)) {
    throw new Error(`Bundled ${DAEMON_NAME} not found at: ${src}`);
  }

  console.log('[daemon] Installing daemon with admin privileges...');
  console.log('[daemon] Source:', src);
  console.log('[daemon] Target:', DAEMON_PATH);

  if (IS_MAC) {
    return installDaemonMac(src);
  } else if (IS_WIN) {
    return installDaemonWin(src);
  } else {
    return installDaemonLinux(src);
  }
}

// macOS: osascript with administrator privileges
function installDaemonMac(src) {
  const srcEsc = src.replace(/"/g, '\\"');
  const tgtEsc = DAEMON_PATH.replace(/"/g, '\\"');

  const script = [
    'mkdir -p /usr/local/bin',
    `cp "${srcEsc}" "${tgtEsc}"`,
    `chmod 755 "${tgtEsc}"`,
    `xattr -dr com.apple.quarantine "${tgtEsc}"`
  ].join(' && ');

  return new Promise((resolve, reject) => {
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

// Windows: copy to LocalAppData (no admin needed), or elevate via PowerShell
function installDaemonWin(src) {
  const targetDir = path.dirname(DAEMON_PATH);
  return new Promise((resolve, reject) => {
    try {
      // Try non-elevated first (LocalAppData doesn't need admin)
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.copyFileSync(src, DAEMON_PATH);
      console.log('[daemon] Install succeeded (non-elevated)');
      resolve(true);
    } catch (e) {
      // If permission denied, try elevated via PowerShell
      console.log('[daemon] Non-elevated install failed, trying elevated...');
      const psScript = `Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','mkdir "${targetDir}" & copy /Y "${src}" "${DAEMON_PATH}"' -Verb RunAs -Wait`;
      execFile('powershell.exe', ['-Command', psScript], { timeout: 60000 }, (err) => {
        if (err) {
          reject(new Error(err.message || 'Admin install cancelled or failed'));
        } else {
          console.log('[daemon] Admin install succeeded (elevated)');
          resolve(true);
        }
      });
    }
  });
}

// Linux: pkexec or sudo for /usr/local/bin
function installDaemonLinux(src) {
  const script = `mkdir -p /usr/local/bin && cp "${src}" "${DAEMON_PATH}" && chmod 755 "${DAEMON_PATH}"`;

  return new Promise((resolve, reject) => {
    // Try pkexec first (graphical sudo prompt)
    execFile('pkexec', ['sh', '-c', script], { timeout: 60000 }, (err) => {
      if (err) {
        // Fallback: try without elevation (might work if user owns /usr/local/bin)
        try {
          const targetDir = path.dirname(DAEMON_PATH);
          if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
          fs.copyFileSync(src, DAEMON_PATH);
          fs.chmodSync(DAEMON_PATH, 0o755);
          console.log('[daemon] Install succeeded (non-elevated)');
          resolve(true);
        } catch (e2) {
          reject(new Error(err.message || 'Admin install cancelled or failed'));
        }
      } else {
        console.log('[daemon] Admin install succeeded (pkexec)');
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
    return { ok: false, error: `${DAEMON_NAME} not found at ${DAEMON_PATH}`, code: 'NOT_FOUND' };
  }

  // 2. Executable bit? (skip on Windows — .exe is always executable)
  if (!IS_WIN) {
    try {
      const stats = fs.statSync(DAEMON_PATH);
      if (!(stats.mode & 0o100)) {
        return { ok: false, error: `${DAEMON_PATH} is not executable`, code: 'NOT_EXECUTABLE' };
      }
    } catch (e) {
      return { ok: false, error: e.message, code: 'STAT_FAILED' };
    }
  }

  // 3. Quick execution test (--help, 5s timeout)
  try {
    execFileSync(DAEMON_PATH, ['--help'], { timeout: 5000, stdio: 'pipe' });
    console.log('[daemon] Verification passed: --help succeeded');
    return { ok: true };
  } catch (e) {
    const stderr = (e.stderr || '').toString();
    const exitCode = e.status;

    // Rosetta detection (macOS only): exit code 86 or "Bad CPU type"
    if (IS_MAC && (exitCode === 86 || /bad cpu type/i.test(stderr) || /Bad CPU type/i.test(e.message))) {
      return {
        ok: false,
        error: 'Rosetta 2 required. Run in Terminal:\nsoftwareupdate --install-rosetta --agree-to-license',
        code: 'ROSETTA_NEEDED'
      };
    }

    // Daemon --help may exit non-zero but still produce output (common for daemons)
    const stdout = (e.stdout || '').toString();
    if (stdout.length > 0) {
      console.log('[daemon] Verification passed: --help produced output (exit', exitCode, ')');
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
    console.log('[daemon] Daemon verified at', DAEMON_PATH);
    return DAEMON_PATH;
  }

  // Not installed or not working — need to install
  if (verification.code === 'ROSETTA_NEEDED') {
    throw new Error(verification.error);
  }

  console.log('[daemon] Daemon not ready:', verification.error);
  notify('installing', 'Installing daemon (admin required)...');

  // Attempt privileged install
  await installDaemonWithAdmin();

  // Re-verify after install
  verification = verifyDaemonBinary();
  if (!verification.ok) {
    throw new Error(verification.error);
  }

  console.log('[daemon] Daemon installed and verified at', DAEMON_PATH);
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

    const args = ['getblockcount'];
    const child = execFile(cli.path, args, { timeout: 3000 }, (err, stdout) => {
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
// startDetached — simple spawn, detach, unref (RC3-stable pattern)
// No PID file — daemon PID is found at shutdown via iocoind.pid or pgrep.
// ---------------------------------------------------------------------------
let child;

function startDetached(iocoindPath) {
  ensureConf();
  if (child?.pid) return true;
  const usePath = iocoindPath || DAEMON_PATH;
  try {
    const spawnOpts = { detached: true, stdio: 'ignore' };
    child = spawn(usePath, [`-datadir=${DATA_DIR}`], spawnOpts);
    child.unref();
    console.log('[daemon] Spawned PID:', child.pid);
    return true;
  } catch (e) {
    console.error('[daemon] startDetached failed:', e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// stopViaCli — stop daemon via RPC
// ---------------------------------------------------------------------------
function stopViaCli(iocCliPath) {
  return new Promise((resolve, reject) => {
    const p = spawn(iocCliPath || DAEMON_PATH, ['stop'], { stdio: 'ignore' });
    p.on('exit', (code) => code === 0 ? resolve(true) : reject(new Error('stop failed')));
    p.on('error', (e) => reject(e));
  });
}

// ---------------------------------------------------------------------------
// Launch agent helpers (macOS only)
// ---------------------------------------------------------------------------
function writeLaunchAgent(iocoindPath) {
  if (!IS_MAC) return;
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
  if (!IS_MAC) return true;
  ensureConf();
  writeLaunchAgent(iocoindPath);
  return new Promise((resolve, reject) => {
    execFile('launchctl', ['load', LAUNCH_AGENT], (e) => e ? reject(e) : resolve(true));
  });
}

async function unloadLaunchAgent() {
  if (!IS_MAC) return true;
  return new Promise((resolve, reject) => {
    execFile('launchctl', ['unload', LAUNCH_AGENT], (e) => e ? reject(e) : resolve(true));
  });
}

module.exports = {
  DAEMON_PATH,
  DATA_DIR,
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
  installDaemonWithAdmin
};
