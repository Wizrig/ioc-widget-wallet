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

