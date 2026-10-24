import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { accounts, seedData } from './lib/seed.mjs';
import { createDomain, knownAccounts, fail, must, clean } from './lib/domain.mjs';
import { launchAddress } from './lib/local-address.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const iso = () => new Date().toISOString();

export function createApp({ dataFile = resolve(ROOT, 'data/store.json'), demo = true } = {}) {
  mkdirSync(dirname(dataFile), { recursive: true });
  let store = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : seedData();
  const sessions = new Map();
  const save = () => {
    const temp = dataFile + '.tmp';
    writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8');
    renameSync(temp, dataFile);
  };
  if (!existsSync(dataFile)) save();
  const { expire, view, act } = createDomain(() => store, save);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (!path.startsWith('/api/')) {
        must(req.method === 'GET' || req.method === 'HEAD', '不支持的请求', 405);
        const files = { '/': ['index.html','text/html'], '/styles.css': ['styles.css','text/css'], '/app.js': ['app.js','text/javascript'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };
        const file = files[path]; must(file, '页面不存在', 404);
        res.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(req.method === 'HEAD' ? '' : readFileSync(resolve(ROOT, 'public', file[0]))); return;
      }
      let body = {};
      if (req.method === 'POST') {
        must(!req.headers.origin || req.headers.origin === `http://${req.headers.host}`, '请求来源不正确', 403);
        must(req.headers['content-type']?.startsWith('application/json') && req.headers['x-requested-with'] === 'CampusKindness', '请通过应用页面提交', 403);
        let raw = '';
        for await (const chunk of req) { raw += chunk; must(Buffer.byteLength(raw) <= 16384, '提交内容过大', 413); }
        try { body = JSON.parse(raw || '{}'); } catch { fail('提交格式不正确'); }
        must(body && typeof body === 'object' && !Array.isArray(body), '提交格式不正确');
      } else must(req.method === 'GET', '不支持的请求', 405);
      const token = (req.headers.cookie || '').match(/(?:^|;\s*)kindness_session=([a-f0-9]+)/)?.[1];
      const session = sessions.get(token);
      const userId = session && session.until > Date.now() ? session.userId : null;
      expire();
      if (path === '/api/me' && req.method === 'GET') return json({ user: knownAccounts.get(userId) || null, demo });
      if (path === '/api/demo-accounts' && req.method === 'GET') return json({ accounts: demo ? accounts : [] });
      if (path === '/api/login' && req.method === 'POST') {
        must(demo, '演示登录已关闭', 403); must(knownAccounts.has(body.userId), '请选择一个演示身份');
        if (token) sessions.delete(token);
        const key = randomBytes(32).toString('hex');
        sessions.set(key, { userId: body.userId, until: Date.now() + 86400000 });
        res.setHeader('Set-Cookie', `kindness_session=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
        return json({ user: knownAccounts.get(body.userId) });
      }
      if (path === '/api/logout' && req.method === 'POST') {
        sessions.delete(token); res.setHeader('Set-Cookie', 'kindness_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json({ ok: true });
      }
      if (path === '/api/tasks' && req.method === 'GET') return json({ tasks: store.tasks.map(t => view(t, userId)) });
      if (path === '/api/thanks' && req.method === 'GET') {
        must(userId, '请先选择演示身份', 401);
        return json({ tasks: store.tasks.filter(t => t.thanks && (t.ownerId === userId || t.helperId === userId)).map(t => view(t, userId, true)) });
      }
      if (path === '/api/tasks' && req.method === 'POST') {
        must(userId, '请先选择演示身份', 401);
        const title = clean(body.title, '标题', 4, 40), description = clean(body.description, '需求说明', 8, 1000);
        must(['study','borrow'].includes(body.category), '请选择需求分类');
        must(['online','offline'].includes(body.mode), '请选择协作方式');
        const end = Date.parse(body.deadline), back = Date.parse(body.returnAt);
        must(Number.isFinite(end) && end > Date.now(), '响应截止时间必须晚于现在');
        must(body.category !== 'borrow' || (body.mode === 'offline' && Number.isFinite(back) && back > end), '物品借用需要线下交接，归还时间须晚于响应截止时间');
        const task = { id: randomUUID(), ownerId: userId, category: body.category, title, description,
          mode: body.mode, location: body.mode === 'online' ? '线上交流' : clean(body.location, '公共交接区域', 2, 50),
          tags: body.category === 'borrow' ? ['物品借用'] : ['学习交流'], deadline: new Date(end).toISOString(), returnAt: body.category === 'borrow' ? new Date(back).toISOString() : null,
          createdAt: iso(), status: 'open', helperId: null, responses: [], messages: [], events: [{ at: iso(), userId, text: '发布了这条需求' }],
          loan: { deliveredAt: null, returnedAt: null, confirmedAt: null }, thanks: null, cancelRequestedBy: null };
        const snapshot = structuredClone(store);
        try { store.tasks.unshift(task); save(); } catch (e) { store = snapshot; throw e; }
        return json({ task: view(task, userId, true) }, 201);
      }
      const match = path.match(/^\/api\/tasks\/([^/]+)(\/action)?$/);
      if (match) {
        const task = store.tasks.find(t => t.id === match[1]); must(task, '没有找到这条需求', 404);
        if (req.method === 'GET' && !match[2]) return json({ task: view(task, userId, true) });
        must(req.method === 'POST' && match[2], '不支持的请求', 405);
        must(userId, '请先选择演示身份', 401);
        const snapshot = structuredClone(store);
        try { act(task, userId, body); save(); } catch (e) { store = snapshot; throw e; }
        return json({ task: view(task, userId, true) });
      }
      fail('接口不存在', 404);
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) json({ error: error.status ? error.message : '保存失败，请稍后重试' }, error.status || 500);
      else res.end();
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port, host, url, lan } = launchAddress();
  const server = createApp({ dataFile: process.env.DATA_FILE ? resolve(process.env.DATA_FILE) : undefined, demo: process.env.DEMO_MODE !== 'false' });
  server.listen(port, host, () => console.log(`善意同行已启动：${url}\n${lan ? '手机与电脑连接同一 Wi-Fi 后，可访问上面的地址。\n' : ''}按 Ctrl+C 停止。数据保存在本项目 data 文件夹。`));
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? '端口已被占用，请关闭旧服务或更换 PORT。' : e.message); process.exitCode = 1; });
}
