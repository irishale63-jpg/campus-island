function avatarChoices(selected='island'){return `<div class="avatar-choices" role="group" aria-label="头像">${Object.entries(avatarEmoji).map(([key,emoji])=>`<label class="avatar-choice"><input type="radio" name="avatar" value="${key}" ${selected===key?'checked':''} aria-label="${{island:'小岛',leaf:'叶子',moon:'月亮',cat:'猫咪',book:'书本',star:'星星'}[key]}"><span aria-hidden="true">${emoji}</span></label>`).join('')}</div>`;}
let profileAvatarFile=null,profileAvatarUrl=null,avatarProcessing=false,avatarVersion=0;
function clearProfileAvatar(){avatarVersion++;avatarProcessing=false;profileAvatarFile=null;if(profileAvatarUrl)URL.revokeObjectURL(profileAvatarUrl);profileAvatarUrl=null;}
function profileAvatarEditor(user){
 const hasPhoto=!!(profileAvatarUrl||user.avatarUrl),selected=profileAvatarFile?'photo':user.avatar;
 const preview=hasPhoto&&selected==='photo'?avatar({...user,avatarUrl:profileAvatarUrl||user.avatarUrl}):avatar({...user,avatar:selected,avatarUrl:null});
 return `<div class="field"><span>头像</span><div class="profile-avatar-editor"><div id="profile-avatar-preview">${preview}</div><div><label class="button outline avatar-upload">上传图片<input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp"></label><small id="avatar-feedback" class="field-hint" role="status">PNG / JPG / WebP，最多 10 MB，自动居中裁为方形。</small></div></div><div id="avatar-photo-option" ${hasPhoto?'':'hidden'}><label class="photo-radio"><input type="radio" name="avatar" value="photo" ${selected==='photo'?'checked':''} ${hasPhoto?'':'disabled'}>使用上传的照片</label></div><details class="avatar-presets"><summary>选择内置头像</summary>${avatarChoices(selected)}</details></div>`;
}
function updateProfileAvatarPreview(){
 const selected=$('#profile-form [name="avatar"]:checked')?.value||state.user.avatar;
 const url=selected==='photo'?(profileAvatarUrl||state.user.avatarUrl):null;
 $('#profile-avatar-preview').innerHTML=avatar({...state.user,avatar:selected,avatarUrl:url});
}
document.addEventListener('change',async event=>{
 if(event.target.name==='avatar'&&event.target.closest('#profile-form')){
  if(event.target.value!=='photo'){
   clearProfileAvatar();const option=$('#avatar-photo-option');option.hidden=!state.user.avatarUrl;option.querySelector('input').disabled=!state.user.avatarUrl;
   $('#avatar-feedback').textContent='点击保存后更换头像。';
  }
  updateProfileAvatarPreview();return;
 }
 if(event.target.id!=='avatar-file')return;
 const file=event.target.files[0];if(!file)return;
 const version=++avatarVersion,epoch=state.epoch;avatarProcessing=true;
 const feedback=$('#avatar-feedback');feedback.textContent='正在处理图片…';
 let bitmap;
 try{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('请选择不超过 10 MB 的 PNG、JPG 或 WebP 图片。');
  bitmap=await createImageBitmap(file);
  if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>60000000)throw new Error('图片尺寸过大，请选择较小的图片。');
  const side=Math.min(bitmap.width,bitmap.height),size=Math.min(512,side),canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  canvas.getContext('2d').drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,size,size);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.88));
  if(!blob||blob.size>3*1024*1024)throw new Error('图片处理未成功，请换一张图片。');
  if(version!==avatarVersion||epoch!==state.epoch)return;
  if(profileAvatarUrl)URL.revokeObjectURL(profileAvatarUrl);
  profileAvatarFile=new File([blob],blob.type==='image/webp'?'avatar.webp':'avatar.png',{type:blob.type});profileAvatarUrl=URL.createObjectURL(blob);
  const option=$('#avatar-photo-option');option.hidden=false;const radio=option.querySelector('input');radio.disabled=false;radio.checked=true;
  updateProfileAvatarPreview();feedback.textContent='已准备好，点击保存后生效。';
 }catch(error){if(version===avatarVersion&&epoch===state.epoch)feedback.textContent=error.message||'无法读取图片，请换一张试试。';}
 finally{bitmap?.close();if(version===avatarVersion)avatarProcessing=false;event.target.value='';}
});
function identityCard(user){return `<button class="account-option" type="button" data-login="${e(user.id)}">${avatar(user)}<span><strong>${e(user.name)}</strong><small>${user.isDemo?'模拟账号 · ':''}${e(user.schoolName||'未加入学校圈')}</small></span><span class="current">${state.user?.id===user.id?'当前':'切换'}</span></button>`;}
let identityTab='email',simulationAccounts=[],simulationPage=1,simulationQuery='';
async function openIdentity(tab=(state.user?'choose':'email')){
 try{state.emailLogin=await api('/auth/email/status');drawIdentityTab(tab);openDialog('identity-dialog');}catch(error){toast(error.message);}
}
function drawIdentityTab(tab){
 if(!['email','bind','choose','restore','simulation'].includes(tab))tab='email';
 if(tab==='email'&&identityTab==='choose')resetEmailLoginDraft();
 identityTab=tab;
 $('#identity-dialog').classList.toggle('email-mode',['email','bind'].includes(tab));
 $('#identity-title').textContent=tab==='bind'?'绑定邮箱':tab==='choose'?'我的账号':tab==='simulation'?'模拟账号':tab==='restore'?'找回旧账号':'登录校园岛';
 const content=$('#identity-content');
 if(tab==='email'||tab==='bind'){drawEmailLogin(tab);return;}
 if(tab==='choose'){
  const accounts=[...(state.user?.isDemo?[state.user]:[]),...state.identities.filter(u=>!u.isDemo)];
  content.innerHTML=`${accounts.map(u=>`<div class="account-row">${identityCard(u)}${u.id===state.user?.id?'<button type="button" class="simulation-entry" data-open-simulation>模拟账号 ↗</button>':''}</div>`).join('')}${!state.user?'<button class="text-button simulation-guest-entry" type="button" data-open-simulation>模拟账号 ↗</button>':''}<button class="button primary full" type="button" data-identity-tab="email">${accounts.length?'登录其他账号':'邮箱登录'}</button><div class="account-switch-links"><button class="text-button" type="button" data-identity-tab="restore">找回旧账号</button>${state.user?'<button class="text-button" type="button" data-logout>退出登录</button>':''}</div>`;
  if(state.user&&!state.user.isDemo&&!state.emailLogin?.bound&&state.emailLogin?.available)content.insertAdjacentHTML('afterbegin','<p class="account-bind-hint"><button class="text-button" type="button" data-bind-email>给当前账号绑定邮箱</button></p>');
 }
 if(tab==='simulation'){content.innerHTML=`<label class="field simulation-search"><span class="sr-only">搜索模拟账号</span><input type="search" id="simulation-query" placeholder="输入模拟账号名字" maxlength="50" value="${e(simulationQuery)}"></label><p class="simulation-note">公开共用，仅用于模拟；请勿填写私人信息。</p><div id="simulation-results"></div><button class="text-button simulation-back" type="button" data-identity-tab="choose">返回我的账号</button>`;drawSimulationAccounts();}
 if(tab==='restore')content.innerHTML='<form id="restore-identity-form"><label class="field">恢复口令<input name="recoveryKey" required type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="输入旧账号的恢复口令"></label><p class="form-error" id="identity-error" role="alert"></p><button class="button primary full" type="submit">找回账号</button></form><p class="email-login-note"><button class="text-button" type="button" data-identity-tab="email">返回邮箱登录</button></p>';
}
async function openSimulation(){
 try{const data=await api('/demo-accounts');simulationAccounts=[...(data.experienceAccounts||[]),...(data.accounts||[])];simulationQuery='';simulationPage=1;drawIdentityTab('simulation');}catch(error){toast(error.message);}
}
function drawSimulationAccounts(){
 const query=simulationQuery.trim().toLowerCase(),accounts=simulationAccounts.filter(u=>!query||u.name.toLowerCase().includes(query)),pages=Math.max(1,Math.ceil(accounts.length/6));simulationPage=Math.max(1,Math.min(simulationPage,pages));
 $('#simulation-results').innerHTML=accounts.slice((simulationPage-1)*6,simulationPage*6).map(identityCard).join('')||'<p class="field-hint">没有找到这个名字。</p>';
 if(pages>1)$('#simulation-results').insertAdjacentHTML('beforeend',`<nav class="simulation-pagination" aria-label="模拟账号翻页"><button class="text-button" type="button" data-simulation-page="${simulationPage-1}" ${simulationPage===1?'disabled':''}>上一页</button><span>${simulationPage} / ${pages}</span><button class="text-button" type="button" data-simulation-page="${simulationPage+1}" ${simulationPage===pages?'disabled':''}>下一页</button></nav>`);
}
document.addEventListener('input',event=>{if(event.target.id==='simulation-query'){simulationQuery=event.target.value;simulationPage=1;drawSimulationAccounts();}});
async function activateIdentity(id,button){button.disabled=true;try{await api('/login',{userId:id});resetPrivateState();await reload();toast('已切换账号');}catch(error){toast(error.message);}finally{button.disabled=false;}}
function schoolBadge(user){return user.schoolStatus==='email_verified'?'<span class="membership-badge verified">邮箱已验证</span>':user.schoolId?'<span class="membership-badge">演示圈 · 未认证</span>':'<span class="membership-badge">未认证</span>';}
function profileSummary(user){return `<div class="profile-summary">${avatar(user)}<div><h2>${e(user.name)}</h2><p>${e(user.schoolName||'未加入学校圈')}${schoolBadge(user)}</p>${user.isExperience?'<small>共用体验账号 · 非真实用户</small>':user.isDemo?'<small>共用演示身份</small>':''}</div></div>`;}
let schoolSearchCriteria={query:'',province:''};
let verificationEmailDraft='',verificationTimer=null,verificationResendAt=0;
function resetVerificationDraft(){verificationEmailDraft='';clearInterval(verificationTimer);verificationTimer=null;verificationResendAt=0;}
function schoolVerificationPanel(user){
 const info=state.verification||{},note='<small>仅验证学校邮箱归属，不代表在读学籍核验。</small>';
 if(user.schoolStatus==='email_verified')return `<section class="verification-note" id="verification-panel"><strong>学校邮箱已验证</strong><p>${e(info.maskedEmail||'验证成功')}</p>${note}</section>`;
 if(user.isDemo)return '<section class="verification-note" id="verification-panel"><strong>学校邮箱认证</strong><p>请使用自己创建的身份进行认证。</p></section>';
 if(!user.schoolId)return '<section class="verification-note" id="verification-panel"><strong>学校邮箱认证</strong><p>选择学校后可验证学校邮箱。</p></section>';
 if(!info.available)return `<section class="verification-note" id="verification-panel"><strong>学校邮箱认证</strong><p>${info.status==='domain_pending'?'该校邮箱认证暂未开放。':'邮箱验证码认证准备中，暂未开放。'}</p>${note}</section>`;
 return `<section class="verification-note" id="verification-panel"><strong>学校邮箱认证</strong><form id="verification-form"><label class="field">学校邮箱<input id="verification-email" name="email" type="email" maxlength="254" autocomplete="email" required placeholder="name@${e(info.domains[0])}" value="${e(verificationEmailDraft)}"></label><p class="field-hint">支持 ${info.domains.map(d=>'@'+e(d)).join('、')}</p><div class="verification-code-row"><label class="field">六位验证码<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="button outline" type="button" data-send-verification>获取验证码</button></div><button class="button primary" type="submit" ${info.challengeActive?'':'disabled'}>确认验证</button><p class="form-error" id="verification-feedback" role="status"></p></form>${note}</section>`;
}
function verificationCooldown(seconds){
 clearInterval(verificationTimer);const until=Date.now()+seconds*1000;verificationResendAt=until;
 const update=()=>{const button=$('[data-send-verification]');if(!button){clearInterval(verificationTimer);return;}const remaining=Math.max(0,Math.ceil((until-Date.now())/1000));button.disabled=remaining>0;button.textContent=remaining?remaining+' 秒后重发':'获取验证码';if(!remaining)clearInterval(verificationTimer);};update();if(seconds>0)verificationTimer=setInterval(update,1000);
}
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-send-verification]');if(!button)return;
 const email=$('#verification-email');if(!email.reportValidity())return;
 const epoch=state.epoch;verificationEmailDraft=email.value.trim();button.disabled=true;$('#verification-feedback').textContent='正在发送…';
 try{const result=await api('/verification/request',{email:verificationEmailDraft});if(epoch!==state.epoch)return;Object.assign(state.verification,{challengeActive:true,retryAfter:0,maskedEmail:result.maskedEmail});$('#verification-form button[type=submit]').disabled=false;$('#verification-feedback').textContent='验证码已发送至 '+result.maskedEmail+'，10 分钟内有效。';verificationCooldown(result.retryAfter);}
 catch(error){if(epoch!==state.epoch)return;$('#verification-feedback').textContent=error.message;button.disabled=false;try{const info=await api('/verification/status');if(epoch===state.epoch)verificationCooldown(info.retryAfter);}catch{}}
});
document.addEventListener('submit',async event=>{
 if(event.target.id!=='verification-form')return;event.preventDefault();const epoch=state.epoch,button=$('button[type=submit]',event.target);button.disabled=true;
 try{const {user}=await api('/verification/confirm',{code:event.target.elements.code.value.trim()});if(epoch!==state.epoch)return;state.user=user;state.verification=await api('/verification/status');if(epoch!==state.epoch)return;state.identities=state.identities.map(u=>u.id===user.id?user:u);drawNavigation();$('.profile-card .profile-summary').outerHTML=profileSummary(user);const badge=$('#school-panel>.field-hint')?.previousElementSibling?.querySelector('.membership-badge');if(badge)badge.outerHTML=schoolBadge(user);$('#verification-panel').outerHTML=schoolVerificationPanel(user);resetVerificationDraft();toast('学校邮箱已验证');}
 catch(error){if(epoch===state.epoch&&$('#verification-feedback'))$('#verification-feedback').textContent=error.message;}
 finally{if(button.isConnected&&epoch===state.epoch)button.disabled=false;}
});
function schoolPicker(){return `<details class="school-directory" open><summary>选择学校</summary><form id="school-search-form" role="search"><div class="school-search-controls"><label class="field">搜索学校<input type="search" id="school-search" placeholder="输入学校名称、简称或城市" autocomplete="off" maxlength="100"></label><label class="field">省份<select id="school-province"><option value="">全部省份</option>${[...new Set(state.schools.map(s=>s.province))].filter(Boolean).map(p=>`<option value="${e(p)}">${e(p)}</option>`).join('')}</select></label><button class="button primary" type="submit">搜索</button></div></form><div id="school-results" class="school-results" role="group" aria-label="本科高校目录"></div><p class="field-hint">进入学校圈不等于学校认证。</p><button class="button primary" type="button" id="join-demo-circle" disabled>进入学校圈</button><p class="form-error" id="school-error" role="alert"></p></details>`;}
function drawProfile(){
 const main=$('#main');if(!state.user){main.innerHTML='<div class="page-heading compact-heading"><h1>个人主页</h1></div>'+empty('登录后查看个人主页','', '<button class="button primary" type="button" data-account>邮箱登录</button>');return;}
 const user=state.user;const related=state.tasks.filter(t=>t.ownerId===user.id||t.myResponse||t.helperId===user.id);
 main.innerHTML=`<div class="page-heading compact-heading"><h1>个人主页</h1></div><div class="profile-layout"><section class="profile-card">${profileSummary(user)}<p class="profile-bio">${e(user.bio||'还没有填写简介。')}</p><dl class="profile-counts"><div><dt>我的求助</dt><dd>${state.tasks.filter(t=>t.ownerId===user.id).length}</dd></div><div><dt>我帮的忙</dt><dd>${state.tasks.filter(t=>t.myResponse||t.helperId===user.id).length}</dd></div><div><dt>进行中</dt><dd>${related.filter(t=>isParticipant(t)&&['active','review'].includes(t.status)).length}</dd></div></dl><a class="button outline full" href="#my">我的互助</a></section><div class="profile-panels"><section class="profile-panel profile-edit-panel"><details class="profile-edit-details" ${window.matchMedia('(max-width:640px)').matches?'':'open'}><summary>个人资料</summary>${user.isDemo?`<p class="field-hint">共用身份资料只读，可创建自己的身份。</p><button class="button primary" type="button" data-create-identity>创建身份</button>`:`<form id="profile-form"><fieldset class="profile-fields"><label class="field">用户名<input name="name" autocomplete="username" value="${e(user.name)}" required maxlength="20"></label>${profileAvatarEditor(user)}<label class="field">简介<textarea name="bio" rows="2" maxlength="140" placeholder="介绍一下自己">${e(user.bio)}</textarea></label><details class="profile-more"><summary>更多资料（选填）</summary><div class="form-grid"><label class="field">擅长什么<input name="skills" maxlength="120" value="${e(user.skills)}" placeholder="如 C++、英语口语"></label><label class="field">愿意提供的帮助<input name="offers" maxlength="120" value="${e(user.offers)}" placeholder="如讲题、借学习用品"></label></div></details><p class="form-error" id="profile-error" role="alert"></p><p class="operation-result" id="profile-result" hidden></p><button class="button primary" type="submit">保存</button></fieldset></form>`}</details></section><section class="profile-panel" id="school-panel"><h2>学校互助圈</h2>${user.schoolId?`<p>${e(user.schoolName)} ${schoolBadge(user)}</p><p class="field-hint">${state.schools.find(s=>s.id===user.schoolId)?.memberCount||0} 个身份已加入，含模拟身份；不是实时在线人数。</p>`:''}${user.schoolId&&!user.isDemo&&!user.isExperience&&!user.isSample?'<button class="text-button school-leave" type="button" data-leave-school>退出并重选学校 ↗</button>':''}${user.schoolId?'':schoolPicker()}${schoolVerificationPanel(user)}</section></div></div>`;
 schoolSearchCriteria={query:'',province:''};if(!user.schoolId)drawSchoolResults();if(verificationResendAt>Date.now()||state.verification?.retryAfter)verificationCooldown(Math.max(0,Math.ceil((verificationResendAt-Date.now())/1000))||state.verification.retryAfter);
 $('#school-panel').insertAdjacentHTML('beforebegin',emailAccountPanel(user));
}
function schoolMatches(s,query){const normalize=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[\s()]/g,'');const text=normalize([s.name,s.aliases,s.province,s.city,s.code].join(' '));return query.trim().split(/\s+/).every(term=>text.includes(normalize(term)));}
function drawSchoolResults(page=1){
 const {query,province}=schoolSearchCriteria;
 const matches=state.schools.filter(s=>(!province||s.province===province)&&schoolMatches(s,query)).sort((a,b)=>b.memberCount-a.memberCount||a.name.localeCompare(b.name,'zh-CN'));
 const pages=Math.max(1,Math.ceil(matches.length/6));state.schoolPage=Math.max(1,Math.min(page,pages));
 const displayed=matches.slice((state.schoolPage-1)*6,state.schoolPage*6);
 $('#school-results').innerHTML=`<p class="school-list-info" role="status">找到 ${matches.length} 所学校${matches.length>6?'，可以输入更完整的校名缩小范围。':''}</p>`+(matches.length?displayed.map(s=>`${state.user?.schoolId?`<div class="school-option ${state.user.schoolId===s.id?'selected':''}">`:`<button class="school-option ${state.selectedSchool===s.id?'selected':''}" type="button" data-select-school="${s.id}" aria-pressed="${state.selectedSchool===s.id}">` }<span class="school-option-copy"><strong>${e(s.name)}</strong><small>${e(s.province)} · ${e(s.city)}<br>自建 ${s.realCount||0} · 体验/模拟 ${s.demoCount||0}</small></span><span aria-hidden="true">${state.user?.schoolId?(state.user.schoolId===s.id?'当前':''):(state.selectedSchool===s.id?'✓':'＋')}</span>${state.user?.schoolId?'</div>':'</button>'}`).join(''):'<p class="field-hint">没有找到匹配的本科高校，请检查校名或调整省份。</p>')+(pages>1?`<div class="school-pagination"><button class="button quiet small" type="button" data-school-page="${state.schoolPage-1}" ${state.schoolPage===1?'disabled':''}>上一页</button><span>${state.schoolPage} / ${pages}</span><button class="button quiet small" type="button" data-school-page="${state.schoolPage+1}" ${state.schoolPage===pages?'disabled':''}>下一页</button></div>`:'');
}

async function openPublicProfile(id){if(id===state.user?.id){$('#detail-dialog').close();location.hash='#profile';if(state.view==='profile')drawProfile();return;}const epoch=state.epoch;try{const {user}=await api('/profiles/'+encodeURIComponent(id));if(epoch!==state.epoch)return;$('#public-profile-content').innerHTML=`<div class="dialog-head"><h2 id="public-profile-title">个人主页</h2><button class="icon-button" data-close="profile-dialog" aria-label="关闭主页">×</button></div>${profileSummary(user)}<p class="profile-bio">${e(user.bio||'还没有填写简介。')}</p>${user.skills?`<div class="profile-info"><h3>擅长什么</h3><p>${e(user.skills)}</p></div>`:''}${user.offers?`<div class="profile-info"><h3>愿意提供的帮助</h3><p>${e(user.offers)}</p></div>`:''}`;openDialog('profile-dialog');}catch(error){toast(error.message);}}
document.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button)return;
 if(button.hasAttribute('data-open-simulation')){await openSimulation();return;}
 if(button.dataset.simulationPage){simulationPage=Number(button.dataset.simulationPage);drawSimulationAccounts();return;}
 if(button.dataset.identityTab){drawIdentityTab(button.dataset.identityTab);return;}
 if(button.dataset.login){await activateIdentity(button.dataset.login,button);return;}
 if(button.hasAttribute('data-continue-identity')){state.recoveryKey=null;$('#identity-dialog').close();$('#identity-content').innerHTML='';location.hash='#profile';if(state.view==='profile')drawProfile();return;}
 if(button.hasAttribute('data-copy-recovery')){const input=$('#recovery-key');try{await navigator.clipboard.writeText(input.value);toast('已复制');}catch{input.focus();input.select();toast('请复制并保存恢复口令');}return;}
 if(button.hasAttribute('data-logout')){if(!confirm(state.emailLogin?.bound?'退出后可用邮箱验证码重新登录。确定退出？':'退出此设备后，恢复自建身份需要恢复口令。确定退出？'))return;try{await api('/logout',{});resetPrivateState();await reload();toast('已退出');}catch(error){toast(error.message);}return;}
 if(button.hasAttribute('data-leave-school')){if(!confirm('退出后可重新选择学校。原学校的求助记录保留，重新加入后可查看；学校邮箱认证需重新完成。'))return;button.disabled=true;try{await api('/me/circle/leave',{});state.selectedSchool=null;verificationResendAt=0;await reload();document.querySelector('#school-panel')?.scrollIntoView({behavior:'smooth',block:'start'});toast('请选择新的学校');}catch(error){toast(error.message);button.disabled=false;}return;}
 if(button.dataset.schoolPage){drawSchoolResults(Number(button.dataset.schoolPage));return;}
 if(button.dataset.selectSchool){state.selectedSchool=button.dataset.selectSchool;drawSchoolResults(state.schoolPage);$('#join-demo-circle').disabled=false;document.querySelector('[data-select-school="'+state.selectedSchool+'"]')?.focus({preventScroll:true});return;}
 if(button.id==='join-demo-circle'){button.disabled=true;try{await api('/me/circle',{schoolId:state.selectedSchool,mode:'demo'});state.selectedSchool=null;await reload();toast('已加入学校圈');}catch(error){$('#school-error').textContent=error.message;button.disabled=false;}}
});
document.addEventListener('submit',event=>{
 if(event.target.id!=='school-search-form')return;
 event.preventDefault();schoolSearchCriteria={query:$('#school-search').value.trim(),province:$('#school-province').value};
 state.selectedSchool=null;if($('#join-demo-circle'))$('#join-demo-circle').disabled=true;drawSchoolResults();
});
document.addEventListener('submit',async event=>{const form=event.target;if(!['create-identity-form','restore-identity-form','profile-form'].includes(form.id))return;event.preventDefault();const epoch=state.epoch;const submit=$('button[type=submit]',form);submit.disabled=true;
 try{const body=Object.fromEntries(new FormData(form));
  if(form.id==='create-identity-form'){const data=await api('/identities',body);resetPrivateState();state.recoveryKey=data.recoveryKey;await reload();$('#identity-content').innerHTML=`<div class="recovery-panel"><h3>身份已创建</h3><p>请保存恢复口令。换设备或退出后，可用它找回自己的记录。</p><label class="field">恢复口令<input id="recovery-key" readonly value="${e(data.recoveryKey)}" autocomplete="off" spellcheck="false"></label><p class="field-hint">口令仅在创建时显示，请勿分享给他人。</p><button class="button outline" type="button" data-copy-recovery>复制口令</button><button class="button primary" type="button" data-continue-identity>已保存，进入主页</button></div>`;openDialog('identity-dialog');}
  if(form.id==='restore-identity-form'){await api('/identities/restore',body);resetPrivateState();await reload();location.hash='#profile';toast('已恢复身份');}
  if(form.id==='profile-form'){if(avatarProcessing)throw new Error('图片正在处理，请稍等。');form.querySelector('.profile-fields').disabled=true;let payload=body;if(profileAvatarFile){payload=new FormData(form);for(const [key,value] of Object.entries(body))payload.set(key,value);payload.set('image',profileAvatarFile);}const {user}=await api('/me/profile',payload);if(epoch!==state.epoch)return;clearProfileAvatar();state.user=user;await reload();if(epoch!==state.epoch)return;$('#profile-result').textContent='已保存';$('#profile-result').hidden=false;$('#profile-error').textContent='';}
 }catch(error){if(epoch!==state.epoch)return;const target=form.id==='profile-form'?$('#profile-error'):$('#identity-error');if(target)target.textContent=error.message;else toast(error.message);}finally{submit.disabled=false;if(form.id==='profile-form'&&form.isConnected)form.querySelector('.profile-fields').disabled=false;}
});
