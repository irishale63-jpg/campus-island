export const taskCategories = [
  {id:'study',label:'学习交流'},
  {id:'borrow',label:'物品借用'},
  {id:'sports',label:'运动搭子'},
  {id:'life',label:'生活互助'},
  {id:'activity',label:'其他'},
];
export const categoryLabel = id => taskCategories.find(c=>c.id===id)?.label || '其他互助';
