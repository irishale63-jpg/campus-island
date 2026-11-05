import test from 'node:test';
import assert from 'node:assert/strict';
import { schools,schoolDirectory,matchesSchool,sampleSchoolIds } from '../lib/schools.mjs';
import { createApplication } from '../lib/application.mjs';
import { ensureIslandState } from '../lib/identity.mjs';
import { seedData } from '../lib/seed.mjs';
import { createDomain } from '../lib/domain.mjs';
import { addSchoolSamples } from '../lib/management.mjs';

test('official undergraduate directory is complete, unique and retains existing circle identifiers',()=>{
  assert.equal(schools.length,1412);assert.equal(schoolDirectory.asOf,'2026-06-17');
  assert.equal(new Set(schools.map(s=>s.id)).size,1412);assert.equal(new Set(schools.map(s=>s.code)).size,1412);
  assert.equal(new Set(schools.map(s=>s.province)).size,31);
  assert.ok(schools.every(s=>s.level==='本科'&&/^\d{10}$/.test(s.code)&&s.province&&s.city));
  assert.equal(schools.find(s=>s.name==='武汉大学').id,'whu');
  assert.equal(schools.find(s=>s.name==='华中师范大学').id,'ccnu');
  assert.equal(sampleSchoolIds.filter(id=>schools.some(s=>s.id===id)).length,7);
  for(const name of ['北京大学','清华大学','深圳职业技术大学','新疆工业职业技术大学'])assert.ok(schools.some(s=>s.name===name),name);
  assert.ok(schools.filter(s=>matchesSchool(s,'北大')).some(s=>s.name==='北京大学'));
  assert.equal(schools.find(s=>matchesSchool(s,'PKU')).name,'北京大学');
  assert.ok(schools.filter(s=>matchesSchool(s,'广东 深圳')).every(s=>s.province.includes('广东')&&s.city.includes('深圳')));
  assert.equal(schools.find(s=>matchesSchool(s,'中国地质大学武汉')).id,'cug');
});

test('a newly listed school accepts members, enforces circle isolation and does not expand synthetic users',async()=>{
  const store=ensureIslandState(seedData()),sessions=new Map();
  const app=createApplication({transact:async operation=>operation(store,createDomain(()=>store)),sessions:{get:async k=>sessions.get(k),set:async(k,v)=>sessions.set(k,v),delete:async k=>sessions.delete(k)}});
  let cookie='';
  const call=async(path,body,expected=200)=>{
    const response=await app(new Request('https://test.example/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json','X-Requested-With':'CampusKindness',Origin:'https://test.example'})},body:body===undefined?undefined:JSON.stringify(body)}));
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
  };
  const pku=schools.find(s=>s.name==='北京大学');
  assert.equal((await call('/schools?q='+encodeURIComponent('北京大学'))).schools[0].id,pku.id);
  assert.ok((await call('/schools?q='+encodeURIComponent('广东 深圳'))).schools.length>0);
  await call('/identities',{name:'北大试用身份',avatar:'book'},201);
  await call('/me/circle',{schoolId:pku.id,mode:'demo'});
  assert.equal((await call('/me')).user.schoolName,'北京大学');
  assert.equal((await call('/schools?q='+encodeURIComponent('北京大学'))).schools[0].realCount,1);
  const task=(await call('/tasks',{title:'讨论一道学习题',category:'study',mode:'online',deadline:new Date(Date.now()+86400000).toISOString()},201)).task;
  assert.equal(task.schoolId,pku.id);
  await call('/tasks/rain',undefined,404);
  assert.deepEqual(addSchoolSamples(store),{usersAdded:28,tasksAdded:28});
  assert.deepEqual(addSchoolSamples(store),{usersAdded:0,tasksAdded:0});
  assert.equal(store.users.filter(u=>u.schoolId===pku.id).length,1);
  assert.ok(store.tasks.some(t=>t.id===task.id));
});
