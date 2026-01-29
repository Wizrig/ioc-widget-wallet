const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, dialog } = require('electron');
const { DATA_DIR, CONF_PATH, LAUNCH_AGENT } = require('../shared/constants');

/**
 * Locate the iocoind binary.
 * Search order:
 * 1. Bundled in app resources (if exists)
 * 2. /usr/local/bin/iocoind
 * 3. /opt/homebrew/bin/iocoind (Apple Silicon)
 * 4. Windows Program Files paths
 * Returns { found: true, path: string } or { found: false, searched: string[] }
 */
function findDaemonBinary() {
  const candidates = [];

  // 1. Check bundled binary in app resources
  try {
    const resourcesPath = process.resourcesPath || path.dirname(app.getAppPath());
    const bundled = path.join(resourcesPath, 'iocoind');
    candidates.push(bundled);
    if (fs.existsSync(bundled)) {
      return { found: true, path: bundled };
    }
  } catch (_) {}

  // 2. Platform-specific system paths
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const unixPaths = [
      '/usr/local/bin/iocoind',
      '/opt/homebrew/bin/iocoind',
      path.join(process.env.HOME || '', 'bin', 'iocoind')
    ];
    for (const p of unixPaths) {
      candidates.push(p);
      if (fs.existsSync(p)) {
        return { found: true, path: p };
      }
    }
  } else if (process.platform === 'win32') {
    const winPaths = [
      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'IOCoin', 'iocoind.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'IOCoin', 'iocoind.exe'),
      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'IOCoin HTML5 Wallet', 'iocoind.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'IOCoin HTML5 Wallet', 'iocoind.exe')
    ];
    for (const p of winPaths) {
      candidates.push(p);
      if (fs.existsSync(p)) {
        return { found: true, path: p };
      }
    }
  }

  return { found: false, searched: candidates };
}

/**
 * Locate the iocoin-cli binary.
 * Similar search order to findDaemonBinary.
 */
function findCliBinary() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const candidates = [];

  // Check bundled iocoin-cli first, then fall back to iocoind (which also accepts CLI commands)
  try {
    const resourcesPath = process.resourcesPath || path.dirname(app.getAppPath());
    for (const name of ['iocoin-cli', 'iocoind']) {
      const bundled = path.join(resourcesPath, name + ext);
      candidates.push(bundled);
      if (fs.existsSync(bundled)) {
        return { found: true, path: bundled };
      }
    }
  } catch (_) {}

  if (process.platform === 'darwin' || process.platform === 'linux') {
    const unixPaths = [
      '/usr/local/bin/iocoin-cli',
      '/opt/homebrew/bin/iocoin-cli',
      '/usr/local/bin/iocoind',
      '/opt/homebrew/bin/iocoind'
    ];
    for (const p of unixPaths) {
      candidates.push(p);
      if (fs.existsSync(p)) {
        return { found: true, path: p };
      }
    }
  } else if (process.platform === 'win32') {
    const winPaths = [
      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'IOCoin', 'iocoin-cli.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'IOCoin', 'iocoin-cli.exe'),
      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'IOCoin', 'iocoind.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'IOCoin', 'iocoind.exe')
    ];
    for (const p of winPaths) {
      candidates.push(p);
      if (fs.existsSync(p)) {
        return { found: true, path: p };
      }
    }
  }

  return { found: false, searched: candidates };
}

/**
 * Check if daemon is currently running by attempting a quick RPC ping.
 * Returns { running: true } or { running: false, error: string }
 */
function isDaemonRunning() {
  return new Promise((resolve) => {
    const cli = findCliBinary();
    if (!cli.found) {
      resolve({ running: false, error: 'iocoin-cli not found' });
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

function ensureConf() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONF_PATH)) {
    // Generate random password for RPC authentication
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

function writeLaunchAgent(iocoindPath) {
  const out = path.join(DATA_DIR, 'iocoind.out.log');
  const err = path.join(DATA_DIR, 'iocoind.err.log');
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
  <key>StandardErrorPath</key><string>${err}</string>
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

let child;

function startDetached(iocoindPath) {
  ensureConf();
  if (child?.pid) return true;
  try {
    child = spawn(iocoindPath, [`-datadir=${DATA_DIR}`], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch (e) {
    dialog.showErrorBox('Daemon start failed', String(e));
    return false;
  }
}

function stopViaCli(iocCliPath) {
  return new Promise((resolve, reject) => {
    const p = spawn(iocCliPath, ['stop', `-datadir=${DATA_DIR}`], { stdio: 'ignore' });
    p.on('exit', (code) => code === 0 ? resolve(true) : reject(new Error('stop failed')));
  });
}

module.exports = {
  ensureConf,
  installLaunchAgent,
  unloadLaunchAgent,
  startDetached,
  stopViaCli,
  findDaemonBinary,
  findCliBinary,
  isDaemonRunning
};
