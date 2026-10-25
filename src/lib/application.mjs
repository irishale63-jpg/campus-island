import { randomBytes, randomUUID } from 'node:crypto';
import { clean, must, fail } from './domain.mjs';
import { schools, avatars, publicUser, findUser, scopeFor, sameScope, createIdentity, recoveryMatches } from './identity.mjs';

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const securityHeaders = {
  'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'self'; style-src 'self'; img-src 'self' data: blob:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const iso = () => new Date().toISOString();
const json = (value,status=200,extra={}) => new Response(JSON.stringify(value), {status,headers:{...securityHeaders,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
const optional = (value,label,max) => value == null || value === '' ? '' : clean(value,label,0,max);
const open = task => ['open','selecting'].includes(task.status);
const participant = (task,id) => !!id && [task.ownerId,task.helperId].includes(id);
function visibleTask(store,user,id) {
  const task=store.tasks.find(t=>t.id===id);
  must(task && sameScope(task,scopeFor(user)), '没有找到这条求助',404);
  return task;
}
function conversation(store,user,id,writing=false) {
  const task=visibleTask(store,user,id);
  must(task.helperId && participant(task,user?.id),'无权查看这段私信',403);
  if(writing) must(['active','review'].includes(task.status),'互助已结束，私信保留为只读记录。',409);
  return task;
}
function requireMember(user) { must(user,'请先选择或创建身份',401); must(scopeFor(user),'请先加入学校圈',403); }
function unreadMessages(store,task,id) {
  const cursor=store.readReceipts[id]?.[task.id];
  const start=cursor ? task.messages.findIndex(m=>m.id===cursor)+1 : 0;
  return task.messages.slice(start).filter(m=>m.userId!==id).length;
}
function notify(store,task,recipientId,text,action,key) {
  if(!recipientId || store.notifications.some(n=>n.key===key)) return;
  store.notifications.push({id:randomUUID(),recipientId,taskId:task.id,text,action,key,at:iso(),readAt:null,schoolId:task.schoolId,circleMode:task.circleMode});
}
function notifyAction(store,task,actorId,action,before) {
  const key=task.id+':'+task.events.length+':'+action;
  const send=(id,text,next='detail')=>notify(store,task,id,text,next,key+':'+id);
  switch(action) {
    case 'respond': send(task.ownerId,'有人回应了你的求助，请选择帮助者。'); break;
    case 'withdraw': send(task.ownerId,'一位同学撤回了回应。'); break;
    case 'select': for(const id of [task.ownerId,task.helperId]) send(id,'已确定互助，可以开始私信沟通。','chat'); break;
    case 'deliver': send(task.ownerId,'对方已确认交付物品，请按约定使用并归还。'); break;
    case 'return': send(task.helperId,'对方已提交归还，请确认收到物品。'); break;
    case 'confirm-return': send(task.ownerId,'对方已确认收到归还物品。'); break;
    case 'submit': send(task.ownerId,'对方申请完成互助，请确认是否解决。'); break;
    case 'complete': send(task.helperId,'互助已完成。'); break;
    case 'redo': send(task.helperId,'对方补充了说明，请继续协作。','chat'); break;
    case 'thank': send(task.helperId,'收到一份感谢，去看看吧。','thanks'); break;
    case 'cancel': {
      if(open(before)) for(const response of before.responses.filter(r=>r.state==='pending')) send(response.userId,'发布者取消了这条求助。');
      else send(task.ownerId===actorId?task.helperId:task.ownerId,'对方申请取消互助，请处理。'); break;
    }
    case 'accept-cancel': for(const id of [task.ownerId,task.helperId]) send(id,'双方已确认取消互助。'); break;
    case 'decline-cancel': send(task.ownerId===actorId?task.helperId:task.ownerId,'对方希望继续互助。','chat'); break;
  }
}
function taskInput(body) {
  const title=typeof body.title==='string'?body.title.trim():'';
  must(title.length>=2 && title.length<=40,'请写明需要的帮助。');
  const description=optional(body.description,'补充说明',1000);
  must(['study','borrow'].includes(body.category),'请选择分类');
  must(['online','offline'].includes(body.mode),'请选择协作方式');
  const end=Date.parse(body.deadline),back=Date.parse(body.returnAt);
  must(Number.isFinite(end)&&end>Date.now(),'请选择之后的时间。');
  must(body.category!=='borrow'||(body.mode==='offline'&&Number.isFinite(back)&&back>end),'归还时间应晚于回应截止时间。');
  return {title,description,category:body.category,mode:body.mode,
    location:body.mode==='online'?'线上':clean(body.location,'见面地点',2,50),helpTime:optional(body.helpTime,'所需时间',80),
    deadline:new Date(end).toISOString(),returnAt:body.category==='borrow'?new Date(back).toISOString():null,
    tags:[body.category==='borrow'?'借点东西':'学习交流']};
}
async function readBytes(request,max) {
  must(!request.headers.get('content-length')||Number(request.headers.get('content-length'))<=max,'提交内容过大',413);
  const reader=request.body?.getReader(),chunks=[];let size=0;
  if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail('提交内容过大',413);}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
}
function imageType(bytes) {
  if(bytes.length>8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';
  if(bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)return 'image/jpeg';
  if(bytes.length>12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
  fail('请选择 PNG、JPEG 或 WebP 图片。');
}

// Local and hosted adapters share every authorization and state transition.
export function createApplication({transact,sessions,uploads,rateLimit=async()=>{},demo=true}) {
  return async function handle(request) {
    try {
      const url=new URL(request.url),path=url.pathname,method=request.method;
      let body={};
      const imageUpload=method==='POST'&&/^\/api\/conversations\/[^/]+\/images$/.test(path);
      if(method==='POST') {
        must(!request.headers.get('origin')||request.headers.get('origin')===url.origin,'请求来源不正确',403);
        must(request.headers.get('x-requested-with')==='CampusKindness','请通过应用页面提交',403);
        await rateLimit(request);
        if(!imageUpload) {
          must(request.headers.get('content-type')?.startsWith('application/json'),'请通过应用页面提交',403);
          const raw=await readBytes(request,16384);
          try{body=JSON.parse(new TextDecoder().decode(raw)||'{}');}catch{fail('提交格式不正确');}
          must(body&&typeof body==='object'&&!Array.isArray(body),'提交格式不正确');
        }
      } else must(method==='GET','不支持的请求',405);
      const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)kindness_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      let session=token?await sessions.get(token):null;
      if(session&&session.until<=Date.now())session=null;
      let owned=[];
      try{owned=JSON.parse(session?.owned_ids||'[]');}catch{}
      if(!Array.isArray(owned))owned=[];
      const user=await transact(store=>findUser(store,session?.user_id)||null);
      const scope=scopeFor(user);
      const auth=()=>must(user,'请先选择或创建身份',401);
      const activate=async (target,addOwned=false)=>{
        const key=token&&session?token:randomBytes(32).toString('hex');
        const ids=[...new Set([...owned,...(addOwned?[target.id]:[])])];
        const maxAge=ids.length?30*86400:86400;
        await sessions.set(key,{user_id:target.id,owned_ids:JSON.stringify(ids),until:Date.now()+maxAge*1000});
        return {'Set-Cookie':`kindness_session=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${url.protocol==='https:'?'; Secure':''}`};
      };
      if(path==='/api/me'&&method==='GET')return json(await transact(store=>({user:publicUser(user),identities:owned.map(id=>publicUser(findUser(store,id))).filter(Boolean),demo,
        circle:scope,schoolVerification:{available:false,status:'pending_configuration'}})));
      if(path==='/api/schools'&&method==='GET') {
        const q=(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,100);
        return json({schools:schools.filter(s=>(s.name+' '+s.aliases).toLowerCase().includes(q))});
      }
      if(path==='/api/demo-accounts'&&method==='GET')return json(await transact(store=>({accounts:demo?store.users.filter(u=>u.isDemo).map(publicUser):[]})));
      if(path==='/api/login'&&method==='POST') {
        const target=await transact(store=>findUser(store,body.userId));
        must(target&&(target.isDemo?demo:owned.includes(target.id)),'不能切换到这个身份',403);
        return json({user:publicUser(target)},200,await activate(target));
      }
      if(path==='/api/identities'&&method==='POST') {
        must(owned.length<8,'此设备已保存多个身份，请先使用已有身份。',409);
        const name=clean(body.name,'昵称',1,20),avatar=body.avatar||'island';must(avatars.includes(avatar),'请选择头像');
        const created=createIdentity(name,avatar);
        await transact(store=>{must(store.users.length<1000,'身份数量已达到当前服务上限。',409);store.users.push(created.user);});
        return json({user:publicUser(created.user),recoveryKey:created.recoveryKey},201,await activate(created.user,true));
      }
      if(path==='/api/identities/restore'&&method==='POST') {
        const target=await transact(store=>store.users.find(u=>!u.isDemo&&recoveryMatches(body.recoveryKey,u.recoveryHash)));
        must(target,'恢复口令不正确',401);
        must(owned.includes(target.id)||owned.length<8,'此设备已保存多个身份。',409);
        return json({user:publicUser(target)},200,await activate(target,true));
      }
      if(path==='/api/logout'&&method==='POST') {
        if(token)await sessions.delete(token);
        return json({ok:true},200,{'Set-Cookie':`kindness_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${url.protocol==='https:'?'; Secure':''}`});
      }
      if(path==='/api/me/profile'&&method==='POST') {
        auth();must(!user.isDemo,'演示身份资料只读，请创建自己的身份。',403);
        must(Object.keys(body).every(k=>['name','avatar','bio','skills','offers'].includes(k)),'学校归属不能通过编辑资料更改。');
        const name=clean(body.name,'昵称',1,20);must(avatars.includes(body.avatar),'请选择头像');
        return json(await transact(store=>{const target=findUser(store,user.id);Object.assign(target,{name,initial:name.slice(0,1),avatar:body.avatar,
          bio:optional(body.bio,'简介',140),skills:optional(body.skills,'擅长什么',120),offers:optional(body.offers,'愿意提供的帮助',120)});return {user:publicUser(target)};}));
      }
      if(path==='/api/me/circle'&&method==='POST') {
        auth();must(!user.isDemo,'演示身份已有学校圈，请创建自己的身份。',403);
        must(schools.some(s=>s.id===body.schoolId),'请选择已开放的学校');
        must(body.mode==='demo','学校邮箱认证待配置。',503);
        return json(await transact(store=>{const target=findUser(store,user.id);must(!target.schoolId||target.schoolId===body.schoolId,'学校变更流程暂未开放。',409);
          Object.assign(target,{schoolId:body.schoolId,schoolStatus:'demo',circleMode:'demo'});return {user:publicUser(target)};}));
      }
      if(path.startsWith('/api/verification/')&&method==='POST') {auth();fail('学校邮箱认证待配置。',503);}
      let match=path.match(/^\/api\/profiles\/([^/]+)$/);
      if(match&&method==='GET')return json(await transact(store=>{const target=findUser(store,match[1]);must(target&&(target.id===user?.id||sameScope(target,scope)),'没有找到这个主页',404);return {user:publicUser(target)};}));
      if(path==='/api/tasks'&&method==='GET')return json(await transact((store,domain)=>({tasks:store.tasks.filter(t=>sameScope(t,scope)).map(t=>domain.view(t,user?.id))})));
      if(path==='/api/thanks'&&method==='GET') {
        auth();return json(await transact((store,domain)=>({tasks:store.tasks.filter(t=>sameScope(t,scope)&&t.thanks&&participant(t,user.id)).map(t=>domain.view(t,user.id,true))})));
      }
      if(path==='/api/tasks'&&method==='POST') {
        requireMember(user);const input=taskInput(body);
        const task={...input,id:randomUUID(),ownerId:user.id,schoolId:scope.schoolId,circleMode:scope.circleMode,
          createdAt:iso(),status:'open',helperId:null,responses:[],messages:[],events:[{at:iso(),userId:user.id,text:'发布了求助'}],
          loan:{deliveredAt:null,returnedAt:null,confirmedAt:null},thanks:null,cancelRequestedBy:null};
        return json(await transact((store,domain)=>{must(store.tasks.length<500,'求助数量已达到当前服务上限。',409);store.tasks.unshift(task);return {task:domain.view(task,user.id,true)};}),201);
      }
      match=path.match(/^\/api\/tasks\/([^/]+)(\/(action|edit))?$/);
      if(match) {
        must(method==='GET'&&!match[2]||method==='POST'&&match[2],'不支持的请求',405);
        if(method==='POST')requireMember(user);
        return json(await transact((store,domain)=>{
          const task=visibleTask(store,user,match[1]);
          if(method==='POST'&&match[3]==='edit') {
            must(task.ownerId===user.id,'只能编辑自己的求助',403);
            must(task.status==='open'&&!task.responses.some(r=>r.state==='pending'),'已有回应或已结束的求助暂不能编辑。',409);
            Object.assign(task,taskInput(body),{updatedAt:iso()});task.events.push({at:iso(),userId:user.id,text:'编辑了求助'});
          } else if(method==='POST') {
            must(task.events.length<500&&task.messages.length<300&&task.responses.length<100,'这条求助的操作已达到上限。',409);
            if(body.action==='respond')must(sameScope(user,scopeFor(findUser(store,task.ownerId))),'不能跨学校圈回应',403);
            const before=structuredClone(task);domain.act(task,user.id,body);notifyAction(store,task,user.id,body.action,before);
          }
          return {task:domain.view(task,user?.id,true)};
        }));
      }
      if(path==='/api/inbox'&&method==='GET') {
        auth();return json(await transact(store=>{
          const conversations=store.tasks.filter(t=>sameScope(t,scope)&&t.helperId&&participant(t,user.id)).map(t=>{
            const last=t.messages.at(-1);return {id:t.id,taskTitle:t.title,status:t.status,other:publicUser(findUser(store,t.ownerId===user.id?t.helperId:t.ownerId)),
              preview:last?(last.type==='image'?'[图片]':last.text):'开始沟通',at:last?.at||t.updatedAt||t.createdAt,unreadCount:unreadMessages(store,t,user.id)};
          }).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
          const notifications=store.notifications.filter(n=>n.recipientId===user.id&&sameScope(n,scope)).map(n=>({...n,taskTitle:store.tasks.find(t=>t.id===n.taskId)?.title||'求助'})).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
          return {conversations,notifications,unreadCount:conversations.reduce((sum,c)=>sum+c.unreadCount,0)+notifications.filter(n=>!n.readAt).length};
        }));
      }
      if(path==='/api/notifications/read'&&method==='POST') {
        auth();return json(await transact(store=>{for(const n of store.notifications)if(n.recipientId===user.id&&sameScope(n,scope)&&(body.id==='all'||body.id===n.id))n.readAt ||= iso();return {ok:true};}));
      }
      match=path.match(/^\/api\/conversations\/([^/]+)(\/(messages|read|images))?$/);
      if(match) {
        auth();const taskId=match[1],operation=match[3];
        if(method==='GET'&&!operation)return json(await transact((store,domain)=>{const task=conversation(store,user,taskId);return {task:domain.view(task,user.id,true),unreadCount:unreadMessages(store,task,user.id)};}));
        must(method==='POST'&&operation,'不支持的请求',405);
        if(operation==='read')return json(await transact(store=>{const task=conversation(store,user,taskId);store.readReceipts[user.id] ||= {};store.readReceipts[user.id][taskId]=task.messages.at(-1)?.id||'';return {ok:true};}));
        if(operation==='messages')return json(await transact((store,domain)=>{const task=conversation(store,user,taskId,true);must(task.messages.length<300,'私信已达到当前上限。',409);domain.act(task,user.id,{action:'message',text:body.text});return {message:{...task.messages.at(-1),user:publicUser(user)}};}),201);
        must(uploads,'图片存储暂时不可用。',503);
        must(request.headers.get('content-type')?.startsWith('multipart/form-data'),'请选择图片');
        await transact(store=>conversation(store,user,taskId,true));
        const bytes=await readBytes(request,MAX_IMAGE_BYTES+65536);
        const form=await new Request(request.url,{method:'POST',headers:{'Content-Type':request.headers.get('content-type')},body:bytes}).formData();
        const file=form.get('image');must(file&&typeof file.arrayBuffer==='function','请选择图片');
        must(file.size>0&&file.size<=MAX_IMAGE_BYTES,'图片不能超过 3 MB。',413);
        const image=new Uint8Array(await file.arrayBuffer()),type=imageType(image),id=randomUUID(),key='private/'+id;
        await uploads.put(key,image,type);
        try {
          return json(await transact(store=>{const task=conversation(store,user,taskId,true);must(task.messages.length<300,'私信已达到当前上限。',409);
            const message={id:randomUUID(),userId:user.id,type:'image',imageId:id,text:'',at:iso()};
            store.attachments.push({id,key,taskId,userId:user.id,type,size:image.length,at:message.at});task.messages.push(message);task.updatedAt=message.at;
            return {message:{...message,user:publicUser(user)}};
          }),201);
        } catch(error) {await uploads.delete(key).catch(()=>{});throw error;}
      }
      match=path.match(/^\/api\/images\/([a-f0-9-]+)$/);
      if(match&&method==='GET') {
        auth();const attachment=await transact(store=>{const item=store.attachments.find(a=>a.id===match[1]);must(item,'图片不存在',404);conversation(store,user,item.taskId);return item;});
        must(uploads,'图片存储暂时不可用。',503);const object=await uploads.get(attachment.key);must(object,'图片暂时不可用',404);
        return new Response(object.body||object,{headers:{...securityHeaders,'Content-Type':attachment.type,'Cache-Control':'private, no-store','Content-Disposition':'inline'}});
      }
      fail('接口不存在',404);
    } catch(error) {
      if(!error.status)console.error('Island API error',error.message);
      return json({error:error.status?error.message:'操作未成功，请重试。'},error.status||500);
    }
  };
}
