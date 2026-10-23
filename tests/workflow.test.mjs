import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { seedData } from '../lib/seed.mjs';

async function fixture(t, data) {
  const base = resolve('.artifact-work'); mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(resolve(base, 'test-'));
  const dataFile = resolve(dir, 'store.json');
  if (data) writeFileSync(dataFile, JSON.stringify(data));
  let app = createApp({ dataFile });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  let url = `http://127.0.0.1:${app.address().port}`;
  const cookies = new Map();
  async function request(path, body, who = 'guest', expected = 200, extra = {}) {
    const headers = { Cookie: cookies.get(who) || '', ...extra };
    const options = body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With':'CampusKindness', ...headers }, body: JSON.stringify(body) };
    const res = await fetch(url + '/api' + path, options);
    const result = await res.json();
    assert.equal(res.status, expected, `${path}: ${JSON.stringify(result)}`);
    if (res.headers.get('set-cookie')) cookies.set(who, res.headers.get('set-cookie').split(';')[0]);
    return result;
  }
  const login = async who => request('/login', { userId: who }, who);
  const act = async (id, action, who, values = {}, expected = 200) => request(`/tasks/${id}/action`, { action, ...values }, who, expected);
  const create = async (who, category = 'study') => (await request('/tasks', {
    title: '测试一个真实完整的互助流程', description: '希望与同学交流解题思路，不需要代做，感谢。', category,
    mode: category === 'borrow' ? 'offline' : 'online', location:'图书馆公共大厅',
    deadline: new Date(Date.now()+86400000).toISOString(), returnAt: new Date(Date.now()+172800000).toISOString(),
  }, who, 201)).task;
  const close = () => new Promise((r,j) => { app.close(e => e ? j(e) : r()); app.closeAllConnections(); });
  t.after(async () => { await close(); assert.ok(dir.startsWith(base + '\\') || dir.startsWith(base + '/')); rmSync(dir, {recursive:true,force:true}); });
  return { request, login, act, create, get url() { return url; }, async restart() { await close(); app=createApp({dataFile}); app.listen(0,'127.0.0.1'); await once(app,'listening'); url=`http://127.0.0.1:${app.address().port}`; } };
}

test('study: two accounts complete, private thanks and messages stay private, data survives restart', async t => {
  const f=await fixture(t); await f.login('lin'); await f.login('zhou'); await f.login('xu');
  const task=await f.create('lin');
  await f.act(task.id,'respond','lin',{message:'不能帮助自己'},400);
  let r=await f.act(task.id,'respond','zhou',{message:'我今晚可以帮你交流一下'});
  const responseId=r.task.myResponse.id;
  const stranger=await f.request('/tasks/'+task.id,undefined,'xu');
  assert.equal(stranger.task.responses.length,0);
  await f.act(task.id,'select','xu',{responseId},403);
  await f.act(task.id,'select','lin',{responseId});
  await f.act(task.id,'message','zhou',{text:'这是只对双方可见的约定'});
  await f.act(task.id,'message','xu',{text:'无关账号留言'},403);
  assert.equal((await f.request('/tasks/'+task.id,undefined,'xu')).task.messages.length,0);
  await f.act(task.id,'complete','lin',{},409);
  await f.act(task.id,'submit','zhou');
  await f.act(task.id,'redo','lin',{reason:'还有一道题的思路想确认'});
  await f.act(task.id,'submit','zhou');
  await f.act(task.id,'complete','lin');
  await f.act(task.id,'thank','lin',{text:'谢谢你耐心解释，现在真的明白了！'});
  assert.equal((await f.request('/thanks',undefined,'zhou')).tasks.length,1);
  assert.equal((await f.request('/thanks',undefined,'xu')).tasks.length,0);
  assert.equal((await f.request('/tasks/'+task.id,undefined,'guest')).task.thanks,null);
  await f.restart(); await f.login('lin');
  r=await f.request('/tasks/'+task.id,undefined,'lin');
  assert.equal(r.task.status,'completed'); assert.match(r.task.thanks.text,/耐心解释/); assert.equal(r.task.messages.length,2);
});

test('borrowing requires delivery, borrower return and lender confirmation before completion', async t => {
  const f=await fixture(t);await f.login('lin');await f.login('zhou');
  const task=await f.create('lin','borrow');
  const r=await f.act(task.id,'respond','zhou',{message:'我有一把伞可以借给你'});
  await f.act(task.id,'select','lin',{responseId:r.task.myResponse.id});
  await f.act(task.id,'submit','zhou',{},409);
  await f.act(task.id,'return','lin',{},409);
  await f.act(task.id,'deliver','lin',{},403);
  await f.act(task.id,'deliver','zhou');
  await f.act(task.id,'cancel','lin');
  await f.act(task.id,'accept-cancel','zhou',{},409);
  await f.act(task.id,'decline-cancel','zhou');
  await f.act(task.id,'return','lin');
  await f.act(task.id,'submit','zhou',{},409);
  await f.act(task.id,'confirm-return','zhou');
  await f.act(task.id,'submit','zhou');
  assert.equal((await f.act(task.id,'complete','lin')).task.status,'completed');
});

test('concurrent selections choose exactly one helper and close other responses', async t => {
  const f=await fixture(t);await f.login('lin');await f.login('zhou');await f.login('xu');
  const task=await f.create('lin');
  const a=await f.act(task.id,'respond','zhou',{message:'我来帮助你学习'});
  const b=await f.act(task.id,'respond','xu',{message:'我也有时间帮你'});
  await f.act(task.id,'respond','zhou',{message:'重复的响应应该失败'},409);
  // Use each API request through the fixture so the owner's real session is retained.
  const results=await Promise.allSettled([
    f.act(task.id,'select','lin',{responseId:a.task.myResponse.id}),
    f.act(task.id,'select','lin',{responseId:b.task.myResponse.id}),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.actual,409);
  const current=(await f.request('/tasks/'+task.id,undefined,'lin')).task;
  assert.equal(current.responses.filter(r=>r.state==='chosen').length,1);
  assert.equal(current.responses.filter(r=>r.state==='closed').length,1);
});

test('withdrawal reopens requests, active cancellation needs the other participant', async t => {
  const f=await fixture(t);await f.login('lin');await f.login('zhou');
  const task=await f.create('lin');
  await f.act(task.id,'respond','zhou',{message:'我有时间可以帮忙'});
  assert.equal((await f.act(task.id,'withdraw','zhou')).task.status,'open');
  const r=await f.act(task.id,'respond','zhou',{message:'重新安排好时间啦'});
  await f.act(task.id,'select','lin',{responseId:r.task.myResponse.id});
  await f.act(task.id,'cancel','lin');
  await f.act(task.id,'accept-cancel','lin',{},403);
  assert.equal((await f.act(task.id,'accept-cancel','zhou')).task.status,'cancelled');
});

test('expired open requests close, active ones do not auto-finish or disappear', async t => {
  const data=seedData();data.tasks[0].deadline=new Date(Date.now()-1000).toISOString();
  data.tasks[1].deadline=new Date(Date.now()-1000).toISOString();data.tasks[1].status='active';data.tasks[1].helperId='zhou';
  const f=await fixture(t,data);await f.login('zhou');
  const tasks=(await f.request('/tasks')).tasks;
  assert.equal(tasks[0].status,'expired');assert.equal(tasks[1].status,'active');
  await f.act(tasks[0].id,'respond','zhou',{message:'过期后不能再响应'},409);
});

test('validation, unauthenticated changes, cross-origin requests and static file boundaries', async t => {
  const f=await fixture(t);
  await f.request('/tasks',{},'guest',401);
  await f.login('lin');
  await f.request('/tasks',{title:'错误字段'},'lin',400);
  await f.request('/logout',{},'lin',403,{Origin:'https://unrelated.example'});
  const response=await fetch(f.url+'/data/store.json');assert.equal(response.status,404);
  const home=await fetch(f.url+'/');assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const cleared=await f.request('/logout',{},'lin');assert.equal(cleared.ok,true);
  assert.equal((await f.request('/me',undefined,'lin')).user,null);
});
