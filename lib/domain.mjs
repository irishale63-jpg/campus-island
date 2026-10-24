import { accounts } from './seed.mjs';
import { randomUUID } from 'node:crypto';
export const knownAccounts = new Map(accounts.map(u => [u.id, u]));
const openStates = ['open', 'selecting'];
export const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
export const must = (condition, message, status = 400) => { if (!condition) fail(message, status); };
export function clean(value, label, min = 1, max = 1000) {
  must(typeof value === 'string', `请填写${label}`);
  const text = value.trim();
  must(text.length >= min && text.length <= max, `${label}需要 ${min}—${max} 个字符`);
  return text;
}
const iso = () => new Date().toISOString();

export function createDomain(getStore, save = () => {}) {
  function expire() {
    let changed = false;
    for (const task of getStore().tasks) {
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
  return { expire, view, act };
}
