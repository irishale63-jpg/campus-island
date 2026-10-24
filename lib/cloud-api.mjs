import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { accounts, seedData } from './seed.mjs';
import { createDomain, knownAccounts, fail, must, clean } from './domain.mjs';

const iso = () => new Date().toISOString();
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), {
  status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
});

// Revision checks prevent concurrent requests from replacing one another's data.
// Only absent state is seeded: deployment never replaces existing data.
export async function withStore(db, operation) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let row = await db.prepare('SELECT body, revision FROM kindness_state WHERE id = 1').first();
    if (!row) {
      await db.prepare('INSERT OR IGNORE INTO kindness_state (id, body, revision) VALUES (1, ?, 0)').bind(JSON.stringify(seedData())).run();
      row = await db.prepare('SELECT body, revision FROM kindness_state WHERE id = 1').first();
    }
    const store = JSON.parse(row.body), domain = createDomain(() => store);
    domain.expire();
    const value = operation(store, domain), next = JSON.stringify(store);
    if (next === row.body) return value;
    const result = await db.prepare('UPDATE kindness_state SET body = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').bind(next, row.revision).run();
    if (result.meta.changes === 1) return value;
  }
  fail('同时操作较多，请稍后重试', 409);
}

async function rateLimit(db, request) {
  const now = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') || 'local-preview';
  const bucket = createHash('sha256').update(ip).digest('hex') + ':' + Math.floor(now / 300000);
  const row = await db.prepare('INSERT INTO kindness_rate_buckets (id, used, until) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET used = used + 1 RETURNING used').bind(bucket, now + 600000).first();
  must(row.used <= 120, '操作太频繁，请稍后再试', 429);
  await db.prepare('DELETE FROM kindness_rate_buckets WHERE until < ?').bind(now).run();
}

export async function handleApi(request, env) {
  try {
    const db = env.DB;
    must(db, '云端数据暂时不可用，请稍后重试', 503);
    const url = new URL(request.url), path = url.pathname;
    let body = {};
    if (request.method === 'POST') {
      must(!request.headers.get('origin') || request.headers.get('origin') === url.origin, '请求来源不正确', 403);
      must(request.headers.get('content-type')?.startsWith('application/json') && request.headers.get('x-requested-with') === 'CampusKindness', '请通过应用页面提交', 403);
      const reader = request.body?.getReader(), chunks = []; let size = 0;
      if (reader) {
        try {
          while (true) {
            const {done, value} = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 16384) { await reader.cancel(); fail('提交内容过大', 413); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { body = JSON.parse(new TextDecoder().decode(bytes) || '{}'); } catch { fail('提交格式不正确'); }
      must(body && typeof body === 'object' && !Array.isArray(body), '提交格式不正确');
      await rateLimit(db, request);
    } else must(request.method === 'GET', '不支持的请求', 405);
    const token = (request.headers.get('cookie') || '').match(/(?:^|;\s*)kindness_session=([a-f0-9]{64})/)?.[1];
    const session = token ? await db.prepare('SELECT user_id FROM kindness_sessions WHERE token = ? AND until > ?').bind(token, Date.now()).first() : null;
    const userId = session?.user_id, secure = url.protocol === 'https:' ? '; Secure' : '';
    if (path === '/api/me' && request.method === 'GET') return json({ user: knownAccounts.get(userId) || null, demo: true });
    if (path === '/api/demo-accounts' && request.method === 'GET') return json({ accounts });
    if (path === '/api/login' && request.method === 'POST') {
      must(knownAccounts.has(body.userId), '请选择一个演示身份');
      const key = randomBytes(32).toString('hex');
      const statements = [db.prepare('DELETE FROM kindness_sessions WHERE until < ?').bind(Date.now())];
      if (token) statements.push(db.prepare('DELETE FROM kindness_sessions WHERE token = ?').bind(token));
      statements.push(db.prepare('INSERT INTO kindness_sessions (token, user_id, until) VALUES (?, ?, ?)').bind(key, body.userId, Date.now() + 86400000));
      await db.batch(statements);
      return json({ user: knownAccounts.get(body.userId) }, 200, { 'Set-Cookie': `kindness_session=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure}` });
    }
    if (path === '/api/logout' && request.method === 'POST') {
      if (token) await db.prepare('DELETE FROM kindness_sessions WHERE token = ?').bind(token).run();
      return json({ ok: true }, 200, { 'Set-Cookie': `kindness_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}` });
    }
    if (path === '/api/tasks' && request.method === 'GET') return json(await withStore(db, (store, {view}) => ({ tasks: store.tasks.map(t => view(t, userId)) })));
    if (path === '/api/thanks' && request.method === 'GET') {
      must(userId, '请先选择演示身份', 401);
      return json(await withStore(db, (store, {view}) => ({ tasks: store.tasks.filter(t => t.thanks && (t.ownerId === userId || t.helperId === userId)).map(t => view(t, userId, true)) })));
    }
    if (path === '/api/tasks' && request.method === 'POST') {
      must(userId, '请先选择演示身份', 401);
      const title = clean(body.title, '标题', 4, 40), description = clean(body.description, '需求说明', 8, 1000);
      must(['study', 'borrow'].includes(body.category), '请选择需求分类');
      must(['online', 'offline'].includes(body.mode), '请选择协作方式');
      const end = Date.parse(body.deadline), back = Date.parse(body.returnAt);
      must(Number.isFinite(end) && end > Date.now(), '响应截止时间必须晚于现在');
      must(body.category !== 'borrow' || (body.mode === 'offline' && Number.isFinite(back) && back > end), '物品借用需要线下交接，归还时间须晚于响应截止时间');
      const task = { id: randomUUID(), ownerId: userId, category: body.category, title, description, mode: body.mode,
        location: body.mode === 'online' ? '线上交流' : clean(body.location, '公共交接区域', 2, 50),
        tags: [body.category === 'borrow' ? '物品借用' : '学习交流'], deadline: new Date(end).toISOString(), returnAt: body.category === 'borrow' ? new Date(back).toISOString() : null,
        createdAt: iso(), status: 'open', helperId: null, responses: [], messages: [], events: [{at: iso(), userId, text: '发布了这条需求'}],
        loan: {deliveredAt: null, returnedAt: null, confirmedAt: null}, thanks: null, cancelRequestedBy: null };
      return json(await withStore(db, (store, {view}) => {
        must(store.tasks.length < 500, '演示需求已达到容量上限，请联系项目维护者', 409);
        store.tasks.unshift(task); return {task: view(task, userId, true)};
      }), 201);
    }
    const match = path.match(/^\/api\/tasks\/([^/]+)(\/action)?$/);
    if (match) {
      must(request.method === 'GET' && !match[2] || request.method === 'POST' && match[2], '不支持的请求', 405);
      if (request.method === 'POST') must(userId, '请先选择演示身份', 401);
      return json(await withStore(db, (store, {view, act}) => {
        const task = store.tasks.find(t => t.id === match[1]); must(task, '没有找到这条需求', 404);
        if (request.method === 'POST') {
          must(task.events.length < 500 && task.messages.length < 300 && task.responses.length < 100, '这条演示需求的操作已达到上限', 409);
          act(task, userId, body);
        }
        return {task: view(task, userId, true)};
      }));
    }
    fail('接口不存在', 404);
  } catch (error) {
    if (!error.status) console.error('Campus API error', error.message);
    return json({error: error.status ? error.message : '保存失败，请稍后重试'}, error.status || 500);
  }
}
