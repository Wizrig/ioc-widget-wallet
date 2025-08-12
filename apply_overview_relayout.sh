#!/usr/bin/env bash
set -e
mkdir -p src/renderer src/main

cat > src/renderer/index.html <<'HTML'
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>I/O Coin Wallet</title>
  <style>
    :root{ --bg:#2c3440; --hdr:#1fb6aa; --panel:#3a4554; --edge:#2d3642; --txt:#e9f1ff; --muted:#b5c2d6; --btn:#27c0b4; }
    body{ margin:14px 16px; background:transparent; color:var(--txt); -webkit-user-select:none; -webkit-app-region:drag; font-family:-apple-system,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
    .app{ background:var(--bg); border-radius:10px; border:1px solid #00000055; overflow:hidden; }
    .topbar{ -webkit-app-region:no-drag; display:flex; gap:14px; align-items:center; padding:10px 14px; background: linear-gradient(#1e293b55, #00000022); border-bottom:3px solid var(--hdr); }
    .tabs{ display:flex; gap:10px; }
    .tab{ padding:6px 12px; border-radius:8px; background:transparent; color:var(--txt); cursor:pointer; border:1px solid transparent; font-weight:600;}
    .tab.active{ background:#00000022; border-color:#00000033; box-shadow: inset 0 -2px 0 var(--hdr); }
    .spacer{ flex:1; }
    .icons{ display:flex; gap:8px; }
    .chip{ width:26px; height:26px; display:grid; place-items:center; border-radius:7px; background:#00000033; color:#d7e6ff; font-size:13px; -webkit-app-region:no-drag; }
    .chip.ok{ background:var(--hdr); color:#051318; }
    .chip .n{ font-weight:800; padding-left:3px; }
    .page{ padding:18px; }
    .panel{ background:var(--panel); border:1px solid var(--edge); border-radius:8px; padding:18px; box-shadow: inset 0 1px 0 #ffffff10; }
    .title{ text-align:center; color:#d6e2f2; font-weight:800; letter-spacing:.6px; }
    .bignum{ width:min(560px, 86%); height:140px; margin:16px auto; border-radius:10px; background:#222a35; border:1px solid #111722; display:flex; align-items:center; justify-content:center; }
    #big-balance{ line-height:1; font-weight:800; font-size:72px; color:#a9b8cf; }
    .staking{ text-align:center; margin-top:8px; color:var(--muted); letter-spacing:.4px; }
    .bottomrow{ display:flex; justify-content:flex-end; align-items:center; gap:10px; margin-top:18px; }
    .syncbar{ width:280px; height:10px; background:#1b2230; border:1px solid #0f1522; border-radius:999px; overflow:hidden; }
    .bar{ height:100%; width:0%; background: linear-gradient(90deg, var(--hdr), #6ef0e6); transition: width .4s ease; }
    .synctxt{ color:var(--muted); font-size:12px; white-space:nowrap; }
    .hidden{ display:none; }
    .panel.padless{ padding:14px 18px; }
    table{ width:100%; border-collapse: collapse; font-size:13px; }
    th,td{ padding:8px; border-bottom:1px solid #2a3545; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; }
    th{ color:var(--muted); text-align:left; }
  </style>
</head>
<body>
  <div class="app" id="app">
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
        <div class="chip" id="ic-lock" title="Wallet lock">🔒</div>
        <div class="chip" id="ic-stake" title="Staking">⛏</div>
        <div class="chip" id="ic-peers" title="Peers">📶</div>
        <div class="chip" id="ic-sync" title="Sync">⏳</div>
        <div class="chip" id="ic-term" title="Open data dir">⌘</div>
      </div>
    </div>

    <section class="page" id="tab-overview">
      <div class="panel padless">
        <h2 class="title">TOTAL I/O AVAILABLE</h2>
        <div class="bignum" id="bignum"><span id="big-balance">0</span></div>
        <div class="staking">STAKING: <span id="staking">0</span></div>
        <div class="bottomrow">
          <div class="synctxt" id="syncTxt">Syncing wallet (0 / 0 blocks)</div>
          <div class="syncbar"><div class="bar" id="syncbar"></div></div>
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

    <section class="page hidden" id="tab-ions">
      <div class="panel"><h3 style="margin:0 0 10px;">IONs</h3><div class="synctxt">Placeholder</div></div>
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
  let size=84;
  const ctx=document.createElement('canvas').getContext('2d');
  const font=(s)=>`800 ${s}px -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
  let max=box.clientWidth-24;
  while(size>28){
    ctx.font=font(size);
    if(ctx.measureText(span.textContent).width<=max) break;
    size-=2;
  }
  span.style.fontSize=size+'px';
}
function setIconState(id, ok, label){
  const chip=el(id);
  if(!chip) return;
  chip.classList.toggle('ok', !!ok);
  if(label!==undefined) chip.textContent=label;
}
async function refreshStatus(){
  try{
    const s = await window.ioc.status();
    const bal = (typeof s.info?.balance==='number'?s.info.balance:(s.wallet?.balance ?? s.wallet?.walletbalance ?? 0)) || 0;
    el('big-balance').textContent = (Math.round(bal*1000)/1000).toLocaleString();
    fitBalance();
    const stakeAmt = s.staking?.stake ?? s.mining?.stake ?? 0;
    el('staking').textContent = stakeAmt;
    const blocks = s.chain?.blocks ?? s.height ?? 0;
    const headers = s.chain?.headers ?? blocks;
    const vp = (typeof s.chain?.verificationprogress === 'number') ? s.chain.verificationprogress : null;
    const pct = vp !== null ? Math.round(vp*100) : (headers ? Math.round((blocks/headers)*100) : 0);
    setSync(pct, `Syncing wallet (${blocks} / ${headers} blocks)`);
    const peers = s.peers || 0;
    setIconState('ic-peers', peers>0, '📶');
    el('ic-peers').title = `Peers: ${peers}`;
    const stakingOn = !!(s.staking?.staking || s.staking?.enabled || s.mining?.staking);
    setIconState('ic-stake', stakingOn, '⛏');
    const unlockedUntil = s.wallet?.unlocked_until || 0;
    const isUnlocked = unlockedUntil>0;
    setIconState('ic-lock', !isUnlocked, isUnlocked?'🔓':'🔒');
    setIconState('ic-sync', pct>=100, pct>=100?'✓':'⏳');
  }catch{
    el('big-balance').textContent='0';
    fitBalance();
    el('staking').textContent='0';
    setSync(0,'Syncing wallet (0 / 0 blocks)');
    setIconState('ic-peers', false, '📶');
    setIconState('ic-stake', false, '⛏');
    setIconState('ic-lock', true, '🔒');
    setIconState('ic-sync', false, '⏳');
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
    el('txrows').innerHTML='<tr><td colspan="4">No data</td></tr>';
  }
}
async function main(){
  const paths = await window.ioc.paths();
  document.getElementById('ic-term').onclick = () => window.ioc.openDir(paths.dataDir);
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', ()=>switchTab(t.dataset.tab)));
  refreshStatus();
  setInterval(refreshStatus, 4000);
}
main();
JS

echo OK
