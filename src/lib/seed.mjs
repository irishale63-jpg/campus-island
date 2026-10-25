export const accounts = [
  { id: 'lin', name: '林同学', initial: '林', color: 'sage', bio: '认真学习，也愿意分享一点温暖。' },
  { id: 'zhou', name: '周同学', initial: '周', color: 'apricot', bio: '喜欢运动，随身带着一把备用伞。' },
  { id: 'xu', name: '许同学', initial: '许', color: 'lavender', bio: '擅长整理资料，偶尔需要一点帮助。' },
];

export function seedData() {
  const now = Date.now();
  const specs = [
    ['rain', 'lin', 'borrow', '想借一把伞，陪我走过这场雨', '晚上下课要去图书馆，忘记带伞了。想借一把雨伞，明天中午在教学楼大厅归还，谢谢你！', '文华公书林门口', ['雨具', '明日归还'], 8],
    ['math', 'xu', 'study', '高数这道极限题，想听听你的思路', '正在复习函数极限，对等价无穷小的使用条件有点困惑。希望找同学交流思路，十几分钟就好，不需要代做。', '线上交流', ['高等数学', '思路交流'], 24],
    ['calculator', 'zhou', 'borrow', '明天的实验课，想借一个计算器', '实验课需要科学计算器，用两个小时左右。可以在理科楼大厅交接，当天下午归还。', '理科楼大厅', ['学习用品', '短时借用'], 20],
    ['english', 'lin', 'study', '一起练习十分钟英语口语吧', '准备英语课堂展示，想找同学相互听一遍、提一点建议。线上语音或图书馆公共讨论区都可以。', '图书馆讨论区', ['英语口语', '相互练习'], 32],
    ['notes', 'zhou', 'study', '第一次写实验报告，想请教排版', '正文已经写完，想了解目录、图题和参考文献的排版方法。希望学会自己调整，不需要帮忙写内容。', '线上交流', ['文档排版', '经验分享'], 40],
    ['pump', 'xu', 'borrow', '篮球有点漏气，谁有打气筒呀', '周末和室友打球，篮球需要补气。借用大概十分钟，打完马上归还，在体育馆外碰面即可。', '佑铭体育馆外', ['运动用品', '用后即还'], 48],
  ];
  const tasks = specs.map(([id, ownerId, category, title, description, location, tags, hours], i) => ({
    id, ownerId, category, title, description, location, tags,
    mode: location === '线上交流' ? 'online' : 'offline',
    deadline: new Date(now + hours * 3600000).toISOString(),
    returnAt: category === 'borrow' ? new Date(now + (hours + 24) * 3600000).toISOString() : null,
    createdAt: new Date(now - (i + 1) * 1700000).toISOString(),
    status: 'open', helperId: null, responses: [], messages: [],
    events: [{ text: '发布了这条需求', userId: ownerId, at: new Date(now - (i + 1) * 1700000).toISOString() }],
    loan: { deliveredAt: null, returnedAt: null, confirmedAt: null },
    thanks: null, cancelRequestedBy: null,
  }));
  const store = { version: 1, tasks };
  ensureDemoExamples(store);
  return store;
}

// Append clearly labeled examples once. Existing requests and conversations stay intact.
export function ensureDemoExamples(store) {
  if (store.demoExamplesVersion >= 1) return false;
  const now = Date.now(), at = hours => new Date(now - hours * 3600000).toISOString();
  const base = (id, ownerId, helperId, category, title, description, status) => ({
    id, ownerId, helperId, category, title, description, status, isDemo: true,
    location: category === 'study' ? '线上交流' : '图书馆一楼公共大厅',
    mode: category === 'study' ? 'online' : 'offline', tags: ['演示案例'],
    deadline: new Date(now + 86400000).toISOString(), returnAt: category === 'borrow' ? at(2) : null,
    createdAt: at(12), updatedAt: at(1),
    responses: [{id: id+'-response', userId: helperId, message: '我可以一起完成这件小事。', state: 'chosen', at: at(10)}],
    messages: [], cancelRequestedBy: null, thanks: null,
    loan: {deliveredAt: null, returnedAt: null, confirmedAt: null},
    events: [{at: at(12), userId: ownerId, text: '发布需求（演示案例）'}, {at: at(10), userId: ownerId, text: '确认帮助者，开始协作（演示案例）'}],
  });
  const active = base('demo-active', 'lin', 'zhou', 'study', '一起准备英语课堂展示', '这是进行中的演示案例。林同学与周同学已约好交流展示思路，你可以切换到这两个演示身份，体验协作留言和完成确认。', 'active');
  active.messages.push({id:'demo-message', userId:'zhou', text:'我整理好了一个开场思路，今晚一起交流吧。（演示内容）', at:at(1)});
  const done = base('demo-completed', 'zhou', 'xu', 'borrow', '计算器已归还，谢谢你', '这是已完成的演示案例。借用、交付、归还与双方确认已经完成。切换到周同学或许同学，可以查看这张演示感谢卡。', 'completed');
  done.loan = {deliveredAt:at(8), returnedAt:at(3), confirmedAt:at(2)};
  done.completedAt = at(1.5);
  for (const [hours,text,userId] of [[8,'出借方确认交付物品','xu'],[3,'借用方提交归还','zhou'],[2,'出借方确认收到归还物品','xu'],[1.8,'帮助者提交完成申请','xu'],[1.5,'发起人确认完成','zhou'],[1,'送出感谢卡','zhou']]) done.events.push({at:at(hours),userId,text:text+'（演示案例）'});
  done.thanks = {text:'谢谢你借来的计算器，实验顺利完成，也记住了这份小小的善意。',at:at(1)};
  for (const task of [active,done]) if (!store.tasks.some(t=>t.id===task.id)) store.tasks.push(task);
  const shortTitles = {
    rain:['想借一把伞，陪我走过这场雨','借把雨伞，明天归还'], math:['高数这道极限题，想听听你的思路','一起弄懂这道极限题'],
    calculator:['明天的实验课，想借一个计算器','实验课想借一个计算器'], english:['一起练习十分钟英语口语吧','一起练十分钟英语口语'],
    notes:['第一次写实验报告，想请教排版','请教实验报告排版'], pump:['篮球有点漏气，谁有打气筒呀','借个打气筒，用完即还'],
  };
  for (const task of store.tasks) {
    const pair = shortTitles[task.id];
    if (pair && task.title === pair[0]) { task.title = pair[1]; task.isDemo = true; }
  }
  store.demoExamplesVersion = 1;
  return true;
}
