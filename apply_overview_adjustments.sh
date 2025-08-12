#!/usr/bin/env bash
set -e
mkdir -p src/renderer

cat > src/renderer/index.html <<'HTML'
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>I/O Coin Wallet</title>
  <style>
    :root{ --bg:#2c3440; --hdr:#1fb6aa; --panel:#3a4554; --edge:#2d3642; --txt:#e9f1ff; --muted:#b5c2d6; --ok:#1fb6aa; --off:#26313f; }
    body{ margin:14px 16px; background:transparent; color:var(--txt); -webkit-user-select:none; -webkit-app-region:drag; font-family:-apple-system,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
    .app{ background:var(--bg); border-radius:10px; border:1px solid #00000055; overflow:hidden; }
    .topbar{ -webkit-app-region:no-drag; display:flex; gap:14px; align-items:center; padding:10px 14px; background: linear-gradient(#1e293b55, #00000022); border-bottom:3px solid var(--hdr); }
    .tabs{ display:flex; gap:10px; }
    .tab{ padding:6px 12px; border-radius:8px; background:transparent; color:var(--txt); cursor:pointer; border:1px solid transparent; font-weight:600;}
    .tab.active{ background:#00000022; border-color:#00000033; box-shadow: inset 0 -2px 0 var(--hdr); }
    .spacer{ flex:1; }
    .icons{ display:flex; gap:8px; }
    .chip{ width:28px; height:28px; display:grid; place-items:center; border-radius:8px; background:var(--off); color:#c9d6ea; font-size:14px; -webkit-app-region:no-drag; }
    .chip.ok{ background:var(--ok); color:#06231f; }
    .bars{ display:grid; grid-auto-flow:column; gap:2px; align-items:end; height:16px; }
    .bar{ width:3px; background:#7d8aa0; border-radius:2px; }
    .bar.on{ background:#06231f; }
    .page{ padding:0; }
    .overview{ background:var(--panel); border:1px solid var(--edge); border-radius:8px; margin:18px; padding:24px; min-height: calc(100vh - 140px); box-shadow: inset 0 1px 0 #ffffff10; }
    .title{ text-align:center; color:#d6e2f2; font-weight:800; letter-spacing:.6px; margin:0 0 14px; }
    .bignum{ width:94%; max-width:820px; height:150px; margin:0 auto 10px; border-radius:12px; background:#222a35; border:1px solid #111722; display:flex; align-items:center; justify-content:center; }
    #big-balance{ line-height:1; font-weight:800; font-size: clamp(44px, 8vw, 64px); color:#a9b8cf; }
    .staking{ text-align:center; margin:6px 0 14px; color:var(--muted); letter-spacing:.4px; }
    .bottomrow{ display:flex; justify-content:flex-end; align-items:center; gap:10px; }
    .syncbar{ width:320px; height:10px; background:#1b2230; border:1px solid #0f1522; border-radius:999px; overflow:hidden; }
    .barfill{ height:100%; width:0%; background: linear-gradient(90deg, var(--hdr), #6ef0e6); transition: width .4s ease; }
    .synctxt{ color:var(--muted); font-size:12px; white-space:nowrap; }
    .hidden{ display:none; }
    table{ width:100%; border-collapse: collapse; font-size:13px; }
    th,td{ padding:8px; border-bottom:1px solid #2a3545; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; }
    th{ color:var(--muted); text-align:left; }
    .panel{ background:var(--panel); border:1px solid var(--edge); border-radius:8px; margin:18px; padding:18px; box-shadow: inset 0 1px 0 #ffffff10; }
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
        <div class="chip" id="ic-lock" title="Wallet lock">🔒</div>
        <div class="chip" id="ic-stake" title="Staking">⛏</div>
        <div class="chip" id="ic-peers" title="Peers">
          <div class="bars" id="bars"><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>
        </div>
        <div class="chip" id="ic-sync" title="Sync">⏳</div>
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
  let size=parseInt(getComputedStyle(span).fontSize,10);
  const ctx=document.createElement('canvas').getContext('2d');
  const font=(s)=>`800 ${s}px -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
  let max=box.clientWidth-28;
  while(size>36){
    ctx.font=font(size);
    if(ctx.measureText(span.textContent).width<=max) break;
    size-=2;
  }
  span.style.fontSize=size+'px';
}
function peerBars(n){
  const bars=[8,12,15,18];
  const els=[...document.querySelectorAll('#bars .bar')];
  els.forEach((e,i)=>{ e.style.height=bars[i]+'px'; e.classList.toggle('on', i < Math.min(4, Math.ceil(Math.max(0,n)/2))); });
}
function setChipState(id, ok, text){
  const chip=el(id); if(!chip) return;
  chip.classList.toggle('ok', !!ok);
  if(text!==undefined) chip.textContent=text;
}
async function refreshStatus(){
  try{
    const s = await window.ioc.status();
    const bal = (typeof s.info?.balance==='number'?s.info.balance:(s.wallet?.balance ?? s.wallet?.walletbalance ?? 0)) || 0;
    el('big-balance').textContent = (Math.round(bal*1000)/1000).toLocaleString();
    fitBalance();
    const stakingOn = !!(s.staking?.staking || s.staking?.enabled || s.mining?.staking);
    const stakeAmt = s.staking?.stake ?? s.mining?.stake ?? 0;
    el('staking').textContent = stakeAmt;
    const peers = s.peers || 0;
    peerBars(peers);
    el('ic-peers').classList.toggle('ok', peers>0);
    const unlockedUntil = s.wallet?.unlocked_until || 0;
    const isUnlocked = unlockedUntil>0;
    setChipState('ic-lock', isUnlocked, isUnlocked?'🔓':'🔒');
    setChipState('ic-stake', stakingOn, '⛏');
    const blocks = s.chain?.blocks ?? s.height ?? 0;
    const headers = s.chain?.headers ?? blocks;
    const vp = (typeof s.chain?.verificationprogress === 'number') ? s.chain.verificationprogress : null;
    const pct = vp !== null ? Math.round(vp*100) : (headers ? Math.round((blocks/headers)*100) : 0);
    setSync(pct, `Syncing wallet (${blocks} / ${headers} blocks)`);
    setChipState('ic-sync', pct>=100, pct>=100?'✓':'⏳');
  }catch{
    el('big-balance').textContent='0'; fitBalance();
    el('staking').textContent='0';
    setSync(0,'Syncing wallet (0 / 0 blocks)');
    peerBars(0);
    setChipState('ic-lock', false, '🔒');
    setChipState('ic-stake', false, '⛏');
    setChipState('ic-sync', false, '⏳');
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
  document.getElementById('ic-lock').title='Wallet lock';
  document.getElementById('ic-stake').title='Staking';
  document.getElementById('ic-peers').title='Peers';
  document.getElementById('ic-sync').title='Sync';
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', ()=>switchTab(t.dataset.tab)));
  refreshStatus();
  setInterval(refreshStatus, 4000);
}
main();
JS

echo OK
