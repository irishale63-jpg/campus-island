import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedData } from './lib/seed.mjs';
import { createDomain, must } from './lib/domain.mjs';
import { ensureIslandState } from './lib/identity.mjs';
import { createApplication, securityHeaders, MAX_IMAGE_BYTES } from './lib/application.mjs';
import { launchAddress } from './lib/local-address.mjs';
import { randomBytes } from 'node:crypto';
import { createSchoolVerification,emailDeliveryFromEnv } from './lib/verification.mjs';
import { createEmailAuth } from './lib/email-auth.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url));
export function createApp({dataFile=resolve(ROOT,'..','data/store.json'),demo=true,adminKey,verification,emailAuth}={}) {
  mkdirSync(dirname(dataFile),{recursive:true});
  const keyFile=resolve(dirname(dataFile),'admin-key.txt');
  if(adminKey===undefined) {
    if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32).toString('base64url'),'utf8');
    adminKey=readFileSync(keyFile,'utf8').trim();
  }
  let store=ensureIslandState(existsSync(dataFile)?JSON.parse(readFileSync(dataFile,'utf8')):seedData());
  const save=()=>{
    const temp=dataFile+'.tmp';writeFileSync(temp,JSON.stringify(store,null,2),'utf8');
    // Windows file scanners can briefly lock an otherwise valid atomic replacement.
    for(let attempt=0;;attempt++)try{renameSync(temp,dataFile);break;}catch(error){
      if(attempt>=5||!['EPERM','EBUSY','EACCES'].includes(error.code))throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20*(attempt+1));
    }
  };
  save();let queue=Promise.resolve();
  const transact=operation=>{
    const run=queue.then(()=>{
      const snapshot=structuredClone(store),before=JSON.stringify(store);
      try {ensureIslandState(store);const domain=createDomain(()=>store);domain.expire();const result=operation(store,domain);if(JSON.stringify(store)!==before)save();return result;}
      catch(error){store=snapshot;throw error;}
    });queue=run.catch(()=>{});return run;
  };
  const uploadDir=resolve(dirname(dataFile),'uploads');
  const imagePath=key=>{must(/^private\/[a-f0-9-]{36}$/.test(key),'图片不存在',404);return resolve(uploadDir,key.slice(8));};
  const api=createApplication({transact,demo,adminKey,emailAuth:emailAuth||createEmailAuth({secret:process.env.VERIFICATION_SECRET||adminKey,delivery:emailDeliveryFromEnv(process.env)}),verification:verification||createSchoolVerification({secret:process.env.VERIFICATION_SECRET||adminKey,delivery:emailDeliveryFromEnv(process.env)}),sessions:{
    get:token=>transact(s=>s.sessions?.[token]||null),
    set:(token,session)=>transact(s=>{s.sessions ||= {};s.sessions[token]=session;for(const [key,value] of Object.entries(s.sessions))if(value.until<=Date.now())delete s.sessions[key];}),
    delete:token=>transact(s=>{if(s.sessions)delete s.sessions[token];}),
  },uploads:{
    put:async(key,bytes)=>{mkdirSync(uploadDir,{recursive:true});writeFileSync(imagePath(key),bytes);},
    get:async key=>existsSync(imagePath(key))?{body:readFileSync(imagePath(key))}:null,
    delete:async key=>{if(existsSync(imagePath(key)))unlinkSync(imagePath(key));},
  }});
  const files={'/admin':['admin.html','text/html'],'/admin/':['admin.html','text/html'],'/admin.js':['admin.js','text/javascript'],'/admin.css':['admin.css','text/css'],'/':['index.html','text/html'],'/styles.css':['styles.css','text/css'],'/design.css':['design.css','text/css'],'/brand.js':['brand.js','text/javascript'],'/app.js':['app.js','text/javascript'],'/account.js':['account.js','text/javascript'],'/messages.js':['messages.js','text/javascript'],'/favicon.svg':['favicon.svg','image/svg+xml'],'/brand-island.png':['brand-island.png','image/png']};
  files['/theme.js']=['theme.js','text/javascript'];files['/theme.css']=['theme.css','text/css'];files['/email-login.js']=['email-login.js','text/javascript'];
  return http.createServer(async(req,res)=>{
    for(const [key,value] of Object.entries(securityHeaders))res.setHeader(key,value);
    try {
      const url=new URL(req.url,'http://'+req.headers.host);
      if(!url.pathname.startsWith('/api/')) {
        must(['GET','HEAD'].includes(req.method),'不支持的请求',405);
        const file=files[url.pathname];must(file,'页面不存在',404);
        res.writeHead(200,{'Content-Type':file[1]+(file[1].startsWith('image/')?'':'; charset=utf-8'),'Cache-Control':'no-cache'});
        res.end(req.method==='HEAD'?'':readFileSync(resolve(ROOT,'public',file[0])));return;
      }
      const limit=MAX_IMAGE_BYTES+65536;
      if(Number(req.headers['content-length']||0)>limit){req.resume();const error=new Error('提交内容过大');error.status=413;throw error;}
      const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;must(length<=limit,'提交内容过大',413);chunks.push(chunk);}
      const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
      const response=await api(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.status?error.message:'操作未成功，请重试。'}));}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {port,host,url,lan}=launchAddress();
  const server=createApp({dataFile:process.env.DATA_FILE?resolve(process.env.DATA_FILE):undefined,demo:process.env.DEMO_MODE!=='false'});
  server.listen(port,host,()=>console.log(`校园岛已启动：${url}\n${lan?'手机与电脑连接同一 Wi-Fi 后可访问。\n':''}按 Ctrl+C 停止。`));
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'端口已被占用，请关闭旧服务或更换 PORT。':e.message);process.exitCode=1;});
}
