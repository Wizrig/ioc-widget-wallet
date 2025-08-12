#!/usr/bin/env bash
set -e

mkdir -p assets
# If you have the IOC logo, save it as assets/logo.png (optional)

# --- main window: enable macOS vibrancy / transparency ---
cat > src/main/main.js <<'JS'
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { DATA_DIR } = require('../shared/constants');
const { ensureConf, installLaunchAgent, unloadLaunchAgent, startDetached, stopViaCli } = require('./daemon');
const {
  getBlockCount, getConnectionCount, getWalletInfo, getMiningInfo, getStakingInfo,
  getPeerInfo, getNewAddress, sendToAddress, walletLock, walletPassphrase
} = require('./rpc');

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 700,
    transparent: true,
    vibrancy: 'sidebar',           // macOS glass effect
    visualEffectState: 'active',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => { ensureConf(); createWindow(); });
app.on('window-all-closed', () => app.quit());

ipcMain.handle('env:paths', () => ({ dataDir: DATA_DIR }));

ipcMain.handle('daemon:startDetached', (_e, p) => startDetached(p));
ipcMain.handle('daemon:installLaunchAgent', (_e, p) => installLaunchAgent(p));
ipcMain.handle('daemon:unloadLaunchAgent', () => unloadLaunchAgent());
ipcMain.handle('daemon:stop', (_e, cli) => stopViaCli(cli));

const { rpc } = require('./rpc'); // quick access for blockchaininfo
async function safe(method, f) { try { return await f(); } catch { return null; } }

ipcMain.handle('rpc:status', async () => {
  const [height, peers, wallet, mining, staking, chain] = await Promise.all([
    safe('getblockcount', getBlockCount),
    safe('getconnectioncount', getConnectionCount),
    safe('getwalletinfo', getWalletInfo),
    safe('getmininginfo', getMiningInfo),
    safe('getstakinginfo', getStakingInfo),
    safe('getblockchaininfo', () => rpc('getblockchaininfo'))
  ]);
  return { height, peers, wallet, mining, staking, chain };
});
ipcMain.handle('rpc:newAddress', (_e, label) => getNewAddress(label));
ipcMain.handle('rpc:send', (_e, to, amt, c, ct) => sendToAddress(to, amt, c, ct));
ipcMain.handle('rpc:lock', () => walletLock());
ipcMain.handle('rpc:unlock', (_e, pass, secs) => walletPassphrase(pass, secs));
ipcMain.handle('open:dir', async (_e, dir) => {
  await shell.openPath('/System/Applications/Utilities/Terminal.app');
  return shell.openPath(dir);
});
JS

# --- renderer HTML with IOC palette + progress bar ---
cat > src/renderer/index.html <<'HTML'
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>IOC Widget Wallet</title>
  <style>
    :root{
      --ioc-navy:#0B1222;      /* deep bg */
      --ioc-card:#0F1A30CC;    /* translucent card */
      --ioc-edge:#1E3A66;      /* borders / lines */
      --ioc-blue:#1E85C8;      /* primary accent */
      --ioc-cyan:#59C1FF;      /* bright accent */
      --text:#EAF3FF;
      --muted:#A7B8D6;
    }
    html,body{height:100%;}
    body {
      margin: 24px;
      color: var(--text);
      background: transparent; /* glass behind */
      -webkit-user-select: none;
      -webkit-app-region: drag;  /* drag anywhere except buttons/inputs */
      font-family: -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    }
    .wrap { max-width: 1120px; margin: 0 auto; }
    header { display:flex; align-items:center; gap:12px; margin-bottom:16px; }
    header img{ width:28px; height:28px; }
    header h1{ font-size:22px; margin:0; letter-spacing:.3px; }
    .row { display:flex; gap:16px; flex-wrap:wrap; }
    .card {
      -webkit-app-region: no-drag;
      background: var(--ioc-card);
      border: 1px solid #0d1530;
      backdrop-filter: blur(24px) saturate(120%);
      border-radius: 14px;
      padding: 16px;
      min-width: 280px; flex: 1;
      box-shadow: 0 8px 24px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.03);
    }
    h3{ margin:0 0 10px; font-size:15px; letter-spacing:.2px; color: var(--text); }
    label{ display:block; margin: 8px 0 6px; color: var(--muted); font-size:12px; }
    input, button {
      -webkit-app-region: no-drag;
      padding: 10px 12px; border-radius: 10px;
      border: 1px solid #142445; outline: none;
      background: #0C1526; color: var(--text);
      font-size: 13px;
    }
    input:focus{ border-color: var(--ioc-blue); box-shadow: 0 0 0 3px #1e85c833; }
    button{
      background: linear-gradient(180deg, var(--ioc-cyan), var(--ioc-blue));
      border: none;
      color: #04101f;
      font-weight: 600;
      cursor: pointer;
    }
    button.secondary{ background:#0C1526; color: var(--text); border:1px solid #20365e; }
    .muted{ color: var(--muted); font-size:12px; }
    code{ user-select: all; }

    /* Block status bar */
    .blockbar{
      position: relative; height: 10px; border-radius: 999px; overflow: hidden;
      background: #0d1731; border:1px solid #13234a; margin: 8px 0 4px;
    }
    .bar{
      height: 100%; width:0%;
      background: linear-gradient(90deg,var(--ioc-blue),var(--ioc-cyan));
      transition: width .4s ease;
    }
    .barlabel{ font-size:12px; color: var(--muted); display:flex; gap:12px; }

    /* Layout simplification */
    .grid { display:grid; grid-template-columns: 1.1fr .9fr; gap:16px; }
    @media (max-width: 980px){ .grid{ display:block; } }
    .actions button{ margin-right:8px; margin-bottom:8px; }
    .qr{ width:160px; height:160px; background:#fff; border-radius:10px; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <img src="../../assets/logo.png" onerror="this.style.display='none'">
      <h1>IOC Wallet</h1>
    </header>

    <div class="row">
      <div class="card" style="flex:2">
        <h3>Status</h3>
        <div class="blockbar"><div id="bar" class="bar"></div></div>
        <div class="barlabel">
          <div id="barText">Sync status: —</div>
          <div id="height"></div>
          <div id="peers"></div>
          <div id="balance"></div>
        </div>
        <div class="actions" style="margin-top:10px;">
          <button id="openDataDir" class="secondary">Open Data Dir in Terminal</button>
        </div>
        <div class="muted" id="datadir" style="margin-top:6px;"></div>
      </div>

      <div class="card">
        <h3>Daemon</h3>
        <label>iocoind path</label>
        <input id="iocoind" placeholder="/usr/local/bin/iocoind">
        <div style="margin-top:8px;">
          <button id="startDetached">Start (Detached)</button>
        </div>
        <div style="margin-top:8px;">
          <button id="installLA">Enable Background</button>
          <button id="unloadLA" class="secondary">Disable Background</button>
        </div>
        <label style="margin-top:8px;">iocoin-cli path</label>
        <input id="iocli" placeholder="/usr/local/bin/iocoin-cli">
        <div style="margin-top:8px;">
          <button id="stopAll" class="secondary">Stop Daemon</button>
        </div>
      </div>
    </div>

    <div class="grid" style="margin-top:16px;">
      <div class="card">
        <h3>Send</h3>
        <label>To address</label>
        <input id="to">
        <label>Amount (IOC)</label>
        <input id="amt" type="number" step="0.00000001">
        <div style="margin-top:10px;">
          <button id="send">Send</button>
        </div>
        <div id="sendMsg" class="muted" style="margin-top:8px;"></div>
      </div>

      <div class="card">
        <h3>Receive</h3>
        <button id="newAddr">New Address</button>
        <div id="addr" style="margin-top:8px;"><code>—</code></div>
        <canvas id="qr" width="160" height="160" class="qr" style="margin-top:8px;"></canvas>
        <div class="muted">Label: ioc-widget</div>

        <h3 style="margin-top:16px;">Security & Staking</h3>
        <label>Wallet passphrase</label>
        <input id="pass" type="password">
        <div style="margin-top:8px;">
          <button id="unlockStake">Unlock for staking</button>
          <button id="lockNow" class="secondary">Lock now</button>
        </div>
      </div>
    </div>
  </div>

  <script src="renderer.js"></script>
</body>
</html>
HTML

# --- renderer logic with progress bar (uses blockchaininfo if present) ---
cat > src/renderer/renderer.js <<'JS'
const QR = {
  draw: (canvas, text) => {
    const url = 'https://chart.googleapis.com/chart?cht=qr&chs=160x160&chl=' + encodeURIComponent(text);
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { const c=canvas.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,canvas.width,canvas.height); c.drawImage(img,0,0,canvas.width,canvas.height); };
    img.src = url;
  }
};
const el = (id) => document.getElementById(id);

function setBar(pct, label){
  const bar = el('bar');
  const txt = el('barText');
  bar.style.width = (Math.max(0, Math.min(100, pct)) || 0) + '%';
  txt.textContent = label;
}

async function refreshStatus() {
  try {
    const s = await window.ioc.status();
    const height = s.height ?? '—';
    const peers = s.peers ?? '—';
    const bal = s.wallet?.balance ?? s.wallet?.walletbalance ?? 0;

    el('height').textContent = `Height: ${height}`;
    el('peers').textContent = `Peers: ${peers}`;
    el('balance').textContent = `Balance: ${bal} IOC`;

    // Prefer verificationprogress (0..1). Fallback: show height movement.
    const vp = s.chain?.verificationprogress;
    if (typeof vp === 'number' && isFinite(vp)) {
      setBar(vp * 100, `Sync ${Math.round(vp*100)}%`);
    } else {
      // Unknown total — display a pulsing bar if we have peers, else 0.
      const pct = peers > 0 ? 60 : 0;
      setBar(pct, peers > 0 ? 'Syncing…' : 'Offline');
    }
  } catch (e) {
    el('height').textContent = 'RPC offline';
    el('peers').textContent = 'Peers: —';
    el('balance').textContent = 'Balance: —';
    setBar(0, 'Offline');
  }
}

async function main() {
  const paths = await window.ioc.paths();
  el('datadir').textContent = 'Data dir: ' + paths.dataDir;
  document.getElementById('openDataDir').onclick = () => window.ioc.openDir(paths.dataDir);

  document.getElementById('startDetached').onclick = async () => {
    const p = document.getElementById('iocoind').value.trim() || '/usr/local/bin/iocoind';
    await window.ioc.startDetached(p);
    setTimeout(refreshStatus, 1000);
  };
  document.getElementById('installLA').onclick = async () => {
    const p = document.getElementById('iocoind').value.trim() || '/usr/local/bin/iocoind';
    await window.ioc.installLaunchAgent(p);
  };
  document.getElementById('unloadLA').onclick = async () => { await window.ioc.unloadLaunchAgent(); };
  document.getElementById('stopAll').onclick = async () => {
    const p = document.getElementById('iocli').value.trim() || '/usr/local/bin/iocoin-cli';
    try { await window.ioc.stopAll(p); setTimeout(refreshStatus, 1500); } catch {}
  };

  document.getElementById('newAddr').onclick = async () => {
    const a = await window.ioc.newAddress('ioc-widget');
    document.getElementById('addr').innerHTML = '<code>'+a+'</code>';
    QR.draw(document.getElementById('qr'), a);
  };

  document.getElementById('send').onclick = async () => {
    const to = document.getElementById('to').value.trim();
    const amt = Number(document.getElementById('amt').value);
    const msg = document.getElementById('sendMsg');
    msg.textContent = 'Sending...';
    try {
      const txid = await window.ioc.send(to, amt);
      msg.textContent = 'TXID: ' + txid;
      document.getElementById('to').value = '';
      document.getElementById('amt').value = '';
      refreshStatus();
    } catch (e) {
      msg.textContent = 'Error: ' + (e.message || e);
    }
  };

  document.getElementById('unlockStake').onclick = async () => {
    const pass = document.getElementById('pass').value;
    try { await window.ioc.unlock(pass, 999999); document.getElementById('pass').value=''; refreshStatus(); }
    catch { alert('Unlock failed'); }
  };
  document.getElementById('lockNow').onclick = async () => { try { await window.ioc.lock(); refreshStatus(); } catch { alert('Lock failed'); } };

  refreshStatus();
  setInterval(refreshStatus, 5000);
}
main();
JS

echo "✓ Applied IOC theme + transparency + block status bar."
echo "Next: npm run dev"
