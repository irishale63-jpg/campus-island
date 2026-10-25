import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server.mjs';

async function fixture(t) {
  const base=resolve('.artifact-work');mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(resolve(base,'island-test-')),dataFile=resolve(dir,'store.json');
  let server=createApp({dataFile}),url;
  const listen=async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;};
  await listen();const close=()=>new Promise(r=>{server.close(r);server.closeAllConnections();});
  t.after(async()=>{await close();assert.ok(dir.startsWith(base+'\\'));rmSync(dir,{recursive:true,force:true});});
  function client() {
    let cookie='';
    const raw=async(path,{body,headers={},method}={})=>{
      const multipart=body instanceof FormData;
      const response=await fetch(url+'/api'+path,{method:method||(body===undefined?'GET':'POST'),headers:{cookie,...(body===undefined?{}:{'X-Requested-With':'CampusKindness',...(multipart?{}:{'Content-Type':'application/json'})}),...headers},body:body===undefined?undefined:multipart?body:JSON.stringify(body)});
      if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;
    };
    const request=async(path,body,expected=200)=>{const response=await raw(path,{body}),data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;};
    return {raw,request,async create(name,school='whu'){const result=await request('/identities',{name,avatar:'leaf'},201);if(school)await request('/me/circle',{schoolId:school,mode:'demo'});return result;},
      async publish(category='study',extra={}){return (await request('/tasks',{title:'请教一道校园学习题',description:'',category,mode:category==='borrow'?'offline':'online',location:'图书馆一楼',deadline:new Date(Date.now()+86400000).toISOString(),returnAt:new Date(Date.now()+172800000).toISOString(),...extra},201)).task;},
      async act(id,action,values={},expected=200){return (await request('/tasks/'+id+'/action',{action,...values},expected)).task;},
    };
  }
  return {client,async restart(){await close();server=createApp({dataFile});await listen();}};
}

test('independent identities, recovery, saved identity switching and profile ownership persist',async t=>{
  const f=await fixture(t),a=f.client(),stranger=f.client();
  const created=await a.create('小林',null),other=await stranger.create('小周',null);
  assert.equal((await a.request('/me')).user.schoolStatus,'unverified');
  assert.equal((await a.request('/tasks')).tasks.length,0);
  await a.request('/tasks',{title:'未加入学校圈不能发布'},403);
  await a.request('/login',{userId:other.user.id},403);
  await a.request('/me/profile',{name:'改名',avatar:'cat',bio:'喜欢编程',skills:'C++',offers:'讲题'});
  await a.request('/me/profile',{name:'假认证',avatar:'cat',schoolId:'whu',schoolStatus:'email_verified'},400);
  await a.request('/login',{userId:'lin'});
  assert.equal((await a.request('/me')).identities[0].id,created.user.id);
  await a.request('/login',{userId:created.user.id});
  assert.equal((await a.request('/me')).user.name,'改名');
  await f.restart();assert.equal((await a.request('/me')).user.id,created.user.id);
  const restored=f.client();await restored.request('/identities/restore',{recoveryKey:'wrong-key'},401);
  await restored.request('/identities/restore',{recoveryKey:created.recoveryKey});
  assert.equal((await restored.request('/me')).user.name,'改名');
  assert.ok(!JSON.stringify(await restored.request('/me')).includes('recoveryHash'));
});

test('seven schools only, search aliases and server-enforced circle boundaries',async t=>{
  const f=await fixture(t),a=f.client(),b=f.client(),c=f.client();
  const aa=await a.create('武大同学','whu'),bb=await b.create('华科同学','hust');await c.create('另一位武大同学','whu');
  assert.equal((await a.request('/schools')).schools.length,7);
  assert.equal((await a.request('/schools?q=WHU')).schools[0].name,'武汉大学');
  assert.equal((await a.request('/schools?q=其他学校')).schools.length,0);
  const task=await a.publish('study',{schoolId:'hust',circleMode:'verified'});
  assert.equal(task.schoolId,'whu');assert.equal(task.circleMode,'demo');
  assert.equal((await b.request('/tasks')).tasks.some(x=>x.id===task.id),false);
  await b.request('/tasks/'+task.id,undefined,404);
  await b.request('/tasks/'+task.id+'/action',{action:'respond',message:'跨学校回应'},404);
  await b.request('/profiles/'+aa.user.id,undefined,404);
  await a.request('/profiles/'+bb.user.id,undefined,404);
  assert.equal((await c.request('/profiles/'+aa.user.id)).user.name,'武大同学');
  await a.request('/me/circle',{schoolId:'unknown',mode:'demo'},400);
  await a.request('/me/circle',{schoolId:'hust',mode:'demo'},409);
  await a.request('/me/circle',{schoolId:'whu',mode:'email'},503);
  await a.request('/verification/request',{email:'test@example.edu'},503);
  assert.equal((await a.request('/me')).user.schoolStatus,'demo');
});

test('optional description, editable own requests and notified valid state changes only',async t=>{
  const f=await fixture(t),owner=f.client(),helper=f.client();await owner.create('发布者');await helper.create('帮助者');
  const task=await owner.publish();assert.equal(task.description,'');
  const changes={title:'想请人讲一道 C++ 题',description:'',category:'study',mode:'online',deadline:new Date(Date.now()+86400000).toISOString(),helpTime:'今天 18:00，约十分钟'};
  const edited=(await owner.request('/tasks/'+task.id+'/edit',changes)).task;assert.equal(edited.helpTime,changes.helpTime);
  await helper.request('/tasks/'+task.id+'/edit',changes,403);
  const responded=await helper.act(task.id,'respond',{message:'我可以帮你讲解'});
  assert.equal((await owner.request('/inbox')).notifications.length,1);
  await helper.act(task.id,'respond',{message:'重复回应'},409);
  assert.equal((await owner.request('/inbox')).notifications.length,1);
  await owner.request('/tasks/'+task.id+'/edit',changes,409);
  await owner.act(task.id,'select',{responseId:responded.myResponse.id});
  assert.equal((await helper.request('/inbox')).conversations.length,1);
  assert.match((await helper.request('/inbox')).notifications[0].text,/开始私信/);
});

test('private text, image messages, unread receipts and read-only history follow conversation permissions',async t=>{
  const f=await fixture(t),owner=f.client(),helper=f.client(),unrelated=f.client(),foreign=f.client(),guest=f.client();
  await owner.create('发布者');await helper.create('帮助者');await unrelated.create('未参与者');await foreign.create('另一所学校','hust');
  const task=await owner.publish(),response=await helper.act(task.id,'respond',{message:'我能帮你'});await owner.act(task.id,'select',{responseId:response.myResponse.id});
  await helper.request('/conversations/'+task.id+'/messages',{text:'这条留言只给发布者'},201);
  assert.equal((await owner.request('/inbox')).conversations[0].unreadCount,1);
  await unrelated.request('/conversations/'+task.id,undefined,403);
  await foreign.request('/conversations/'+task.id,undefined,404);
  await guest.request('/conversations/'+task.id,undefined,401);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGKsAAAAASUVORK5CYII=','base64');
  const form=new FormData();form.set('image',new Blob([png],{type:'image/png'}),'test.png');
  const upload=await helper.raw('/conversations/'+task.id+'/images',{body:form});assert.equal(upload.status,201);const imageId=(await upload.json()).message.imageId;
  const image=await owner.raw('/images/'+imageId);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
  await unrelated.request('/images/'+imageId,undefined,403);await foreign.request('/images/'+imageId,undefined,404);await guest.request('/images/'+imageId,undefined,401);
  const malicious=new FormData();malicious.set('image',new Blob(['<svg><script>bad()</script></svg>'],{type:'image/png'}),'fake.png');
  assert.equal((await helper.raw('/conversations/'+task.id+'/images',{body:malicious})).status,400);
  await owner.request('/conversations/'+task.id+'/read',{});
  assert.equal((await owner.request('/inbox')).conversations[0].unreadCount,0);
  await f.restart();assert.equal((await owner.request('/inbox')).conversations[0].unreadCount,0);
  assert.equal((await owner.request('/conversations/'+task.id)).task.messages.length,2);
  await helper.act(task.id,'submit');await owner.act(task.id,'complete');
  await helper.request('/conversations/'+task.id+'/messages',{text:'结束后不能再发'},409);
  assert.equal((await owner.raw('/images/'+imageId)).status,200);
});

test('borrower return notification asks for lender confirmation, notifications and read state persist',async t=>{
  const f=await fixture(t),borrower=f.client(),lender=f.client();await borrower.create('借用者');await lender.create('出借者');
  const task=await borrower.publish('borrow'),response=await lender.act(task.id,'respond',{message:'可以借给你'});await borrower.act(task.id,'select',{responseId:response.myResponse.id});
  await lender.act(task.id,'deliver');await borrower.act(task.id,'return');
  const inbox=await lender.request('/inbox'),notification=inbox.notifications.find(n=>n.text.includes('提交归还'));
  assert.ok(notification);assert.match(notification.text,/请确认收到/);
  assert.equal((await borrower.request('/tasks/'+task.id)).task.loan.confirmedAt,null);
  await lender.act(task.id,'submit',{},409);
  await lender.request('/notifications/read',{id:notification.id});
  await f.restart();assert.ok((await lender.request('/inbox')).notifications.find(n=>n.id===notification.id).readAt);
  await lender.act(task.id,'confirm-return');
  assert.ok((await borrower.request('/inbox')).notifications.some(n=>n.text.includes('确认收到归还物品')));
  await lender.act(task.id,'submit');await borrower.act(task.id,'complete');await borrower.act(task.id,'thank',{text:'谢谢你借来的物品'});
  assert.ok((await lender.request('/inbox')).notifications.some(n=>n.action==='thanks'));
});
