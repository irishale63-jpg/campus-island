import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server.mjs';
import { ensureIslandState } from '../lib/identity.mjs';
import { seedData } from '../lib/seed.mjs';
import { addSchoolSamples,managementData } from '../lib/management.mjs';
import { importExperienceBatch } from '../lib/experience.mjs';
import { taskCategories } from '../lib/categories.mjs';

test('fictional experience batch is balanced, clearly classified and additive',()=>{
  const store=ensureIslandState(seedData());addSchoolSamples(store);
  const original={id:'keep-real-user',name:'保留自建资料',schoolId:'ccnu',schoolStatus:'demo',circleMode:'demo',isDemo:false};store.users.push(original);
  const first=importExperienceBatch(store);
  assert.deepEqual(first,{usersAdded:100,tasksAdded:100,convertedUsers:14,convertedTasks:14,categoryCounts:{study:20,borrow:20,sports:20,activity:20,life:20}});
  assert.equal(store.users.filter(u=>u.isExperience).length,114);assert.equal(store.tasks.filter(t=>t.isExperience).length,114);
  assert.equal(store.users.filter(u=>u.isSample).length,14);assert.equal(new Set(store.users.filter(u=>u.isExperience).map(u=>u.name)).size,114);
  assert.ok(store.tasks.filter(t=>t.origin==='experience-batch-v1').every(t=>t.isDemo&&t.isExperience&&!t.isSample&&t.responses.length===0&&t.messages.length===0&&t.status==='open'&&!t.thanks));
  assert.deepEqual(store.users.find(u=>u.id===original.id),original);
  const overview=managementData(store);assert.equal(overview.summary.realUsers,1);assert.equal(overview.summary.realTasks,0);assert.equal(overview.summary.experienceUsers,114);
  const sample=store.tasks.find(t=>t.origin==='experience-batch-v1');sample.messages.push({id:'keep-test-conversation',userId:sample.ownerId,text:'保留体验互动'});sample.status='active';
  const before=JSON.stringify(store),second=importExperienceBatch(store);assert.equal(second.usersAdded,0);assert.equal(second.tasksAdded,0);assert.equal(second.convertedUsers,0);assert.equal(JSON.stringify(store),before);
});

test('experience accounts interact through existing permissions, persist, and stay outside real usage statistics',async t=>{
  const base=resolve('.artifact-work');mkdirSync(base,{recursive:true});const dir=mkdtempSync(resolve(base,'experience-')),dataFile=resolve(dir,'store.json'),adminKey='experience-admin-test-key-32-characters';
  let server,url;const start=async()=>{server=createApp({dataFile,adminKey});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;};const stop=()=>new Promise(r=>{server.close(r);server.closeAllConnections();});await start();
  t.after(async()=>{await stop();assert.ok(dir.startsWith(base+'\\'));rmSync(dir,{recursive:true,force:true});});
  function client(){let cookie='';return async(path,body,expected=200)=>{const response=await fetch(url+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json','X-Requested-With':'CampusKindness',Origin:url})},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;};}
  const admin=client(),owner=client(),helper=client(),guest=client(),foreign=client(),real=client();
  await guest('/admin/experiences',{},401);await admin('/admin/login',{key:adminKey});await admin('/admin/samples',{});await admin('/admin/experiences',{});
  const catalogue=await guest('/demo-accounts');assert.equal(catalogue.accounts.length,3);assert.equal(catalogue.experienceAccounts.length,114);assert.ok(catalogue.experienceAccounts.every(u=>u.isDemo&&u.isExperience));
  await owner('/login',{userId:'experience-v1-001'});await helper('/login',{userId:'experience-v1-002'});await foreign('/login',{userId:'experience-v1-041'});
  const id='task-experience-v1-001',path='/tasks/'+id+'/action';
  await foreign('/tasks/'+id,undefined,404);
  const response=(await helper(path,{action:'respond',message:'我可以一起讨论这道题'})).task.myResponse;
  await owner(path,{action:'select',responseId:response.id});await helper('/conversations/'+id+'/messages',{text:'这是一次体验对话'},201);
  assert.equal((await guest('/tasks/'+id)).task.messages.length,0);
  await helper(path,{action:'submit'});await owner(path,{action:'complete'});await owner(path,{action:'thank',text:'谢谢，一起体验完了流程'});
  let overview=await admin('/admin/overview');assert.equal(overview.summary.realUsers,0);assert.equal(overview.summary.completed,0);assert.equal(overview.tasks.find(t=>t.id===id).isExperience,true);
  const identity=await real('/identities',{name:'自建试用',avatar:'leaf'},201);await real('/me/circle',{schoolId:'ccnu',mode:'demo'});
  for(const category of taskCategories){const task=(await real('/tasks',{title:category.label+'分类测试',category:category.id,mode:category.id==='borrow'?'offline':'online',location:'图书馆公共大厅',deadline:new Date(Date.now()+86400000).toISOString(),returnAt:new Date(Date.now()+172800000).toISOString()},201)).task;assert.equal(task.category,category.id);assert.equal(task.isExperience,false);assert.equal(task.isDemo,false);}
  // A genuine request completed with a shared experience helper is an experience collaboration.
  const realTask=(await real('/tasks',{title:'与体验身份协作测试',category:'life',mode:'online',deadline:new Date(Date.now()+86400000).toISOString()},201)).task;
  const r=(await helper('/tasks/'+realTask.id+'/action',{action:'respond',message:'用体验身份一起走流程'})).task.myResponse;await real('/tasks/'+realTask.id+'/action',{action:'select',responseId:r.id});
  assert.equal((await real('/tasks/'+realTask.id)).task.isExperience,true);assert.equal((await admin('/admin/overview')).tasks.find(t=>t.id===realTask.id).isDemo,true);
  await stop();await start();assert.equal((await real('/me')).user.id,identity.user.id);assert.equal((await owner('/conversations/'+id)).task.messages[0].text,'这是一次体验对话');
  const counts=await admin('/admin/experiences',{});assert.equal(counts.usersAdded,0);assert.equal(counts.convertedUsers,0);assert.ok(JSON.parse(readFileSync(dataFile,'utf8')).users.find(u=>u.id===identity.user.id));
});
