let emailLoginDraft=null,emailLoginTimer;
function resetEmailLoginDraft(){clearInterval(emailLoginTimer);emailLoginDraft=null;}
function emailAccountPanel(user){
 if(user.isDemo)return '';
 const info=state.emailLogin||{};
 return `<section class="profile-panel" id="email-account-panel"><h2>登录邮箱</h2>${info.bound?`<p class="bound-email">${e(info.maskedEmail)}<span class="membership-badge verified">已绑定</span></p><p class="field-hint">用此邮箱获取验证码，即可登录原账号。</p>`:`<p class="field-hint">绑定邮箱后，可用验证码登录，原有求助和消息保留。</p><button type="button" class="button outline" data-bind-email ${info.available?'':'disabled'}>绑定邮箱</button>`}</section>`;
}
function drawEmailLogin(tab='email'){
 clearInterval(emailLoginTimer);
 const purpose=tab==='bind'?'bind':'login',userId=purpose==='bind'?state.user?.id:null;
 if(!state.emailLogin?.available){$('#identity-content').innerHTML='<p class="field-hint">邮箱登录暂未开放，可以在“我的账号”中使用已有账号。</p>';return;}
 if(purpose==='bind'&&(!state.user||state.user.isDemo)){$('#identity-content').innerHTML='<p class="field-hint">请先在“我的账号”中进入你自己的账号，再绑定邮箱。</p>';return;}
 if(!emailLoginDraft||emailLoginDraft.purpose!==purpose||emailLoginDraft.userId!==userId)emailLoginDraft={purpose,userId,email:'',challengeId:null,resendAt:0};
 const draft=emailLoginDraft;
 $('#identity-content').innerHTML=`<form id="email-login-form">${draft.challengeId?`<p class="email-sent-note">已发送至 <strong>${e(draft.maskedEmail)}</strong></p><label class="field"><span class="sr-only">六位验证码</span><input class="email-code-input" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="六位验证码"></label>`:`<label class="field"><span class="sr-only">邮箱地址</span><input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" required placeholder="邮箱地址" value="${e(draft.email)}"></label>`}<p class="form-error" id="email-login-error" role="alert"></p><button class="button primary full" type="submit">${draft.challengeId?(purpose==='bind'?'确认绑定':'登录'):'继续'}</button></form>${draft.challengeId?'<div class="email-login-tools"><button class="text-button" type="button" data-email-change>更换邮箱</button><button class="text-button" type="button" data-email-resend>重新发送</button></div>':purpose==='login'?'<p class="email-login-note"><button class="text-button" type="button" data-identity-tab="choose">已有账号</button></p>':''}`;
 if(draft.challengeId){const tick=()=>{const button=$('[data-email-resend]');if(!button||emailLoginDraft!==draft){clearInterval(emailLoginTimer);return;}const seconds=Math.max(0,Math.ceil((draft.resendAt-Date.now())/1000));button.disabled=seconds>0;button.textContent=seconds?seconds+' 秒后重发':'重新发送';if(!seconds)clearInterval(emailLoginTimer);};tick();if(draft.resendAt>Date.now())emailLoginTimer=setInterval(tick,1000);}
}
async function requestEmailLogin(button){
 const draft=emailLoginDraft,epoch=state.epoch;if(!draft)return;
 button.disabled=true;$('#email-login-error').textContent='';
 try{const result=await api('/auth/email/request',{email:draft.email,purpose:draft.purpose});if(epoch!==state.epoch||emailLoginDraft!==draft)return;Object.assign(draft,result,{resendAt:Date.now()+result.retryAfter*1000});if($('#identity-dialog').open&&['email','bind'].includes(identityTab)){drawEmailLogin(identityTab);$('#email-login-form [name=code]')?.focus();}}
 catch(error){if(epoch===state.epoch&&$('#email-login-error'))$('#email-login-error').textContent=error.message;}
 finally{if(button.isConnected)button.disabled=false;}
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.hasAttribute('data-bind-email')){openIdentity('bind');return;}
 if(button.hasAttribute('data-email-change')){if(emailLoginDraft)emailLoginDraft.challengeId=null;drawEmailLogin(identityTab);return;}
 if(button.hasAttribute('data-email-resend'))requestEmailLogin(button);
});
document.addEventListener('submit',async event=>{
 if(event.target.id!=='email-login-form')return;event.preventDefault();
 const form=event.target,draft=emailLoginDraft,button=$('[type=submit]',form),epoch=state.epoch;if(!draft)return;
 if(!draft.challengeId){draft.email=form.elements.email.value.trim();await requestEmailLogin(button);return;}
 button.disabled=true;$('#email-login-error').textContent='';
 try{const result=await api('/auth/email/confirm',{challengeId:draft.challengeId,code:form.elements.code.value.trim()});if(epoch!==state.epoch)return;resetPrivateState();await reload();location.hash=result.purpose==='bind'||result.created||!result.user.schoolId?'#profile':'#plaza';toast(result.purpose==='bind'?'邮箱已绑定':result.created?'登录成功，请完善昵称并选择学校':'登录成功');}
 catch(error){if(epoch===state.epoch&&$('#email-login-error'))$('#email-login-error').textContent=error.message;}
 finally{if(button.isConnected)button.disabled=false;}
});
