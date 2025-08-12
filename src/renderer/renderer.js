const el = (id) => document.getElementById(id);
let last = { bal:0, stake:0, peers:0, pct:0, blocks:0, headers:0, unlocked:false, stakingOn:false };
let busy = false, afterUnlock = null;

const hide = (n)=>{ const m=el(n); if(m){ m.style.display='none'; m.classList.add('hidden'); }};
const show = (n)=>{ const m=el(n); if(m){ m.style.display='flex'; m.classList.remove('hidden'); setTimeout(()=>m.querySelector('input')?.focus(),0); }};
const hideModal=()=>hide('unlockModal');
const showUnlock=()=>{ const e=el('unlockErr'); if(e) e.textContent=''; const s=el('unlockSheet'); if(s) s.classList.remove('shake'); show('unlockModal'); };
const hideSend=()=>hide('sendModal');
const showSend=()=>show('sendModal');

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function waitFor(pred, timeout=4000, interval=120){ const end=Date.now()+timeout; while(Date.now()<end){ try{ if(await pred()) return true; }catch{} await sleep(interval); } return false; }

async function rpc(method, params=[]){
  if(window.ioc?.rpc) return await window.ioc.rpc(method, params);
  if(window.ioc && typeof window.ioc[method]==='function') return await window.ioc[method](...params);
  return null;
}

function setSync(pct, txt){
  const b=el('syncbar'); if(b) b.style.width=(Math.max(0,Math.min(100,pct))||0)+'%';
  const t=el('syncTxt'); if(t) t.textContent=txt;
  const chip = el('ic-sync'); if(chip) chip.classList.toggle('ok', (pct||0)>=100);
}
function switchTab(name){
  document.querySelectorAll('.page').forEach(s=>s.classList.add('hidden'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el('tab-'+name).classList.remove('hidden');
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  if(name==='history') loadHistory();
}
function fitBalance(){
  const box=el('bignum'), span=el('big-balance');
  const ctx=document.createElement('canvas').getContext('2d');
  const font=(s)=>`800 ${s}px -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
  let size=parseInt(getComputedStyle(span).fontSize,10), max=box.clientWidth-28;
  while(size>36){ ctx.font=font(size); if(ctx.measureText(span.textContent).width<=max) break; size-=2; }
  span.style.fontSize=size+'px';
}
function peerBars(n){
  const bars=[8,12,15,18];
  const els=[...document.querySelectorAll('#bars .bar')];
  const on=n<=0?0:n<=2?1:n<=4?2:n<=6?3:4;
  els.forEach((e,i)=>{ e.style.height=bars[i]+'px'; e.classList.toggle('on', i<on); });
  const p=el('ic-peers'); if(p) p.title=`Peers: ${n}`;
}
function setOK(id, ok, onT, offT){
  const chip=el(id); if(!chip) return;
  chip.classList.toggle('ok', !!ok);
  if(onT||offT) chip.title = ok ? onT : offT;
}
function setLockIcon(unlocked){
  const svg=el('svg-lock'); if(!svg) return;
  svg.innerHTML = unlocked
    ? '<path d="M12 17a2 2 0 100-4 2 2 0 000 4zm7-6h-5V7a3 3 0 00-6 0h-2a5 5 0 019.8-1H19v5zM6 11h13a1 1 0 011 1v7a1 1 0 01-1 1H6a1 1 0 01-1-1v-7a1 1 0 011-1z"/>'
    : '<path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm3 8H9V7a3 3 0 016 0v3z"/>';
}

async function getLock(){
  const r = await rpc('walletlockstatus', []);
  if(r && typeof r.isLocked==='boolean') return r.isLocked;
  const s = await window.ioc.status(); return !!(s.lockst && s.lockst.isLocked===true);
}
async function getStakeInfo(){
  const r = await rpc('getstakinginfo', []);
  if(r) return r;
  const s = await window.ioc.status(); return s.staking || s.mining || {};
}

async function refreshStatus(){
  if(busy) return; busy = true;
  try{
    const [info, lockNow, stakeInfo] = await Promise.all([
      window.ioc.status().catch(()=>({})),
      getLock().catch(()=>null),
      getStakeInfo().catch(()=>({}))
    ]);

    const bal = (typeof info.info?.balance==='number'?info.info.balance:(info.wallet?.balance ?? info.wallet?.walletbalance ?? last.bal)) ?? last.bal;
    last.bal = bal; el('big-balance').textContent=(Math.round(bal*1000)/1000).toLocaleString(); fitBalance();

    const peers = info.peers ?? last.peers; last.peers = peers; peerBars(peers); setOK('ic-peers', peers>0, `Peers: ${peers}`, `Peers: ${peers}`);

    const blocks = info.chain?.blocks ?? info.height ?? last.blocks;
    const headers = info.chain?.headers ?? blocks ?? last.headers;
    last.blocks = blocks; last.headers = headers;
    const vp = (typeof info.chain?.verificationprogress === 'number') ? info.chain.verificationprogress : null;
    const pct = vp !== null ? Math.round(vp*100) : (headers ? Math.round((blocks/headers)*100) : last.pct);
    last.pct=pct; setSync(pct, `Syncing wallet (${blocks} / ${headers} blocks)`);

    const unlocked = (lockNow===false);
    last.unlocked = unlocked; setLockIcon(unlocked); setOK('ic-lock', unlocked, 'Wallet unlocked', 'Wallet locked');

    const stakingOn = !!(unlocked && (stakeInfo.staking || stakeInfo.enabled));
    last.stakingOn = stakingOn; setOK('ic-stake', stakingOn, 'Staking on', 'Staking off');

    const weight = stakingOn ? (stakeInfo.weight ?? stakeInfo.stake ?? 0) : 0;
    el('staking').textContent = stakingOn ? Number(weight).toLocaleString() : 0;
  }catch{} finally{ busy=false; }
}

async function lockNow(){
  try{ await rpc('reservebalance', [true, 999999999]).catch(()=>{}); }catch{}
  try{ await rpc('walletlock', []).catch(()=>{}); }catch{}
  await waitFor(async()=>await getLock()===true, 3000, 120);
  last.unlocked = false; last.stakingOn = false;
  setLockIcon(false); setOK('ic-lock', false, 'Wallet unlocked', 'Wallet locked'); setOK('ic-stake', false, 'Staking on', 'Staking off');
  refreshStatus();
}

function openUnlock(){ showUnlock(); }
async function doUnlock(){
  const p=(el('pass').value||'').trim(); if(!p) return;
  el('unlockErr').textContent=''; el('unlockSheet').classList.remove('shake');
  try{
    await rpc('walletpassphrase', [p, 9999999]).catch(async()=>{ if(window.ioc.unlock) return await window.ioc.unlock(p,9999999); throw new Error('fail'); });
    await rpc('reservebalance', [false]).catch(()=>{});
    const ok = await waitFor(async()=>await getLock()===false, 3500, 120);
    if(!ok) throw new Error('bad');
    el('pass').value=''; hideModal(); last.unlocked=true; setLockIcon(true); setOK('ic-lock', true, 'Wallet unlocked', 'Wallet locked'); refreshStatus();
    if(typeof afterUnlock==='function'){ const fn=afterUnlock; afterUnlock=null; setTimeout(fn, 120); }
  }catch(e){
    const err=el('unlockErr'); if(err) err.textContent='Wrong passphrase';
    const sh=el('unlockSheet'); sh.classList.remove('shake'); void sh.offsetWidth; sh.classList.add('shake');
  }
}

async function doSend(){
  const addr = (el('sendAddr')?.value||'').trim();
  const amt  = parseFloat((el('sendAmt')?.value||'').trim());
  if(!addr || !(amt>0)) return;
  try{
    if(!last.unlocked){
      afterUnlock = ()=>doSend();
      openUnlock(); return;
    }
    await (rpc('sendtoaddress',[addr,amt]) || window.ioc.sendToAddress?.(addr,amt));
    hideSend(); setTimeout(refreshStatus, 300);
    alert('Transaction submitted.');
  }catch(e){ alert('Send failed.'); }
}

async function loadHistory(){
  try{
    const tx=await (window.ioc.listTx?.(50) || rpc('listtransactions',['*',50]));
    const tbody=el('txrows'); if(!tbody || !tx) return; tbody.innerHTML='';
    tx.forEach(t=>{
      const tr=document.createElement('tr');
      const when=new Date((t.timereceived||t.time||0)*1000).toLocaleString();
      const amt=(t.amount ?? 0);
      const addr=t.address || t.txid || '';
      tr.innerHTML = `<td>${when}</td><td>${t.category||''}</td><td>${amt}</td><td title="${addr}">${addr}</td>`;
      tbody.appendChild(tr);
    });
  }catch{}
}

async function onLockClick(){
  if(last.unlocked===false){ openUnlock(); return; }
  lockNow();
}

async function main(){
  hide('unlockModal'); hide('sendModal');
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>switchTab(t.dataset.tab)));
  el('sendBtn').addEventListener('click',()=>{ showSend(); });
  el('ic-lock').addEventListener('click', onLockClick);
  el('cancelUnlock').addEventListener('click', ()=>{ el('pass').value=''; hideModal(); afterUnlock=null; });
  el('doUnlock').addEventListener('click', doUnlock);
  el('pass').addEventListener('keydown', (e)=>{ if(e.key==='Enter') doUnlock(); if(e.key==='Escape'){ el('pass').value=''; hideModal(); afterUnlock=null; }});
  el('cancelSend').addEventListener('click', ()=>{ hideSend(); });
  el('doSend').addEventListener('click', doSend);
  ['sendModal','unlockModal'].forEach(id=>{ el(id).addEventListener('click', (e)=>{ if(e.target.id===id){ hide(id); }}); });
  refreshStatus(); setInterval(refreshStatus, 2500);
  window.addEventListener('resize', fitBalance);
}
main();
