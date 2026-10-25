import { createApplication } from './application.mjs';
import { createDomain, must } from './domain.mjs';
import { seedData } from './seed.mjs';
import { ensureIslandState } from './identity.mjs';
import { createHash } from 'node:crypto';
export { securityHeaders } from './application.mjs';

export async function withStore(db, operation) {
  for (let attempt=0;attempt<5;attempt++) {
    let row=await db.prepare('SELECT body, revision FROM kindness_state WHERE id = 1').first();
    if(!row){await db.prepare('INSERT OR IGNORE INTO kindness_state (id, body, revision) VALUES (1, ?, 0)').bind(JSON.stringify(seedData())).run();row=await db.prepare('SELECT body, revision FROM kindness_state WHERE id = 1').first();}
    const store=ensureIslandState(JSON.parse(row.body));
    const domain=createDomain(()=>store);domain.expire();
    const value=operation(store,domain),next=JSON.stringify(store);
    if(next===row.body)return value;
    must(new TextEncoder().encode(next).length<1800000,'当前数据容量已达到上限，请联系维护者。',409);
    const result=await db.prepare('UPDATE kindness_state SET body = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').bind(next,row.revision).run();
    if(result.meta.changes===1)return value;
  }
  const error=new Error('同时操作较多，请稍后重试。');error.status=409;throw error;
}
export async function handleApi(request,env) {
  if(!env.DB)return new Response(JSON.stringify({error:'没加载出来，请重试。'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8'}});
  const db=env.DB;
  const app=createApplication({
    transact:operation=>withStore(db,operation),
    sessions:{
      get:token=>db.prepare('SELECT user_id, owned_ids, until FROM kindness_sessions WHERE token = ?').bind(token).first(),
      set:async(token,session)=>{
        await db.batch([
          db.prepare('DELETE FROM kindness_sessions WHERE until < ?').bind(Date.now()),
          db.prepare('INSERT INTO kindness_sessions (token, user_id, owned_ids, until) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, owned_ids = excluded.owned_ids, until = excluded.until').bind(token,session.user_id,session.owned_ids,session.until),
        ]);
      },
      delete:token=>db.prepare('DELETE FROM kindness_sessions WHERE token = ?').bind(token).run(),
    },
    uploads:env.BUCKET?{
      put:(key,bytes,type)=>env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type}}),
      get:key=>env.BUCKET.get(key),delete:key=>env.BUCKET.delete(key),
    }:null,
    rateLimit:async request=>{
      const now=Date.now(),ip=request.headers.get('CF-Connecting-IP')||'local-preview';
      const bucket=createHash('sha256').update(ip).digest('hex')+':'+Math.floor(now/300000);
      const row=await db.prepare('INSERT INTO kindness_rate_buckets (id, used, until) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET used = used + 1 RETURNING used').bind(bucket,now+600000).first();
      must(row.used<=120,'操作太频繁，请稍后再试。',429);
      await db.prepare('DELETE FROM kindness_rate_buckets WHERE until < ?').bind(now).run();
    },
  });
  return app(request);
}
