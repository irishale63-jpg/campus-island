const $ = (selector, root = document) => root.querySelector(selector);
const state = { user: null, tasks: [], category: 'all', query: '', sort: 'latest', allStates: false, mine: 'all', view: 'plaza', detail: null };
const names = { open: '等待帮助', selecting: '等待确认', active: '互助进行中', review: '待确认完成', completed: '已完成', cancelled: '已取消', expired: '已过期' };
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  book: '<path d="M12 5v16M3 3c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z"/>',
  box: '<path d="m3 7 9-5 9 5v10l-9 5-9-5Z M3 7l9 5 9-5 M12 12v10 M7.5 4.5l9 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6 M12 7h.01"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  plus: '<path d="M12 4v16 M4 12h16"/>',
  leaf: '<path d="M20 3C5 2 0 13 7 18c7 7 16-2 13-15Z M5 21 17 7"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.heart}</svg>`;
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const avatar = user => `<span class="avatar ${e(user?.color || '')}" aria-hidden="true">${e(user?.initial || '你')}</span>`;
const cat = task => `<span class="category-tag ${task.category === 'borrow' ? 'borrow' : ''}">${icon(task.category === 'borrow' ? 'box' : 'book')}${task.category === 'borrow' ? '物品借用' : '学习互助'}</span>`;
const status = task => `<span class="status ${e(task.status)}">${names[task.status] || '状态更新中'}</span>`;
const date = value => new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(value));
function deadline(value) {
  const hours = Math.ceil((Date.parse(value) - Date.now()) / 3600000);
  return hours <= 0 ? '已到截止时间' : hours < 24 ? `${hours} 小时后截止` : `${Math.ceil(hours / 24)} 天内响应`;
}
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3600); }
async function api(path, body) {
  const response = await fetch('/api' + path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type':'application/json', 'X-Requested-With':'CampusKindness' }, body:JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败，请稍后重试');
  return data;
}
function openDialog(id) { const d = $('#' + id); if (!d.open) d.showModal(); }
const isOpen = task => ['open','selecting'].includes(task.status);
function requireUser() { if (state.user) return true; openAccounts(); return false; }
function drawNavigation() {
  const items = [['plaza','grid','互助广场'],['my','heart','我的互助'],['thanks','mail','我的感谢卡']];
  $('#navigation').innerHTML = items.map(([key, glyph, label]) => `<a href="#${key}" class="nav-item ${state.view === key ? 'active' : ''}" ${state.view === key ? 'aria-current="page"' : ''}>${icon(glyph)}${label}${key === 'plaza' ? `<span class="nav-count">${state.tasks.filter(isOpen).length}</span>` : ''}</a>`).join('') + `<button type="button" class="nav-item full" data-about>${icon('info')}关于善意同行</button>`;
  $('#mobile-nav').innerHTML = `<a href="#plaza" class="${state.view === 'plaza' ? 'active' : ''}">${icon('grid')}广场</a><button type="button" data-publish>${icon('plus')}发布</button><a href="#my" class="${state.view === 'my' ? 'active' : ''}">${icon('heart')}互助</a><a href="#thanks" class="${state.view === 'thanks' ? 'active' : ''}">${icon('mail')}感谢</a><button type="button" data-account>${icon('user')}${state.user ? e(state.user.name) : '身份'}</button>`;
  $('#profile-button').innerHTML = `${avatar(state.user)}<span>${state.user ? e(state.user.name) : '选择演示身份'}<small>${state.user ? '演示中 · 点击切换身份' : '开始你的一次校园互助'}</small></span><span class="profile-arrow">⇄</span>`;
  $('#breadcrumb').textContent = { plaza:'互助广场', my:'我的互助', thanks:'我的感谢卡' }[state.view];
}
const heroArt = `<div class="hero-art" aria-hidden="true"><svg viewBox="0 0 420 330" fill="none" xmlns="http://www.w3.org/2000/svg">
<g stroke-linecap="round" stroke-linejoin="round">
<path d="M36 64v12m-6-6h12M365 53v16m-8-8h16M321 286v12m-6-6h12" stroke="#cfb9dd" stroke-width="1.4"/>
<circle cx="372" cy="94" r="2" fill="#d7c3e2"/><circle cx="57" cy="284" r="2" fill="#e2c5d7"/>
<path d="M311 30c-4-10-17-4-12 4l12 10 11-10c5-8-8-14-11-4Z" fill="#f3e5f0" stroke="#d3b6cd" stroke-width="1.2"/>
<rect x="222" y="118" width="154" height="139" rx="7" fill="#f5effa" stroke="#c6b3d9" stroke-width="1.4"/>
<path d="M229 118h140a7 7 0 0 1 7 7v15H222v-15a7 7 0 0 1 7-7Z" fill="#e6dcf1"/>
<path d="M222 140h154" stroke="#c6b3d9"/>
<text x="235" y="132" font-family="Georgia,serif" font-size="9" letter-spacing="1" fill="#a28bb5">a note for you</text>
<rect x="358" y="125" width="9" height="8" rx="1" stroke="#b8a1cc"/>
<path d="M309 168c-13-16-33 1-17 15l17 14 17-14c16-14-4-31-17-15Z" fill="#efdce9" stroke="#c598b5" stroke-width="1.4"/>
<path d="M277 222c12-12 18 13 29 0s17 10 30-1M280 235h52" stroke="#d6c3e2" stroke-width="1.3"/>
<rect x="52" y="41" width="257" height="210" rx="9" fill="#fffaf8" stroke="#c7afd5" stroke-width="1.5"/>
<path d="M61 41h239a9 9 0 0 1 9 9v18H52V50a9 9 0 0 1 9-9Z" fill="#eae0f4"/>
<path d="M52 68h257" stroke="#c7afd5"/>
<rect x="65" y="50" width="8" height="10" rx="1" stroke="#b398c8"/>
<path d="M67 53h4m-4 3h4" stroke="#b398c8"/>
<text x="82" y="59" font-family="Georgia,serif" font-size="10" letter-spacing="1.4" fill="#9277a4">little kind things</text>
<path d="M277 58h7m12-6v7h-7v-7h7Z" stroke="#b398c8" stroke-width="1.1"/>
<g stroke="#bc8ca8" stroke-width="1.6">
<path d="M122 144q54-78 108 0" fill="#fbf0f4"/>
<path d="M122 144q13-13 27 0 13-13 27 0 13-13 27 0 13-13 27 0M176 105q-9 15-10 29m10-29q12 15 13 29M176 144v61q0 15-12 8"/>
<circle cx="140" cy="174" r="12" fill="#fff8f5"/>
<circle cx="210" cy="174" r="12" fill="#fff8f5"/>
<path d="M129 171q1-14 13-11m-7 7 5-5 6 6M199 169q4-10 15-8m-13 7 7-5 7 6M136 175v1m8-1v1m-7 6q3 3 6 0m63-7v1m8-1v1m-7 6q3 3 6 0"/>
<path d="M122 213v-7q0-14 18-14 14 0 19 13l10-4M228 213v-7q0-14-18-14-14 0-19 13l-10-4"/>
<path d="M128 213h25m44 0h25" stroke="#d8bddc"/>
<path d="M114 99v7m-3-3h6M239 180v7m-3-3h6M221 92v7m-3-3h6" stroke="#d6b1c9" stroke-width="1.1"/>
</g>
<text x="105" y="236" font-family="Georgia,serif" font-style="italic" font-size="10" letter-spacing=".8" fill="#b18ba4">a little help, a little closer.</text>
<g transform="rotate(-9 66 209)"><rect x="22" y="180" width="84" height="59" rx="5" fill="#f8e6ee" stroke="#cc9eb8" stroke-width="1.3"/><path d="m24 183 40 29 40-29m-80 54 28-23m52 23-28-23" stroke="#d9b2c8" stroke-width="1.3"/><path d="M65 218s-11-6-10-12c1-5 8-5 10-1 2-4 9-4 10 1 1 6-10 12-10 12Z" fill="#e8bed3" stroke="#c99bb6"/></g>
<path d="M107 273c10-5 9 10 18 3s10 4 16 0" stroke="#d8bad2" stroke-width="1.3"/>
<path d="M346 279c-3-7-12-3-8 3l8 7 8-7c4-6-5-10-8-3Z" stroke="#d7bfdc" stroke-width="1.3"/>
</g></svg></div>`;
function card(task) {
  return `<article class="task-card"><button type="button" class="card-body" data-task="${e(task.id)}" aria-label="查看需求：${e(task.title)}"><div class="card-meta">${cat(task)}${status(task)}</div><h3>${e(task.title)}</h3><p class="description">${e(task.description)}</p><div class="tags">${task.tags.map(tag=>`<span>${e(tag)}</span>`).join('')}</div><div class="card-location">${icon('pin')}${e(task.location)}</div></button><div class="card-bottom">${avatar(task.owner)}<span>${e(task.owner.name)}</span><time datetime="${e(task.deadline)}">${isOpen(task) ? deadline(task.deadline) : names[task.status]}</time><span class="arrow" aria-hidden="true">↗</span></div></article>`;
}
const empty = (title, text, action = '') => `<div class="empty-state">${icon('leaf')}<h3>${e(title)}</h3><p>${e(text)}</p>${action}</div>`;
function searchBar() { return `<label class="search">${icon('search')}<input id="search-input" type="search" aria-label="搜索互助需求" placeholder="找找有没有你能帮忙的小事" value="${e(state.query)}" maxlength="100"></label>`; }
function filters() {
  return `<div class="filter-row">${[['all','全部需求'],['study','学习互助'],['borrow','物品借用']].map(([key,label])=>`<button type="button" class="filter-chip ${state.category===key?'active':''}" data-category="${key}" aria-pressed="${state.category===key}">${label}</button>`).join('')}<span class="result-count" id="result-count"></span><select class="sort-select" aria-label="需求排序" id="sort-select"><option value="latest" ${state.sort==='latest'?'selected':''}>最新发布 ↓</option><option value="deadline" ${state.sort==='deadline'?'selected':''}>截止时间最近 ↓</option></select></div>`;
}
function drawResults() {
  let tasks = [...state.tasks];
  if (state.view === 'plaza' && !state.allStates) tasks = tasks.filter(isOpen);
  if (state.view === 'my') {
    tasks = tasks.filter(t => state.user && (t.ownerId === state.user.id || t.myResponse));
    if (state.mine === 'published') tasks = tasks.filter(t => t.ownerId === state.user?.id);
    if (state.mine === 'responded') tasks = tasks.filter(t => t.myResponse);
  }
  tasks = tasks.filter(t => (state.category === 'all' || t.category === state.category) && `${t.title} ${t.description} ${t.location} ${t.tags.join(' ')}`.toLowerCase().includes(state.query.trim().toLowerCase()));
  tasks.sort((a,b)=>state.sort === 'deadline' ? Date.parse(a.deadline)-Date.parse(b.deadline) : Date.parse(b.createdAt)-Date.parse(a.createdAt));
  $('#result-count').textContent = `${tasks.length} 条`;
  $('#task-results').innerHTML = tasks.length ? tasks.map(card).join('') : empty('还没有找到合适的小需求', '试试其他分类或关键词，也可以发布你自己的需求。', '<button class="button outline" type="button" data-publish>发布一个需求 ↗</button>');
}
function drawMain() {
  drawNavigation();
  const main = $('#main');
  if (state.view === 'thanks') { drawThanks(); return; }
  if (state.view === 'my' && !state.user) {
    main.innerHTML = `<div class="page-heading"><span class="eyebrow">YOUR LITTLE CONTRIBUTIONS</span><h1>我的互助</h1><p>每一次参与，都有迹可循。</p></div>${empty('先认识一下你吧', '选择一个演示身份，查看自己发布和参与的互助。', '<button class="button primary" type="button" data-account>选择演示身份</button>')}`; return;
  }
  const available = state.tasks.filter(isOpen);
  main.innerHTML = state.view === 'plaza' ? `<section class="hero"><div class="hero-copy"><span class="eyebrow">a little help, a warmer campus.</span><h1>一点善意，<br>让校园<span>更近一点。</span></h1><p>一道难题，一把雨伞。你的小小帮助，刚好是别人需要的温暖。</p><button class="button primary" type="button" data-explore>看看我能帮什么 ↗</button><button class="button outline" type="button" data-publish>我需要一点帮助</button></div>${heroArt}<span class="hero-mark">small things, warm hearts ♡</span></section><section class="summary" aria-label="演示需求概览"><div class="summary-item"><span class="summary-icon">${icon('heart')}</span><div><b>${available.length.toString().padStart(2,'0')}</b><p>等待回应的小需求</p></div><small>从这里开始 ↗</small></div><div class="summary-item"><span class="summary-icon">${icon('book')}</span><div><b>${available.filter(t=>t.category==='study').length.toString().padStart(2,'0')}</b><p>学习交流的机会</p></div><small>一起想一想</small></div><div class="summary-item"><span class="summary-icon">${icon('box')}</span><div><b>${available.filter(t=>t.category==='borrow').length.toString().padStart(2,'0')}</b><p>物品借用的小事</p></div><small>借一点方便</small></div></section>` : `<div class="page-heading"><span class="eyebrow">YOUR LITTLE CONTRIBUTIONS</span><h1>每一次互助，都算数。</h1><p>${e(state.user.name)}，这里记着你发出和回应的每一份小需求。</p></div><div class="filter-row">${[['all','全部参与'],['published','我发布的'],['responded','我响应的']].map(([k,l])=>`<button class="filter-chip ${state.mine===k?'active':''}" data-mine="${k}" type="button">${l}</button>`).join('')}</div>`;
  main.innerHTML += `<section id="plaza-section"><div class="section-top"><div class="section-title"><h2>${state.view==='my'?'我的互助记录':'校园里的小需求'}</h2><span>${state.view==='my'?'每一点付出都被记得':'刚好你需要，刚好我可以'}</span></div>${searchBar()}</div>${filters()}${state.view==='plaza'?`<div class="filter-row archive-filter"><button class="text-button" id="toggle-closed" type="button">${state.allStates?'☑ 正在显示全部状态':'□ 同时查看已结束的需求'}</button></div>`:''}<div class="task-grid" id="task-results"></div></section><div class="how-it-works"><p><b>01 说出需求</b>　→　找到彼此　→　认真完成　→　留下一句感谢</p><span>这里展示的是可操作的示例需求</span></div>`;
  drawResults();
}
let thanksDraw = 0;
async function drawThanks() {
  const version = ++thanksDraw;
  $('#main').innerHTML = `<div class="page-heading"><span class="eyebrow">A NOTE TO REMEMBER</span><h1>把谢谢，认真留下来。</h1><p>互助完成后的一句感谢，只在你们之间传递。</p></div><div class="thanks-grid" id="thanks-results"></div>`;
  if (!state.user) { $('#thanks-results').innerHTML = empty('你的感谢卡，等你来打开', '先选择演示身份，查看你送出或收到的感谢。', '<button class="button primary" data-account type="button">选择演示身份</button>'); return; }
  try {
    const { tasks } = await api('/thanks');
    if (state.view !== 'thanks' || version !== thanksDraw) return;
    $('#thanks-results').innerHTML = tasks.length ? tasks.map(task=>`<div class="thank-entry">${thankCard(task)}<button class="text-button" data-task="${e(task.id)}" type="button">查看这次互助 ↗</button></div>`).join('') : empty('第一张感谢卡，从一次帮助开始', '完成互助后，发起人可以在需求详情里送出一张感谢卡。', '<a class="button outline" href="#plaza">去看看谁需要帮助 ↗</a>');
  } catch (err) { if ($('#thanks-results')) $('#thanks-results').innerHTML = empty('暂时没有打开感谢卡',err.message); }
}
function thankCard(task) { return `<article class="thank-card"><span class="eyebrow">A LITTLE THANK YOU</span><span>${icon('heart')}</span><blockquote>${e(task.thanks.text)}</blockquote><p>${e(task.owner.name)} → ${e(task.helper.name)} · ${date(task.thanks.at)}</p><p>关于「${e(task.title)}」</p></article>`; }
async function reload() { const [me, list] = await Promise.all([api('/me'),api('/tasks')]); state.user=me.user; state.tasks=list.tasks; drawMain(); }
async function openAccounts() {
  try {
    const { accounts } = await api('/demo-accounts');
    $('#accounts').innerHTML = accounts.length ? accounts.map(u=>`<button class="account-option" type="button" data-login="${e(u.id)}">${avatar(u)}<span>${e(u.name)}<small>${e(u.bio)}</small></span><span class="current">${state.user?.id===u.id?'当前身份':'选择 ↗'}</span></button>`).join('') : '<p>演示登录已关闭。</p>';
    openDialog('account-dialog');
  } catch(err) { toast(err.message); }
}
function localInputDate(ms) { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function openPublish() {
  if (!requireUser()) { toast('选择身份后，再点击发布需求'); return; }
  const form=$('#publish-form'); form.reset(); $('#publish-error').textContent='';
  form.elements.deadline.min=localInputDate(Date.now()+60000); form.elements.deadline.value=localInputDate(Date.now()+86400000);
  form.elements.returnAt.value=localInputDate(Date.now()+172800000); updateFields(); openDialog('publish-dialog');
}
function updateFields() {
  const form=$('#publish-form'), loan=form.elements.category.value==='borrow';
  if(loan) form.elements.mode.value='offline';
  form.elements.mode.disabled=loan;
  $('#return-field').hidden=!loan; form.elements.returnAt.required=loan;
  $('#location-field').hidden=form.elements.mode.value==='online'; form.elements.location.required=form.elements.mode.value!=='online';
}
const actionButton = (task, action, text, style='primary', extra='') => `<button type="button" class="button ${style}" data-action="${action}" data-id="${e(task.id)}" ${extra}>${text}</button>`;
function detailHTML(task) {
  const owner=state.user?.id===task.ownerId, helper=state.user?.id===task.helperId, participant=owner||helper;
  let html=`<div class="detail-top">${cat(task)}${status(task)}<button class="icon-button" data-close="detail-dialog" aria-label="关闭需求详情">×</button></div><h2 class="detail-title">${e(task.title)}</h2><div class="detail-author">${avatar(task.owner)}<span>${e(task.owner.name)} 发布</span><small>${date(task.createdAt)}</small></div><p class="detail-description">${e(task.description)}</p><div class="detail-facts"><div><small>协作区域</small>${e(task.location)}</div><div><small>响应截止</small>${date(task.deadline)}</div>${task.returnAt?`<div><small>预计归还</small>${date(task.returnAt)}</div>`:''}${task.helper?`<div><small>这次的帮助者</small>${e(task.helper.name)}</div>`:''}</div>`;
  if (isOpen(task)) {
    if (owner) {
      html+=`<section class="detail-section"><h3>愿意帮忙的同学 · ${task.responseCount}</h3>`;
      const pending=task.responses.filter(r=>r.state==='pending');
      html+=pending.length ? pending.map(r=>`<div class="response-item"><div class="response-person">${avatar(r.user)}${e(r.user.name)}${actionButton(task,'select','请这位同学帮忙','primary small',`data-response="${e(r.id)}"`)}</div><p>${e(r.message)}</p></div>`).join('') : '<p class="info-line">需求已经发布，等待合适的同学看见。</p>';
      html+=`<div class="detail-actions">${actionButton(task,'cancel','取消这条需求','quiet')}</div></section>`;
    } else if (task.myResponse?.state==='pending') {
      html+=`<section class="detail-section"><h3>你的帮助意愿已送达</h3><p class="info-line">${e(task.myResponse.message)}<br>等待发起人确认，请先不要直接行动。</p>${actionButton(task,'withdraw','撤回响应','quiet')}</section>`;
    } else {
      html+=`<section class="detail-section"><h3>刚好你可以帮上忙？</h3>${state.user?`<form class="inline-form" data-operation="respond" data-id="${e(task.id)}"><textarea name="message" aria-label="响应说明" placeholder="说说你能提供的帮助和方便的时间…" required minlength="2" maxlength="300"></textarea><button class="button primary" type="submit">我可以帮忙 ↗</button></form>`:'<p class="info-line">先选择一个演示身份，就能回应这份需求。</p><button class="button primary" type="button" data-account>选择身份，参与帮助</button>'}</section>`;
    }
  }
  if (participant && task.helperId) {
    html+=`<section class="detail-section"><h3>你们的协作区 <small>仅互助双方可见</small></h3>`;
    if (task.category==='borrow') {
      html+=`<div class="loan-steps">${[['deliveredAt','① 交付物品'],['returnedAt','② 提交归还'],['confirmedAt','③ 确认收到']].map(([k,t])=>`<div class="loan-step ${task.loan[k]?'done':''}">${t}${task.loan[k]?' ✓':''}</div>`).join('')}</div>`;
      if (task.status==='active') {
        if(helper&&!task.loan.deliveredAt)html+=actionButton(task,'deliver','已当面交付物品','outline');
        if(owner&&task.loan.deliveredAt&&!task.loan.returnedAt)html+=actionButton(task,'return','我已归还物品','outline');
        if(helper&&task.loan.returnedAt&&!task.loan.confirmedAt)html+=actionButton(task,'confirm-return','确认收到归还物品','outline');
      }
    }
    html+=task.messages.length?task.messages.map(m=>`<div class="message ${m.userId===state.user.id?'mine':''}"><small>${e(m.user.name)} · ${date(m.at)}</small>${e(m.text)}</div>`).join(''):'<p class="info-line">在这里约定时间、交接方式，或补充需要的帮助。</p>';
    if (['active','review'].includes(task.status)) html+=`<form class="inline-form" data-operation="message" data-id="${e(task.id)}"><textarea name="text" aria-label="协作留言" placeholder="给对方留句话…" required maxlength="500"></textarea><button type="submit" class="button quiet">发送留言</button></form>`;
    if (task.cancelRequestedBy) {
      html+='<p class="info-line">有一份待处理的取消申请。借用物品已交付时，需先归还再确认取消。</p>';
      html+=task.cancelRequestedBy===state.user.id?'<p class="info-line">已申请取消，等待对方处理。</p>':`<div class="detail-actions">${actionButton(task,'accept-cancel','同意取消','danger')}${actionButton(task,'decline-cancel','继续互助','quiet')}</div>`;
    } else if (task.status==='active') {
      html+='<div class="detail-actions">';
      if(helper&&(task.category!=='borrow'||task.loan.confirmedAt))html+=actionButton(task,'submit','这次帮助完成了 ✓');
      html+=actionButton(task,'cancel','协商取消','quiet')+'</div>';
    } else if (task.status==='review') {
      html+=owner?`<p class="info-line">对方已提交完成，请确认事情是否解决。</p><div class="detail-actions">${actionButton(task,'complete','确认完成 ✓')}${actionButton(task,'cancel','协商取消','quiet')}</div><details><summary class="text-button">还需要一点帮助？</summary><form class="inline-form" data-operation="redo" data-id="${e(task.id)}"><textarea name="reason" aria-label="继续协作的说明" placeholder="说说还有什么需要继续完成…" required minlength="2" maxlength="300"></textarea><button type="submit" class="button quiet">说明情况，继续协作</button></form></details>`:'<p class="info-line">完成申请已发送，等待发起人确认。</p>';
    }
    html+='</section>';
  }
  if (task.status==='completed'&&participant) {
    html+='<section class="detail-section"><h3>谢谢，让这次互助有了温度</h3>';
    if(task.thanks)html+=thankCard(task);
    else if(owner)html+=`<p class="info-line">这张卡片只会送给帮助你的同学。</p><form class="inline-form" data-operation="thank" data-id="${e(task.id)}"><textarea name="text" aria-label="感谢的话" placeholder="写下你想对 TA 说的谢谢…" required minlength="2" maxlength="300"></textarea><button type="submit" class="button primary">送出这张感谢卡 ♡</button></form>`;
    else html+='<p class="info-line">你们已完成这次互助。如果对方送出感谢，会出现在这里。</p>';
    html+='</section>';
  }
  html+=`<section class="detail-section"><h3>这份善意的进展</h3><ol class="timeline">${task.events.map(ev=>`<li>${e(ev.text)}<time>${date(ev.at)}</time></li>`).join('')}</ol></section>`;
  return html;
}
async function openDetail(id) {
  try { const { task }=await api('/tasks/'+encodeURIComponent(id)); state.detail=task; $('#detail-content').innerHTML=detailHTML(task); openDialog('detail-dialog'); }
  catch(err){toast(err.message);}
}
let busy=false;
async function runAction(id,body,button) {
  if(busy)return; busy=true; if(button)button.disabled=true;
  try {
    const { task }=await api('/tasks/'+encodeURIComponent(id)+'/action',body);
    state.detail=task; await reload(); $('#detail-content').innerHTML=detailHTML(task);
    toast({ respond:'帮助意愿已送达，等待对方确认',select:'找到彼此了，可以在协作区留言',complete:'互助完成，送给对方一句感谢吧',thank:'这张感谢卡已送达',message:'留言已发送',return:'已提交归还，等待出借方确认' }[body.action]||'进展已更新');
  } catch(err){toast(err.message);} finally{busy=false;if(button)button.disabled=false;}
}
document.addEventListener('click', async event=>{
  const button=event.target.closest('button,a'); if(!button)return;
  if(button.dataset.close){$('#'+button.dataset.close).close();return;}
  if(button.hasAttribute('data-about')){openDialog('about-dialog');return;}
  if(button.hasAttribute('data-account')){openAccounts();return;}
  if(button.hasAttribute('data-publish')){openPublish();return;}
  if(button.hasAttribute('data-explore')){$('#plaza-section')?.scrollIntoView({behavior:'smooth'});$('#search-input')?.focus({preventScroll:true});return;}
  if(button.dataset.task){openDetail(button.dataset.task);return;}
  if(button.dataset.login){
    button.disabled=true;
    try{await api('/login',{userId:button.dataset.login});$('#account-dialog').close();$('#detail-dialog').close();$('#publish-dialog').close();await reload();toast('现在以'+state.user.name+'的身份体验');}catch(err){toast(err.message);}finally{button.disabled=false;}return;
  }
  if(button.dataset.category){state.category=button.dataset.category;drawMain();return;}
  if(button.dataset.mine){state.mine=button.dataset.mine;drawMain();return;}
  if(button.id==='toggle-closed'){state.allStates=!state.allStates;drawMain();return;}
  if(button.dataset.action){
    const action=button.dataset.action;
    if(['select','cancel','accept-cancel','complete','deliver','return','confirm-return'].includes(action)&&!confirm({select:'确定选择这位同学？确认后将停止接收其他响应。',cancel:'确定取消或申请协商取消这次互助？', 'accept-cancel':'确定同意取消这次互助？',complete:'请确认这次需求已经解决。确认完成？',deliver:'请确认物品已经交给借用同学。',return:'请确认物品已经归还给出借同学。','confirm-return':'请确认已经收到归还的物品。'}[action]))return;
    runAction(button.dataset.id,{action,responseId:button.dataset.response},button);
  }
});
document.addEventListener('submit',event=>{
  const form=event.target;
  if(!form.dataset.operation)return;
  event.preventDefault();const body=Object.fromEntries(new FormData(form));body.action=form.dataset.operation;
  runAction(form.dataset.id,body,$('button[type=submit]',form));
});
$('#publish-form').addEventListener('change',updateFields);
$('#publish-form').addEventListener('submit',async event=>{
  event.preventDefault(); const form=event.target, button=$('button[type=submit]',form);button.disabled=true;$('#publish-error').textContent='';
  try{
    const body=Object.fromEntries(new FormData(form)); body.mode=form.elements.mode.value;
    body.deadline=new Date(body.deadline).toISOString(); body.returnAt=body.category==='borrow'?new Date(body.returnAt).toISOString():null;
    const {task}=await api('/tasks',body);$('#publish-dialog').close();state.category='all';state.query='';await reload();await openDetail(task.id);toast('需求已发布，等一个刚好能帮忙的同学');
  }catch(err){$('#publish-error').textContent=err.message;}finally{button.disabled=false;}
});
$('#main').addEventListener('input',event=>{if(event.target.id==='search-input'){state.query=event.target.value;drawResults();}});
$('#main').addEventListener('change',event=>{if(event.target.id==='sort-select'){state.sort=event.target.value;drawResults();}});
$('#profile-button').addEventListener('click',openAccounts);
$('#publish-top').addEventListener('click',openPublish);
$('#about-footer').addEventListener('click',()=>openDialog('about-dialog'));
$('#logout-button').addEventListener('click',async()=>{try{await api('/logout',{});$('#account-dialog').close();$('#detail-dialog').close();$('#publish-dialog').close();await reload();toast('已退出演示身份');}catch(err){toast(err.message);}});
function route(){state.view=['my','thanks'].includes(location.hash.slice(1))?location.hash.slice(1):'plaza';state.category='all';state.query='';drawMain();}
window.addEventListener('hashchange',route);
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'){try{await reload();if($('#detail-dialog').open&&state.detail)await openDetail(state.detail.id);}catch{}}});
state.view=['my','thanks'].includes(location.hash.slice(1))?location.hash.slice(1):'plaza';
reload().catch(err=>{$('#main').innerHTML=`<div class="empty-state error-state"><h3>暂时没有连接到校园</h3><p>${e(err.message)}</p><button class="button outline" id="retry-button" type="button">重新连接</button></div>`;$('#retry-button').addEventListener('click',()=>location.reload());});
