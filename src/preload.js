const { contextBridge, ipcRenderer } = require('electron');

function rpc(method, params = []) {
  return ipcRenderer.invoke('ioc:rpc', method, params);
}
function status() {
  return ipcRenderer.invoke('ioc:status');
}

contextBridge.exposeInMainWorld('ioc', { rpc, status });
// Back-compat alias some of your code uses:
contextBridge.exposeInMainWorld('callRpc', rpc);
try{
  const {ipcRenderer}=require('electron')
  let lastH=0,lastT=0,lastP=-1
  function q(sel){ return document.querySelector(sel) }
  function pick(){ return q('[data-ioc="sync"]')||q('#syncText')||q('#sync') }
  function pickBar(){ return q('[data-ioc="syncbar"]')||q('#syncbar') }
  ipcRenderer.on('ioc:sync-tick',(_e,d)=>{
    const tEl=pick(), bEl=pickBar()
    if(tEl && (d.height!==lastH || d.tip!==lastT)){
      if(d.tip>0){ tEl.textContent=`Syncing wallet (${d.height} / ${d.tip} blocks)` } else { tEl.textContent=`Syncing wallet (${d.height} blocks)` }
      lastH=d.height; lastT=d.tip
    }
    if(bEl && d.tip>0){
      const pct=Math.max(0,Math.min(100,(d.height/d.tip)*100))
      bEl.style.width=pct.toFixed(2)+'%'; bEl.setAttribute('aria-valuenow',pct.toFixed(2))
    }
    const pEl=q('[data-ioc="peers"]')||q('#peers')||q('#peersCount')
    if(pEl && d.peers!==lastP){ pEl.textContent=String(d.peers||0); lastP=d.peers }
    const lEl=q('[data-ioc="lock"]')||q('#lockIcon'); if(lEl!=null && d.locked!=null){ lEl.classList.toggle('ioc-locked',!!d.locked); lEl.classList.toggle('ioc-unlocked',!d.locked) }
    const sEl=q('[data-ioc="staking"]')||q('#staking'); if(sEl!=null && d.staking!=null){ sEl.setAttribute('data-state',d.staking?'on':'off') }
  })
}catch(e){}
