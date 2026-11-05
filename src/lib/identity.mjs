import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { accounts, ensureDemoExamples } from './seed.mjs';
import { schools } from './schools.mjs';
export { schools };
export const avatars = ['island','leaf','moon','cat','book','star'];
export const usernameKey = value => String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export const usernameAvailable = (store,name,exceptId) => !store.users.some(u=>u.id!==exceptId&&usernameKey(u.name)===usernameKey(name));
export function defaultUsername(store){
  if(usernameAvailable(store,'新同学'))return '新同学';
  for(let i=2;i<=store.users.length+2;i++){const name='新同学'+i;if(usernameAvailable(store,name))return name;}
}
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
  const {id,name,initial,avatar,color,bio,skills,offers,isDemo,isSample,isExperience,schoolId,schoolStatus,circleMode,createdAt} = user;
  return {id,name,initial:initial || name?.slice(0,1),avatar:avatar || 'island',color:color || 'lavender',bio:bio || '',skills:skills || '',offers:offers || '',
    avatarUrl:avatar==='photo'&&user.avatarPhoto?.id?'/api/avatars/'+user.avatarPhoto.id:null,
    schoolVerifiedAt:schoolStatus==='email_verified'?user.schoolVerifiedAt||null:null,
    isDemo:!!isDemo,isSample:!!isSample,isExperience:!!isExperience,schoolId:schoolId || null,schoolName:schools.find(s=>s.id===schoolId)?.name || null,
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
  return {schoolId:user.schoolId,circleMode:user.circleMode||(user.schoolStatus==='email_verified'?'verified':'demo')};
}
export const sameScope = (item,scope) => !!scope && item.schoolId===scope.schoolId && item.circleMode===scope.circleMode;
