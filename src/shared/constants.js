const os = require('os');
const path = require('path');
const fs = require('fs');

const HOME = os.homedir();

/**
 * Platform-specific data directory for IOCoin.
 * Matches legacy html5wallet behavior:
 * - macOS:   ~/Library/Application Support/IOCoin/
 * - Windows: %APPDATA%\IOCoin\
 * - Linux:   ~/.iocoin/ (lowercase, per legacy wallet)
 */
function getDataDir() {
  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(HOME, 'Library', 'Application Support', 'IOCoin');
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
    return path.join(appData, 'IOCoin');
  } else {
    // Linux and other Unix-like systems: ~/.iocoin (lowercase, matches legacy)
    return path.join(HOME, '.iocoin');
  }
}

const DATA_DIR = getDataDir();
const CONF_PATH = path.join(DATA_DIR, 'iocoin.conf');
const LAUNCH_AGENT = path.join(HOME, 'Library', 'LaunchAgents', 'io.iocoin.daemon.plist');

const DEFAULT_RPC_PORT = 33765;
const DEFAULT_P2P_PORT = 33764;

/**
 * Check if this is a first run (no iocoin.conf exists yet).
 * Used to trigger first-run onboarding and bootstrap prompt.
 */
function isFirstRun() {
  return !fs.existsSync(CONF_PATH);
}

module.exports = {
  HOME, DATA_DIR, CONF_PATH, LAUNCH_AGENT, DEFAULT_RPC_PORT, DEFAULT_P2P_PORT,
  getDataDir, isFirstRun
};
