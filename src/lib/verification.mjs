import { randomInt,randomUUID,createHmac,timingSafeEqual } from 'node:crypto';
import { must,fail,clean } from './domain.mjs';
import { schools,findUser,publicUser } from './identity.mjs';

// Only the owner can add exact, independently checked school email domains.
// A generic .edu.cn suffix must never verify membership of a selected school.
export function saveSchoolEmailDomains(store,body) {
  must(schools.some(s=>s.id===body.schoolId),'请选择学校');
  must(Array.isArray(body.domains)&&body.domains.length<=6,'每所学校最多配置六个邮箱后缀');
  const domains=[...new Set(body.domains.map(value=>clean(value,'邮箱后缀',4,150).toLowerCase()))];
  must(domains.every(d=>/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d)),'请填写准确的邮箱后缀，不含 @、通配符或网址');
  const sourceUrl=typeof body.sourceUrl==='string'?body.sourceUrl.trim():'';
  if(domains.length){let source;try{source=new URL(sourceUrl);}catch{fail('请填写学校官网的邮箱说明链接');}
    must(source.protocol==='https:'&&!source.username&&!source.password&&sourceUrl.length<=500,'请填写学校官网的 HTTPS 说明链接');}
  store.schoolEmailDomains ||= {};
  if(domains.length)store.schoolEmailDomains[body.schoolId]={domains,sourceUrl,updatedAt:new Date().toISOString()};
  else delete store.schoolEmailDomains[body.schoolId];
  return {ok:true};
}

export function emailDeliveryFromEnv(env={},fetcher=fetch) {
  const ready=!!(env.RESEND_API_KEY&&env.VERIFICATION_FROM&&!/[\r\n]/.test(env.VERIFICATION_FROM));
  return {ready,async send({email,code,schoolName,requestId,purpose='school'}){
    must(ready,'学校邮箱认证即将开放，暂不能发送验证码。',503);
    try{
      // Workers supports manual/follow only. Reject redirects below without
      // forwarding the provider credential to a different URL.
      const response=await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
        headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':requestId},
        body:JSON.stringify({from:env.VERIFICATION_FROM,to:[email],subject:purpose==='school'?'校园岛 · 学校邮箱验证码':purpose==='bind'?'校园岛 · 绑定邮箱验证码':'校园岛 · 登录验证码',text:`你的校园岛验证码是 ${code}，10 分钟内有效。\n${purpose==='school'?`本次用于验证${schoolName}的学校邮箱归属，不代表在读学籍核验。`:purpose==='bind'?'本次用于将邮箱绑定到你当前的校园岛账号，原有求助和消息会保留。':'本次用于登录校园岛。首次验证将创建账号，普通邮箱登录不代表学校认证。'}\n请勿把验证码提供给他人。如非本人操作，请忽略此邮件。`})});
      if(!response.ok){
        // Record only provider status/category, never its raw body or user data.
        let category='unknown';try{const result=await response.json();if(/^[a-z_]{1,60}$/.test(result.name||''))category=result.name;}catch{}
        console.error('email_delivery_rejected',JSON.stringify({status:response.status,category}));
        throw new Error('Mail delivery rejected');
      }
      const result=await response.json();if(!result.id)throw new Error('Mail delivery unconfirmed');
    }catch(error){
      let reason=String(error?.message||'unknown');
      for(const value of [env.RESEND_API_KEY,env.VERIFICATION_FROM,email,code])if(value)reason=reason.split(value).join('[redacted]');
      reason=reason.replace(/re_[a-zA-Z0-9_-]+/g,'[redacted]').replace(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+/g,'[redacted]');
      console.error('email_delivery_failed',JSON.stringify({kind:error?.name==='TimeoutError'?'timeout':error?.name==='TypeError'?'request_error':'delivery_error',reason:reason.slice(0,180)}));fail('验证码暂时未能发送，请稍后重试。',503);
    }
  }};
}

export function createSchoolVerification({secret='',delivery={ready:false},now=()=>Date.now()}={}) {
  const ready=secret.length>=24&&!!delivery.ready;
  const digest=value=>createHmac('sha256',secret).update(JSON.stringify(value)).digest('hex');
  const domainsFor=(store,id)=>store.schoolEmailDomains?.[id]?.domains||[];
  const isVerified=user=>user?.schoolStatus==='email_verified';
  function status(store,user){
    const domains=domainsFor(store,user?.schoolId),challenge=store.emailChallenges?.[user?.id];
    return {available:ready&&!!user&&!user.isDemo&&!!user.schoolId&&domains.length>0,
      status:isVerified(user)?'verified':!user?.schoolId?'join_school':user.isDemo?'demo_identity':!ready?'service_pending':!domains.length?'domain_pending':'ready',
      domains,maskedEmail:isVerified(user)?user.schoolEmailMasked:challenge?.expiresAt>now()?challenge.maskedEmail:null,
      verifiedAt:user?.schoolVerifiedAt||null,retryAfter:challenge?Math.max(0,Math.ceil((challenge.createdAt+60000-now())/1000)):0,
      challengeActive:!!(challenge?.state==='ready'&&challenge.expiresAt>now()&&challenge.attempts<5)};
  }
  function configuration(store){return {deliveryReady:ready,configs:Object.entries(store.schoolEmailDomains||{}).map(([schoolId,config])=>({schoolId,schoolName:schools.find(s=>s.id===schoolId)?.name,...config}))};}
  async function request(transact,user,body){
    must(user,'请先登录',401);must(!user.isDemo,'请用自己的身份进行认证',403);must(user.schoolId,'请先选择学校',403);
    must(ready,'学校邮箱认证即将开放，暂不能发送验证码。',503);
    const email=clean(body.email,'学校邮箱',5,254).toLowerCase();
    must(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email),'请填写有效的学校邮箱');
    const domain=email.split('@')[1],code=String(randomInt(1000000)).padStart(6,'0'),id=randomUUID(),emailHash=digest(['email',email]);
    const instant=now(),maskedEmail=email.slice(0,1)+'***@'+domain;
    const schoolName=schools.find(s=>s.id===user.schoolId)?.name||'所选学校';
    await transact(store=>{
      const target=findUser(store,user.id);must(target?.schoolId===user.schoolId,'学校归属已变更，请刷新重试。',409);
      must(!isVerified(target),'该身份已验证学校邮箱。',409);
      must(domainsFor(store,user.schoolId).includes(domain),'该邮箱后缀尚未获准用于所选学校的认证。');
      must(!store.users.some(u=>u.id!==user.id&&u.verifiedEmailHash===emailHash),'该邮箱暂不能用于此身份的认证。',409);
      store.emailChallenges ||= {};store.emailVerificationRates ||= {};
      const old=store.emailChallenges[user.id];must(!old||instant-old.createdAt>=60000,'请间隔 60 秒后再获取验证码。',429);
      for(const [key,value] of Object.entries(store.emailVerificationRates))if(value.until<=instant)delete store.emailVerificationRates[key];
      const keys=['user:'+user.id,'email:'+emailHash];
      for(const key of keys)must((store.emailVerificationRates[key]?.used||0)<5,'本小时获取次数较多，请稍后再试。',429);
      for(const key of keys){const bucket=store.emailVerificationRates[key]||{used:0,until:instant+3600000};bucket.used++;store.emailVerificationRates[key]=bucket;}
      for(const [key,value] of Object.entries(store.emailChallenges))if(value.expiresAt<=instant)delete store.emailChallenges[key];
      store.emailChallenges[user.id]={id,schoolId:user.schoolId,domain,emailHash,maskedEmail,createdAt:instant,expiresAt:instant+600000,
        codeHash:digest(['code',user.id,user.schoolId,emailHash,id,code]),attempts:0,state:'sending'};
    });
    try{await delivery.send({email,code,schoolName,requestId:id});}
    catch{await transact(store=>{const record=store.emailChallenges?.[user.id];if(record?.id===id)record.state='failed';});fail('验证码暂时未能发送，请稍后重试。',503);}
    await transact(store=>{const record=store.emailChallenges?.[user.id];if(record?.id===id)record.state='ready';});
    return {ok:true,maskedEmail,expiresIn:600,retryAfter:60};
  }
  async function confirm(transact,user,body){
    must(user,'请先登录',401);must(!user.isDemo,'请用自己的身份进行认证',403);must(ready,'学校邮箱认证尚未开放。',503);
    const code=clean(body.code,'六位验证码',6,6);must(/^\d{6}$/.test(code),'请输入六位数字验证码');
    const result=await transact(store=>{
      const record=store.emailChallenges?.[user.id],target=findUser(store,user.id);
      if(!record||record.state!=='ready')return {error:'请先获取新的验证码。',status:400};
      if(record.expiresAt<=now()){delete store.emailChallenges[user.id];return {error:'验证码已过期，请重新获取。',status:400};}
      if(record.attempts>=5)return {error:'尝试次数已达上限，请重新获取验证码。',status:429};
      if(target?.schoolId!==record.schoolId||!domainsFor(store,record.schoolId).includes(record.domain))return {error:'学校邮箱配置已更新，请重新获取验证码。',status:409};
      record.attempts++;
      const candidate=digest(['code',user.id,record.schoolId,record.emailHash,record.id,code]);
      if(!timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(record.codeHash,'hex')))return {error:record.attempts>=5?'尝试次数已达上限，请重新获取验证码。':'验证码不正确，请重试。',status:record.attempts>=5?429:400};
      if(store.users.some(u=>u.id!==user.id&&u.verifiedEmailHash===record.emailHash))return {error:'该邮箱暂不能用于此身份的认证。',status:409};
      // Verification is a badge upgrade. Existing school-circle records and permissions stay intact.
      target.circleMode ||= 'demo';target.schoolStatus='email_verified';target.schoolVerifiedAt=new Date(now()).toISOString();
      target.verifiedEmailHash=record.emailHash;target.schoolEmailMasked=record.maskedEmail;delete store.emailChallenges[user.id];
      return {user:publicUser(target)};
    });
    // Failed guesses must commit their attempt counters before returning an error.
    if(result.error)fail(result.error,result.status);return result;
  }
  return {status,configuration,request,confirm};
}
