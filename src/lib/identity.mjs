import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { accounts, ensureDemoExamples } from './seed.mjs';

export const schools = [
  {id:'whu',name:'武汉大学',aliases:'武大 WHU'},
  {id:'hust',name:'华中科技大学',aliases:'华科 华科大 HUST'},
  {id:'cug',name:'中国地质大学（武汉）',aliases:'地大 武汉地大 CUG'},
  {id:'whut',name:'武汉理工大学',aliases:'武理 武汉理工 WHUT'},
  {id:'hzau',name:'华中农业大学',aliases:'华农 HZAU'},
  {id:'ccnu',name:'华中师范大学',aliases:'华师 CCNU'},
  {id:'zuel',name:'中南财经政法大学',aliases:'中南财大 中南大 财大 ZUEL'},
];
export const avatars = ['island','leaf','moon','cat','book','star'];
export const hashRecovery = value => createHash('sha256').update(value).digest('hex');
export function recoveryMatches(value, hash) {
  if (typeof value !== 'string' || value.length > 100 || typeof hash !== 'string' || hash.length !== 64) return false;
  return timingSafeEqual(Buffer.from(hashRecovery(value)), Buffer.from(hash));
}
export function createIdentity(name, avatar) {
  const recoveryKey = randomBytes(18).toString('base64url');
  return {recoveryKey,user:{id:randomUUID(),name,avatar,initial:name.slice(0,1),color:'lavender',bio:'',skills:'',offers:'',
    isDemo:false,schoolId:null,schoolStatus:'unverified',circleMode:null,recoveryHash:hashRecovery(recoveryKey),createdAt:new Date().toISOString()}};
}
export function publicUser(user) {
  if (!user) return null;
  const {id,name,initial,avatar,color,bio,skills,offers,isDemo,schoolId,schoolStatus,circleMode,createdAt} = user;
  return {id,name,initial:initial || name?.slice(0,1),avatar:avatar || 'island',color:color || 'lavender',bio:bio || '',skills:skills || '',offers:offers || '',
    isDemo:!!isDemo,schoolId:schoolId || null,schoolName:schools.find(s=>s.id===schoolId)?.name || null,
    schoolStatus:schoolStatus || 'unverified',circleMode:circleMode || null,createdAt};
}
export function ensureIslandState(store) {
  ensureDemoExamples(store);
  store.users ||= [];
  store.notifications ||= [];
  store.readReceipts ||= {};
  store.attachments ||= [];
  for (const account of accounts) if (!store.users.some(u=>u.id===account.id)) store.users.push({...account,avatar:{lin:'leaf',zhou:'cat',xu:'moon'}[account.id],
    skills:'',offers:'',isDemo:true,schoolId:'ccnu',schoolStatus:'demo',circleMode:'demo'});
  // Versioned, additive upgrade. Historical records stay in their original demo circle.
  if (!store.islandVersion) {
    for (const task of store.tasks) { task.schoolId ||= 'ccnu'; task.circleMode ||= 'demo'; }
    store.islandVersion = 1;
  }
  return store;
}
export const findUser = (store,id) => store.users?.find(u=>u.id===id);
export function scopeFor(user) {
  if (!user) return {schoolId:'ccnu',circleMode:'demo'};
  if (!user.schoolId || !['demo','email_verified'].includes(user.schoolStatus)) return null;
  return {schoolId:user.schoolId,circleMode:user.schoolStatus==='email_verified'?'verified':'demo'};
}
export const sameScope = (item,scope) => !!scope && item.schoolId===scope.schoolId && item.circleMode===scope.circleMode;
