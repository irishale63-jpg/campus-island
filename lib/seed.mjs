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
  return { version: 1, tasks };
}
