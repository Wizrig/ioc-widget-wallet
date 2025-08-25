const {app,BrowserWindow}=require('electron')
const {spawn}=require('child_process')
const fs=require('fs')
const APP_DIR=process.env.APP_DIR
const LOG=process.env.LOG
let splash,launched=false,offset=0,buf=''
function show(){
  splash=new BrowserWindow({width:380,height:220,frame:false,resizable:false,alwaysOnTop:true,backgroundColor:'#0b131a',show:true})
  const html='<!doctype html><meta charset=utf-8><style>html,body{margin:0;height:100%;background:#0f1820;color:#bfefff;display:flex;justify-content:center;align-items:center;font-family:-apple-system,system-ui,Segoe UI,Roboto,Inter,Helvetica,Arial,sans-serif}.card{width:360px;height:200px;background:#0b131a;border-radius:16px;box-shadow:0 12px 36px rgba(0,0,0,.5);display:flex;flex-direction:column;justify-content:center;align-items:center}.r{width:60px;height:60px;border-radius:50%;border:6px solid rgba(33,212,253,.18);border-top-color:#21d4fd;animation:spin 1s linear infinite;margin-bottom:12px}@keyframes spin{to{transform:rotate(360deg)}}h1{font-size:18px;margin:0 0 6px;font-weight:700}p{margin:0;font-size:12px;color:#8fcbde}</style><div class=card><div class=r></div><h1>Starting IOC daemon…</h1><p>Please wait while the blockchain is loading.</p></div>'
  splash.loadURL('data:text/html,'+encodeURIComponent(html))
}
function readyText(s){
  if(/LoadBlockIndex\(\):\s*hashBestChain/.test(s)) return true
  if(/Done loading/i.test(s)) return true
  return false
}
function readChunk(){
  try{
    const st=fs.statSync(LOG)
    if(st.size<offset) offset=0
    if(st.size>offset){
      const fd=fs.openSync(LOG,'r'); const len=st.size-offset; const b=Buffer.alloc(len)
      fs.readSync(fd,b,0,len,offset); fs.closeSync(fd); offset=st.size
      buf+=b.toString('utf8'); if(buf.length>1048576) buf=buf.slice(-524288)
      if(readyText(buf)) launch()
    }
  }catch{}
}
function tail(){
  try{ offset=fs.statSync(LOG).size }catch{ offset=0 }
  const w=fs.watch(LOG,readChunk); const t=setInterval(readChunk,500); const k=setTimeout(()=>{ if(!launched) launch() },600000)
  const c=()=>{ try{w.close()}catch{} clearInterval(t); clearTimeout(k) }
  process.on('exit',c); app.on('quit',c)
}
function launch(){
  if(launched) return
  launched=true
  try{ if(splash && !splash.isDestroyed()) splash.destroy() }catch{}
  const cmd=process.platform==='win32'?'npm.cmd':'npm'
  const child=spawn(cmd,['run','dev'],{cwd:APP_DIR,detached:true,stdio:'ignore'})
  child.unref()
  app.quit()
}
app.whenReady().then(()=>{ show(); tail() })
app.on('window-all-closed',()=>{})
