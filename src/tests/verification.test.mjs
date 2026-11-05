import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server.mjs';
import { createSchoolVerification,emailDeliveryFromEnv } from '../lib/verification.mjs';

async function fixture(t,{ready=true}={}){
  const base=resolve('.artifact-work');mkdirSync(base,{recursive:true});const dir=mkdtempSync(resolve(base,'verify-')),dataFile=resolve(dir,'store.json');
  let time=Date.now(),failing=false,server,url;const sent=[];
  const secret='test-email-verification-secret-32-characters',adminKey='test-verification-admin-key-32-characters';
  const verification=createSchoolVerification({secret,now:()=>time,delivery:{ready,async send(message){if(failing)throw new Error('provider rejected');sent.push(message);}}});
  const start=async()=>{server=createApp({dataFile,adminKey,verification});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;};
  const stop=()=>new Promise(r=>{server.close(r);server.closeAllConnections();});await start();
  t.after(async()=>{await stop();assert.ok(dir.startsWith(base+'\\'));rmSync(dir,{recursive:true,force:true});});
  function client(){let cookie='';return async(path,body,expected=200)=>{const response=await fetch(url+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json','X-Requested-With':'CampusKindness',Origin:url})},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;};}
  const admin=client();await admin('/admin/login',{key:adminKey});
  await admin('/admin/verification',{schoolId:'whu',domains:['students.whu.edu.cn'],sourceUrl:'https://www.whu.edu.cn/email-help'});
  const member=async name=>{const c=client(),identity=await c('/identities',{name,avatar:'leaf'},201);await c('/me/circle',{schoolId:'whu',mode:'demo'});return {c,identity};};
  return {client,admin,member,sent,advance:ms=>time+=ms,fail:value=>failing=value,store:()=>JSON.parse(readFileSync(dataFile,'utf8')),async restart(){await stop();await start();}};
}

test('school email verification preserves existing circle records across verification, restart and recovery',async t=>{
  const f=await fixture(t),{c,identity}=await f.member('验证同学');
  const task=(await c('/tasks',{title:'认证前已发布的求助',category:'study',mode:'online',deadline:new Date(Date.now()+86400000).toISOString()},201)).task;
  const result=await c('/verification/request',{email:'student@students.whu.edu.cn'});assert.equal(result.code,undefined);assert.equal(result.retryAfter,60);
  assert.equal(f.sent.length,1);assert.match(f.sent[0].code,/^\d{6}$/);
  const pending=f.store().emailChallenges[identity.user.id];assert.equal(pending.code,undefined);assert.equal(pending.email,undefined);assert.equal(pending.codeHash.length,64);
  const verified=(await c('/verification/confirm',{code:f.sent[0].code})).user;assert.equal(verified.schoolStatus,'email_verified');assert.equal(verified.circleMode,'demo');
  assert.equal(verified.verifiedEmailHash,undefined);assert.equal(verified.schoolEmailMasked,undefined);
  assert.equal((await c('/tasks/'+task.id)).task.id,task.id);assert.equal((await c('/verification/status')).status,'verified');
  await c('/verification/confirm',{code:f.sent[0].code},400);
  await f.restart();const restored=f.client();await restored('/identities/restore',{recoveryKey:identity.recoveryKey});assert.equal((await restored('/me')).user.schoolStatus,'email_verified');assert.equal((await restored('/tasks/'+task.id)).task.id,task.id);
  const second=await f.member('另一身份');await second.c('/verification/request',{email:'student@students.whu.edu.cn'},409);
});

test('leaving a school clears verification and challenges without moving or deleting requests',async t=>{
  const f=await fixture(t),{c,identity}=await f.member('重选学校');
  const task=(await c('/tasks',{title:'保留在原学校的求助',category:'activity',mode:'online',deadline:new Date(Date.now()+86400000).toISOString()},201)).task;
  await c('/verification/request',{email:'switch@students.whu.edu.cn'});
  const staleCode=f.sent.at(-1).code;
  await c('/me/circle/leave',{});
  assert.equal((await c('/me')).user.schoolId,null);
  assert.equal(f.store().emailChallenges[identity.user.id],undefined);
  await c('/me/circle',{schoolId:'hust',mode:'demo'});
  await c('/verification/confirm',{code:staleCode},400);
  await c('/tasks/'+task.id,undefined,404);
  await c('/me/circle/leave',{});
  await c('/me/circle',{schoolId:'whu',mode:'demo'});
  assert.equal((await c('/tasks/'+task.id)).task.id,task.id);
  f.advance(60001);
  await c('/verification/request',{email:'switch@students.whu.edu.cn'});
  await c('/verification/confirm',{code:f.sent.at(-1).code});
  await c('/me/circle/leave',{});
  const stored=f.store().users.find(u=>u.id===identity.user.id);
  for(const key of ['schoolVerifiedAt','verifiedEmailHash','schoolEmailMasked'])assert.equal(stored[key],undefined);
  assert.equal((await c('/verification/status')).status,'join_school');
  assert.equal((await c('/me')).user.schoolStatus,'unverified');
  const guest=f.client();await guest('/me/circle/leave',{},401);
  await guest('/login',{userId:'lin'});await guest('/me/circle/leave',{},403);
});

test('school codes enforce persistent attempt limits, resend cooldown, expiry and one active challenge',async t=>{
  const f=await fixture(t),{c,identity}=await f.member('次数限制');await c('/verification/request',{email:'one@students.whu.edu.cn'});
  await c('/verification/request',{email:'one@students.whu.edu.cn'},429);
  const wrong=f.sent[0].code==='000000'?'111111':'000000';
  for(let i=0;i<4;i++)await c('/verification/confirm',{code:wrong},400);
  assert.equal(f.store().emailChallenges[identity.user.id].attempts,4);
  await c('/verification/confirm',{code:wrong},429);await c('/verification/confirm',{code:f.sent[0].code},429);
  f.advance(60001);await c('/verification/request',{email:'one@students.whu.edu.cn'});const second=f.sent[1].code;
  f.advance(600001);await c('/verification/confirm',{code:second},400);assert.equal((await c('/me')).user.schoolStatus,'demo');
  for(let i=0;i<3;i++){await c('/verification/request',{email:'one@students.whu.edu.cn'});f.advance(60001);}
  await c('/verification/request',{email:'one@students.whu.edu.cn'},429);assert.equal(f.sent.length,5);
});

test('school verification rejects unapproved domains, revoked configurations and unconfigured delivery',async t=>{
  const f=await fixture(t),{c}=await f.member('域名边界'),guest=f.client();
  await guest('/verification/request',{email:'x@students.whu.edu.cn'},401);await guest('/admin/verification',{schoolId:'whu',domains:['evil.example']},401);
  await c('/verification/request',{email:'x@students.whu.edu.cn.evil.example'},400);await c('/verification/request',{email:'x@qq.com'},400);
  await f.admin('/admin/verification',{schoolId:'whu',domains:['*.edu.cn'],sourceUrl:'https://www.whu.edu.cn'},400);
  await c('/verification/request',{email:'x@students.whu.edu.cn'});await f.admin('/admin/verification',{schoolId:'whu',domains:[],sourceUrl:''});
  await c('/verification/confirm',{code:f.sent[0].code},409);assert.equal((await c('/me')).user.schoolStatus,'demo');
  const off=await fixture(t,{ready:false}),m=await off.member('未开通');await m.c('/verification/request',{email:'x@students.whu.edu.cn'},503);assert.equal(off.sent.length,0);assert.equal((await m.c('/verification/status')).status,'service_pending');
});

test('delivery failures do not enable confirmation or mark the identity verified',async t=>{
  const f=await fixture(t),{c}=await f.member('失败处理');f.fail(true);await c('/verification/request',{email:'x@students.whu.edu.cn'},503);
  assert.equal((await c('/verification/status')).challengeActive,false);await c('/verification/confirm',{code:'123456'},400);
  assert.equal((await c('/me')).user.schoolStatus,'demo');f.advance(60001);f.fail(false);await c('/verification/request',{email:'x@students.whu.edu.cn'});await c('/verification/confirm',{code:f.sent[0].code});
});

test('email adapter sends through the fixed provider and treats rejected deliveries as failures',async()=>{
  let request;
  const env={RESEND_API_KEY:'test-key-not-real',VERIFICATION_FROM:'校园岛 <verify@example.com>'};
  const sender=emailDeliveryFromEnv(env,async(url,options)=>{request={url,options};return new Response(JSON.stringify({id:'accepted'}));});
  await sender.send({email:'x@school.edu.cn',code:'123456',schoolName:'测试学校',requestId:'unique-id'});
  assert.equal(request.url,'https://api.resend.com/emails');assert.equal(request.options.redirect,'manual');assert.deepEqual(JSON.parse(request.options.body).to,['x@school.edu.cn']);assert.match(JSON.parse(request.options.body).text,/123456/);
  const rejected=emailDeliveryFromEnv(env,async()=>new Response('{}',{status:403}));await assert.rejects(()=>rejected.send({email:'x@school.edu.cn',code:'123456'}),{status:503});assert.equal(emailDeliveryFromEnv({}).ready,false);
  let calls=0;
  const redirected=emailDeliveryFromEnv(env,async(url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://another.example/emails'}});});
  await assert.rejects(()=>redirected.send({email:'x@school.edu.cn',code:'123456'}),{status:503});assert.equal(calls,1);
});
