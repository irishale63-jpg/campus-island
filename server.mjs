import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { accounts, seedData } from './lib/seed.mjs';
import { launchAddress } from './lib/local-address.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const knownAccounts = new Map(accounts.map(u => [u.id, u]));
const openStates = ['open', 'selecting'];
const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
const must = (condition, message, status = 400) => { if (!condition) fail(message, status); };
function clean(value, label, min = 1, max = 1000) {
  must(typeof value === 'string', `请填写${label}`);
  const text = value.trim();
  must(text.length >= min && text.length <= max, `${label}需要 ${min}—${max} 个字符`);
  return text;
}
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
  function expire() {
    let changed = false;
    for (const task of store.tasks) {
      if (openStates.includes(task.status) && Date.parse(task.deadline) <= Date.now()) {
        task.status = 'expired'; changed = true;
        task.responses.forEach(r => { if (r.state === 'pending') r.state = 'closed'; });
        task.events.push({ at: iso(), userId: null, text: '需求已到响应截止时间' });
      }
    }
    if (changed) save();
  }
  function view(task, userId, detail = false) {
    const { responses, messages, events, thanks, cancelRequestedBy, ...summary } = task;
    const participant = userId && (task.ownerId === userId || task.helperId === userId);
    const own = responses.find(r => r.userId === userId && r.state !== 'withdrawn');
    const result = { ...summary, owner: knownAccounts.get(task.ownerId), helper: knownAccounts.get(task.helperId) || null,
      responseCount: responses.filter(r => r.state === 'pending').length,
      myResponse: own ? { ...own } : null };
    if (detail) {
      result.responses = (task.ownerId === userId ? responses : responses.filter(r => r.userId === userId))
        .map(r => ({ ...r, user: knownAccounts.get(r.userId) }));
      result.messages = participant ? messages.map(m => ({ ...m, user: knownAccounts.get(m.userId) })) : [];
      result.events = events.map(({ at, text }) => ({ at, text }));
      result.thanks = participant ? thanks : null;
      result.cancelRequestedBy = participant ? cancelRequestedBy : null;
    }
    return result;
  }
  function act(task, userId, body) {
    const owner = task.ownerId === userId;
    const helper = task.helperId === userId;
    const participant = owner || helper;
    const event = text => task.events.push({ at: iso(), userId, text });
    const response = task.responses.find(r => r.userId === userId && r.state === 'pending');
    switch (body.action) {
      case 'respond':
        must(openStates.includes(task.status), '这条需求已停止接收响应', 409);
        must(!owner, '不能响应自己发布的需求');
        must(!response, '你已经响应过了', 409);
        task.responses.push({ id: randomUUID(), userId, message: clean(body.message, '响应说明', 2, 300), state: 'pending', at: iso() });
        task.status = 'selecting'; event('收到了一份帮助意愿'); break;
      case 'withdraw':
        must(response && openStates.includes(task.status), '当前没有可撤回的响应', 409);
        response.state = 'withdrawn';
        if (!task.responses.some(r => r.state === 'pending')) task.status = 'open';
        event('一位同学撤回了响应'); break;
      case 'select': {
        must(owner, '只有发起人可以选择帮助者', 403);
        must(openStates.includes(task.status), '已经选定帮助者或需求已关闭', 409);
        const selected = task.responses.find(r => r.id === body.responseId && r.state === 'pending');
        must(selected, '这份响应已失效', 409);
        task.helperId = selected.userId;
        task.responses.forEach(r => { if (r.state === 'pending') r.state = r === selected ? 'chosen' : 'closed'; });
        task.status = 'active'; event('已确认帮助者，互助开始了'); break;
      }
      case 'message':
        must(participant && task.helperId, '只有互助双方可以使用协作区', 403);
        must(['active', 'review'].includes(task.status), '这次互助已经结束', 409);
        task.messages.push({ id: randomUUID(), userId, text: clean(body.text, '留言', 1, 500), at: iso() }); break;
      case 'deliver':
        must(helper, '由出借同学确认物品交付', 403);
        must(task.category === 'borrow' && task.status === 'active' && !task.loan.deliveredAt, '当前无法记录交付', 409);
        task.loan.deliveredAt = iso(); event('出借方确认物品已交付'); break;
      case 'return':
        must(owner, '由借用同学提交归还记录', 403);
        must(task.status === 'active' && task.category === 'borrow' && task.loan.deliveredAt && !task.loan.returnedAt, '请先完成物品交付', 409);
        task.loan.returnedAt = iso(); event('借用方表示已归还物品'); break;
      case 'confirm-return':
        must(helper, '由出借同学确认收到归还物品', 403);
        must(task.status === 'active' && task.category === 'borrow' && task.loan.returnedAt && !task.loan.confirmedAt, '请先由借用方提交归还', 409);
        task.loan.confirmedAt = iso(); event('出借方确认已收到归还物品'); break;
      case 'submit':
        must(helper, '由帮助者提交完成申请', 403);
        must(task.status === 'active' && !task.cancelRequestedBy, '当前无法申请完成', 409);
        must(task.category !== 'borrow' || task.loan.confirmedAt, '借用任务需要先确认归还', 409);
        task.status = 'review'; event('帮助者提交了完成申请'); break;
      case 'complete':
        must(owner, '由发起人确认完成', 403);
        must(task.status === 'review' && !task.cancelRequestedBy, '请先等待帮助者提交完成', 409);
        task.status = 'completed'; event('发起人确认互助完成'); break;
      case 'redo':
        must(owner, '由发起人操作', 403);
        must(task.status === 'review', '当前不处于完成确认阶段', 409);
        task.messages.push({ id: randomUUID(), userId, text: '尚需继续：' + clean(body.reason, '补充说明', 2, 300), at: iso() });
        task.status = 'active'; event('双方继续协作'); break;
      case 'cancel':
        must(participant, '只有参与者可以申请取消', 403);
        if (openStates.includes(task.status) && owner) {
          task.status = 'cancelled';
          task.responses.forEach(r => { if (r.state === 'pending') r.state = 'closed'; });
          event('发起人取消了需求');
        } else {
          must(['active', 'review'].includes(task.status), '这次互助已经结束', 409);
          must(!task.cancelRequestedBy, '已有待处理的取消申请', 409);
          task.cancelRequestedBy = userId; event('一方申请取消，等待对方确认');
        } break;
      case 'accept-cancel':
      case 'decline-cancel':
        must(participant && task.cancelRequestedBy && task.cancelRequestedBy !== userId, '请由另一方处理取消申请', 403);
        must(body.action !== 'accept-cancel' || task.category !== 'borrow' || !task.loan.deliveredAt || task.loan.confirmedAt, '请先完成并确认物品归还，再取消借用任务', 409);
        if (body.action === 'accept-cancel') task.status = 'cancelled';
        task.cancelRequestedBy = null; event(body.action === 'accept-cancel' ? '双方确认取消互助' : '未同意取消，继续协作'); break;
      case 'thank':
        must(owner, '由发起人发送感谢', 403);
        must(task.status === 'completed' && !task.thanks, '完成后可以发送一次感谢', 409);
        task.thanks = { text: clean(body.text, '感谢的话', 2, 300), at: iso() }; event('发起人送出了一张感谢卡'); break;
      default: fail('不支持的操作');
    }
    task.updatedAt = iso();
  }
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
