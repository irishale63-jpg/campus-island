import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {createApp} from '../server.mjs';
import {createEmailAuth} from '../lib/email-auth.mjs';
import {emailDeliveryFromEnv} from '../lib/verification.mjs';

async function fixture(t,{ready=true}={}){
 const base=resolve('.artifact-work');mkdirSync(base,{recursive:true});const dir=mkdtempSync(resolve(base,'email-auth-')),dataFile=resolve(dir,'store.json');
 let time=Date.now(),failed=false,server,url;const sent=[];
 const mail=createEmailAuth({secret:'stable-email-login-test-secret-32-characters',now:()=>time,delivery:{ready,async send(message){if(failed)throw Error('failure');sent.push(message);}}});
 const start=async()=>{server=createApp({dataFile,emailAuth:mail,adminKey:'email-test-admin-secret-32-characters'});await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;};
 const stop=()=>new Promise(r=>{server.close(r);server.closeAllConnections();});await start();
 t.after(async()=>{await stop();assert.ok(dir.startsWith(base+'\\'));rmSync(dir,{recursive:true,force:true});});
 function client(){const jar=new Map();const call=async(path,body,expected=200)=>{const response=await fetch(url+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(body===undefined?{}:{'Content-Type':'application/json','X-Requested-With':'CampusKindness',Origin:url})},body:body===undefined?undefined:JSON.stringify(body)});for(const value of response.headers.getSetCookie()){const part=value.split(';')[0],at=part.indexOf('=');jar.set(part.slice(0,at),part.slice(at+1));}const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;};call.jar=jar;return call;}
 return{client,sent,store:()=>JSON.parse(readFileSync(dataFile,'utf8')),advance:ms=>time+=ms,fail:value=>failed=value,async restart(){await stop();await start();}};
}

test('email login creates only after proof, preserves account and data across restart, and never verifies a school',async t=>{
 const f=await fixture(t),a=f.client(),other=f.client();assert.equal((await a('/auth/email/status')).available,true);
 const request=await a('/auth/email/request',{email:'Person@QQ.com'});assert.equal(f.sent[0].email,'person@qq.com');assert.equal(f.store().users.filter(u=>!u.isDemo).length,0);
 assert.ok(!JSON.stringify(f.store().loginEmailChallenges).includes(f.sent[0].code));assert.ok(!JSON.stringify(f.store()).includes('person@qq.com'));
 await other('/auth/email/confirm',{challengeId:request.challengeId,code:f.sent[0].code},401);
 assert.equal(f.store().loginEmailChallenges[request.challengeId].attempts,0);
 const result=await a('/auth/email/confirm',{challengeId:request.challengeId,code:f.sent[0].code});assert.equal(result.created,true);assert.equal(result.user.schoolStatus,'unverified');assert.equal(result.user.schoolId,null);assert.equal(result.user.loginEmailHash,undefined);
 const id=result.user.id;assert.equal((await a('/me')).emailLogin.bound,true);await a('/me/circle',{schoolId:'whu',mode:'demo'});
 const task=(await a('/tasks',{title:'邮箱登录前后保留的求助',category:'study',mode:'online',deadline:new Date(Date.now()+86400000).toISOString()},201)).task;
 await a('/auth/email/confirm',{challengeId:request.challengeId,code:f.sent[0].code},400);
 f.advance(60001);await f.restart();const b=f.client(),next=await b('/auth/email/request',{email:'person@qq.com'});
 const login=await b('/auth/email/confirm',{challengeId:next.challengeId,code:f.sent.at(-1).code});assert.equal(login.created,false);assert.equal(login.user.id,id);assert.equal(login.user.schoolStatus,'demo');assert.equal((await b('/tasks/'+task.id)).task.id,task.id);
 assert.equal(f.store().users.filter(u=>u.loginEmailHash).length,1);
});

test('binding preserves an existing identity, rotates sessions, and refuses email/account merging',async t=>{
 const f=await fixture(t),a=f.client();const original=await a('/identities',{name:'原有账号',avatar:'cat'},201);await a('/me/circle',{schoolId:'ccnu',mode:'demo'});
 const oldSession=a.jar.get('kindness_session');const request=await a('/auth/email/request',{email:'owner@example.com',purpose:'bind'});
 await a('/login',{userId:'lin'});await a('/auth/email/confirm',{challengeId:request.challengeId,code:f.sent[0].code},401);
 await a('/login',{userId:original.user.id});const bound=await a('/auth/email/confirm',{challengeId:request.challengeId,code:f.sent[0].code});assert.equal(bound.user.id,original.user.id);assert.equal(bound.user.name,'原有账号');assert.equal(bound.user.avatar,'cat');assert.equal(bound.user.schoolStatus,'demo');assert.equal(bound.purpose,'bind');assert.notEqual(a.jar.get('kindness_session'),oldSession);
 const stale=f.client();stale.jar.set('kindness_session',oldSession);assert.equal((await stale('/me')).user,null);
 const b=f.client();await b('/identities',{name:'另一个账号',avatar:'leaf'},201);f.advance(60001);const duplicate=await b('/auth/email/request',{email:'owner@example.com',purpose:'bind'});await b('/auth/email/confirm',{challengeId:duplicate.challengeId,code:f.sent.at(-1).code},409);assert.equal((await b('/me')).emailLogin.bound,false);
 const anonymous=f.client();await anonymous('/auth/email/request',{email:'x@example.com',purpose:'bind'},401);
 await anonymous('/login',{userId:'lin'});await anonymous('/auth/email/request',{email:'x@example.com',purpose:'bind'},403);
});

test('OTP guesses, expiry, cooldown and email quotas persist; rejected mail never authenticates',async t=>{
 const f=await fixture(t),a=f.client();const request=await a('/auth/email/request',{email:'rate@example.com'}),wrong=f.sent[0].code==='000000'?'111111':'000000';
 await a('/auth/email/request',{email:'rate@example.com'},429);
 for(let i=0;i<4;i++)await a('/auth/email/confirm',{challengeId:request.challengeId,code:wrong},400);
 await f.restart();await a('/auth/email/confirm',{challengeId:request.challengeId,code:wrong},429);await a('/auth/email/confirm',{challengeId:request.challengeId,code:f.sent[0].code},429);
 assert.equal(f.store().loginEmailChallenges[request.challengeId].attempts,5);assert.equal((await a('/me')).user,null);
 f.advance(60001);const expired=await a('/auth/email/request',{email:'rate@example.com'});f.advance(600001);await a('/auth/email/confirm',{challengeId:expired.challengeId,code:f.sent.at(-1).code},400);
 for(let i=0;i<3;i++){await a('/auth/email/request',{email:'rate@example.com'});f.advance(60001);}await a('/auth/email/request',{email:'rate@example.com'},429);
 f.fail(true);await a('/auth/email/request',{email:'failure@example.com'},503);assert.equal((await a('/me')).user,null);assert.equal(f.store().users.filter(u=>!u.isDemo).length,0);
});

test('simultaneous confirmation consumes one proof once and unavailable mail stays unavailable',async t=>{
 const f=await fixture(t),a=f.client(),request=await a('/auth/email/request',{email:'single@ccnu.edu.cn'}),body={challengeId:request.challengeId,code:f.sent[0].code};
 const outcomes=await Promise.allSettled([a('/auth/email/confirm',body),a('/auth/email/confirm',body)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.store().users.filter(u=>u.loginEmailHash).length,1);assert.equal(f.store().users.find(u=>u.loginEmailHash).schoolStatus,'unverified');
 const off=await fixture(t,{ready:false}),guest=off.client();assert.equal((await guest('/auth/email/status')).available,false);await guest('/auth/email/request',{email:'no@example.com'},503);
});

test('mail adapter distinguishes login and binding from school verification',async()=>{
 const calls=[],delivery=emailDeliveryFromEnv({RESEND_API_KEY:'test-only-key',VERIFICATION_FROM:'Campus <verify@example.com>'},async(url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({id:'test'}));});
 await delivery.send({email:'a@example.com',code:'012345',purpose:'login',requestId:'login'});await delivery.send({email:'a@example.com',code:'012345',purpose:'bind',requestId:'bind'});
 assert.match(calls[0].subject,/登录验证码/);assert.match(calls[0].text,/不代表学校认证/);assert.match(calls[1].subject,/绑定邮箱/);assert.ok(!calls[0].text.includes('undefined'));
});

test('email signups get unique names, conflicting renames are atomic, and user search respects school scope',async t=>{
 const f=await fixture(t),a=f.client(),b=f.client(),c=f.client();
 async function signup(client,email){const r=await client('/auth/email/request',{email});return (await client('/auth/email/confirm',{challengeId:r.challengeId,code:f.sent.at(-1).code})).user;}
 const aa=await signup(a,'name-a@example.com'),bb=await signup(b,'name-b@example.com');await signup(c,'name-c@example.com');
 assert.notEqual(aa.name,bb.name);
 await a('/me/circle',{schoolId:'ccnu',mode:'demo'});await b('/me/circle',{schoolId:'ccnu',mode:'demo'});await c('/me/circle',{schoolId:'whu',mode:'demo'});
 await a('/me/profile',{name:'Alice同学',avatar:'leaf'});
 await b('/me/profile',{name:'ＡＬＩＣＥ同学',avatar:'leaf'},409);
 await b('/me/profile',{name:'Alice同学',avatar:'leaf'},409);
 await a('/me/profile',{name:'Alice同学',avatar:'cat'});
 await c('/me/profile',{name:'Alice隔壁学校',avatar:'leaf'});
 const found=await b('/profiles/search?q=alice');assert.deepEqual(found.users.map(u=>u.id),[aa.id]);
 assert.ok(!JSON.stringify(found).includes('loginEmailHash'));assert.ok(!JSON.stringify(found).includes('loginEmailMasked'));
 assert.deepEqual((await b('/profiles/search?q=')).users,[]);
 const outcomes=await Promise.allSettled([a('/me/profile',{name:'唯一的夜航同学',avatar:'cat'}),b('/me/profile',{name:'唯一的夜航同学',avatar:'leaf'})]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(f.store().users.filter(u=>u.name==='唯一的夜航同学').length,1);
});
