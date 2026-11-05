const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'历史记录未标注';
const statuses={open:'待回应',selecting:'待选择',active:'进行中',review:'待确认完成',completed:'已完成',cancelled:'已取消',expired:'已截止'};
let data=null,page=1,mailConfiguration=null;
async function request(path,body){const r=await fetch('/api/admin/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Requested-With':'CampusKindness'},body:body===undefined?undefined:JSON.stringify(body)});const result=await r.json();if(!r.ok){const error=new Error(result.error||'操作失败，请重试');error.status=r.status;throw error;}return result;}
function showLogin(){data=null;$('#admin-dashboard').hidden=true;$('#admin-login').hidden=false;$('#admin-table-body').innerHTML='';$('#admin-stats').innerHTML='';$('#admin-schools').innerHTML='';}
async function refresh(){
  try{const responses=await Promise.all([request('overview'),request('verification')]);data=responses[0];mailConfiguration=responses[1];$('#admin-login').hidden=true;$('#admin-dashboard').hidden=false;$('#login-error').textContent='';$('#admin-error').textContent='';
    $('#updated-at').textContent='更新于 '+when(data.updatedAt)+' · 点击刷新获取最新数据';
    const s=data.summary;
    $('#admin-stats').innerHTML=[['自建身份',s.realUsers,'尚未核验为不同真人'],['体验与模拟身份',s.demoUsers,'其中互动体验 '+(s.experienceUsers||0)+' 个'],['非模拟求助',s.realTasks,'全部求助 '+s.tasks+' 条'],['非模拟已完成互助',s.completed,'完成状态由双方确认']].map(([label,count,note])=>`<article class="admin-stat"><span>${label}</span><strong>${count}</strong><small>${note}</small></article>`).join('');
    drawSchoolCircles();drawVerificationConfiguration();
    const selected=$('#admin-school').value;$('#admin-school').innerHTML='<option value="">全部学校</option><option value="unassigned">未加入学校圈</option>'+data.schools.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('#admin-school').value=selected;
    const c=data.capacity;$('#admin-capacity').textContent=`身份 ${s.users} / ${c.users}，求助 ${s.tasks} / ${c.tasks}。当前数据约 ${(c.stateBytes/1024).toFixed(1)} KB；线上数据快照上限约 ${(c.cloudStateBytes/1024).toFixed(0)} KB。`;
    draw();
  }catch(error){if(error.status===401){showLogin();return;}throw error;}
}
function drawSchoolCircles(){
  if(!data)return;
  const query=$('#admin-circle-search').value.trim();
  const normalize=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[\s()]/g,'');
  const matches=data.schools.filter(s=>query?query.split(/\s+/).every(t=>normalize([s.name,s.aliases,s.province,s.city,s.code].join(' ')).includes(normalize(t))):s.memberCount>0).sort((a,b)=>b.memberCount-a.memberCount||a.name.localeCompare(b.name,'zh-CN'));
  $('#admin-circle-count').textContent=`已开放 ${data.schools.length} 所本科高校。`+(query?`找到 ${matches.length} 所，显示前 ${Math.min(matches.length,24)} 所。`:'默认展示已有成员的学校圈，可搜索其他学校。');
  $('#admin-schools').innerHTML=matches.slice(0,24).map(s=>`<article class="admin-school-card"><strong>${esc(s.name)}</strong><small>${esc(s.province)} · ${esc(s.city)}</small><p>${s.memberCount} 个身份已加入</p><small>自建 ${s.realCount} · 互动体验 ${s.experienceCount||0} · 其他模拟 ${s.demoCount-(s.experienceCount||0)}</small></article>`).join('')||'<p>没有找到符合条件的学校圈。</p>';
}
$('#admin-circle-search').addEventListener('input',drawSchoolCircles);
function draw(){if(!data)return;const kind=$('#admin-kind').value,school=$('#admin-school').value,source=$('#admin-source').value,q=$('#admin-search').value.trim().toLowerCase();
  const rows=data[kind].filter(r=>(!school||(school==='unassigned'?!r.schoolId:r.schoolId===school))&&(!source||(source==='experience'?r.isExperience:source==='demo'?r.isDemo:!r.isDemo))&&[r.id,r.name,r.title,r.ownerName].join(' ').toLowerCase().includes(q));
  const pages=Math.max(1,Math.ceil(rows.length/15));page=Math.max(1,Math.min(page,pages));
  $('#record-count').textContent=rows.length+' 条';$('#admin-page').textContent=page+' / '+pages;$('#admin-prev').disabled=page<=1;$('#admin-next').disabled=page>=pages;
  const headers=kind==='users'?['身份 / 编号','学校圈','来源','创建时间']:['求助 / 编号','发布者 / 学校','来源','状态 / 回应','创建时间'];
  $('#admin-table-head').innerHTML='<tr>'+headers.map(h=>`<th scope="col">${h}</th>`).join('')+'</tr>';
  $('#admin-table-body').innerHTML=rows.slice((page-1)*15,page*15).map(r=>{const source=`<span class="source-label ${r.isDemo?'':'real'}">${r.isSample?'模拟样本':r.isExperience?'互动体验':r.isDemo?'预设演示':kind==='users'?'自建身份':'非模拟求助'}</span>`;
    const cells=kind==='users'?[`${esc(r.name)}<small>${esc(r.id)}</small>`,esc(r.schoolName||'未加入'),source,esc(when(r.createdAt))]:[`${esc(r.title)}<small>${esc(r.id)}</small>`,`${esc(r.ownerName)}<small>${esc(r.schoolName)}</small>`,source,`${esc(statuses[r.status]||r.status)}<small>${r.responseCount} 次回应</small>`,esc(when(r.createdAt))];return '<tr>'+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr>';
  }).join('')||`<tr><td colspan="${headers.length}">没有符合条件的记录。</td></tr>`;
}
async function busy(button,operation){button.disabled=true;$('#admin-error').textContent='';try{await operation();}catch(error){if(error.status===401)showLogin();$('#admin-error').textContent=error.message;$('#login-error').textContent=error.message;}finally{button.disabled=false;}}
$('#admin-login-form').addEventListener('submit',event=>{event.preventDefault();const input=event.target.elements.key;busy(event.target.querySelector('button'),async()=>{await request('login',{key:input.value});input.value='';await refresh();});});
$('#admin-refresh').onclick=e=>busy(e.currentTarget,refresh);
$('#admin-logout').onclick=e=>busy(e.currentTarget,async()=>{await request('logout',{});showLogin();});
$('#admin-samples').onclick=e=>busy(e.currentTarget,async()=>{const result=await request('samples',{});$('#sample-result').textContent=`新增 ${result.usersAdded} 个模拟身份、${result.tasksAdded} 条模拟求助。已有记录保持不变。`;$('#sample-result').hidden=false;await refresh();});
$('#admin-export').onclick=e=>busy(e.currentTarget,async()=>{await refresh();if(!data)return;const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='校园岛数据概览-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
for(const id of ['admin-kind','admin-school','admin-source','admin-search'])$('#'+id).addEventListener(id==='admin-search'?'input':'change',()=>{page=1;draw();});
$('#admin-prev').onclick=()=>{page--;draw();};$('#admin-next').onclick=()=>{page++;draw();};
refresh().catch(error=>$('#login-error').textContent=error.message);

function drawVerificationConfiguration(){
 if(!data||!mailConfiguration)return;
 $('#admin-mail-status').textContent=mailConfiguration.deliveryReady?'发信服务已配置，可为已配置后缀的学校发送验证码。':'发信服务尚未接入，暂不能发送验证码。可先保存经过核实的学校邮箱后缀。';
 const previous=$('#verification-school').value;$('#verification-school').innerHTML='<option value="">选择要配置的学校</option>'+data.schools.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('#verification-school').value=previous;
 fillVerificationConfiguration();
}
function fillVerificationConfiguration(){const selected=mailConfiguration?.configs.find(c=>c.schoolId===$('#verification-school').value);$('#verification-domains').value=selected?.domains.join('\n')||'';$('#verification-source').value=selected?.sourceUrl||'';}
$('#verification-school').addEventListener('change',()=>{fillVerificationConfiguration();$('#admin-verification-result').hidden=true;});
$('#admin-verification-form').addEventListener('submit',event=>{event.preventDefault();busy(event.target.querySelector('button'),async()=>{await request('verification',{schoolId:$('#verification-school').value,domains:$('#verification-domains').value.split(/[\s,，;；]+/).filter(Boolean),sourceUrl:$('#verification-source').value.trim()});mailConfiguration=await request('verification');$('#admin-verification-result').textContent='已保存；只有完成邮箱验证码验证的身份才会获得标记。';$('#admin-verification-result').hidden=false;});});

$('#admin-experiences').onclick=event=>busy(event.currentTarget,async()=>{const result=await request('experiences',{});$('#experience-result').textContent=`新增 ${result.usersAdded} 个体验账号、${result.tasksAdded} 条体验求助，转换 ${result.convertedUsers} 个只读身份及 ${result.convertedTasks} 条求助。体验数据不代表真人运营记录。`;$('#experience-result').hidden=false;await refresh();});
