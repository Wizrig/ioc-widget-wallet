const {app,BrowserWindow,dialog}=require('electron');
const {execFile}=require('child_process');
const fs=require('fs'),path=require('path');

function resolveEntry(){
  const root=process.cwd();
  let pkg={};
  try{ pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')); }catch{}
  const c=[pkg.main,'src/main/main.js','main.js','app/main.js','electron/main.js'].filter(Boolean);
  for(const rel of c){ const full=path.join(root,rel); try{ fs.accessSync(full); return full; }catch{} }
  throw new Error('wallet UI entry not found');
}

app.on('browser-window-created',(e,win)=>{
  win.on('close',(ev)=>{
    const res=dialog.showMessageBoxSync(win,{
      type:'question',
      buttons:['Close wallet & daemon','Close wallet only','Cancel'],
      defaultId:0,
      cancelId:2,
      title:'Exit options',
      message:'Choose how you want to exit.',
      detail:'Close wallet & daemon will stop iocoind. Close wallet only leaves iocoind running.'
    });
    if(res===2){ ev.preventDefault(); return; }
    if(res===0){ try{ execFile('/usr/local/bin/iocoind',['stop']); }catch(_){ } }
  });
});

app.whenReady().then(()=>{ require(resolveEntry()); });
