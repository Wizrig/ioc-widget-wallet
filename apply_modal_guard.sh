#!/usr/bin/env bash
set -e

# Ensure modal starts hidden at the DOM level
python3 - <<'PY'
from pathlib import Path, re
p=Path('src/renderer/index.html')
s=p.read_text()
s=s.replace('id="unlockModal">','id="unlockModal" style="display:none;">')
p.write_text(s)
print("OK")
PY

cat > src/renderer/renderer.js <<'JS'
const el = (id) => document.getElementById(id);
let last = { bal:0, stake:0, peers:0, pct:0, blocks:0, headers:0, unlocked:false, stakingOn:false };
let busy = false;

function hideModal(){ const m=el('unlockModal'); if(m){ m.classList.add('hidden'); m.style.display='none'; } }
function showModal(){ if(last.unlocked || last.stakingOn){ hideModal(); return; } const m=el('unlockModal'); if(m){ m.classList.remove('hidden'); m.style.display='flex'; setTimeout(()=>el('pass')?.focus(),0); } }

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

    const lockst = s.lockst || {};
    const unlockedByLockst = typeof lockst.isLocked === 'boolean' ? !lockst.isLocked : last.unlocked;
    last.unlocked = unlockedByLockst || stakingOn;
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
