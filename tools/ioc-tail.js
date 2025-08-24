const fs=require("fs"),os=require("os"),path=require("path"),http=require("http");
const LOG=process.env.IOC_DEBUGLOG||path.join(os.homedir(),"Library","Application Support","IOCoin","debug.log");
const STATE=path.join(os.tmpdir(),"ioc-tail-state.json");
let cur=0,tip=0,off=0;

// restore sticky state
try{const s=JSON.parse(fs.readFileSync(STATE,"utf8")); if(s){cur=s.current||0; tip=Math.max(s.target||0,cur);}}catch{}

const save=()=>{try{fs.writeFileSync(STATE,JSON.stringify({current:cur,target:Math.max(tip,cur)}))}catch{}};
const upCur=n=>{if(Number.isFinite(n)&&n>cur){cur=n;save()}};
const upTip=n=>{if(Number.isFinite(n)&&n>tip){tip=n;save()}};

function scan(txt){
  // current block height
  txt.replace(/height\s*=\s*(\d{3,})/g,(_,n)=>{upCur(+n);return""});
  txt.replace(/bestHeight\s*=\s*(\d{3,})/g,(_,n)=>{upCur(+n);return""});
  // network tip seen in peer version lines
  txt.replace(/blocks\s*=\s*(\d{3,})/g,(_,n)=>{upTip(+n);return""});
}

function seed(){
  try{
    const st=fs.statSync(LOG); if(!st.size){off=0;return}
    const len=Math.min(5*1024*1024,st.size);      // scan last 5MB for safety
    const fd=fs.openSync(LOG,"r");
    const b=Buffer.alloc(len);
    fs.readSync(fd,b,0,len,st.size-len);
    fs.closeSync(fd);
    scan(b.toString("utf8"));
    off=st.size;
  }catch{}
}

function poll(){
  let st; try{st=fs.statSync(LOG)}catch{return setTimeout(poll,800)}
  if(st.size<off) off=0; // rotated/truncated
  if(st.size>off){
    try{
      const fd=fs.openSync(LOG,"r");
      const len=Math.min(262144,st.size-off);
      const b=Buffer.alloc(len);
      const n=fs.readSync(fd,b,0,len,off);
      fs.closeSync(fd);
      off+=n;
      scan(b.slice(0,n).toString("utf8"));
    }catch{}
  }
  setTimeout(poll,800);
}

fs.mkdirSync(path.dirname(LOG),{recursive:true});
if(!fs.existsSync(LOG)) fs.writeFileSync(LOG,"");
try{off=fs.statSync(LOG).size||0}catch{off=0}
seed(); poll();

http.createServer((q,r)=>{
  if(q.url==="/sync"){
    const body=JSON.stringify({current:cur,target:Math.max(tip,cur)});
    r.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
    r.end(body); return;
  }
  r.writeHead(404); r.end();
}).listen(17334,"127.0.0.1");
