import {randomInt,randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {must,fail,clean} from './domain.mjs';
import {createIdentity,findUser,defaultUsername} from './identity.mjs';

// Email login is independent of school membership. Only a proved mailbox can
// create an account or bind to an existing account; no plaintext codes are saved.
export function createEmailAuth({secret='',delivery={ready:false},now=()=>Date.now()}={}){
 const available=secret.length>=24&&!!delivery.ready;
 const hash=value=>createHmac('sha256',secret).update(JSON.stringify(['email-login-v1',...value])).digest('hex');
 const status=user=>({available,bound:!!user&&!user.isDemo&&!!user.loginEmailHash,maskedEmail:user&&!user.isDemo?user.loginEmailMasked||null:null});
 async function request(transact,user,body,{clientToken,ip='local'}={}){
  must(available,'邮箱登录暂未开放，请稍后再试。',503);
  const purpose=body.purpose||'login';must(['login','bind'].includes(purpose),'请选择正确的邮箱操作');
  if(purpose==='bind'){must(user,'请先登录自己的账号',401);must(!user.isDemo,'请用自己的账号绑定邮箱',403);must(!user.loginEmailHash,'该账号已绑定邮箱。',409);}
  const email=clean(body.email,'邮箱',5,254).toLowerCase();
  must(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email),'请填写有效的邮箱地址');
  must(typeof clientToken==='string'&&/^[a-f0-9]{64}$/.test(clientToken),'请重新打开登录窗口');
  const emailHash=hash(['email',email]),ipHash=hash(['ip',ip]),id=randomUUID(),code=String(randomInt(1000000)).padStart(6,'0');
  const at=now(),maskedEmail=email.slice(0,1)+'***@'+email.split('@')[1],targetId=purpose==='bind'?user.id:null;
  await transact(store=>{
   if(targetId){const target=findUser(store,targetId);must(target&&!target.isDemo&&!target.loginEmailHash,'账号状态已变化，请刷新重试。',409);}
   store.loginEmailRates ||= {};store.loginEmailChallenges ||= {};
   for(const [key,value] of Object.entries(store.loginEmailRates))if(value.until<=at)delete store.loginEmailRates[key];
   for(const [key,value] of Object.entries(store.loginEmailChallenges))if(value.expiresAt<=at)delete store.loginEmailChallenges[key];
   const bucket=store.loginEmailRates['email:'+emailHash];
   must(!bucket||at-bucket.last>=60000,'请间隔 60 秒后再获取验证码。',429);
   const limits=[['email:'+emailHash,5,3600000],['ip:'+ipHash,10,3600000],['daily:'+Math.floor(at/86400000),80,86400000]];
   for(const [key,limit] of limits)must((store.loginEmailRates[key]?.used||0)<limit,'获取次数较多，请稍后再试。',429);
   for(const [key,,ttl] of limits){const value=store.loginEmailRates[key]||{used:0,until:at+ttl};value.used++;value.last=at;store.loginEmailRates[key]=value;}
   for(const [key,value] of Object.entries(store.loginEmailChallenges))if(value.emailHash===emailHash)delete store.loginEmailChallenges[key];
   store.loginEmailChallenges[id]={id,emailHash,maskedEmail,purpose,targetId,clientHash:hash(['client',clientToken]),
    codeHash:hash(['code',id,emailHash,purpose,targetId,code]),createdAt:at,expiresAt:at+600000,attempts:0,state:'sending'};
  });
  try{await delivery.send({email,code,purpose,requestId:id});}
  catch{await transact(store=>{if(store.loginEmailChallenges?.[id])store.loginEmailChallenges[id].state='failed';});fail('验证码暂时未能发送，请稍后重试。',503);}
  await transact(store=>{if(store.loginEmailChallenges?.[id])store.loginEmailChallenges[id].state='ready';});
  return {challengeId:id,maskedEmail,retryAfter:60,expiresIn:600};
 }
 async function confirm(transact,user,body,{clientToken,owned=[]}={}){
  must(available,'邮箱登录暂未开放。',503);
  const id=clean(body.challengeId,'验证请求',36,36),code=clean(body.code,'六位验证码',6,6);
  must(/^\d{6}$/.test(code),'请输入六位数字验证码');
  must(typeof clientToken==='string'&&/^[a-f0-9]{64}$/.test(clientToken),'请在获取验证码的浏览器中继续操作。',401);
  const result=await transact(store=>{
   const record=store.loginEmailChallenges?.[id];
   const error=(message,status=400)=>({error:message,status});
   if(!record||record.state!=='ready')return error('请重新获取验证码。');
   if(record.clientHash!==hash(['client',clientToken]))return error('请在获取验证码的浏览器中继续操作。',401);
   if(record.expiresAt<=now()){delete store.loginEmailChallenges[id];return error('验证码已过期，请重新获取。');}
   if(record.attempts>=5)return error('尝试次数已达上限，请重新获取验证码。',429);
   if(record.purpose==='bind'&&(!user||user.isDemo||user.id!==record.targetId))return error('当前账号已变化，请重新绑定。',401);
   record.attempts++;
   const candidate=hash(['code',id,record.emailHash,record.purpose,record.targetId,code]);
   if(!timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(record.codeHash,'hex')))return error(record.attempts>=5?'尝试次数已达上限，请重新获取验证码。':'验证码不正确，请重试。',record.attempts>=5?429:400);
   let target=store.users.find(u=>!u.isDemo&&u.loginEmailHash===record.emailHash),created=false;
   if(record.purpose==='bind'){
    if(target&&target.id!==record.targetId)return error('该邮箱已绑定其他账号，请使用其他邮箱。',409);
    target=findUser(store,record.targetId);
    if(!target||target.isDemo||target.loginEmailHash)return error('账号绑定状态已变化，请刷新。',409);
   }else if(!target){
    if(store.users.length>=1000)return error('当前账号数量已达到上限。',409);
    if(owned.length>=8)return error('此设备已保存多个账号，请先退出后再登录。',409);
    target=createIdentity(defaultUsername(store),'island').user;store.users.push(target);created=true;
   }
   if(!owned.includes(target.id)&&owned.length>=8)return error('此设备已保存多个账号，请先退出后再登录。',409);
   target.loginEmailHash=record.emailHash;target.loginEmailMasked=record.maskedEmail;
   target.loginEmailBoundAt ||= new Date(now()).toISOString();
   delete store.loginEmailChallenges[id];
   return {user:target,created,purpose:record.purpose};
  });
  // Wrong guesses are committed before an error is raised, including on D1 retries.
  if(result.error)fail(result.error,result.status);return result;
 }
 return {status,request,confirm};
}
