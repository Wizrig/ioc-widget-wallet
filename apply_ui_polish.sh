#!/usr/bin/env bash
set -e

cat > src/main/main.js <<'JS'
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { DATA_DIR } = require('../shared/constants');
const { ensureConf, installLaunchAgent, unloadLaunchAgent, startDetached, stopViaCli } = require('./daemon');
const { rpc, getBlockCount, getConnectionCount, getWalletInfo, getMiningInfo, getStakingInfo, getPeerInfo, getNewAddress, sendToAddress, walletLock, walletPassphrase, listTransactions, getInfo } = require('./rpc');
let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 920, height: 640, minWidth: 880, minHeight: 600,
    transparent: true, vibrancy: 'sidebar', visualEffectState: 'active',
    titleBarStyle: 'hiddenInset', titleBarOverlay: { color: '#00000000', symbolColor: '#d7e6ff', height: 48 },
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
  const [height, peers, wallet, mining, staking, chain, info] = await Promise.all([
    safe(()=>getBlockCount()), safe(()=>getConnectionCount()), safe(()=>getWalletInfo()),
    safe(()=>getMiningInfo()), safe(()=>getStakingInfo()), safe(()=>rpc('getblockchaininfo')),
    safe(()=>getInfo())
  ]);
  return { height, peers, wallet, mining, staking, chain, info };
});
ipcMain.handle('rpc:newAddress', (_e, label) => getNewAddress(label));
ipcMain.handle('rpc:send', (_e, to, amt, c, ct) => sendToAddress(to, amt, c, ct));
ipcMain.handle('rpc:lock', () => walletLock());
ipcMain.handle('rpc:unlock', (_e, pass, secs) => walletPassphrase(pass, secs));
ipcMain.handle('rpc:listtx', (_e, count=50) => listTransactions(count));
ipcMain.handle('open:dir', async (_e, dir) => { await shell.openPath('/System/Applications/Utilities/Terminal.app'); return shell.openPath(dir); });
JS

cat > src/renderer/index.html <<'HTML'
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>I/O Coin Wallet</title>
  <style>
    :root{ --bg:#222a33; --hdr:#1fb6aa; --panel:#3a4554; --edge:#2d3642; --txt:#e9f1ff; --muted:#b5c2d6; --ok:#1fb6aa; --off:#2a3341; }
    body{ margin:12px 14px; background:transparent; color:var(--txt); -webkit-user-select:none; -webkit-app-region:drag; font-family:-apple-system,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
    .app{ background:var(--bg); border-radius:12px; border:1px solid #00000066; overflow:hidden; }
    .topbar{ -webkit-app-region:no-drag; display:flex; gap:14px; align-items:center; padding:16px 16px 10px; background: linear-gradient(#1e293b55, #00000022); border-bottom:3px solid var(--hdr); }
    .tabs{ display:flex; gap:10px; }
    .tab{ padding:6px 12px; border-radius:9px; background:transparent; color:var(--txt); cursor:pointer; border:1px solid transparent; font-weight:600;}
    .tab.active{ background:#00000022; border-color:#00000033; box-shadow: inset 0 -2px 0 var(--hdr); }
    .spacer{ flex:1; }
    .icons{ display:flex; gap:8px; }
    .chip{ width:28px; height:28px; display:grid; place-items:center; border-radius:8px; background:var(--off); color:#c9d6ea; -webkit-app-region:no-drag; }
    .chip.ok{ background:var(--ok); color:#06231f; }
    .chip svg{ width:16px; height:16px; fill:currentColor; }
    .bars{ display:grid; grid-auto-flow:column; gap:2px; align-items:end; height:16px; }
    .bar{ width:3px; background:#7d8aa0; border-radius:2px; }
    .bar.on{ background:#06231f; }
    .page{ padding:0; }
    .overview{ background:var(--panel); border:1px solid var(--edge); border-radius:10px; margin:14px; padding:24px; min-height: calc(100vh - 128px); }
    .title{ text-align:center; color:#d6e2f2; font-weight:800; letter-spacing:.6px; margin:0 0 14px; }
    .bignum{ width:94%; max-width:820px; height:140px; margin:0 auto 10px; border-radius:12px; background:#222a35; border:1px solid #111722; display:flex; align-items:center; justify-content:center; }
    #big-balance{ line-height:1; font-weight:800; font-size: clamp(42px, 7.6vw, 58px); color:#b5c1d4; }
    .staking{ text-align:center; margin:6px 0 14px; color:var(--muted); letter-spacing:.4px; }
    .bottomrow{ display:flex; justify-content:flex-end; align-items:center; gap:10px; }
    .syncbar{ width:320px; height:10px; background:#1b2230; border:1px solid #0f1522; border-radius:999px; overflow:hidden; }
    .barfill{ height:100%; width:0%; background: linear-gradient(90deg, var(--hdr), #6ef0e6); transition: width .4s ease; }
    .synctxt{ color:var(--muted); font-size:12px; white-space:nowrap; }
    .hidden{ display:none; }
    table{ width:100%; border-collapse: collapse; font-size:13px; }
    th,td{ padding:8px; border-bottom:1px solid #2a3545; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; }
    th{ color:var(--muted); text-align:left; }
    .panel{ background:var(--panel); border:1px solid var(--edge); border-radius:10px; margin:14px; padding:18px; }
  </style>
</head>
<body>
  <div class="app" id="app">
    <div class="topbar">
      <div class="tabs">
        <div class="tab active" data-tab="overview">Overview</div>
        <div class="tab" data-tab="history">History</div>
        <div class="tab" data-tab="address">Address Book</div>
        <div class="tab" data-tab="dions">DIONS</div>
        <div class="tab" data-tab="settings">Settings</div>
      </div>
      <div class="spacer"></div>
      <div class="icons">
        <div class="chip" id="ic-lock" title="Wallet"><svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm3 8H9V7a3 3 0 016 0v3z"/></svg></div>
        <div class="chip" id="ic-stake" title="Staking"><svg viewBox="0 0 24 24"><path d="M2 21l6-6 5 5-6 2-5-1zM14.5 3l6.5 6.5-6.5 6.5L8 9.5 14.5 3z"/></svg></div>
        <div class="chip" id="ic-peers" title="Peers"><div class="bars" id="bars"><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div></div></div>
        <div class="chip" id="ic-sync" title="Sync"><svg viewBox="0 0 24 24"><path d="M12 6V3L8 7l4 4V8c2.8 0 5 2.2 5 5 0 1-.3 2-.8 2.8l1.5 1.3A6.96 6.96 0 0019 13c0-3.9-3.1-7-7-7zm-5 3c-1 1.2-1.6 2.7-1.6 4.3 0 3.9 3.1 7 7 7v3l4-4-4-4v3c-2.8 0-5-2.2-5-5 0-.8.2-1.6.6-2.3L7 9z"/></svg></div>
      </div>
    </div>

    <section class="page" id="tab-overview">
      <div class="overview">
        <h2 class="title">TOTAL I/O AVAILABLE</h2>
        <div class="bignum" id="bignum"><span id="big-balance">0</span></div>
        <div class="staking">STAKING: <span id="staking">0</span></div>
        <div class="bottomrow">
          <div class="synctxt" id="syncTxt">Syncing wallet (0 / 0 blocks)</div>
          <div class="syncbar"><div class="barfill" id="syncbar"></div></div>
        </div>
      </div>
    </section>

    <section class="page hidden" id="tab-history">
      <div class="panel">
        <h3 style="margin:0 0 10px;">Recent Activity</h3>
        <table>
          <thead><tr><th>Time</th><th>Type</th><th>Amount</th><th>Address / TXID</th></tr></thead>
          <tbody id="txrows"></tbody>
        </table>
      </div>
    </section>

    <section class="page hidden" id="tab-address">
      <div class="panel"><h3 style="margin:0 0 10px;">Address Book</h3><div class="synctxt">Placeholder</div></div>
    </section>

    <section class="page hidden" id="tab-dions">
      <div class="panel"><h3 style="margin:0 0 10px;">DIONS</h3><div class="synctxt">Placeholder</div></div>
    </section>

    <section class="page hidden" id="tab-settings">
      <div class="panel"><h3 style="margin:0 0 10px;">Settings</h3><div class="synctxt">Theme coming next</div></div>
    </section>
  </div>
  <script src="renderer.js"></script>
</body>
</html>
HTML

cat > src/renderer/renderer.js <<'JS'
const el = (id) => document.getElementById(id);
function setSync(pct, txt){ const b=el('syncbar'); if(b) b.style.width=(Math.max(0,Math.min(100,pct))||0)+'%'; const t=el('syncTxt'); if(t) t.textContent=txt; }
function switchTab(name){
  document.querySelectorAll('.page').forEach(s=>s.classList.add('hidden'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('tab-'+name).classList.remove('hidden');
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  if(name==='history') loadHistory();
}
function fitBalance(){
  const box=document.getElementById('bignum');
  const span=document.getElementById('big-balance');
  const ctx=document.createElement('canvas').getContext('2d');
  const font=(s)=>`800 ${s}px -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
  let size=parseInt(getComputedStyle(span).fontSize,10), max=box.clientWidth-28;
  while(size>36){ ctx.font=font(size); if(ctx.measureText(span.textContent).width<=max) break; size-=2; }
  span.style.fontSize=size+'px';
}
function peerBars(n){
  const bars=[8,12,15,18];
  const els=[...document.querySelectorAll('#bars .bar')];
  const on = n<=0?0 : n<=2?1 : n<=4?2 : n<=6?3 : 4;
  els.forEach((e,i)=>{ e.style.height=bars[i]+'px'; e.classList.toggle('on', i<on); });
}
function setOK(id, ok){ const chip=el(id); if(chip) chip.classList.toggle('ok', !!ok); }
async function refreshStatus(){
  try{
    const s = await window.ioc.status();
    const bal = (typeof s.info?.balance==='number'?s.info.balance:(s.wallet?.balance ?? s.wallet?.walletbalance ?? 0)) || 0;
    el('big-balance').textContent = (Math.round(bal*1000)/1000).toLocaleString();
    fitBalance();
    const stakingOn = !!(s.staking?.staking || s.staking?.enabled || s.mining?.staking);
    const stakeAmt = s.staking?.stake ?? s.mining?.stake ?? 0;
    el('staking').textContent = stakeAmt;
    setOK('ic-stake', stakingOn);
    const peers = s.peers || 0;
    peerBars(peers);
    setOK('ic-peers', peers>0);
    const isUnlocked = (s.wallet?.unlocked_until || 0) > 0;
    setOK('ic-lock', isUnlocked);
    const blocks = s.chain?.blocks ?? s.height ?? 0;
    const headers = s.chain?.headers ?? blocks;
    const vp = (typeof s.chain?.verificationprogress === 'number') ? s.chain.verificationprogress : null;
    const pct = vp !== null ? Math.round(vp*100) : (headers ? Math.round((blocks/headers)*100) : 0);
    setSync(pct, `Syncing wallet (${blocks} / ${headers} blocks)`);
    setOK('ic-sync', pct>=100);
  }catch{
    el('big-balance').textContent='0'; fitBalance();
    el('staking').textContent='0'; setSync(0,'Syncing wallet (0 / 0 blocks)');
    peerBars(0); setOK('ic-stake', false); setOK('ic-peers', false); setOK('ic-lock', false); setOK('ic-sync', false);
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
  }catch{ el('txrows').innerHTML='<tr><td colspan="4">No data</td></tr>'; }
}
async function main(){
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', ()=>switchTab(t.dataset.tab)));
  refreshStatus(); setInterval(refreshStatus, 4000);
  window.addEventListener('resize', fitBalance);
}
main();
JS

echo OK
