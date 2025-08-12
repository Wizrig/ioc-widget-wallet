#!/usr/bin/env bash
set -e

cat > src/renderer/index.html <<'HTML'
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>I/O Coin Wallet</title>
<style>
:root{ --bg:#222a33; --hdr:#1fb6aa; --panel:#3a4554; --edge:#2d3642; --txt:#e9f1ff; --muted:#b5c2d6; --ok:#1fb6aa; --off:#2a3341; --ink:#0a1a18; }
body{ margin:12px 14px; background:transparent; color:var(--txt); -webkit-user-select:none; -webkit-app-region:drag; font-family:-apple-system,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
.app{ background:var(--bg); border-radius:12px; overflow:hidden; }
.topbar{ -webkit-app-region:no-drag; display:flex; gap:14px; align-items:center; padding:16px 16px 10px; background: linear-gradient(#1e293b55, #00000022); border-bottom:3px solid var(--hdr); }
.tabs{ display:flex; gap:10px; }
.tab{ padding:6px 12px; border-radius:9px; background:transparent; color:var(--txt); cursor:pointer; border:1px solid transparent; font-weight:600;}
.tab.active{ background:#00000022; border-color:#00000033; box-shadow: inset 0 -2px 0 var(--hdr); }
.spacer{ flex:1; }
.icons{ display:flex; gap:8px; }
.chip{ width:28px; height:28px; display:grid; place-items:center; border-radius:8px; background:var(--off); color:#c9d6ea; -webkit-app-region:no-drag; }
.chip.ok{ background:var(--ok); color:var(--ink); }
.chip svg{ width:16px; height:16px; fill:currentColor; }
.bars{ display:grid; grid-auto-flow:column; gap:2px; align-items:end; height:16px; }
.bar{ width:3px; background:#7d8aa0; border-radius:2px; }
.bar.on{ background:var(--ink); }
.page{ padding:0; }
.overview{ position:relative; background:var(--panel); border:1px solid var(--edge); border-radius:10px; margin:14px; padding:24px 24px 54px; min-height: calc(100vh - 128px); }
.title{ text-align:center; color:#d6e2f2; font-weight:800; letter-spacing:.6px; margin:0 0 14px; }
.bignum{ width:94%; max-width:820px; height:140px; margin:0 auto 14px; border-radius:12px; background:#222a35; display:flex; align-items:center; justify-content:center; }
#big-balance{ line-height:1; font-weight:800; font-size: clamp(40px, 7.2vw, 56px); color:#bcc6d8; }
.staking{ text-align:center; margin:6px 0 18px; color:var(--muted); letter-spacing:.4px; }
.sendwrap{ display:flex; justify-content:center; margin-bottom:18px; }
.sendbtn{ -webkit-app-region:no-drag; display:inline-flex; align-items:center; gap:8px; padding:10px 18px; border-radius:8px; border:none; color:var(--ink); background:var(--ok); font-weight:800; cursor:pointer; box-shadow: 0 2px 0 #00000040; }
.sendbtn svg{ width:16px; height:16px; }
.syncdock{ position:absolute; right:18px; bottom:14px; display:flex; align-items:center; gap:10px; }
.syncbar{ position:relative; width:240px; height:12px; background:#0f1522; border-radius:999px; box-shadow: inset 0 0 0 1px #0e1a2c; overflow:hidden; }
.syncdot{ position:absolute; left:6px; top:50%; width:6px; height:6px; border-radius:999px; transform:translateY(-50%); background:var(--ok); }
.barfill{ height:100%; width:0%; background: linear-gradient(90deg, var(--hdr), #6ef0e6); transition: width .35s ease; border-radius:999px; }
.synctxt{ color:var(--muted); font-size:12px; white-space:nowrap; }
.hidden{ display:none !important; }
.panel{ background:var(--panel); border:1px solid var(--edge); border-radius:10px; margin:14px; padding:18px; }

.modal{ position:fixed; inset:0; background:#0008; display:flex; align-items:center; justify-content:center; z-index:99; -webkit-app-region:no-drag; }
.sheet{ width:360px; background:#101826; border:1px solid #223049; border-radius:12px; padding:16px; box-shadow:0 10px 30px #0007; -webkit-app-region:no-drag; }
.row{ display:flex; gap:8px; align-items:center; }
.sheet h3{ margin:0 0 10px; }
.sheet input{ width:100%; height:34px; padding:0 10px; border-radius:8px; border:1px solid #1a2634; background:#0c1523; color:#e9f1ff; -webkit-app-region:no-drag; }
.btn{ height:34px; padding:0 14px; border-radius:8px; border:1px solid #1a2634; background:#0c1523; color:#e9f1ff; cursor:pointer; -webkit-app-region:no-drag; }
.btn.primary{ background:var(--ok); color:var(--ink); border:none; font-weight:700; }
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
        <div class="chip" id="ic-lock" title="Wallet"><svg id="svg-lock" viewBox="0 0 24 24"><path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm3 8H9V7a3 3 0 016 0v3z"/></svg></div>
        <div class="chip" id="ic-stake" title="Staking off"><svg viewBox="0 0 24 24"><path d="M2 21l6-6 5 5-6 2-5-1zM14.5 3l6.5 6.5-6.5 6.5L8 9.5 14.5 3z"/></svg></div>
        <div class="chip" id="ic-peers" title="Peers: 0"><div class="bars" id="bars"><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div></div></div>
        <div class="chip" id="ic-sync" title="Sync"><svg viewBox="0 0 24 24"><path d="M12 6V3L8 7l4 4V8c2.8 0 5 2.2 5 5 0 1-.3 2-.8 2.8l1.5 1.3A6.96 6.96 0 0019 13c0-3.9-3.1-7-7-7zm-5 3c-1 1.2-1.6 2.7-1.6 4.3 0 3.9 3.1 7 7 7v3l4-4-4-4v3c-2.8 0-5-2.2-5-5 0-.8.2-1.6.6-2.3L7 9z"/></svg></div>
      </div>
    </div>

    <section class="page" id="tab-overview">
      <div class="overview">
        <h2 class="title">TOTAL I/O AVAILABLE</h2>
        <div class="bignum" id="bignum"><span id="big-balance">0</span></div>
        <div class="staking">STAKING: <span id="staking">0</span></div>
        <div class="sendwrap">
          <button class="sendbtn" id="sendBtn"><svg viewBox="0 0 24 24"><path d="M2 21l20-9L2 3v7l14 2L2 14z"/></svg>Send</button>
        </div>
        <div class="syncdock">
          <div class="synctxt" id="syncTxt">Syncing wallet (0 / 0 blocks)</div>
          <div class="syncbar"><div class="syncdot"></div><div class="barfill" id="syncbar"></div></div>
        </div>
      </div>
    </section>

    <section class="page hidden" id="tab-history"><div class="panel"><h3 style="margin:0 0 10px;">Recent Activity</h3><table><thead><tr><th>Time</th><th>Type</th><th>Amount</th><th>Address / TXID</th></tr></thead><tbody id="txrows"></tbody></table></div></section>
    <section class="page hidden" id="tab-address"><div class="panel"><h3 style="margin:0 0 10px;">Address Book</h3><div class="synctxt">Placeholder</div></div></section>
    <section class="page hidden" id="tab-dions"><div class="panel"><h3 style="margin:0 0 10px;">DIONS</h3><div class="synctxt">Placeholder</div></div></section>
    <section class="page hidden" id="tab-settings"><div class="panel"><h3 style="margin:0 0 10px;">Settings</h3><div class="synctxt">Theme coming next</div></div></section>

    <div class="modal hidden" id="unlockModal" style="display:none;">
      <div class="sheet">
        <h3>Unlock wallet for staking</h3>
        <div class="row" style="margin-bottom:10px;"><input id="pass" type="password" placeholder="Wallet passphrase" autocomplete="current-password"></div>
        <div class="row" style="justify-content:flex-end;"><button class="btn" id="cancelUnlock">Cancel</button><button class="btn primary" id="doUnlock">Unlock</button></div>
      </div>
    </div>
  </div>
  <script src="renderer.js"></script>
</body>
</html>
HTML

cat > src/renderer/renderer.js <<'JS'
const el = (id) => document.getElementById(id);
let last = { bal:0, stake:0, peers:0, pct:0, blocks:0, headers:0, unlocked:false, stakingOn:false };
let busy = false;

function hideModal(){ const m=el('unlockModal'); if(m){ m.classList.add('hidden'); m.style.display='none'; } }
function showModal(){ if(last.unlocked || last.stakingOn) return; const m=el('unlockModal'); if(m){ m.classList.remove('hidden'); m.style.display='flex'; setTimeout(()=>el('pass')?.focus(),0); } }

function setSync(pct, txt){ const b=el('syncbar'); if(b) b.style.width=(Math.max(0,Math.min(100,pct))||0)+'%'; const t=el('syncTxt'); if(t) t.textContent=txt; }
function switchTab(name){ document.querySelectorAll('.page').forEach(s=>s.classList.add('hidden')); document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active')); el('tab-'+name).classList.remove('hidden'); document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active'); if(name==='history') loadHistory(); }
function fitBalance(){ const box=el('bignum'), span=el('big-balance'), ctx=document.createElement('canvas').getContext('2d'); const font=(s)=>`800 ${s}px -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif`; let size=parseInt(getComputedStyle(span).fontSize,10), max=box.clientWidth-28; while(size>36){ ctx.font=font(size); if(ctx.measureText(span.textContent).width<=max) break; size-=2; } span.style.fontSize=size+'px'; }
function peerBars(n){ const bars=[8,12,15,18]; const els=[...document.querySelectorAll('#bars .bar')]; const on=n<=0?0:n<=2?1:n<=4?2:n<=6?3:4; els.forEach((e,i)=>{ e.style.height=bars[i]+'px'; e.classList.toggle('on', i<on); }); const p=el('ic-peers'); if(p) p.title=`Peers: ${n}`; }
function setOK(id, ok, onT, offT){ const c=el(id); if(!c) return; c.classList.toggle('ok',!!ok); if(onT||offT) c.title = ok?onT:offT; }
function setLockIcon(unlocked){ const svg=el('svg-lock'); if(!svg) return; svg.innerHTML = unlocked ? '<path d="M17 10V7a5 5 0 10-10 0v3h1.5V7a3.5 3.5 0 017 0v3H17zM6 11h12a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2v-7a2 2 0 012-2z"/>' : '<path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm3 8H9V7a3 3 0 016 0v3z"/>'; }

async function refreshStatus(){
  if(busy) return; busy = true;
  try{
    const s = await window.ioc.status();

    const bal = (typeof s.info?.balance==='number'?s.info.balance:(s.wallet?.balance ?? s.wallet?.walletbalance ?? last.bal)) ?? last.bal;
    last.bal = bal; el('big-balance').textContent=(Math.round(bal*1000)/1000).toLocaleString(); fitBalance();

    const stakingOn = !!(s.staking?.staking || s.staking?.enabled || s.mining?.staking);
    last.stakingOn = stakingOn; setOK('ic-stake', stakingOn, 'Staking on', 'Staking off');

    const stakeAmt = s.staking?.stake ?? s.mining?.stake ?? last.stake; last.stake = stakeAmt; el('staking').textContent = stakeAmt;

    const peers = s.peers ?? last.peers; last.peers = peers; peerBars(peers); setOK('ic-peers', peers>0, `Peers: ${peers}`, `Peers: ${peers}`);

    const lockedFlag = !!(s.lockst && s.lockst.isLocked === true);
    last.unlocked = !lockedFlag || stakingOn;
    setLockIcon(last.unlocked); setOK('ic-lock', last.unlocked, 'Wallet unlocked', 'Wallet locked');

    if(last.unlocked || stakingOn) hideModal();

    const blocks = s.chain?.blocks ?? s.height ?? last.blocks;
    const headers = s.chain?.headers ?? blocks ?? last.headers;
    last.blocks = blocks; last.headers = headers;
    const vp = (typeof s.chain?.verificationprogress === 'number') ? s.chain.verificationprogress : null;
    const pct = vp !== null ? Math.round(vp*100) : (headers ? Math.round((blocks/headers)*100) : last.pct);
    last.pct=pct; setSync(pct, `Syncing wallet (${blocks} / ${headers} blocks)`); setOK('ic-sync', pct>=100, 'Synced', 'Syncing');
  }catch{} finally{ busy=false; }
}

async function lockNow(){ try{ await window.ioc.reserve(true, 999999999); }catch{} try{ await window.ioc.lock(); }catch{} hideModal(); refreshStatus(); }
function openUnlock(){ showModal(); }
async function doUnlock(){ const p=el('pass').value; if(!p) return; try{ await window.ioc.unlock(p, 9999999); await window.ioc.reserve(false); }catch{} el('pass').value=''; hideModal(); refreshStatus(); }

async function loadHistory(){ try{ const tx=await window.ioc.listTx(50); const tbody=el('txrows'); tbody.innerHTML=''; tx.forEach(t=>{ const tr=document.createElement('tr'); const when=new Date((t.timereceived||t.time||0)*1000).toLocaleString(); const amt=(t.amount ?? 0); const addr=t.address || t.txid || ''; tr.innerHTML = `<td>${when}</td><td>${t.category||''}</td><td>${amt}</td><td title="${addr}">${addr}</td>`; tbody.appendChild(tr); }); }catch{} }

async function onLockClick(){
  try{
    const s = await window.ioc.status();
    const lockedNow = !!(s.lockst && s.lockst.isLocked === true);
    if(lockedNow) openUnlock(); else lockNow();
  }catch{ lockNow(); }
}

async function main(){
  hideModal();
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>switchTab(t.dataset.tab)));
  el('sendBtn').addEventListener('click',()=>alert('Send sheet coming next'));
  el('ic-lock').addEventListener('click', onLockClick);
  el('cancelUnlock').addEventListener('click', ()=>{ el('pass').value=''; hideModal(); });
  el('doUnlock').addEventListener('click', doUnlock);
  el('pass').addEventListener('keydown', (e)=>{ if(e.key==='Enter') doUnlock(); if(e.key==='Escape'){ el('pass').value=''; hideModal(); }});
  el('unlockModal').addEventListener('click', (e)=>{ if(e.target.id==='unlockModal'){ el('pass').value=''; hideModal(); }});
  refreshStatus(); setInterval(()=>{ refreshStatus(); if(last.unlocked||last.stakingOn) hideModal(); }, 3000);
  window.addEventListener('resize', fitBalance);
}
main();
JS
