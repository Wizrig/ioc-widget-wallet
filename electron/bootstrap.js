const {app,BrowserWindow}=require('electron');
const {spawn}=require('child_process');
const fs=require('fs');
const path=require('path');

const APP_DIR=process.env.APP_DIR;
const LOG=process.env.LOG;

let splash,launched=false,last=0;

function showSplash(){
  splash=new BrowserWindow({width:380,height:220,frame:false,resizable:false,alwaysOnTop:true,backgroundColor:'#0b131a',show:true});
  const html='<!doctype html><meta charset=utf-8><style>html,body{margin:0;height:100%;background:#0f1820;color:#bfefff;display:flex;justify-content:center;align-items:center;font-family:-apple-system,system-ui,Segoe UI,Roboto,Inter,Helvetica,Arial,sans-serif}.card{width:360px;height:200px;background:#0b131a;border-radius:16px;box-shadow:0 12px 36px rgba(0,0,0,.5);display:flex;flex-direction:column;justify-content:center;align-items:center}.r{width:60px;height:60px;border-radius:50%;border:6px solid rgba(33,212,253,.18);border-top-color:#21d4fd;animation:spin 1s linear infinite;margin-bottom:12px}@keyframes spin{to{transform:rotate(360deg)}}h1{font-size:18px;margin:0 0 6px;font-weight:700}p{margin:0;font-size:12px;color:#8fcbde}</style><div class=card><div class=r></div><h1>Starting IOC daemon…</h1><p>Please wait while the blockchain is loading.</p></div>';
  splash.loadURL('data:text/html,'+encodeURIComponent(html));
}

function readyFrom(buf){
  const s=buf.toString('utf8');
  if(/LoadBlockIndex\(\): hashBestChain/.test(s)) return true;
  if(s.includes('Done loading')) return true;
  return false;
}

function tailUntilReady(){
  try{ last=fs.statSync(LOG).size }catch{ last=0 }
  const w=fs.watch(LOG,()=>{ try{
    const st=fs.statSync(LOG);
    if(st.size>last){
      const fd=fs.openSync(LOG,'r');
      const b=Buffer.alloc(st.size-last);
      fs.readSync(fd,b,0,b.length,last);
      fs.closeSync(fd);
      last=st.size;
      if(readyFrom(b)) launch();
    }
  }catch{} });
  setTimeout(()=>{ if(!launched) launch(); },8*60*1000);
  process.on('exit',()=>{ try{w.close()}catch{} });
}

function launch(){
  if(launched) return;
  launched=true;
  try{ if(splash && !splash.isDestroyed()) splash.destroy() }catch{}
  const electronBin=path.join(APP_DIR,'node_modules','.bin',process.platform==='win32'?'electron.cmd':'electron');
  const child=spawn(electronBin,[path.join(APP_DIR,'electron','wrapper.js')],{cwd:APP_DIR,detached:true,stdio:'ignore'});
  child.unref();
  app.quit();
}

app.whenReady().then(()=>{ showSplash(); tailUntilReady(); });
app.on('window-all-closed',()=>{});
