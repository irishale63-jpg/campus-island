import { schools, publicUser } from './identity.mjs';
import { sampleSchoolIds, schoolDirectory } from './schools.mjs';

export function schoolCounts(store) {
  const counts=new Map();
  for(const user of store.users) {
    if(!user.schoolId||!['demo','email_verified'].includes(user.schoolStatus))continue;
    const count=counts.get(user.schoolId)||{realCount:0,demoCount:0,experienceCount:0};
    count[user.isDemo?'demoCount':'realCount']++;counts.set(user.schoolId,count);
    if(user.isExperience)count.experienceCount++;
  }
  return schools.map(s => {
    const {realCount=0,demoCount=0,experienceCount=0}=counts.get(s.id)||{};
    return {...s, memberCount:realCount+demoCount, realCount, demoCount,experienceCount};
  });
}

// This projection deliberately excludes sessions, recovery hashes and private messages.
export function managementData(store) {
  const users = store.users.map(u => ({...publicUser(u), isSample:!!u.isSample}));
  const tasks = store.tasks.map(t => ({id:t.id,title:t.title,schoolId:t.schoolId,
    schoolName:schools.find(s=>s.id===t.schoolId)?.name || '未分配',category:t.category,status:t.status,
    ownerName:users.find(u=>u.id===t.ownerId)?.name || '未知',createdAt:t.createdAt,
    isDemo:!!t.isDemo||!!users.find(u=>u.id===t.ownerId)?.isDemo||!!users.find(u=>u.id===t.helperId)?.isDemo,
    isExperience:!!t.isExperience||!!users.find(u=>u.id===t.ownerId)?.isExperience||!!users.find(u=>u.id===t.helperId)?.isExperience,
    isSample:!!t.isSample,responseCount:t.responses?.length || 0}));
  return {updatedAt:new Date().toISOString(),schools:schoolCounts(store),directory:schoolDirectory,users,tasks,
    summary:{users:users.length,realUsers:users.filter(u=>!u.isDemo).length,demoUsers:users.filter(u=>u.isDemo).length,
      experienceUsers:users.filter(u=>u.isExperience).length,experienceTasks:tasks.filter(t=>t.isExperience).length,
      tasks:tasks.length,realTasks:tasks.filter(t=>!t.isDemo).length,completed:tasks.filter(t=>!t.isDemo&&t.status==='completed').length},
    capacity:{users:1000,tasks:500,stateBytes:new TextEncoder().encode(JSON.stringify(store)).length,cloudStateBytes:1800000}};
}

// Stable IDs make repeated imports safe. No historical or visitor records are overwritten.
export function addSchoolSamples(store) {
  const sampleSchools=schools.filter(s=>sampleSchoolIds.includes(s.id));
  const now=Date.now(), at=h=>new Date(now-h*3600000).toISOString();
  let usersAdded=0,tasksAdded=0;
  const specs=[
    ['study','一起练十分钟英语口语','想找同学互相听一遍课堂展示，交流表达建议。','线上'],
    ['borrow','临时借一个科学计算器','实验课用两个小时，约在图书馆大厅交接，当天归还。','图书馆公共大厅'],
    ['study','请教一道高数题的思路','已经尝试过推导，想交流卡住的一步，不需要代做。','线上'],
    ['borrow','借个打气筒，用完即还','给篮球补气，约十分钟，在体育馆公共区域交接。','体育馆入口'],
  ];
  const missingUsers=sampleSchools.flatMap(s=>specs.map((_,i)=>`sample-${s.id}-${i}`)).filter(id=>!store.users.some(u=>u.id===id)).length;
  const missingTasks=sampleSchools.flatMap(s=>specs.map((_,i)=>`sample-task-${s.id}-${i}`)).filter(id=>!store.tasks.some(t=>t.id===id)).length;
  if(store.users.length+missingUsers>1000||store.tasks.length+missingTasks>500) {
    const error=new Error('当前容量不足，未添加样本。');error.status=409;throw error;
  }
  for(const school of sampleSchools) for(const [i,[category,title,description,location]] of specs.entries()) {
    const ownerId=`sample-${school.id}-${i}`,id=`sample-task-${school.id}-${i}`;
    if(!store.users.some(u=>u.id===ownerId)) {
      store.users.push({id:ownerId,name:['小禾','小林','小星','小橙'][i]+'（模拟）',avatar:['leaf','book','star','cat'][i],
        isDemo:true,isSample:true,bio:'仅用于展示校园互助场景的模拟身份，不是真实用户。',
        schoolId:school.id,schoolStatus:'demo',circleMode:'demo',createdAt:at(i+2)});usersAdded++;
    }
    if(!store.tasks.some(t=>t.id===id)) {
      store.tasks.push({id,ownerId,category,title,description,location,mode:category==='study'?'online':'offline',
        schoolId:school.id,circleMode:'demo',isDemo:true,isSample:true,status:'open',helperId:null,
        createdAt:at(i+1),deadline:new Date(now+14*86400000).toISOString(),
        returnAt:category==='borrow'?new Date(now+15*86400000).toISOString():null,
        tags:['模拟样本'],responses:[],messages:[],events:[{at:at(i+1),userId:ownerId,text:'添加模拟样本'}],
        loan:{deliveredAt:null,returnedAt:null,confirmedAt:null},thanks:null,cancelRequestedBy:null});tasksAdded++;
    }
  }
  return {usersAdded,tasksAdded};
}
