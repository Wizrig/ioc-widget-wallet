const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { ipcMain } = require('electron');

// Cross-platform IOCoin data directory
function dataDir() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'IOCoin');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'IOCoin');
  }
  // Fallback for Linux/other
  return path.join(home, '.iocoin');
}

function confPath() {
  return path.join(dataDir(), 'iocoin.conf');
}

function readConf() {
  const p = confPath();
  const out = {};
  if (!fs.existsSync(p)) return out;
  try {
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([^#;][^=]*)=(.*)$/);
      if (m) out[m[1].trim()] = m[2].trim();
    }
  } catch {}
  return out;
}

function readCookie() {
  const p = path.join(dataDir(), '.cookie'); // user:token
  if (!fs.existsSync(p)) return null;
  try {
    const s = fs.readFileSync(p, 'utf8').trim();
    const i = s.indexOf(':');
    if (i > 0) return { user: s.slice(0, i), pass: s.slice(i + 1) };
  } catch {}
  return null;
}

function candidateTargets() {
  const conf = readConf();
  const host = conf.rpcconnect || '127.0.0.1';
  const ports = conf.rpcport ? [Number(conf.rpcport)] : [7332, 33765]; // common IOC ports
  const authPref = [];

  const cookie = readCookie();
  if (cookie) authPref.push({ type: 'basic', user: cookie.user, pass: cookie.pass });

  if (conf.rpcuser && conf.rpcpassword) {
    authPref.push({ type: 'basic', user: conf.rpcuser, pass: conf.rpcpassword });
  }

  const out = [];
  for (const port of ports) {
    if (authPref.length === 0) out.push({ host, port, auth: { type: 'none' } });
    else for (const auth of authPref) out.push({ host, port, auth });
  }
  return out;
}

function rpcCallOnce(target, method, params = []) {
  const payload = JSON.stringify({ jsonrpc: '1.0', id: 'ui', method, params });
  const headers = { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(payload) };
  if (target.auth && target.auth.type === 'basic') {
    headers.Authorization = 'Basic ' + Buffer.from(`${target.auth.user}:${target.auth.pass}`).toString('base64');
  }
  const opts = { host: target.host, port: target.port, method: 'POST', path: '/', headers, timeout: 3000 };

  return new Promise((resolve, reject) => {
    const req = http.request(opts, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => (body += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j && j.error) return reject(new Error(j.error.message || 'RPC error'));
          resolve(j.result);
        } catch {
          reject(new Error('Bad RPC response'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('RPC timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function rpcCall(method, params = []) {
  const targets = candidateTargets();
  let lastErr = null;
  for (const t of targets) {
    try { return await rpcCallOnce(t, method, params); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('RPC unavailable');
}

async function statusSummary() {
  const out = { reachable: false, blocks: null, headers: null, balance: null, staking: null };
  try {
    const [b, m] = await Promise.allSettled([
      rpcCall('getblockcount', []),
      rpcCall('getmininginfo', [])
    ]);
    if (b.status === 'fulfilled') { out.blocks = b.value; out.reachable = true; }
    if (m.status === 'fulfilled') {
      const info = m.value || {};
      if (typeof info.blocks === 'number') out.headers = info.blocks;
      if (typeof info.stake === 'number') out.staking = info.stake;
    }
    try {
      const wi = await rpcCall('getwalletinfo', []);
      if (wi && typeof wi.balance === 'number') out.balance = wi.balance;
    } catch {}
  } catch {}
  return out;
}

// Register IPC once
if (!ipcMain._ioc_rpc_ready) {
  ipcMain._ioc_rpc_ready = true;
  ipcMain.handle('ioc:rpc', async (_e, method, params) => rpcCall(method, params));
  ipcMain.handle('ioc:status', async () => statusSummary());
}
