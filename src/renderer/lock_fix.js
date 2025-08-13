(function(){
  const $ = (id)=>document.getElementById(id);
  const LOCK_CHIP_ID = 'ic-lock';
  const LOCK_SVG_ID  = 'svg-lock';
  let last = null, primed = false;

  function setLockVisual(unlocked){
    const chip = $(LOCK_CHIP_ID);
    const svg  = $(LOCK_SVG_ID);
    if (!chip || !svg) return;

    chip.classList.toggle('ok', !!unlocked);
    chip.title = unlocked ? 'Wallet unlocked' : 'Wallet locked';

    const openSVG =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">'+
      '<path d="M17 8h-1V7a4 4 0 10-8 0v1H7a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2v-8a2 2 0 00-2-2zm-7-1a2 2 0 114 0v1h-4V7zm3 7a2 2 0 11-2-2 2 2 0 012 2z"/></svg>';
    const closedSVG =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">'+
      '<path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm3 8H9V7a3 3 0 016 0v3zm-3 7a2 2 0 110-4 2 2 0 010 4z"/></svg>';
    svg.innerHTML = unlocked ? openSVG : closedSVG;
  }

  function computeUnlocked(st){
    if (st && st.lockst && typeof st.lockst.isLocked === 'boolean') {
      if (st.lockst.isEncrypted === false) return true;
      if (st.lockst.isEncrypted === true)  return !st.lockst.isLocked;
    }
    if (st && st.staking && typeof st.staking.enabled === 'boolean') {
      return !!st.staking.enabled; // fallback only
    }
    return null;
  }

  function onStatus(e){
    const st = e.detail || {};
    const unlocked = computeUnlocked(st);
    if (unlocked === null) return;
    if (unlocked !== last){
      last = unlocked;
      setLockVisual(unlocked);
    }
  }

  async function primeOnce(){
    try{
      if (primed) return;
      const fn = (window.ioc && window.ioc.status) || (window.iocBridge && window.iocBridge.status);
      const st = fn ? await fn() : null;
      const u = computeUnlocked(st);
      if (u !== null){ last = u; setLockVisual(u); primed = true; }
    }catch{}
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    window.addEventListener('ioc:status', onStatus);
    setTimeout(primeOnce, 600);
  }, { once:true });
})();
