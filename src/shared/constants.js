const os = require('os');
const path = require('path');

const HOME = os.homedir();
const DATA_DIR = path.join(HOME, 'Library', 'Application Support', 'IOCoin');
const CONF_PATH = path.join(DATA_DIR, 'iocoin.conf');
const LAUNCH_AGENT = path.join(HOME, 'Library', 'LaunchAgents', 'io.iocoin.daemon.plist');

const DEFAULT_RPC_PORT = 33765;
const DEFAULT_P2P_PORT = 33764;

module.exports = {
  HOME, DATA_DIR, CONF_PATH, LAUNCH_AGENT, DEFAULT_RPC_PORT, DEFAULT_P2P_PORT
};
