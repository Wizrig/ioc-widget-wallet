(function(){
  const timeout = (ms)=>new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms));
  let fails = 0;

  async function getStatusOnce(){
    try{
      const fn = (window.ioc && window.ioc.status) || (window.iocBridge && window.iocBridge.status);
      if(!fn) throw new Error('no-bridge');
      const res = await Promise.race([ fn(), timeout(700) ]);
      if (res && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('ioc:status', { detail: res }));
      }
      fails = 0;
    }catch(e){
      fails++;
      // do not emit empties; avoids UI clearing on transient errors
    }
  }

  async function loop(){
    await getStatusOnce();
    const delay = Math.min(2500, 900 + fails * 400); // gentle backoff
    setTimeout(loop, delay);
  }

  document.addEventListener('DOMContentLoaded', loop, { once:true });
})();
