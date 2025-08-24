const http=require("http"),fs=require("fs"),os=require("os"),path=require("path");
const LOG=process.env.IOC_DEBUGLOG||path.join(os.homedir(),"Library","Application Support","IOCoin","debug.log");
let cur=0,tip=0,last=0;function scan(s){let m;s.replace(/height=(\d{3,})/g,(_,n)=>{n=+n; if(n>cur)cur=n});s.replace(/blocks=(\d{3,})/g,(_,n)=>{n=+n; if(n>tip)tip=n});}
function poll(){let st;try{st=fs.statSync(LOG)}catch(_){setTimeout(poll,800);return}if(st.size<last)last=0;if(st.size>last){try{const fd=fs.openSync(LOG,"r");const len=Math.min(262144,st.size-last);const b=Buffer.alloc(len);const n=fs.readSync(fd,b,0,len,last);fs.closeSync(fd);last+=n;scan(b.slice(0,n).toString("utf8"))}catch(_){}}setTimeout(poll,800)}
fs.mkdirSync(path.dirname(LOG),{recursive:true});if(!fs.existsSync(LOG))fs.writeFileSync(LOG,"");try{last=fs.statSync(LOG).size||0}catch(_){last=0}poll();
http.createServer((q,r)=>{if(q.url==="/sync"){const t=Math.max(tip,cur);const b=Buffer.from(JSON.stringify({current:cur,target:t,ts:Date.now()}));r.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store","Content-Length":b.length});r.end(b);return}r.writeHead(404);r.end()}).listen(17334,"127.0.0.1");
