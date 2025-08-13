const $ = id => document.getElementById(id);

let state = {unlocked: false, peers: 0};

function setSync(pct, text) {
  const bar = $('syncbar');
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
  const t = $('syncText');
  if (t) t.textContent = text || '';
  const syncChip = $('ic-sync');
  if (syncChip) syncChip.classList.toggle('ok', (pct || 0) >= 100);
}

function setPeers(n) {
  state.peers = n || 0;
  const chip = $('ic-peers');
  if (chip) chip.title = `Peers: ${state.peers}`;
  if (chip) chip.classList.toggle('ok', state.peers > 0);
}

function setLock(unlocked) {
  state.unlocked = !!unlocked;
  const p = $('p-lock');
  if (!p) return;
  if (state.unlocked) {
    p.setAttribute('d', 'M12 17a2 2 0 100-4 2 2 0 000 4zm7-6h-5V7a3 3 0 00-6 0H6a5 5 0 019.8-1H19v5zM6 11h13a1 1 0 011 1v7a1 1 0 01-1 1H6a1 1 0 01-1-1v-7a1 1 0 011-1z');
  } else {
    p.setAttribute('d', 'M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm3 8H9V7a3 3 0 016 0v3z');
  }
  const chip = $('ic-lock');
  if (chip) {
    chip.classList.toggle('ok', state.unlocked);
    chip.title = state.unlocked ? 'Wallet unlocked' : 'Wallet locked';
  }
}

function setStaking(on, weight) {
  const chip = $('ic-stake');
  if (chip) {
    chip.classList.toggle('ok', !!on);
    chip.title = on ? 'Staking on' : 'Staking off';
  }
  const s = $('staking');
  if (s) s.textContent = on ? Number(weight || 0).toLocaleString() : '0';
}

function fitBalance() {
  const box = $('bignum'), span = $('big-balance');
  if (!box || !span) return;
  const ctx = document.createElement('canvas').getContext('2d');
  const font = s => `800 ${s}px -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
  let size = 72;
  const max = box.clientWidth - 30;
  while (size > 36) {
    ctx.font = font(size);
    if (ctx.measureText(span.textContent).width <= max) break;
    size -= 2;
  }
  span.style.fontSize = size + 'px';
}

async function refresh() {
  try {
    const st = await window.ioc.status();
    const info = st?.info || {};
    const bal = Number(info.balance || info.walletbalance || 0);
    $('big-balance').textContent = (Math.round(bal * 1000) / 1000).toLocaleString();
    fitBalance();

    const blocks = st?.chain?.blocks || 0;
    const headers = st?.chain?.headers || blocks || 0;
    const vp = typeof st?.chain?.verificationprogress === 'number' ? st.chain.verificationprogress : (headers ? blocks / headers : 0);
    setSync(Math.round((vp || 0) * 100), `Syncing wallet (${blocks} / ${headers} blocks)`);

    setPeers(st?.peers || 0);

    const locked = st?.lockst?.isLocked;
    if (typeof locked === 'boolean') setLock(!locked);

    const stakingOn = !!(st?.staking?.staking || st?.staking?.enabled);
    setStaking(stakingOn, st?.staking?.weight || st?.staking?.stake || 0);
  } catch {}
}

async function loadHistory() {
  const rows = await window.ioc.listTx(50);
  const tbody = $('txrows');
  if (!tbody) return;
  tbody.innerHTML = '';
  rows.forEach(t => {
    const tr = document.createElement('tr');
    const when = new Date((t.timereceived || t.time || 0) * 1000).toLocaleString();
    tr.innerHTML = `<td>${when}</td><td>${t.category || ''}</td><td>${t.amount || 0}</td><td>${t.address || t.txid || ''}</td>`;
    tbody.appendChild(tr);
  });
}

async function loadAddrs() {
  const grid = $('addrGrid');
  if (!grid) return;
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
  const pass = ($('pass').value || '').trim();
  if (!pass) return;
  $('unlockErr').textContent = '';
  try {
    await window.ioc.rpc('walletpassphrase', [pass, 9999999]);
    await window.ioc.rpc('reservebalance', [false]);
    setTimeout(() => { setLock(true); $('unlockModal').classList.add('hidden'); $('pass').value=''; refresh(); }, 300);
  } catch {
    $('unlockErr').textContent = 'Wrong passphrase';
  }
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

function main() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  window.addEventListener('resize', fitBalance);

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

  refresh();
  setInterval(refresh, 2500);
}
document.addEventListener('DOMContentLoaded', main);
