#!/usr/bin/env bash
set -e

# --- src/main/main.js ---
cat > src/main/main.js <<'JS'
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { DATA_DIR } = require('../shared/constants');
const { ensureConf, installLaunchAgent, unloadLaunchAgent, startDetached, stopViaCli } = require('./daemon');
const {
  rpc, getBlockCount, getConnectionCount, getWalletInfo, getMiningInfo, getStakingInfo,
  getPeerInfo, getNewAddress, sendToAddress, walletLock, walletPassphrase, listTransactions
} = require('./rpc');

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 920, height: 640, minWidth: 880, minHeight: 600,
    transparent: true, vibrancy: 'sidebar', visualEffectState: 'active',
    titleBarStyle: 'hiddenInset', backgroundColor: '#00000000',
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
ipcMain.handle('rpc:listtx', (_e, count=50) => listTransactions(count));
ipcMain.handle('open:dir', async (_e, dir) => {
  await shell.openPath('/System/Applications/Utilities/Terminal.app');
  return shell.openPath(dir);
});
JS

# --- src/main/rpc.js ---
cat > src/main/rpc.js <<'JS'
const fs = require('node:fs');
const axios = require('axios');
const { CONF_PATH } = require('../shared/constants');

function readCreds() {
  const txt = fs.readFileSync(CONF_PATH, 'utf8');
  const u = /rpcuser=(.+)/.exec(txt)?.[1] ?? '';
  const p = /rpcpassword=(.+)/.exec(txt)?.[1] ?? '';
  return { u, p };
}
async function rpc(method, params=[]) {
  const { u, p } = readCreds();
  const { data } = await axios.post('http://127.0.0.1:33765/', {
    jsonrpc:'2.0', id:1, method, params
  }, { auth:{ username:u, password:p }, timeout:10000 });
  if (data.error) throw new Error(data.error.message || 'RPC error');
  return data.result;
}
const getBlockCount      = () => rpc('getblockcount');
const getConnectionCount = () => rpc('getconnectioncount');
const getWalletInfo      = () => rpc('getwalletinfo');
const getMiningInfo      = () => rpc('getmininginfo').catch(()=>({}));
const getStakingInfo     = () => rpc('getstakinginfo').catch(()=>({}));
const getPeerInfo        = () => rpc('getpeerinfo').catch(()=>([]));
const getNewAddress      = (label='ioc-widget') => rpc('getnewaddress', [label]);
const sendToAddress      = (addr, amt, c='', ct='') => rpc('sendtoaddress', [addr, amt, c, ct]);
const walletLock         = () => rpc('walletlock');
const walletPassphrase   = (pass, secs) => rpc('walletpassphrase', [pass, secs]);
const listTransactions   = (count=50) => rpc('listtransactions', ["*", count, 0, true]);

module.exports = {
  rpc, getBlockCount, getConnectionCount, getWalletInfo, getMiningInfo, getStakingInfo,
  getPeerInfo, getNewAddress, sendToAddress, walletLock, walletPassphrase, listTransactions
};
JS

# --- src/main/preload.js (full, with listTx bridge) ---
cat > src/main/preload.js <<'JS'
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ioc', {
  paths: () => ipcRenderer.invoke('env:paths'),
  startDetached: (p) => ipcRenderer.invoke('daemon:startDetached', p),
  installLaunchAgent: (p) => ipcRenderer.invoke('daemon:installLaunchAgent', p),
  unloadLaunchAgent: () => ipcRenderer.invoke('daemon:unloadLaunchAgent'),
  stopAll: (cli) => ipcRenderer.invoke('daemon:stop', cli),

  status: () => ipcRenderer.invoke('rpc:status'),
  newAddress: (label) => ipcRenderer.invoke('rpc:newAddress', label),
  send: (to, amt, c, ct) => ipcRenderer.invoke('rpc:send', to, amt, c, ct),
  lock: () => ipcRenderer.invoke('rpc:lock'),
  unlock: (pass, secs) => ipcRenderer.invoke('rpc:unlock', pass, secs),
  listTx: (count) => ipcRenderer.invoke('rpc:listtx', count),

  openDir: (dir) => ipcRenderer.invoke('open:dir', dir),
});
JS

# --- src/renderer/index.html ---
cat > src/renderer/index.html <<'HTML'
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>I/O Coin Wallet</title>
  <style>
    :root{
      --bg:#2c3440; --hdr:#1fb6aa; --panel:#3a4554; --edge:#2d3642;
      --txt:#e9f1ff; --muted:#b5c2d6; --btn:#27c0b4; --accent:#1e85c8;
    }
    [data-theme="blue"] { --hdr:#1e85c8; --btn:#1e85c8; }
    [data-theme="light"] { --bg:#e9eef6; --panel:#ffffff; --edge:#d5dbea; --txt:#0f172a; --muted:#4b5563; --hdr:#1e85c8; --btn:#1e85c8; }

    body{ margin:14px 16px; background:transparent; color:var(--txt); -webkit-user-select:none; -webkit-app-region:drag;
      font-family:-apple-system,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
    .app{ background:var(--bg); border-radius:10px; border:1px solid #00000055; overflow:hidden; }
    .topbar{ -webkit-app-region:no-drag; display:flex; gap:14px; align-items:center; padding:10px 14px;
      background: linear-gradient(#1e293b55, #00000022); border-bottom:3px solid var(--hdr); }
    .tabs{ display:flex; gap:10px; }
    .tab{ padding:6px 12px; border-radius:8px; background:transparent; color:var(--txt); cursor:pointer; border:1px solid transparent; font-weight:600;}
    .tab.active{ background:#00000022; border-color:#00000033; box-shadow: inset 0 -2px 0 var(--hdr); }
    .spacer{ flex:1; }
    .icons{ display:flex; gap:10px; opacity:.9; }
    .icon{ width:24px; height:24px; display:grid; place-items:center; background:#00000033; border-radius:6px; cursor:pointer; -webkit-app-region:no-drag; }

    .page{ padding:18px; }
    .panel{ background:var(--panel); border:1px solid var(--edge); border-radius:8px; padding:18px; box-shadow: inset 0 1px 0 #ffffff10; }
    .title{ text-align:center; color:#d6e2f2; font-weight:800; letter-spacing:.6px; }
    .bignum{ width:220px; height:120px; margin:16px auto; border-radius:8px; background:#222a35; color:#93a4bd; display:grid; place-items:center; font-size:62px; font-weight:700; border:1px solid #111722; }
    .staking{ text-align:center; margin-top:8px; color:var(--muted); letter-spacing:.4px; }
    .sendwrap{ display:flex; justify-content:center; margin-top:16px; }
    .sendbtn{ -webkit-app-region:no-drag; display:inline-flex; align-items:center; gap:8px; padding:10px 18px; border-radius:8px; border:none; color:#0a1a20; background:var(--btn); font-weight:800; cursor:pointer; box-shadow: 0 3px 0 #00000040; }
    .sendbtn svg{ width:16px; height:16px; }
    .syncrow{ display:flex; align-items:center; gap:10px; margin-top:18px; }
    .syncbar{ flex:1; height:10px; background:#1b2230; border:1px solid #0f1522; border-radius:999px; overflow:hidden; }
    .bar{ height:100%; width:0%; background: linear-gradient(90deg, var(--hdr), #6ef0e6); transition: width .4s ease; }
    .synctxt{ color:var(--muted); font-size:12px; }

    .grid2{ display:grid; grid-template-columns: 1.2fr .8fr; gap:14px; }
    @media (max-width: 900px){ .grid2{ display:block; } }
    label{ display:block; margin:10px 0 6px; color:var(--muted); font-size:13px; }
    input,button{ -webkit-app-region:no-drag; height:32px; padding:0 10px; border-radius:8px; border:1px solid #1a2634; background:#0c1523; color:var(--txt); }
    input:focus{ outline:none; border-color: var(--hdr); box-shadow:0 0 0 2px #1fb6aa55; }
    .row{ display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; }

    table{ width:100%; border-collapse: collapse; font-size:13px; }
    th,td{ padding:8px; border-bottom:1px solid #2a3545; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; }
    th{ color:var(--muted); text-align:left; }
    .tiles{ display:grid; grid-template-columns: repeat(auto-fill,minmax(210px,1fr)); gap:14px; }
    .tile{ background:var(--panel); border:1px solid var(--edge); border-radius:10px; padding:10px; cursor:pointer; }
    .tile.active{ outline:3px solid var(--hdr); }
  </style>
</head>
<body>
  <div class="app" id="app" data-theme="teal">
    <div class="topbar">
      <div class="tabs">
        <div class="tab active" data-tab="overview">Overview</div>
        <div class="tab" data-tab="history">History</div>
        <div class="tab" data-tab="address">Address Book</div>
        <div class="tab" data-tab="ions">IONs</div>
        <div class="tab" data-tab="settings">Settings</div>
      </div>
      <div class="spacer"></div>
      <div class="icons">
        <div class="icon" id="openDataDir" title="Open data dir in Terminal">⌘</div>
      </div>
    </div>

    <!-- Overview -->
    <section class="page" id="tab-overview">
      <div class="panel">
        <h2 class="title">TOTAL I/O AVAILABLE</h2>
        <div class="bignum"><span id="big-balance">0</span></div>
        <div class="staking">STAKING: <span id="staking">0</span></div>
        <div class="sendwrap">
          <button class="sendbtn" id="sendBtn">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
            Send
          </button>
        </div>
        <div class="syncrow">
          <div class="syncbar"><div class="bar" id="syncbar"></div></div>
          <div class="synctxt" id="syncTxt">Syncing wallet (0 / 0 blocks)</div>
        </div>
      </div>

      <div class="grid2" style="margin-top:14px;">
        <div class="panel">
          <h3 style="margin:0 0 10px;">Send Coins</h3>
          <div class="row">
            <div style="flex:1;"><label>Pay To</label><input id="to" placeholder="Address"></div>
            <div style="width:160px;"><label>Amount</label><input id="amt" type="number" step="0.00000001" placeholder="IOC"></div>
            <button id="send" style="width:110px; background:var(--btn); border:none; color:#0a1a20; font-weight:800;">Send</button>
          </div>
          <div id="sendMsg" class="synctxt" style="margin-top:8px;"></div>
        </div>

        <div class="panel">
          <h3 style="margin:0 0 10px;">Receive & Staking</h3>
          <button id="newAddr" style="height:30px; background:var(--btn); border:none; color:#0a1a20; font-weight:800;">New Address</button>
          <div id="addr" class="synctxt" style="margin-top:6px;"><code>—</code></div>
          <canvas id="qr" width="120" height="120" style="margin-top:8px; background:#fff; border-radius:8px;"></canvas>
          <label style="margin-top:10px;">Wallet passphrase</label>
          <input id="pass" type="password" placeholder="••••••">
          <div class="row" style="margin-top:8px;">
            <button id="unlockStake" style="background:var(--btn); border:none; color:#0a1a20; font-weight:800;">Unlock for staking</button>
            <button id="lockNow">Lock now</button>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:14px;">
        <h3 style="margin:0 0 10px;">Daemon</h3>
        <div class="row">
          <input id="iocoind" placeholder="/usr/local/bin/iocoind" style="flex:1;">
          <button id="startDetached" style="background:var(--btn); border:none; color:#0a1a20; font-weight:800;">Start Detached</button>
          <button id="stopAll">Stop</button>
        </div>
        <div class="row" style="margin-top:8px;">
          <button id="installLA" style="background:var(--btn); border:none; color:#0a1a20; font-weight:800;">Enable Background</button>
          <button id="unloadLA">Disable Background</button>
          <input id="iocli" placeholder="/usr/local/bin/iocoin-cli" style="flex:1;">
        </div>
      </div>
    </section>

    <!-- History -->
    <section class="page" id="tab-history" style="display:none;">
      <div class="panel">
        <h3 style="margin:0 0 10px;">Recent Activity</h3>
        <table>
          <thead><tr><th>Time</th><th>Type</th><th>Amount</th><th>Address / TXID</th></tr></thead>
          <tbody id="txrows"></tbody>
        </table>
      </div>
    </section>

    <!-- Address Book -->
    <section class="page" id="tab-address" style="display:none;">
      <div class="panel"><h3 style="margin:0 0 10px;">Address Book</h3><div class="synctxt">Placeholder. (Labels + export/import can be added next.)</div></div>
    </section>

    <!-- IONs -->
    <section class="page" id="tab-ions" style="display:none;">
      <div class="panel"><h3 style="margin:0 0 10px;">IONs</h3><div class="synctxt">Placeholder for ION features.</div></div>
    </section>

    <!-- Settings -->
    <section class="page" id="tab-settings" style="display:none;">
      <div class="panel">
        <h3 style="margin:0 0 14px;">Change Theme</h3>
        <div class="tiles">
          <div class="tile active" data-theme="teal"><strong>IOC Teal (Classic)</strong><div class="synctxt">Dark slate + teal highlight</div></div>
          <div class="tile" data-theme="blue"><strong>Blue</strong><div class="synctxt">Dark slate + blue highlight</div></div>
          <div class="tile" data-theme="light"><strong>Light</strong><div class="synctxt">Light background</div></div>
        </div>
      </div>
    </section>
  </div>
  <script src="renderer.js"></script>
</body>
</html>
HTML

# --- src/renderer/renderer.js ---
cat > src/renderer/renderer.js <<'JS'
const el = (id) => document.getElementById(id);
const QR = {
  draw: (canvas, text) => {
    const url = 'https://chart.googleapis.com/chart?cht=qr&chs=120x120&chl=' + encodeURIComponent(text);
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { const c=canvas.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,canvas.width,canvas.height); c.drawImage(img,0,0,canvas.width,canvas.height); };
    img.src = url;
  }
};
function setSync(pct, txt){ const b=el('syncbar'); if(b) b.style.width=(Math.max(0,Math.min(100,pct))||0)+'%'; const t=el('syncTxt'); if(t) t.textContent=txt; }
function switchTab(name){
  document.querySelectorAll('.page').forEach(s=>s.style.display='none');
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('tab-'+name).style.display='';
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  if(name==='history') loadHistory();
}
async function refreshStatus(){
  try{
    const s = await window.ioc.status();
    const bal = s.wallet?.balance ?? s.wallet?.walletbalance ?? 0;
    el('big-balance').textContent = (Math.round(bal*10000)/10000).toString();
    const stakeAmt = s.staking?.stake ?? s.mining?.stake ?? 0;
    el('staking').textContent = stakeAmt;
    const blocks = s.chain?.blocks ?? s.height ?? 0;
    const headers = s.chain?.headers ?? blocks;
    const vp = (typeof s.chain?.verificationprogress === 'number') ? s.chain.verificationprogress : null;
    const pct = vp !== null ? Math.round(vp*100) : (headers ? Math.round((blocks/headers)*100) : 0);
    setSync(pct, `Syncing wallet (${blocks} / ${headers} blocks)`);
    el('sendBtn').onclick = () => document.getElementById('to').focus();
  }catch{
    el('big-balance').textContent='0'; el('staking').textContent='0'; setSync(0, 'Syncing wallet (0 / 0 blocks)');
  }
}
async function loadHistory(){
  try{
    const tx = await window.ioc.listTx(50);
    const tbody = el('txrows'); tbody.innerHTML='';
    tx.forEach(t=>{
      const tr=document.createElement('tr');
      const when=new Date((t.timereceived||t.time||0)*1000).toLocaleString();
      const amt=(t.amount ?? 0);
      const addr=t.address || t.txid || '';
      tr.innerHTML = `<td>${when}</td><td>${t.category||''}</td><td>${amt}</td><td title="${addr}">${addr}</td>`;
      tbody.appendChild(tr);
    });
  }catch{
    el('txrows').innerHTML='<tr><td colspan="4">No data (RPC offline)</td></tr>';
  }
}
async function main(){
  const paths = await window.ioc.paths();
  document.getElementById('openDataDir').onclick = () => window.ioc.openDir(paths.dataDir);
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', ()=>switchTab(t.dataset.tab)));
  const app = document.getElementById('app');
  document.querySelectorAll('.tile').forEach(tile=>{
    tile.addEventListener('click', ()=>{
      document.querySelectorAll('.tile').forEach(x=>x.classList.remove('active'));
      tile.classList.add('active');
      app.setAttribute('data-theme', tile.getAttribute('data-theme'));
    });
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
    document.getElementById('addr').innerHTML='<code>'+a+'</code>';
    QR.draw(document.getElementById('qr'), a);
  };
  document.getElementById('send').onclick = async () => {
    const to=document.getElementById('to').value.trim();
    const amt=Number(document.getElementById('amt').value);
    const msg=document.getElementById('sendMsg'); msg.textContent='Sending...';
    try{ const txid=await window.ioc.send(to, amt); msg.textContent='TXID: '+txid; document.getElementById('to').value=''; document.getElementById('amt').value=''; refreshStatus(); }
    catch(e){ msg.textContent='Error: '+(e.message||e); }
  };
  document.getElementById('unlockStake').onclick = async () => {
    const pass=document.getElementById('pass').value;
    try{ await window.ioc.unlock(pass, 999999); document.getElementById('pass').value=''; refreshStatus(); }
    catch{ alert('Unlock failed'); }
  };
  document.getElementById('lockNow').onclick = async () => { try{ await window.ioc.lock(); refreshStatus(); }catch{ alert('Lock failed'); } };
  refreshStatus(); setInterval(refreshStatus, 5000);
}
main();
JS

echo "✓ Classic IOC UI files written."
echo "Run: npm run dev"
