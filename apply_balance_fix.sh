#!/usr/bin/env bash
set -e

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
  const { data } = await axios.post('http://127.0.0.1:33765/', { jsonrpc:'2.0', id:1, method, params }, { auth:{ username:u, password:p }, timeout:10000 });
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
const getInfo            = () => rpc('getinfo').catch(()=>({}));
module.exports = { rpc, getBlockCount, getConnectionCount, getWalletInfo, getMiningInfo, getStakingInfo, getPeerInfo, getNewAddress, sendToAddress, walletLock, walletPassphrase, listTransactions, getInfo };
JS

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
    const balDirect = s.info && typeof s.info.balance === 'number' ? s.info.balance : null;
    const balWI = s.wallet?.balance ?? s.wallet?.walletbalance ?? null;
    const bal = (balDirect ?? balWI ?? 0);
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
