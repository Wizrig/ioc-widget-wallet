const fs=require('fs');const os=require('os');const path=require('path');
let win=null,pos=0,tip=0,best=0,peers=0,staking=null,locked=null,lastTouch=0;
function dataDir(){if(process.platform==='darwin')return path.join(os.homedir(),'Library','Application Support','IOCoin');if(process.platform==='win32')return path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'IOCoin');return path.join(os.homedir(),'.iocoin')}
const LOG=path.join(dataDir(),'debug.log');
function parse(s){
  const hs=[...s.matchAll(/SetBestChain:\s+new best=.*?\sheight=(\d+)/g)]; if(hs.length){tip=Math.max(tip,parseInt(hs[hs.length-1][1],10)); lastTouch=Date.now()}
  const bs=[...s.matchAll(/\breceive version message: .*?blocks=(\d+)/g)]; if(bs.length){best=Math.max(best,parseInt(bs[bs.length-1][1],10))}
  const inc=(s.match(/connected [\[\]0-9a-fA-F\.:]+:\d+/g)||[]).length; const dec=(s.match(/disconnecting node /g)||[]).length; if(inc||dec){peers=Math.max(0,peers+inc-dec)}
  if(/ThreadStakeMiner started|Staking:\s*true/i.test(s)) staking=true;
  if(/ThreadStakeMiner exiting|Staking:\s*false/i.test(s)) staking=false;
  if(/wallet locked/i.test(s)) locked=true;
  if(/wallet unlocked/i.test(s)) locked=false;
}
function readOnce(){
  try{
    const st=fs.statSync(LOG); if(st.size<pos) pos=0;
    if(st.size>pos){
      const fd=fs.openSync(LOG,'r'); const buf=Buffer.alloc(st.size-pos); fs.readSync(fd,buf,0,buf.length,pos); fs.closeSync(fd); pos=st.size;
      parse(buf.toString('utf8')); emit();
    }
  }catch{}
}
function emit(){ if(!win) return; const target=Math.max(best,tip); try{win.webContents.send('ioc:sync-tick',{height:tip,tip:target,peers,staking,locked,ts:Date.now()})}catch{} }
function attach(w){
  win=w;
  try{ const st=fs.statSync(LOG); pos=Math.max(0,st.size-1048576); const fd=fs.openSync(LOG,'r'); const b=Buffer.alloc(st.size-pos); fs.readSync(fd,b,0,b.length,pos); fs.closeSync(fd); pos=st.size; parse(b.toString('utf8')); emit(); }catch{}
  const watcher=fs.watch(LOG,readOnce); const timer=setInterval(()=>{ if(Date.now()-lastTouch>2000) readOnce() },1000);
  const stop=()=>{ try{watcher.close()}catch{} clearInterval(timer) };
  process.on('exit',stop);
}
module.exports={attach};
