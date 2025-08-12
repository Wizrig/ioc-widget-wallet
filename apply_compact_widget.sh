#!/usr/bin/env bash
set -e

# --- Compact window (≈420×520), non-resizable, glassy ---
cat > src/main/main.js <<'JS'
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { DATA_DIR } = require('../shared/constants');
const { ensureConf, installLaunchAgent, unloadLaunchAgent, startDetached, stopViaCli } = require('./daemon');
const {
  getBlockCount, getConnectionCount, getWalletInfo, getMiningInfo, getStakingInfo,
  getPeerInfo, getNewAddress, sendToAddress, walletLock, walletPassphrase, rpc
} = require('./rpc');

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 520,
    minWidth: 420,
    minHeight: 520,
    resizable: false,
    fullscreenable: false,
    transparent: true,
    vibrancy: 'sidebar',
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

async function safe(fn){ try{ return await fn(); }catch{ return null; } }
ipcMain.handle('rpc:status', async () => {
  const [height, peers, wallet, mining, staking, chain] = await Promise.all([
    safe(()=>getBlockCount()), safe(()=>getConnectionCount()), safe(()=>getWalletInfo()),
    safe(()=>getMiningInfo()), safe(()=>getStakingInfo()), safe(()=>rpc('getblockchaininfo'))
  ]);
  return { height, peers, wallet, mining, staking, chain };
});
ipcMain.handle('rpc:newAddress', (_e, label) => getNewAddress(label));
ipcMain.handle('rpc:send', (_e, to, amt, c, ct) => sendToAddress(to, amt, c, ct));
ipcMain.handle('rpc:lock', () => walletLock());
ipcMain.handle('rpc:unlock', (_e, pass, secs) => walletPassphrase(pass, secs));
ipcMain.handle('open:dir', async (_e, dir) => {
  await shell.openPath('/System/Applications/Utilities/Terminal.app'); return shell.openPath(dir);
});
JS

# --- Compact UI (12–13px text, icons, tight spacing) ---
cat > src/renderer/index.html <<'HTML'
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>IOC Widget</title>
  <style>
    :root{
      --bg:#0B1222;
      --card:#0F1A30CC;
      --edge:#16294d;
      --blue:#1E85C8;
      --cyan:#59C1FF;
      --txt:#EAF3FF;
      --muted:#A7B8D6;
    }
    html,body{height:100%;}
    body{
      margin: 10px 12px 12px;
      color: var(--txt);
      background: transparent;
      -webkit-user-select: none;
      -webkit-app-region: drag;
      font-family: -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      font-size: 12.5px;
    }
    .card{
      -webkit-app-region: no-drag;
      background: var(--card);
      border: 1px solid var(--edge);
      backdrop-filter: blur(20px) saturate(120%);
      border-radius: 12px;
      padding: 10px;
      margin-bottom: 8px;
    }
    h1{ font-size:14px; margin:0 0 8px; letter-spacing:.2px; }
    .toolbar{ display:flex; align-items:center; gap:6px; }
    .toolbar .spacer{ flex:1; }
    button, input{
      -webkit-app-region: no-drag;
      height: 26px; padding: 0 8px; border-radius: 8px;
      border: 1px solid #142445; outline: none;
      background: #0C1526; color: var(--txt); font-size: 12.5px;
    }
    input:focus{ border-color: var(--blue); box-shadow: 0 0 0 2px #1e85c83a; }
    .btn{
      background: linear-gradient(180deg, var(--cyan), var(--blue)); border:none;
      color:#04101f; font-weight:600; cursor:pointer;
    }
    .btn.secondary{ background:#0C1526; color:var(--txt); border:1px solid #20365e; }
    .iconbtn{ width:28px; height:26px; display:grid; place-items:center; padding:0; }
    .row{ display:flex; gap:8px; }
    label{ display:block; margin:6px 0 4px; color:var(--muted); font-size:12px; }

    /* Progress bar (slim) */
    .barwrap{ height:8px; border-radius:999px; overflow:hidden; background:#0d1731; border:1px solid #13234a; }
    .bar{ height:100%; width:0%; background: linear-gradient(90deg,var(--blue),var(--cyan)); transition:width .3s; }
    .tiny{ font-size:11.5px; color:var(--muted); margin-top:4px; display:flex; gap:8px; white-space:nowrap; overflow:hidden; }

    .qr{ width:120px; height:120px; background:#fff; border-radius:10px; }
    code{ user-select: all; }
  </style>
</head>
<body>
  <!-- Top: Status -->
  <div class="card" id="status">
    <div class="toolbar">
      <h1 style="margin-right:6px;">IOC Wallet</h1>
      <div class="spacer"></div>
      <!-- Daemon controls (icons) -->
      <button id="startDetached" class="iconbtn btn" title="Start daemon">▶</button>
      <button id="installLA" class="iconbtn btn" title="Enable background">⏼</button>
      <button id="unloadLA" class="iconbtn secondary" title="Disable background">⏻</button>
      <button id="stopAll" class="iconbtn secondary" title="Stop daemon">■</button>
    </div>
    <div class="barwrap" style="margin-top:6px;"><div id="bar" class="bar"></div></div>
    <div class="tiny">
      <div id="barText">Status: —</div>
      <div id="height"></div>
      <div id="peers"></div>
      <div id="balance"></div>
      <div class="spacer"></div>
      <button id="openDataDir" class="secondary" style="height:22px;">Terminal</button>
    </div>
  </div>

  <!-- Send -->
  <div class="card">
    <div class="row">
      <div style="flex:1;">
        <label>To</label>
        <input id="to" placeholder="Address">
      </div>
      <div style="width:110px;">
        <label>Amount</label>
        <input id="amt" type="number" step="0.00000001" placeholder="IOC">
      </div>
      <div style="width:70px; display:flex; align-items:flex-end;">
        <button id="send" class="btn" style="width:100%;">Send</button>
      </div>
    </div>
    <div id="sendMsg" class="tiny" style="margin-top:4px;"></div>
  </div>

  <!-- Receive + Staking -->
  <div class="row">
    <div class="card" style="flex:1;">
      <div class="row" style="align-items:center; justify-content:space-between;">
        <button id="newAddr" class="btn" style="height:24px;">New Address</button>
      </div>
      <div id="addr" class="tiny" style="margin-top:6px;"><code>—</code></div>
      <canvas id="qr" width="120" height="120" class="qr" style="margin-top:6px;"></canvas>
    </div>

    <div class="card" style="width:160px;">
      <label>Passphrase</label>
      <input id="pass" type="password" placeholder="••••••">
      <div class="row" style="margin-top:6px;">
        <button id="unlockStake" class="btn" style="flex:1;">Unlock</button>
        <button id="lockNow" class="secondary" style="width:64px;">Lock</button>
      </div>
    </div>
  </div>

  <!-- Hidden daemon paths (open small settings by option-click title if needed) -->
  <div class="card" id="daemonPaths" style="display:none;">
    <div class="row">
      <input id="iocoind" placeholder="/usr/local/bin/iocoind" style="flex:1;">
      <input id="iocli" placeholder="/usr/local/bin/iocoin-cli" style="flex:1;">
    </div>
  </div>

  <script src="renderer.js"></script>
</body>
</html>
HTML

# --- Keep same renderer logic; only IDs used above. (No change needed if you already applied previous theme) ---
# Just ensure QR is 120x120 and everything maps. Re-write with tiny tweak to keep compact timings.
cat > src/renderer/renderer.js <<'JS'
const QR = {
  draw: (canvas, text) => {
    const url = 'https://chart.googleapis.com/chart?cht=qr&chs=120x120&chl=' + encodeURIComponent(text);
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { const c=canvas.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,canvas.width,canvas.height); c.drawImage(img,0,0,canvas.width,canvas.height); };
    img.src = url;
  }
};
const el = (id) => document.getElementById(id);
function setBar(pct,label){ el('bar').style.width = (Math.max(0,Math.min(100,pct))||0)+'%'; el('barText').textContent = label; }

async function refreshStatus(){
  try{
    const s = await window.ioc.status();
    const height = s.height ?? '—';
    const peers = s.peers ?? '—';
    const bal = s.wallet?.balance ?? s.wallet?.walletbalance ?? 0;

    el('height').textContent = `H:${height}`;
    el('peers').textContent = `P:${peers}`;
    el('balance').textContent = `B:${bal}`;

    const vp = s.chain?.verificationprogress;
    if (typeof vp === 'number' && isFinite(vp)) setBar(vp*100, `Sync ${Math.round(vp*100)}%`);
    else setBar(peers>0?60:0, peers>0?'Syncing…':'Offline');
  }catch{
    el('height').textContent='H:—'; el('peers').textContent='P:—'; el('balance').textContent='B:—';
    setBar(0,'Offline');
  }
}

async function main(){
  const paths = await window.ioc.paths();
  document.getElementById('openDataDir').onclick = () => window.ioc.openDir(paths.dataDir);

  // Toggle hidden daemon path row with Option-click on title
  document.querySelector('h1').addEventListener('click', (e)=>{
    if (e.altKey) document.getElementById('daemonPaths').style.display =
      document.getElementById('daemonPaths').style.display==='none'?'block':'none';
  });

  document.getElementById('startDetached').onclick = async () => {
    const p = document.getElementById('iocoind').value.trim() || '/usr/local/bin/iocoind';
    await window.ioc.startDetached(p); setTimeout(refreshStatus, 1000);
  };
  document.getElementById('installLA').onclick = async () => {
    const p = document.getElementById('iocoind').value.trim() || '/usr/local/bin/iocoind';
    await window.ioc.installLaunchAgent(p);
  };
  document.getElementById('unloadLA').onclick = async () => { await window.ioc.unloadLaunchAgent(); };
  document.getElementById('stopAll').onclick = async () => {
    const p = document.getElementById('iocli').value.trim() || '/usr/local/bin/iocoin-cli';
    try{ await window.ioc.stopAll(p); setTimeout(refreshStatus, 1500); }catch{}
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
    try{
      const txid = await window.ioc.send(to, amt);
      msg.textContent = 'TXID: ' + txid;
      document.getElementById('to').value=''; document.getElementById('amt').value='';
      refreshStatus();
    }catch(e){ msg.textContent = 'Error: ' + (e.message || e); }
  };

  document.getElementById('unlockStake').onclick = async () => {
    const pass = document.getElementById('pass').value;
    try{ await window.ioc.unlock(pass, 999999); document.getElementById('pass').value=''; refreshStatus(); }
    catch{ alert('Unlock failed'); }
  };
  document.getElementById('lockNow').onclick = async () => { try{ await window.ioc.lock(); refreshStatus(); }catch{ alert('Lock failed'); } };

  refreshStatus(); setInterval(refreshStatus, 5000);
}
main();
JS

echo "✓ Applied compact widget layout. Relaunch with: npm run dev"
