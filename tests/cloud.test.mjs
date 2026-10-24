import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleApi, withStore } from '../lib/cloud-api.mjs';

// Real SQLite exercises the same SQL and revision checks as hosted D1.
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../deploy/schema.sql', import.meta.url), 'utf8'));
  const prepare = sql => {
    let values = [];
    const statement = {
      bind(...args) { values = args; return statement; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async run() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; },
    };
    return statement;
  };
  return { prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try { for (const statement of statements) await statement.run(); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }, close() { sqlite.close(); } };
}
function client(db) {
  let cookie = '';
  return async (path, body, expected = 200) => {
    const headers = { cookie };
    if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', 'X-Requested-With': 'CampusKindness', Origin: 'https://example.test' });
    const response = await handleApi(new Request('https://example.test/api' + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) }), {DB: db});
    if (response.headers.has('set-cookie')) {
      assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
      assert.match(response.headers.get('set-cookie'), /Secure/);
      cookie = response.headers.get('set-cookie').split(';')[0];
    }
    const data = await response.json();
    assert.equal(response.status, expected, JSON.stringify(data)); return data;
  };
}
const taskBody = () => ({title:'云端测试学习需求',description:'一起交流一道高数题的思路，仅为测试。',category:'study',mode:'online',deadline:new Date(Date.now()+86400000).toISOString()});

test('cloud: shared durable data, private participant views, secure sessions and completed thanks', async () => {
  const db = database();
  try {
    const owner = client(db), helper = client(db), guest = client(db);
    const initialCount = (await guest('/tasks')).tasks.length;
    await owner('/login', {userId:'lin'}); await helper('/login', {userId:'zhou'});
    const {task} = await owner('/tasks', taskBody(), 201);
    const {task:responded} = await helper('/tasks/'+task.id+'/action', {action:'respond',message:'我可以一起讨论这道题'});
    await owner('/tasks/'+task.id+'/action', {action:'select',responseId:responded.myResponse.id});
    await helper('/tasks/'+task.id+'/action', {action:'message',text:'协作测试留言'});
    assert.deepEqual((await guest('/tasks/'+task.id)).task.messages, []);
    await helper('/tasks/'+task.id+'/action', {action:'submit'});
    await owner('/tasks/'+task.id+'/action', {action:'complete'});
    await owner('/tasks/'+task.id+'/action', {action:'thank',text:'谢谢你一起交流思路'});
    const freshClient = client(db);
    await freshClient('/login', {userId:'lin'});
    assert.equal((await freshClient('/thanks')).tasks.length, 1);
    assert.equal((await guest('/tasks')).tasks.length, initialCount + 1);
    assert.equal((await guest('/tasks/'+task.id)).task.thanks, null);
    await guest('/tasks', taskBody(), 401);
    await owner('/logout', {});
    assert.equal((await owner('/me')).user, null);
  } finally { db.close(); }
});

test('cloud: simultaneous writes retry without losing data or reseeding it', async () => {
  const db = database();
  try {
    const initialCount = await withStore(db, store => store.tasks.length);
    await Promise.all(['one','two'].map(id => withStore(db, store => { store.notes = [...(store.notes || []), id]; })));
    assert.deepEqual((await withStore(db, store => store.notes)).sort(), ['one','two']);
    assert.equal((await withStore(db, store => store.tasks.length)), initialCount);
  } finally { db.close(); }
});
