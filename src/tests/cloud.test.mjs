import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleApi, withStore } from '../lib/cloud-api.mjs';

// Real SQLite exercises the same SQL and revision checks as hosted D1.
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../lib/schema.sql', import.meta.url), 'utf8'));
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
function client(db,extraEnv={}) {
  let cookie = '';
  return async (path, body, expected = 200) => {
    const headers = { cookie };
    const multipart=body instanceof FormData;
    if (body !== undefined) Object.assign(headers, { ...(!multipart?{'Content-Type': 'application/json'}:{}), 'X-Requested-With': 'CampusKindness', Origin: 'https://example.test' });
    const response = await handleApi(new Request('https://example.test/api' + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : multipart?body:JSON.stringify(body) }), {DB: db,...extraEnv});
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

test('cloud avatar metadata and object storage survive recovery and remove replaced photos',async()=>{
  const db=database(),objects=new Map(),env={BUCKET:{async put(key,bytes){objects.set(key,bytes);},async get(key){return objects.has(key)?{body:objects.get(key)}:null;},async delete(key){objects.delete(key);}}};
  try{
    const owner=client(db,env),created=await owner('/identities',{name:'云端头像',avatar:'leaf'},201);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGKsAAAAASUVORK5CYII=','base64');
    const form=new FormData();form.set('name','云端头像');form.set('avatar','photo');form.set('image',new Blob([png],{type:'image/png'}),'avatar.png');
    const {user}=await owner('/me/profile',form);assert.equal(objects.size,1);assert.ok(user.avatarUrl);
    const restored=client(db,env);await restored('/identities/restore',{recoveryKey:created.recoveryKey});assert.equal((await restored('/me')).user.avatarUrl,user.avatarUrl);
    await restored('/me/profile',{name:'云端头像',avatar:'moon'});assert.equal(objects.size,0);assert.equal((await restored('/me')).user.avatarUrl,null);
  }finally{db.close();}
});

test('cloud management: server-configured key, durable admin sessions and sample import',async()=>{
  const db=database();
  try {
    const key='cloud-management-test-key-32-characters';
    const adminEnv={ADMIN_KEY:key};
    const unconfigured=client(db),admin=client(db,adminEnv),visitor=client(db);
    await unconfigured('/admin/login',{key},503);
    await visitor('/admin/overview',undefined,401);
    await admin('/admin/login',{key});
    assert.deepEqual(await admin('/admin/samples',{}),{usersAdded:28,tasksAdded:28});
    assert.equal((await admin('/admin/overview')).summary.demoUsers,31);
    const newSession=client(db,{ADMIN_KEY:key});await newSession('/admin/login',{key});
    assert.equal((await newSession('/admin/overview')).tasks.filter(t=>t.isSample).length,28);
    await visitor('/admin/samples',{},401);
    adminEnv.ADMIN_KEY='';await admin('/admin/overview',undefined,401);
    adminEnv.ADMIN_KEY='rotated-management-key-32-characters';await admin('/admin/overview',undefined,401);
    await admin('/admin/login',{key},401);
    await admin('/admin/login',{key:adminEnv.ADMIN_KEY});await admin('/admin/overview');
  } finally {db.close();}
});

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

test('cloud: upgrading an existing database retains requests and inserts examples only once', async () => {
  const db = database();
  try {
    const custom = {id:'existing-user-request',title:'现有用户的需求',status:'completed',responses:[],messages:[{text:'保留这条留言'}],events:[]};
    const old = {version:1,tasks:[custom],notes:['保留其他字段']};
    await db.prepare('INSERT INTO kindness_state (id, body, revision) VALUES (1, ?, 0)').bind(JSON.stringify(old)).run();
    const first = await withStore(db, store => structuredClone(store));
    assert.deepEqual(first.tasks.find(t=>t.id===custom.id),{...custom,schoolId:'ccnu',circleMode:'demo'});
    assert.deepEqual(first.notes,old.notes);
    assert.equal(first.tasks.length,3);
    const second = await withStore(db, store => structuredClone(store));
    assert.deepEqual(second,first);
  } finally { db.close(); }
});
