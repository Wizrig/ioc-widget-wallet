const $ = id => document.getElementById(id);

let state = { unlocked: false, peers: 0 };
let refreshing = false;
let nextTimer = null;
let last = { bal: null, stakeAmt: null, stakeOn: null, vp: 0 };

function setSync(pct, text) {
  const bar = $('syncbar'); if (bar) bar.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
  const t = $('syncText'); if (t) t.textContent = text || '';
  const syncChip = $('ic-sync'); if (syncChip) syncChip.classList.toggle('ok', (pct || 0) >= 100);
}

function setPeers(n) {
  state.peers = n || 0;
  const chip = $('ic-peers');
  if (chip) { chip.title = `Peers: ${state.peers}`; chip.classList.toggle('ok', state.peers > 0); }
}

function setLock(unlocked) {
  state.unlocked = !!unlocked;
  const p = $('p-lock'); if (!p) return;
  if (state.unlocked) {
    p.setAttribute('d', 'M9 10V7a3 3 0 0 1 6 0h2a5 5 0 1 0-10 0v3H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H9zm3 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4z');
  } else {
    p.setAttribute('d', 'M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm3 8H9V7a3 3 0 016 0v3z');
  }
  const chip = $('ic-lock');
  if (chip) { chip.classList.toggle('ok', state.unlocked); chip.title = state.unlocked ? 'Wallet unlocked' : 'Wallet locked'; }
}

function setStaking(on, amount) {
  const chip = $('ic-stake'); if (chip) { chip.classList.toggle('ok', !!on); chip.title = on ? 'Staking on' : 'Staking off'; }
  const s = $('staking'); if (s) s.textContent = on ? Number(amount || 0).toLocaleString() : '0';
}

let __resizeRAF=null;
function fitBalance() {
  const box = $('bignum'), span = $('big-balance');
  if (!box || !span) return;
  const ctx = document.createElement('canvas').getContext('2d');
  const font = s => `800 ${s}px -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
  let size = 72, max = box.clientWidth - 30;
  while (size > 36) { ctx.font = font(size); if (ctx.measureText(span.textContent).width <= max) break; size -= 2; }
  span.style.fontSize = size + 'px';
}

function scheduleRefresh(ms) {
  if (nextTimer) clearTimeout(nextTimer);
  nextTimer = setTimeout(refresh, ms);
}

async function refresh() {
  if (refreshing) return; // prevent overlap
  refreshing = true;
  try {
    const st = await window.ioc.status();
    const info = st?.info || {};
    const bal = Number(info.balance || info.walletbalance || 0);

    if (last.bal !== bal) {
      const el = $('big-balance');
      if (el) el.textContent = (Math.round(bal * 1000) / 1000).toLocaleString();
      last.bal = bal; fitBalance();
    }

    const blocks = st?.chain?.blocks || 0;
    const headers = st?.chain?.headers || blocks || 0;
    const vp = typeof st?.chain?.verificationprogress === 'number' ? st.chain.verificationprogress : (headers ? blocks / headers : 0);
    const pct = Math.round((vp || 0) * 100);
    if (last.vp !== vp) {
      setSync(pct, `Syncing wallet (${blocks} / ${headers} blocks)`);
      last.vp = vp;
    }

    setPeers(st?.peers || 0);

    const locked = st?.lockst?.isLocked;
    if (typeof locked === 'boolean') setLock(!locked);

    // staking ON flag (unchanged)
    const stakingOn = !!(st?.staking?.staking || st?.staking?.enabled);
    // staking AMOUNT (prefer getinfo.stake, fallback to getstakinginfo fields)
    const stakingAmt = Number(
      (typeof info.stake !== 'undefined') ? info.stake :
      (st?.staking && typeof st.staking.stake !== 'undefined') ? st.staking.stake :
      (st?.staking && typeof st.staking.stakingbalance !== 'undefined') ? st.staking.stakingbalance : 0
    );

    if (stakingOn !== last.stakeOn || stakingAmt !== last.stakeAmt) {
      setStaking(stakingOn, stakingAmt);
      last.stakeOn = stakingOn; last.stakeAmt = stakingAmt;
    }
  } catch {}
  finally {
    refreshing = false;
    // Adaptive polling: faster while syncing, slower when synced; extra-slow when tab/window hidden
    const isHidden = document.hidden;
    const vp = last.vp || 0;
    const base = vp < 0.999 ? 1500 : 4000;
    const delay = isHidden ? Math.max(base, 10000) : base;
    scheduleRefresh(delay);
  }
}

async function loadHistory() {
  const rows = await window.ioc.listTx(50);
  const tbody = $('txrows'); if (!tbody) return;
  tbody.innerHTML = '';
  rows.forEach(t => {
    const tr = document.createElement('tr');
    const when = new Date((t.timereceived || t.time || 0) * 1000).toLocaleString();
    tr.innerHTML = `<td>${when}</td><td>${t.category || ''}</td><td>${t.amount || 0}</td><td>${t.address || t.txid || ''}</td>`;
    tbody.appendChild(tr);
  });
}

async function loadAddrs() {
  const grid = $('addrGrid'); if (!grid) return;
  grid.innerHTML = '';
  const xs = await window.ioc.listAddrs();
  xs.forEach(x => {
    const card = document.createElement('div');
    card.className = 'addr-card';
    card.innerHTML = `<div class="label">${x.label || 'Address'}</div>
      <div class="addr" title="Balance: ${Number(x.amount || 0).toLocaleString()}">${x.address}</div>`;
    grid.appendChild(card);
  });
}

function switchTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  $('tab-' + name).classList.remove('hidden');
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  if (name === 'history') loadHistory();
  if (name === 'address') loadAddrs();
}

async function doUnlock() {
  const pass = ($('pass').value || '').trim(); if (!pass) return;
  $('unlockErr').textContent = '';
  try {
    await window.ioc.rpc('walletpassphrase', [pass, 9999999]);
    await window.ioc.rpc('reservebalance', [false]);
    setTimeout(() => { setLock(true); $('unlockModal').classList.add('hidden'); $('pass').value=''; refresh(); }, 300);
  } catch { $('unlockErr').textContent = 'Wrong passphrase'; }
}

async function onLockClick() {
  if (state.unlocked) {
    try {
      await window.ioc.rpc('reservebalance', [true, 999999999]);
      await window.ioc.rpc('walletlock', []);
      setLock(false);
      setStaking(false, 0);
      refresh();
    } catch {}
  } else {
    $('unlockModal').classList.remove('hidden');
    setTimeout(() => $('pass').focus(), 0);
  }
}

/** New Address flow */
function openNewAddrModal() {
  $('newLabel').value = '';
  $('newAddrErr').textContent = '';
  $('newAddrResult').classList.add('hidden');
  $('newAddrResult').textContent = '';
  $('newAddrModal').classList.remove('hidden');
  setTimeout(() => $('newLabel').focus(), 0);
}

async function createNewAddr() {
  const label = ($('newLabel').value || '').trim();
  $('newAddrErr').textContent = '';
  const res = await window.ioc.newAddr(label);
  if (!res?.ok) { $('newAddrErr').textContent = 'Could not create address (daemon not ready?)'; return; }
  const out = $('newAddrResult');
  out.textContent = res.address;
  out.classList.remove('hidden');
  setTimeout(loadAddrs, 300);
  setTimeout(() => { $('newAddrModal').classList.add('hidden'); }, 1200);
}

function main() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  window.addEventListener('resize',()=>{if(__resizeRAF)cancelAnimationFrame(__resizeRAF);__resizeRAF=requestAnimationFrame(()=>{__resizeRAF=null;fitBalance();});});

  document.addEventListener('visibilitychange', () => {
    // When returning to the app, refresh immediately; when hiding, the next tick will stretch.
    if (!document.hidden) refresh();
  });

  $('ic-lock').addEventListener('click', onLockClick);
  $('cancelUnlock').addEventListener('click', () => { $('unlockModal').classList.add('hidden'); $('pass').value=''; });
  $('doUnlock').addEventListener('click', doUnlock);
  $('pass').addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock(); if (e.key === 'Escape') {$('unlockModal').classList.add('hidden');} });

  $('sendBtn').addEventListener('click', () => $('sendModal').classList.remove('hidden'));
  $('cancelSend').addEventListener('click', () => $('sendModal').classList.add('hidden'));
  $('doSend').addEventListener('click', async () => {
    const a = ($('sendAddr').value||'').trim();
    const n = parseFloat(($('sendAmt').value||'').trim());
    if (!a || !(n>0)) return;
    if (!state.unlocked) { $('unlockModal').classList.remove('hidden'); return; }
    try { await window.ioc.rpc('sendtoaddress', [a, n]); $('sendModal').classList.add('hidden'); setTimeout(refresh, 400); } catch {}
  });

  $('newAddrBtn').addEventListener('click', openNewAddrModal);
  $('cancelNewAddr').addEventListener('click', () => $('newAddrModal').classList.add('hidden'));
  $('createNewAddr').addEventListener('click', createNewAddr);
  $('newLabel').addEventListener('keydown', e => { if (e.key === 'Enter') createNewAddr(); if (e.key === 'Escape') {$('newAddrModal').classList.add('hidden');}});

  // Kick off the adaptive loop
  refresh();
}
document.addEventListener('DOMContentLoaded', main);

;(function(){
  function q(id){return document.getElementById(id)}
  async function rpc(m, a){ try { return await window.ioc.rpc(m, a||[]) } catch(e){ throw e } }

  function setupWalletTools(){
    var d=q('btnDump'), imp=q('btnImport'), op=q('btnOpenPath');
    if (op && window.sys) op.addEventListener('click', function(){ window.sys.openFolder() });

    if (d) d.addEventListener('click', async function(){
      var pass = prompt('Enter wallet passphrase');
      if (!pass) return;
      var path = prompt('Enter full .txt path to save (e.g. /Users/you/Desktop/wallet_dump.txt)');
      if (!path || !/\.txt$/i.test(path)) { alert('Path must end with .txt'); return; }
      try {
        await rpc('walletpassphrase',[pass,60]);
        await rpc('dumpwalletRT',[path]);
        alert('Dump complete to:\n'+path);
      } catch(e){ alert('Dump failed'); }
      try{ await rpc('walletlock',[]) }catch(e){}
    });

    if (imp) imp.addEventListener('click', async function(){
      var pass = prompt('Enter wallet passphrase');
      if (!pass) return;
      var path = prompt('Enter full path of dump .txt to import');
      if (!path || !/\.txt$/i.test(path)) { alert('Path must end with .txt'); return; }
      try {
        await rpc('walletpassphrase',[pass,120]);
        await rpc('importwallet',[path]);
        alert('Import started');
      } catch(e){ alert('Import failed'); }
      try{ await rpc('walletlock',[]) }catch(e){}
    });
  }

  function setupLiveTail(){
    var box=q('live-tail'), st=q('start-tail'), sp=q('stop-tail');
    if (!box || !st || !sp || !window.diag) return;
    window.diag.onData(function(line){ box.textContent += line; box.scrollTop = box.scrollHeight; });
    st.addEventListener('click', function(){ window.diag.startTail() });
    sp.addEventListener('click', function(){ window.diag.stopTail() });
  }

  function init(){ setupWalletTools(); setupLiveTail(); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* IOC_WIDGET_TOOLS_MODAL_HOOK */
function __ioc_modal(opts){
  return new Promise(function(res){
    var wrap=document.createElement('div');wrap.style.position='fixed';wrap.style.inset='0';wrap.style.background='rgba(0,0,0,.45)';wrap.style.display='flex';wrap.style.alignItems='center';wrap.style.justifyContent='center';wrap.style.zIndex='9999';
    var box=document.createElement('div');box.style.background='#0e141b';box.style.border='1px solid #12343b';box.style.borderRadius='12px';box.style.padding='16px 18px';box.style.minWidth='340px';box.style.boxShadow='0 10px 30px rgba(0,0,0,.45)';
    var h=document.createElement('div');h.textContent=opts&&opts.title?opts.title:'Input';h.style.color='#cbd5df';h.style.fontWeight='600';h.style.margin='0 0 10px';h.style.textAlign='center';
    var inp=document.createElement('input');inp.type=(opts&&opts.type)||'text';inp.placeholder=(opts&&opts.placeholder)||'';inp.value=(opts&&opts.value)||'';inp.style.width='100%';inp.style.padding='10px';inp.style.borderRadius='8px';inp.style.border='1px solid #243541';inp.style.background='#0b1117';inp.style.color='#e6f2f1';
    var row=document.createElement('div');row.style.display='flex';row.style.gap='10px';row.style.marginTop='12px';row.style.justifyContent='center';
    var ok=document.createElement('button');ok.textContent='OK';ok.className='btn';
    var ca=document.createElement('button');ca.textContent='Cancel';ca.className='btn';
    ok.onclick=function(){var v=inp.value;document.body.removeChild(wrap);res(v||null);};
    ca.onclick=function(){document.body.removeChild(wrap);res(null);};
    inp.addEventListener('keydown',function(e){if(e.key==='Enter')ok.click();if(e.key==='Escape')ca.click();});
    row.appendChild(ok);row.appendChild(ca);box.appendChild(h);box.appendChild(inp);box.appendChild(row);wrap.appendChild(box);document.body.appendChild(wrap);setTimeout(function(){inp.focus();inp.select&&inp.select();},0);
  });
}
function __ioc_defaultDumpPath(){
  var d=new Date(),y=d.getFullYear(),m=('0'+(d.getMonth()+1)).slice(-2),da=('0'+d.getDate()).slice(-2);
  return '/tmp/ioc-wallet-dump-'+y+m+da+'.txt';
}
async function __ioc_dump(){
  try{
    var pass=await __ioc_modal({title:'Enter wallet passphrase',type:'password',placeholder:'passphrase'}); if(!pass) return;
    var path=await __ioc_modal({title:'Save dump as absolute path (.txt) — no ~',type:'text',value:__ioc_defaultDumpPath()}); if(!path) return;
    if (/^~\//.test(path)) { alert('Use a full absolute path (no ~). Example: '+__ioc_defaultDumpPath()); return; }
    try{ await window.ioc.rpc('walletpassphrase',[pass,300]); }catch(_){}
    try{ await window.ioc.rpc('dumpwalletRT',[path]); }
    catch(e1){
      var msg=''+(e1&&e1.message?e1.message:e1);
      if(/not.*found/i.test(msg)){ await window.ioc.rpc('dumpwallet',[path]); }
      else { alert('Dump failed: '+msg); return; }
    }
    try{ await window.ioc.rpc('walletlock',[]); }catch(_){}
    alert('Dump written to:\n'+path);
  }catch(e){ alert('Dump failed'); }
}
async function __ioc_import(){
  try{
    var path=await __ioc_modal({title:'Absolute path to dump (.txt) — no ~',type:'text',placeholder:'/full/path/to/wallet-dump.txt'});
    if(!path) return;
    if (/^~\//.test(path)) { alert('Use a full absolute path (no ~)'); return; }
    await window.ioc.rpc('importwallet',[path]);
    alert('Import started:\n'+path);
  }catch(e){ alert('Import failed'); }
}
document.addEventListener('DOMContentLoaded',function(){
  var d=document.getElementById('btnDump'); if(d&&!d.__wired){ d.addEventListener('click',function(ev){ev.preventDefault();__ioc_dump();}); d.__wired=1; }
  var i=document.getElementById('btnImport'); if(i&&!i.__wired){ i.addEventListener('click',function(ev){ev.preventDefault();__ioc_import();}); i.__wired=1; }
});
/* END_IOC_WIDGET_TOOLS_MODAL_HOOK */

;(()=>{let __lastBeat=Date.now();const __kick=()=>{try{refresh();}catch(e){}};const __mark=()=>{__lastBeat=Date.now()};document.addEventListener('click',()=>{setTimeout(__kick,0)},true);const __hb=setInterval(()=>{if(Date.now()-__lastBeat>6000){__kick()}},3000);const __orig_refresh=refresh;refresh=async function(){try{await __orig_refresh()}finally{__mark()}}})();

;(()=>{if(window.__iocSyncHB)return;window.__iocSyncHB=true;setInterval(()=>{try{if(!document.hidden)refresh();}catch(e){}},4000);window.addEventListener('focus',()=>{try{refresh();}catch(e){}});})();
;(()=>{if(window.__SYNC_WATCHDOG)return;window.__SYNC_WATCHDOG=true;let __lastSyncTs=0;const __mark=()=>{__lastSyncTs=Date.now()};const __kick=()=>{try{refresh()}catch(e){}};const __wd=()=>{if(Date.now()-__lastSyncTs>5000){__kick()}};setInterval(__wd,2500);document.addEventListener('click',e=>{const t=e.target.closest&&e.target.closest('.tab');if(t){setTimeout(__kick,0)}},true);const _r=refresh;refresh=async function(){try{return await _r.apply(this,arguments)}finally{__mark()}}})();
;(()=>{ if (window.__SYNC_TICK) return; window.__SYNC_TICK = true;
  const kick = ()=>{ try { if (typeof refresh==='function') refresh(); } catch(e){} };
  setInterval(kick, 2500);
  window.addEventListener('focus', kick, {once:false});
  document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) kick(); }, true);
})();
;(()=>{if(window.__SYNC_PINGER)return;window.__SYNC_PINGER=true;
const kick=()=>{try{if(typeof refresh==='function'){refresh();return}}catch(e){}try{
  const tab=document.querySelector('.tab[aria-selected="true"]');
  if(tab && /overview/i.test(tab.textContent||'')) tab.click();
}catch(e){}};
setInterval(kick,3000);window.addEventListener('focus',kick);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)kick();},true);
})();
;(()=>{if(window.__SYNC_RPC__)return;window.__SYNC_RPC__=true;
const rpc=(n,a=[])=>new Promise(res=>{let done=false;const to=setTimeout(()=>{if(!done){done=true;res(null)}},3000);try{const f=(window.ioc&&typeof window.ioc.rpc==='function')?window.ioc.rpc(n,a):null;if(!f){clearTimeout(to);return res(null)}f.then(v=>{if(!done){done=true;clearTimeout(to);res(v)}}).catch(()=>{if(!done){done=true;clearTimeout(to);res(null)}})}catch(e){clearTimeout(to);res(null)}});
const tick=async()=>{const local=await rpc('getblockcount');let net=await rpc('getnumblocksofpeers');if(!(net>0)){const mi=await rpc('getmininginfo');if(mi&&mi.blocks)net=mi.blocks}if(!(net>=0))net=0;if(!(local>=0))net=local||0;if(net<local)net=local;const pct=net?Math.round((local/net)*100):0;if(typeof setSync==='function'){setSync(pct,`Syncing wallet (${local||0} / ${net||0} blocks)`)}else{const t=document.getElementById('syncText');if(t)t.textContent=`Syncing wallet (${local||0} / ${net||0} blocks)`;const b=document.getElementById('syncbar');if(b)b.style.width=(pct||0)+'%'}};
setInterval(tick,3000);window.addEventListener('focus',()=>{setTimeout(tick,0)});document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});setTimeout(tick,200);
})();function __ensureHistoryScroller(){
  const pane = document.querySelector('#history-pane');
  if(!pane) return;
  let scroller = pane.querySelector('.history-scroller');
  if(!scroller){
    const table = pane.querySelector('table');
    if(!table) return;
    scroller = document.createElement('div');
    scroller.className = 'history-scroller';
    const parent = table.parentNode;
    parent.replaceChild(scroller, table);
    scroller.appendChild(table);
  }
  const rect = pane.getBoundingClientRect();
  const available = Math.max(260, window.innerHeight - rect.top - 160);
  scroller.style.maxHeight = available + 'px';
}
window.addEventListener('resize', __ensureHistoryScroller);
document.addEventListener('DOMContentLoaded', __ensureHistoryScroller);
window.addEventListener('hashchange', __ensureHistoryScroller);
new MutationObserver(__ensureHistoryScroller).observe(document.documentElement,{subtree:true,childList:true});

(() => {
  console.log("BACKUP button injector runs here");
})();


/* ===== Wallet Tools layout normalizer ===== */
(() => {
  const normalizeWalletTools = () => {
    // Find the Wallet Tools button row
    const tools =
      document.querySelector('[data-panel="wallet-tools"]') ||
      document.getElementById('wallet-tools') ||
      Array.from(document.querySelectorAll('.panel,.card,.group,.section'))
        .find(el => /wallet\s*tools/i.test(el.textContent || ''));

    if (!tools) return false;

    let row = tools.querySelector('.btn-row');
    if (!row) {
      row = tools.querySelector('div');
    }
    if (!row) return false;

    // Row layout
    row.style.display = 'flex';
    row.style.flexWrap = 'wrap';
    row.style.justifyContent = 'center';
    row.style.gap = '16px';

    // Normalize every button inside Wallet Tools
    const btns = Array.from(row.querySelectorAll('button'));
    btns.forEach(b => {
      b.style.flex = '0 0 auto';   // don't stretch
      b.style.width = 'auto';
      b.style.minWidth = '';       // clear any minWidth left over
      b.style.padding = '6px 16px';
      b.style.margin = '0';
      b.style.boxSizing = 'border-box';
    });

    // Ensure our BACKUP button specifically is not wider than others
    const backup = document.getElementById('backupWalletBtn');
    if (backup) {
      backup.style.flex = '0 0 auto';
      backup.style.width = 'auto';
      backup.style.minWidth = '';
      backup.style.padding = '6px 16px';
    }

    return true;
  };

  // Run now and also when Settings mounts
  if (!normalizeWalletTools()) {
    const mo = new MutationObserver(() => { if (normalizeWalletTools()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(normalizeWalletTools, 500);
    setTimeout(normalizeWalletTools, 1200);
  }
})();
/// ===== end normalizer =====


(function(){
  if(window.__accentRuntimeInit)return; window.__accentRuntimeInit=true;

  function ensureStyle(){
    if(document.getElementById('accent-style')) return;
    var css = `
:root{--accent:#20e0d0}
.btn,.btn.primary{background:var(--accent) !important;border-color:var(--accent) !important}
.btn:hover{filter:brightness(1.05)}
.tab.is-active,.tab.active{box-shadow:0 0 0 2px var(--accent) inset !important}
.rule-accent,.accent{background:var(--accent) !important}
#syncbar{background:var(--accent) !important}
svg [data-accent="fill"]{fill:var(--accent) !important}
svg [data-accent="stroke"]{stroke:var(--accent) !important}
#accentPick{width:44px;height:32px;border:1px solid var(--border,#293442);border-radius:6px;background:#0e1420;padding:0}
.accent-row{display:flex;gap:10px;align-items:center;margin-top:8px}
.theme-card{margin-top:14px}
.theme-card .card-title{font-weight:600;margin-bottom:8px}
`;
    var el = document.createElement('style'); el.id='accent-style'; el.textContent = css; document.head.appendChild(el);
  }

  function setAccent(c){
    document.documentElement.style.setProperty('--accent', c);
    try{ localStorage.setItem('accent', c) }catch(e){}
  }
  function getAccent(){
    try{ return localStorage.getItem('accent') || '' }catch(e){ return '' }
  }

  function injectSettings(){
    var tab = document.getElementById('tab-settings');
    if(!tab || document.getElementById('accentPick')) return;

    var card = document.createElement('div');
    card.className = 'card theme-card';
    card.innerHTML =
      '<div class="card-title">Theme</div>' +
      '<div class="accent-row">' +
        '<input type="color" id="accentPick" value="#2da1dd">' +
        '<button id="accentApply" class="btn">APPLY</button>' +
        '<button id="accentReset" class="btn">RESET</button>' +
      '</div>';

    // Prefer placing after Wallet Tools; else append at end
    var anchor = Array.from(tab.querySelectorAll('.card,.section')).find(x=>{
      return /wallet\s*tools/i.test(x.textContent||'');
    });
    if(anchor && anchor.parentNode){
      anchor.parentNode.insertBefore(card, anchor.nextSibling);
    }else{
      tab.appendChild(card);
    }

    var saved = getAccent();
    if(saved){ setAccent(saved); var p=document.getElementById('accentPick'); if(p) p.value=saved; }

    var a = document.getElementById('accentApply');
    if(a){ a.addEventListener('click', function(){
      var v = (document.getElementById('accentPick')||{}).value || '#2da1dd';
      setAccent(v);
    });}
    var r = document.getElementById('accentReset');
    if(r){ r.addEventListener('click', function(){
      setAccent('#20e0d0');
      var p=document.getElementById('accentPick'); if(p) p.value='#20e0d0';
    });}
  }

  function init(){
    ensureStyle();
    var saved = getAccent(); if(saved) setAccent(saved);
    injectSettings();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init, {once:true});
  }else{
    init();
  }
})();


// === Global Accent Recolor (teal -> var(--accent)) ===
(function(){
  if (window.__accentGlobalRecolor) return; window.__accentGlobalRecolor = true;

  // Old teal palette (hex & rgb variants) we want to override
  const TEALS_HEX = new Set([
    '#20e0d0','#1fe0d0','#21dfd0','#20dfcf','#22e1d1','#2ae2d4','#14e1d0',
    '#24e0d1','#23e0d1'
  ].map(s=>s.toLowerCase()));

  // Parse "rgb(...)" or "rgba(...)" to [r,g,b,a]
  function toRGBA(s){
    if(!s) return null;
    s = (''+s).trim().toLowerCase();
    const m = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)$/i);
    if(!m) return null;
    return [parseInt(m[1]),parseInt(m[2]),parseInt(m[3]), m[4]==null?1:parseFloat(m[4])];
  }
  function rgbToHex([r,g,b]) {
    return '#' + [r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  // Is “roughly teal”? (tolerance for slight theme variations)
  function approxTeal(r,g,b){
    // target ~ (32,224,208)
    const t = [32,224,208], tol = 20;
    return Math.abs(r-t[0])<=tol && Math.abs(g-t[1])<=tol && Math.abs(b-t[2])<=tol;
  }
  function isTealColor(val) {
    if(!val) return false;
    let v = (''+val).trim().toLowerCase();
    if (TEALS_HEX.has(v)) return true;
    const rgba = toRGBA(v);
    if (rgba){
      const [r,g,b] = rgba;
      if (approxTeal(r,g,b)) return true;
      const hex = rgbToHex([r,g,b]);
      if (TEALS_HEX.has(hex)) return true;
    }
    return false;
  }

  // Box-shadow can carry color strings; replace teal-like pieces
  function normalizeShadow(sh){
    if(!sh) return sh;
    let v = (''+sh);
    // Replace any rgb(a) teal-ish with var(--accent)
    v = v.replace(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[0-9.]+)?\s*\)/gi, (m)=>{
      const rgba = toRGBA(m);
      return (rgba && approxTeal(rgba[0],rgba[1],rgba[2])) ? 'var(--accent)' : m;
    });
    // Replace direct hex teals
    TEALS_HEX.forEach(hex=>{
      v = v.replace(new RegExp(hex,'gi'),'var(--accent)');
    });
    return v;
  }

  // Apply inline overrides to any element that uses teal
  const COLOR_PROPS = [
    'color','backgroundColor','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','outlineColor'
  ];
  function recolorElement(el){
    try{
      const cs = getComputedStyle(el);
      let changed = false;

      // Colors
      COLOR_PROPS.forEach(prop=>{
        const val = cs[prop];
        if (isTealColor(val)) {
          el.style[prop] = 'var(--accent)';
          changed = true;
        }
      });

      // Box shadow
      if (cs.boxShadow && /rgb|#/.test(cs.boxShadow)) {
        const replaced = normalizeShadow(cs.boxShadow);
        if (replaced !== cs.boxShadow) {
          el.style.boxShadow = replaced;
          changed = true;
        }
      }

      // SVG: map teal fills/strokes to currentColor, then set color to var(--accent)
      if (el.tagName === 'SVG' || el.querySelector && el.querySelector('svg')){
        const svgs = el.tagName==='SVG' ? [el] : el.querySelectorAll('svg');
        svgs.forEach(svg=>{
          svg.querySelectorAll('*').forEach(n=>{
            const gs = getComputedStyle(n);
            const f = gs.fill, st = gs.stroke;
            if (isTealColor(f)) { n.style.fill = 'currentColor'; svg.style.color='var(--accent)'; changed=true; }
            if (isTealColor(st)) { n.style.stroke = 'currentColor'; svg.style.color='var(--accent)'; changed=true; }
          });
        });
      }

      return changed;
    }catch(e){ return false; }
  }

  function walk(root){
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    let node = root.nodeType===1 ? root : walker.nextNode();
    if(root.nodeType===1) recolorElement(root);
    while(node = walker.nextNode()){
      recolorElement(node);
    }
  }

  function recolorAll(){ walk(document.body || document); }

  // Observe future DOM changes so new nodes get the accent too
  const mo = new MutationObserver((muts)=>{
    for(const m of muts){
      for(const n of m.addedNodes){
        if (n.nodeType===1) walk(n);
      }
    }
  });

  if (document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', ()=>{
      recolorAll();
      try{ mo.observe(document.body, {childList:true, subtree:true}); }catch(e){}
    }, {once:true});
  } else {
    recolorAll();
    try{ mo.observe(document.body, {childList:true, subtree:true}); }catch(e){}
  }
})();





/* ===== BACKUP button injector (clean, single handler, no status text) ===== */
(()=>{ if(window.__IOC_BACKUP_ONE) return; window.__IOC_BACKUP_ONE = true;
  const getInvoke = () => (
    (window.electron && window.electron.ipcRenderer && window.electron.ipcRenderer.invoke) ? window.electron.ipcRenderer.invoke.bind(window.electron.ipcRenderer)
    : (window.api && window.api.invoke) ? window.api.invoke.bind(window.api)
    : null
  );
  function install(){
    const panel = document.querySelector('[data-panel="wallet-tools"]') || document;
    const btns  = Array.from(panel.querySelectorAll('button,.btn'));
    const open  = btns.find(b => ((b.textContent||'').trim().toUpperCase())==='IOC FOLDER')
               || btns.find(b => /OPEN DEFAULT PATH/i.test(b.textContent||''));
    if(!open) return false;

    let bak = document.getElementById('backupWalletBtn');
    if(!bak){
      bak = document.createElement('button');
      bak.id = 'backupWalletBtn';
      bak.className = open.className || 'btn';
      bak.textContent = 'BACKUP';
      open.parentElement && open.parentElement.insertBefore(bak, open.nextSibling);
    }
    if(bak.__wired) return true;
    bak.__wired = true;
    bak.addEventListener('click', async (e)=>{
      e.preventDefault();
      const invoke = getInvoke(); if(!invoke) return;
      bak.disabled = true;
      try { await invoke('ioc:wallet:backup'); } finally { bak.disabled = false; }
    }, true);
    return true;
  }
  if(!install()){
    const mo = new MutationObserver(()=>{ if(install()) mo.disconnect(); });
    mo.observe(document.documentElement, {childList:true, subtree:true});
  }
})();
/// ===== end injector =====


