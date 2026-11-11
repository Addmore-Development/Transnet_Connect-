function clearAuth(){localStorage.removeItem('tc_auth');sessionStorage.removeItem('tc_auth');}
function readAuth(){
 try{return JSON.parse(localStorage.getItem('tc_auth')||sessionStorage.getItem('tc_auth')||'null');}catch(e){return null;}
}
const auth = readAuth();
if (!auth || !auth.token || (auth.expiresAt && Date.now() > auth.expiresAt)) {
  clearAuth();
  window.location.replace('login.html');
  throw new Error('Not signed in — redirecting to login.'); // stops the rest of this script
}
const isAdmin = auth.role === 'admin';
document.body.classList.add(isAdmin ? 'role-admin' : 'role-division');

// Every /api call goes through here so the session token is always sent.
// A 401 means the session ended, so we send the user back to sign in.
async function apiFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${auth.token}` } });
  if (res.status === 401) {
    clearAuth();
    window.location.href = 'login.html';
    throw new Error('Your session has expired — please sign in again.');
  }
  return res;
}


let cases = [];

async function loadCases(){
 try{
  const res=await apiFetch('/api/cases');
  if(!res.ok) throw new Error(`API error ${res.status}`);
  cases=await res.json();
 }catch(err){
  console.error('Failed to load cases:',err);
  toast('Couldn’t load cases. Please try again.');
  cases=[];
 }
 renderAll();
}

const titleMap={dashboard:'Command Centre',intake:'Record an Engagement',cases:'Case Management',stakeholders:'Stakeholders',questionnaire:'Stakeholder Questionnaire',intelligence:'Insights',reports:'Executive Reporting',logins:'Login Activity'};
const navItems=[...document.querySelectorAll('.nav-item')];
function setView(id){
 if(!isAdmin&&(id==='intake'||id==='logins')) id='dashboard';
 if(id==='logins') loadLogins();
 if(id==='stakeholders') loadStakeholders();
 if(id==='dashboard') loadSupport();
 document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));
 navItems.forEach(n=>n.classList.toggle('active',n.dataset.view===id));
 document.getElementById('viewTitle').textContent=titleMap[id]||'Transnet Connect';
 window.scrollTo({top:0,behavior:'smooth'});
}
navItems.forEach(n=>n.addEventListener('click',()=>setView(n.dataset.view)));
document.querySelectorAll('[data-view-jump]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.viewJump)));

function riskPill(r){return `<span class="pill ${r.toLowerCase()}">${r}</span>`}
function statusPill(s){let c=s==='In Progress'?'progress':s.toLowerCase();return `<span class="pill ${c}">${s}</span>`}
function slaClass(s){if(s==='Met')return 'good';let m=s.match(/(\d+)h/);if(s.includes('m')&&!m)return 'bad';if(m&&+m[1]<=2)return 'warn';return 'good'}

function renderDashboard(){
 const open=cases.filter(c=>c.status!=='Resolved').length;
 const high=cases.filter(c=>c.risk==='High'&&c.status!=='Resolved').length;
 const escalated=cases.filter(c=>c.status==='Escalated').length;
 const resolved=cases.filter(c=>c.status==='Resolved').length;
 const metrics=[['Open cases',open,'+8% vs last week','warn'],['High-risk matters',high,'Requires executive visibility','bad'],['SLA escalations',escalated,'2 due within 60 minutes','bad'],['Resolved today',resolved,'87% within SLA','good']];
 document.getElementById('metricsGrid').innerHTML=metrics.map(m=>`<div class="metric-card"><div class="metric-label">${m[0]}</div><div class="metric-value">${m[1]}</div><div class="metric-meta ${m[3]}">${m[2]}</div></div>`).join('');
 renderNetworkRiskIndex(cases,open,high);
 renderFollowups();
 document.getElementById('priorityCases').innerHTML=cases.filter(c=>c.risk!=='Low').slice(0,6).map(c=>`<tr class="case-row" data-case-id="${c.id}"><td class="case-id">${c.id}</td><td>${escHtml(c.stakeholder)}</td><td>${escHtml(c.issue)}</td><td>${escHtml(c.od)}</td><td>${riskPill(c.risk)}</td><td class="sla ${slaClass(c.sla)}">${escHtml(c.sla)}</td></tr>`).join('');
 document.querySelectorAll('#priorityCases .case-row').forEach(row=>row.addEventListener('click',()=>openCaseModal(row.dataset.caseId)));
 const channelCounts={}; cases.forEach(c=>channelCounts[c.channel]=(channelCounts[c.channel]||0)+1); const max=Math.max(...Object.values(channelCounts),1);
 document.getElementById('channelBars').innerHTML=Object.entries(channelCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="channel-row"><span>${escHtml(k)}</span><div class="bar"><span style="width:${Math.round(v/max*100)}%"></span></div><b>${v}</b></div>`).join('');
}


function renderNetworkRiskIndex(cases,open,high){
 const scoreEl=document.getElementById('networkRiskScore');
 const noteEl=document.getElementById('networkRiskNote');
 if(!scoreEl||!noteEl) return;

 if(cases.length===0){
  scoreEl.innerHTML='—<span>/100</span>';
  noteEl.textContent='No data yet — reset demo data or log an interaction to populate.';
  return;
 }

 const openCases=cases.filter(c=>c.status!=='Resolved');
 if(openCases.length===0){
  scoreEl.innerHTML='0<span>/100</span>';
  noteEl.textContent='Stable • no open matters';
  return;
 }

 const weight={High:3,Medium:1,Low:0};
 const weightSum=openCases.reduce((sum,c)=>sum+(weight[c.risk]??1),0);
 const index=Math.round((weightSum/(openCases.length*3))*100);

 let label='Stable';
 if(index>=70) label='Critical';
 else if(index>=40) label='Elevated';
 else if(index>=15) label='Guarded';

 scoreEl.innerHTML=`${index}<span>/100</span>`;
 noteEl.textContent=`${label} • ${high} high-risk matter${high===1?'':'s'}`;
}

function renderCases(){
 const q=(document.getElementById('caseSearch')?.value||'').toLowerCase(); const f=document.getElementById('caseFilter')?.value||'all';
 const filtered=cases.filter(c=>(f==='all'||c.status===f)&&JSON.stringify(c).toLowerCase().includes(q));
 document.getElementById('casesTable').innerHTML=filtered.map(c=>`<tr class="case-row" data-case-id="${c.id}"><td class="case-id">${c.id}</td><td>${escHtml(c.created)}</td><td><b>${escHtml(c.stakeholder)}</b><br><small>${escHtml(c.name)}</small></td><td>${escHtml(c.channel)}</td><td>${escHtml(c.issue)}</td><td>${escHtml(c.od)}</td><td>${escHtml(c.owner)}</td><td>${riskPill(c.risk)}</td><td>${statusPill(c.status)}</td><td class="sla ${slaClass(c.sla)}">${escHtml(c.sla)}</td></tr>`).join('');
 document.querySelectorAll('#casesTable .case-row').forEach(row=>row.addEventListener('click',()=>openCaseModal(row.dataset.caseId)));
}

document.getElementById('caseSearch').addEventListener('input',renderCases);document.getElementById('caseFilter').addEventListener('change',renderCases);

// ===========================================================================
// Stakeholders: the accounts that can sign in (admin sees every stakeholder;
// a division account sees its own), with contact details. Not enquirers.
// ===========================================================================
var stakeholderAccounts=[];
var stakeholderEditId=null;
function fmtSignIn(iso){return iso?new Date(iso).toLocaleString('en-ZA',{day:'2-digit',month:'short',year:'numeric'}):'Not yet'}
function stakeholderBadge(s){const code=String(s.division||'');const caps=code.replace(/[^A-Z]/g,'');return (caps.length>=2?caps:code.slice(0,2)).slice(0,3)}

async function loadStakeholders(){
 const msg=document.getElementById('stakeholdersMsg');
 if(!isAdmin){
  stakeholderAccounts=[{id:'self',email:auth.email,division:auth.division,divisionLabel:auth.divisionLabel||auth.division,contactName:'',jobTitle:'',phone:'',lastSignIn:null}];
  renderStakeholders();return;
 }
 try{
  const res=await apiFetch('/api/auth/login?resource=stakeholders');
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||`API error ${res.status}`);
  if(msg) msg.hidden=true;
  stakeholderAccounts=data.stakeholders||[];
 }catch(err){
  console.error('Failed to load stakeholders:',err);
  if(msg){msg.textContent="Couldn't load stakeholders. Please try again.";msg.hidden=false;}
  stakeholderAccounts=[];
 }
 renderStakeholders();
}

function renderStakeholders(){
 const grid=document.getElementById('stakeholderGrid');
 if(!grid) return;
 if(!stakeholderAccounts.length){grid.innerHTML='<div class="analysis-empty">No stakeholder accounts to show yet.</div>';return;}
 grid.innerHTML=stakeholderAccounts.map(s=>{
  const open=cases.filter(c=>c.od===s.division&&c.status!=='Resolved').length;
  const editing=isAdmin&&stakeholderEditId===s.id;
  const sub=s.contactName?escHtml(s.contactName)+(s.jobTitle?' &middot; '+escHtml(s.jobTitle):''):'No contact person added yet';
  const body=editing
   ?`<div class="sh-form">
      <label>Contact person<input data-f="contactName" value="${escHtml(s.contactName)}" maxlength="120" /></label>
      <label>Job title<input data-f="jobTitle" value="${escHtml(s.jobTitle)}" maxlength="120" /></label>
      <label>Phone number<input data-f="phone" type="tel" value="${escHtml(s.phone)}" maxlength="40" /></label>
      <div class="sh-actions"><button type="button" class="ghost-btn sh-cancel">Cancel</button><button type="button" class="primary-btn sh-save">Save changes</button></div>
     </div>`
   :`<div class="stakeholder-meta">
      <div class="wide"><small>Email</small><b><a href="mailto:${escHtml(s.email)}">${escHtml(s.email)}</a></b></div>
      <div><small>Phone</small><b>${s.phone?`<a href="tel:${escHtml(s.phone.replace(/[^0-9+]/g,''))}">${escHtml(s.phone)}</a>`:'&mdash;'}</b></div>
      <div><small>Open cases</small><b>${open}</b></div>
      <div class="wide"><small>Last sign-in</small><b>${isAdmin?fmtSignIn(s.lastSignIn):'&mdash;'}</b></div>
     </div>
     ${isAdmin?'<div class="sh-actions"><button type="button" class="ghost-btn sh-edit">Edit contact details</button></div>':''}`;
  return `<div class="stakeholder-card" data-sid="${escHtml(s.id)}"><div class="stakeholder-card-head"><div class="stakeholder-avatar">${escHtml(stakeholderBadge(s))}</div><div><h3>${escHtml(s.divisionLabel||s.division)}</h3><p>${sub}</p></div></div>${body}</div>`;
 }).join('');
}

document.getElementById('stakeholderGrid').addEventListener('click',async e=>{
 const card=e.target.closest('.stakeholder-card');
 if(!card||!isAdmin) return;
 const id=card.dataset.sid;
 if(e.target.closest('.sh-edit')){stakeholderEditId=id;renderStakeholders();return;}
 if(e.target.closest('.sh-cancel')){stakeholderEditId=null;renderStakeholders();return;}
 const saveBtn=e.target.closest('.sh-save');
 if(!saveBtn) return;
 const val=f=>card.querySelector(`[data-f="${f}"]`).value;
 saveBtn.disabled=true;saveBtn.textContent='Saving...';
 try{
  const res=await apiFetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update_contact',id,contactName:val('contactName'),jobTitle:val('jobTitle'),phone:val('phone')})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||`API error ${res.status}`);
  stakeholderAccounts=stakeholderAccounts.map(s=>s.id===id?{...s,...data.stakeholder}:s);
  stakeholderEditId=null;
  renderStakeholders();
  toast('Changes saved');
 }catch(err){
  console.error('Failed to save contact details:',err);
  toast("Couldn't save. Please try again.");
  saveBtn.disabled=false;saveBtn.textContent='Save changes';
 }
});
function renderIntelligence(){
 const counts={};cases.forEach(c=>counts[c.issue]=(counts[c.issue]||0)+1); const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,7); const max=Math.max(...entries.map(e=>e[1]),1);
 document.getElementById('trendChart').innerHTML=entries.map(([k,v])=>`<div class="trend-col"><b>${v}</b><div class="col" style="height:${Math.max(20,v/max*210)}px"></div><span>${escHtml(k)}</span></div>`).join('');
 document.getElementById('riskCards').innerHTML=cases.filter(c=>c.risk==='High').slice(0,3).map(c=>`<div class="risk-card"><b>${escHtml(c.issue)}</b><p>${escHtml(c.message)}</p><div class="risk-meta">${escHtml(c.od)} • ${escHtml(c.stakeholder)} • ${escHtml(c.sla)} SLA</div></div>`).join('');
}

var lastInsight=null;
function openInsightReport(){
 const a=lastInsight; if(!a) return;
 const list=x=>Array.isArray(x)?x:[];
 const com=list(a.commonalities), ano=list(a.anomalies), act=list(a.recommended_actions);
 openReport({
  title:'Stakeholder Insights Report',
  intro:'AI-assisted analysis of commonalities and anomalies across all current cases.',
  scope:isAdmin?'All divisions':(auth.divisionLabel||auth.division||'Your division'),
  kpis:[['Cases analysed',cases.length],['Commonalities',com.length],['Anomalies',ano.length],['Recommended actions',act.length]],
  sections:[
   {heading:'Summary',head:['Summary'],rows:[[a.summary||'']]},
   {heading:'Commonalities',intro:'Patterns that appear across several cases.',head:['Theme','Detail'],rows:com.map(c=>[c.title,c.detail])},
   {heading:'Anomalies',intro:'Cases or patterns that stand out from the rest.',head:['Observation','Detail'],rows:ano.map(c=>[c.title,c.detail])},
   {heading:'Recommended actions',head:['#','Action'],rows:act.map((x,i)=>[i+1,x])}
  ]
 });
}
// ===========================================================================
// Engagement features: follow-ups, support requests, reassigning a case,
// engagement report on resolved cases, dashboard tabs and report filters.
// ===========================================================================
const DIVISION_OPTIONS=[{code:'Group CA',label:'Group Corporate Affairs'},{code:'TFR',label:'Transnet Freight Rail (TFR)'},{code:'TRIM',label:'Transnet Rail Infrastructure Manager (TRIM)'},{code:'TNPA',label:'Transnet National Ports Authority (TNPA)'},{code:'TPT',label:'Transnet Port Terminals (TPT)'},{code:'TE',label:'Transnet Engineering (TE)'},{code:'TPL',label:'Transnet Pipelines (TPL)'},{code:'Property',label:'Transnet Property'}];
const SUPPORT_TYPES=['More information from the enquirer','Input from another division','Senior or executive escalation','Resources or access','Technical or system help','Other'];
var supportList=[];
function fmtShort(ts){return new Date(ts).toLocaleString('en-ZA',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
async function readError(res){let m='';try{m=(await res.json()).error||''}catch(e){}return m||`API error ${res.status}`}

// ---- Dashboard tabs (stakeholder accounts only) ----
(function tagDashPanels(){
 const map={'LIVE CASE FLOW':'overview','CHANNEL MIX':'engagement','ISSUE HOTSPOTS':'engagement','STAKEHOLDER INSIGHTS':'insights','INTELLIGENCE SIGNALS':'insights'};
 document.querySelectorAll('#dashboard .section-label').forEach(l=>{const k=map[l.textContent.trim()];const p=l.closest('.panel');if(k&&p&&!p.dataset.dtab)p.dataset.dtab=k;});
 const hero=document.querySelector('#dashboard .hero-strip');if(hero)hero.dataset.dtab='overview';
 const mg=document.getElementById('metricsGrid');if(mg)mg.dataset.dtab='overview';
})();
function setDashTab(tab){
 if(isAdmin) return;
 document.querySelectorAll('#dashboard [data-dtab]').forEach(el=>el.classList.toggle('dtab-off',el.dataset.dtab!==tab));
 document.querySelectorAll('#dashTabs button').forEach(b=>b.classList.toggle('active',b.dataset.dtabBtn===tab));
}
if(!isAdmin){
 document.getElementById('dashTabs').addEventListener('click',e=>{const b=e.target.closest('button');if(b)setDashTab(b.dataset.dtabBtn)});
 setDashTab('overview');
}

// ---- Open follow-ups: action owner + due date (created time + SLA) ----
function slaMinutes(s){
 const t=String(s||'');const h=t.match(/(\d+)\s*h/i);const m=t.match(/(\d+)\s*m(?!o)/i);
 const mins=(h?+h[1]*60:0)+(m?+m[1]:0);return mins||null;
}
function dueAt(c){
 const mins=slaMinutes(c.sla);const start=c.created_at?new Date(c.created_at).getTime():NaN;
 return (mins&&!isNaN(start))?start+mins*60000:null;
}
function renderFollowups(){
 const body=document.getElementById('followupRows');if(!body) return;
 const now=Date.now();
 const open=cases.filter(c=>c.status!=='Resolved').map(c=>({c,due:dueAt(c)})).sort((a,b)=>(a.due===null?1e15:a.due)-(b.due===null?1e15:b.due));
 const cnt=document.getElementById('followupCount');if(cnt)cnt.textContent=open.length?`(${open.length})`:'';
 body.innerHTML=open.length?open.slice(0,8).map(({c,due})=>{
  const late=due!==null&&due<now;
  return `<tr class="case-row" data-case-id="${escHtml(c.id)}"><td class="case-id">${escHtml(c.id)}</td><td>${escHtml(c.issue)}</td><td>${escHtml(c.owner||'Unassigned')}</td><td>${due===null?'&mdash;':escHtml(fmtShort(due))}${late?' <span class="pill high">Past due</span>':''}</td></tr>`;
 }).join(''):'<tr><td colspan="4" class="lg-empty">You\u2019re all caught up. There are no open follow-ups.</td></tr>';
 body.querySelectorAll('.case-row').forEach(r=>r.addEventListener('click',()=>openCaseModal(r.dataset.caseId)));
}

// ---- Support requests (stakeholder -> admin alert) ----
async function loadSupport(){
 try{
  const res=await apiFetch('/api/cases?resource=support');
  if(!res.ok) throw new Error(await readError(res));
  supportList=(await res.json()).requests||[];
 }catch(err){console.warn('Support requests not loaded:',err.message);supportList=[];}
 renderSupportAlerts();
}
function renderSupportAlerts(){
 const box=document.getElementById('supportAlerts');if(!box) return;
 const open=supportList.filter(r=>r.status==='Open');
 if(!open.length){box.hidden=true;box.innerHTML='';return;}
 box.hidden=false;
 box.innerHTML=`<div class="section-label">${isAdmin?'SUPPORT REQUESTS':'YOUR SUPPORT REQUESTS'}</div><h3>${isAdmin?'Stakeholders are asking for support':'Waiting on the admin team'} (${open.length})</h3>`
  +open.slice(0,6).map(r=>`<div class="support-item" data-case-id="${escHtml(r.case_id)}" data-sid="${escHtml(r.id)}"><div class="support-main"><b>${escHtml(r.case_id)}</b> <span class="support-div">${escHtml(r.division||'')}</span><span class="support-type">${escHtml(r.support_type)}</span>${r.details?`<p>${escHtml(r.details)}</p>`:''}<small>Requested by ${escHtml(r.requested_by||'a stakeholder')} on ${escHtml(fmtShort(r.created_at))}</small></div><div class="support-actions"><button type="button" class="ghost-btn sup-open">Open case</button>${isAdmin?'<button type="button" class="primary-btn sup-done">Mark as handled</button>':''}</div></div>`).join('');
}
document.getElementById('supportAlerts').addEventListener('click',async e=>{
 const item=e.target.closest('.support-item');if(!item) return;
 if(e.target.closest('.sup-open')){openCaseModal(item.dataset.caseId);return;}
 const done=e.target.closest('.sup-done');if(!done||!isAdmin) return;
 done.disabled=true;
 try{
  const res=await apiFetch('/api/cases?resource=support',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.dataset.sid,status:'Handled'})});
  if(!res.ok) throw new Error(await readError(res));
  toast('Marked as handled');
  await loadSupport();
 }catch(err){console.error(err);toast("Couldn't update the request. Please try again.");done.disabled=false;}
});
if(isAdmin) setInterval(loadSupport,60000);

// ---- Extra sections inside the case modal ----
function enhanceCaseModal(c){
 let html='';
 if(isAdmin){
  html+=`<div class="modal-section"><h4>Reassign case</h4><p class="modal-hint">If the suggested division looks wrong, send the case to the right stakeholder.</p><div class="status-edit-row"><select id="reassignSelect">${DIVISION_OPTIONS.map(d=>`<option value="${d.code}" ${d.code===c.od?'selected':''}>${escHtml(d.label)}</option>`).join('')}</select><button type="button" class="ghost-btn" id="reassignBtn">Reassign</button></div></div>`;
 }else{
  html+=`<div class="modal-section"><h4>Request support</h4><p class="modal-hint">Tell the admin team what kind of support you need on this case.</p><div class="support-form"><select id="supportType">${SUPPORT_TYPES.map(t=>`<option>${escHtml(t)}</option>`).join('')}</select><textarea id="supportDetails" rows="3" maxlength="1000" placeholder="Describe what you need help with..."></textarea><div class="sh-actions"><button type="button" class="primary-btn" id="supportSend">Send request</button></div></div></div>`;
 }
 if(c.status==='Resolved') html+='<div class="modal-section" id="engReportSection"><h4>Engagement report</h4><div id="engReportBody" class="analysis-empty">Loading report...</div></div>';
 caseModalBody.insertAdjacentHTML('beforeend',html);
 const rb=document.getElementById('reassignBtn');if(rb)rb.addEventListener('click',()=>reassignCase(c));
 const sb=document.getElementById('supportSend');if(sb)sb.addEventListener('click',()=>sendSupportRequest(c));
 if(c.status==='Resolved') loadEngReport(c);
}
async function reassignCase(c){
 const sel=document.getElementById('reassignSelect'),btn=document.getElementById('reassignBtn');
 const od=sel.value;
 if(od===c.od){toast('This case is already with that division.');return;}
 const label=(DIVISION_OPTIONS.find(d=>d.code===od)||{}).label||od;
 btn.disabled=true;btn.textContent='Reassigning...';
 try{
  const res=await apiFetch(`/api/cases/${encodeURIComponent(c.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({od})});
  if(!res.ok) throw new Error(await readError(res));
  await loadCases();
  toast(`${c.id} reassigned to ${label}`);
  openCaseModal(c.id);
 }catch(err){console.error('Failed to reassign case:',err);toast("Couldn't reassign the case. Please try again.");btn.disabled=false;btn.textContent='Reassign';}
}
async function sendSupportRequest(c){
 const type=document.getElementById('supportType').value;
 const box=document.getElementById('supportDetails'),btn=document.getElementById('supportSend');
 const details=box.value.trim();
 if(type==='Other'&&!details){toast('Please describe the support you need.');return;}
 btn.disabled=true;btn.textContent='Sending...';
 try{
  const res=await apiFetch(`/api/cases/${encodeURIComponent(c.id)}?resource=support`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,details})});
  if(!res.ok) throw new Error(await readError(res));
  box.value='';
  toast('Support request sent to the admin team');
  loadSupport();
 }catch(err){console.error('Failed to send support request:',err);toast("Couldn't send the request. Please try again.");}
 finally{btn.disabled=false;btn.textContent='Send request';}
}

// ---- Engagement report on a resolved case (AI draft, editable, saved on the case) ----
async function loadEngReport(c){
 const box=document.getElementById('engReportBody');if(!box) return;
 try{
  const res=await apiFetch(`/api/cases/${encodeURIComponent(c.id)}?resource=report`);
  if(!res.ok) throw new Error(await readError(res));
  const data=await res.json();
  if(data.report){renderEngReport(c,data.report);return;}
  box.className='';
  box.innerHTML='<p class="modal-hint">This case is resolved. Create a report on how it was handled: when the enquirer was updated and how confident we are in the solution.</p><div class="sh-actions" style="justify-content:flex-start"><button type="button" class="primary-btn" id="engGenerate">Generate engagement report</button></div>';
  document.getElementById('engGenerate').addEventListener('click',()=>generateEngReport(c));
 }catch(err){box.className='analysis-empty';box.textContent=err.message||"Couldn't load the report. Please try again.";}
}
async function generateEngReport(c){
 const box=document.getElementById('engReportBody');if(!box) return;
 box.className='analysis-empty';box.textContent='Generating the report...';
 try{
  const res=await apiFetch(`/api/cases/${encodeURIComponent(c.id)}?resource=report`,{method:'POST'});
  if(!res.ok) throw new Error(await readError(res));
  renderEngReport(c,(await res.json()).draft);
 }catch(err){
  console.warn('Report generation failed:',err);
  box.className='analysis-empty';
  box.innerHTML=`${escHtml(err.message&&err.message!=='Failed to fetch'?err.message:"Couldn't generate the report right now. Please try again.")}<div class="sh-actions" style="justify-content:flex-start"><button type="button" class="ghost-btn" id="engRetry">Try again</button></div>`;
  document.getElementById('engRetry').addEventListener('click',()=>generateEngReport(c));
 }
}
function renderEngReport(c,r){
 const box=document.getElementById('engReportBody');box.className='';
 box.innerHTML=`<div class="eng-form">
  <label>Engagement summary<textarea data-r="summary" rows="4"></textarea></label>
  <label>Updates sent to the enquirer (one per line: time | update)<textarea data-r="timeline" rows="6"></textarea></label>
  <label>Solution provided<textarea data-r="solution" rows="3"></textarea></label>
  <div class="eng-conf"><label>Confidence in the solution (%)<input data-r="confidence" type="number" min="0" max="100" /></label><label>Basis for the confidence<textarea data-r="confidence_note" rows="2"></textarea></label></div>
  <label>Additional notes<textarea data-r="notes" rows="2"></textarea></label>
  <small class="eng-meta" id="engMeta"></small>
  <div class="sh-actions"><button type="button" class="ghost-btn" id="engRegen">Regenerate with AI</button><button type="button" class="ghost-btn" id="engPdf">Print / Save as PDF</button><button type="button" class="primary-btn" id="engSave">Save report</button></div>
 </div>`;
 const f=k=>box.querySelector(`[data-r="${k}"]`);
 ['summary','timeline','solution','confidence_note','notes'].forEach(k=>{f(k).value=r[k]||''});
 f('confidence').value=(r.confidence===null||r.confidence===undefined)?'':r.confidence;
 const meta=box.querySelector('#engMeta');
 meta.textContent=r.updated_at?`Last saved by ${r.updated_by||'a user'} on ${fmtShort(r.updated_at)}`:'AI draft - review and edit, then save.';
 const read=()=>({summary:f('summary').value,timeline:f('timeline').value,solution:f('solution').value,confidence:f('confidence').value===''?null:Number(f('confidence').value),confidence_note:f('confidence_note').value,notes:f('notes').value,ai_generated:!!r.ai_generated});
 box.querySelector('#engRegen').addEventListener('click',()=>{if(window.confirm('Replace the text below with a new AI draft?'))generateEngReport(c);});
 box.querySelector('#engSave').addEventListener('click',async()=>{
  const btn=box.querySelector('#engSave');btn.disabled=true;btn.textContent='Saving...';
  try{
   const res=await apiFetch(`/api/cases/${encodeURIComponent(c.id)}?resource=report`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(read())});
   if(!res.ok) throw new Error(await readError(res));
   const saved=(await res.json()).report;
   meta.textContent=`Last saved by ${saved.updated_by||'a user'} on ${fmtShort(saved.updated_at)}`;
   toast('Report saved');
  }catch(err){console.error('Failed to save report:',err);toast("Couldn't save the report. Please try again.");}
  finally{btn.disabled=false;btn.textContent='Save report';}
 });
 box.querySelector('#engPdf').addEventListener('click',()=>{
  const d=read();
  const lines=d.timeline.split('\n').map(s=>s.trim()).filter(Boolean).map(l=>{const i=l.indexOf(' | ');return i>-1?[l.slice(0,i),l.slice(i+3)]:['',l]});
  const conf=(d.confidence===null||isNaN(d.confidence))?'Not rated':d.confidence+'%';
  const sections=[
   {heading:'Engagement summary',head:['Summary'],rows:[[d.summary||'-']]},
   {heading:'Updates sent to the enquirer',intro:'Times and updates that reached the enquirer.',head:['Time','Update'],rows:lines.length?lines:[['','No updates recorded']]},
   {heading:'Solution and confidence',head:['Solution provided','Confidence','Basis for the confidence'],rows:[[d.solution||'-',conf,d.confidence_note||'-']]},
  ];
  if(d.notes.trim()) sections.push({heading:'Additional notes',head:['Notes'],rows:[[d.notes]]});
  openReport({title:'Engagement Report',intro:`${c.id} - ${c.issue}`,scope:`${c.od} | ${c.stakeholder}`,kpis:[['Confidence in solution',conf],['Updates sent',lines.length],['Risk',c.risk],['Division',c.od]],sections});
 });
}

// ---- Reports page: explore / filter / download ----
function reportCases(){
 const f=document.getElementById('rpFilter'),d=document.getElementById('rpDivision');
 const status=f?f.value:'all',div=d?d.value:'all';
 return cases.filter(c=>(div==='all'||c.od===div)&&(status==='all'||(status==='open'&&c.status!=='Resolved')||(status==='resolved'&&c.status==='Resolved')||(status==='highrisk'&&c.risk==='High')));
}
(function wireReportToolbar(){
 const d=document.getElementById('rpDivision');
 if(d) DIVISION_OPTIONS.forEach(o=>{const opt=document.createElement('option');opt.value=o.code;opt.textContent=o.label;d.appendChild(opt);});
 document.getElementById('rpExplore').addEventListener('click',()=>setView('intelligence'));
 document.getElementById('rpDownload').addEventListener('click',()=>{
  if(!cases.length){toast('There are no cases to report on yet.');return;}
  currentReport=buildReport('pulse');
  document.getElementById('reportCsv').click();
 });
})();

const generateInsightBtn=document.getElementById('generateInsightBtn');
if(generateInsightBtn){
 generateInsightBtn.addEventListener('click',async()=>{
  const box=document.getElementById('insightResult');
  generateInsightBtn.disabled=true;generateInsightBtn.textContent='Analysing…';
  box.className='analysis-empty';box.textContent='Analysing all current cases for commonalities and anomalies…';
  try{
   const res=await apiFetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cases})});
   if(!res.ok){
    let serverMsg='';
    try{serverMsg=(await res.json()).error||''}catch(e){}
    throw new Error(serverMsg||`API error ${res.status}`);
   }
   const a=await res.json();
   box.className='analysis-result';
   box.innerHTML=`
    <div class="analysis-row" style="flex-direction:column;align-items:flex-start;gap:6px"><span>Summary</span><b style="text-align:left;font-weight:600">${escHtml(a.summary)}</b></div>
    ${a.commonalities.length?`<div class="analysis-row" style="flex-direction:column;align-items:flex-start"><span>Commonalities</span></div>
    <div class="risk-cards">${a.commonalities.map(c=>`<div class="risk-card" style="border-left-color:var(--teal)"><b>${escHtml(c.title)}</b><p>${escHtml(c.detail)}</p></div>`).join('')}</div>`:''}
    ${a.anomalies.length?`<div class="analysis-row" style="flex-direction:column;align-items:flex-start"><span>Anomalies</span></div>
    <div class="risk-cards">${a.anomalies.map(c=>`<div class="risk-card"><b>${escHtml(c.title)}</b><p>${escHtml(c.detail)}</p></div>`).join('')}</div>`:''}
    ${a.recommended_actions.length?`<div class="analysis-row" style="flex-direction:column;align-items:flex-start"><span>Recommended actions</span><ul style="margin:6px 0 0;padding-left:18px">${a.recommended_actions.map(x=>`<li style="font-size:12px;margin-bottom:4px">${escHtml(x)}</li>`).join('')}</ul></div>`:''}
   `;
   lastInsight=a;
   box.insertAdjacentHTML('beforeend','<div style="display:flex;justify-content:flex-end;margin-top:16px"><button type="button" class="primary-btn" id="createInsightReportBtn">Create report</button></div>');
   document.getElementById('createInsightReportBtn').addEventListener('click',openInsightReport);
  }catch(err){
   console.warn('Insight generation failed:',err);
   box.className='analysis-empty';
   box.textContent=err.message&&err.message!=='Failed to fetch'?err.message:'Couldn’t generate insights right now. Please try again.';
  }finally{
   generateInsightBtn.disabled=false;generateInsightBtn.textContent='Generate insight';
  }
 });
}


function analyseLocal(text, stakeholderType, province){
 const lower=text.toLowerCase();
 let issue='General stakeholder enquiry',od='Group CA',risk='Medium',sentiment='Neutral',priority='P2',sla='4 hours',owner='Corporate Affairs Queue';
 if(/crossing|train|rail|wagon|capacity|slot/.test(lower)){issue=/crossing|child|hurt|safety/.test(lower)?'Rail crossing safety':'Rail operations / capacity';od='TFR';owner='TFR Stakeholder Relations'}
 if(/port|permit|terminal|berth/.test(lower)){issue='Port access / operations';od='TNPA';owner='TNPA Stakeholder Relations'}
 if(/payment|invoice|supplier/.test(lower)){issue='Supplier payment';od='TE';owner='Supplier Resolution Desk'}
 if(/media|journalist|press/.test(lower)){issue='Media query';od='Group CA';owner='Media Relations'}
 if(/urgent|hurt|danger|accident|blocked|fatal|legal|protest/.test(lower)){risk='High';priority='P1';sla='1 hour';sentiment='Negative'}
 else if(/complaint|delay|overdue|problem|again|pending/.test(lower)){risk='Medium';priority='P2';sla='4 hours';sentiment='Negative'}
 else if(/thank|appreciate|resolved|good/.test(lower)){risk='Low';priority='P3';sla='8 hours';sentiment='Positive'}
 if(stakeholderType==='Media'||stakeholderType==='Regulator'||stakeholderType==='Investor'){ if(risk==='Medium')risk='High'; }
 const duplicate=/again|reported before|previous|still/.test(lower)?'Likely — matches recurring theme':'No strong match';
 const score=risk==='High'?86:risk==='Medium'?58:24;
 return {issue,od,risk,sentiment,priority,sla,owner,duplicate,score,province};
}

// Calls the server-side /api/analyse endpoint (which calls the Claude API).
// Falls back to the local keyword heuristic if the request fails, so the
// intake form still works if the backend isn't deployed or is unreachable.
async function analyse(message, stakeholderType, province, stakeholder){
 const history = cases
  .filter(c=>c.stakeholder===stakeholder)
  .slice(0,5)
  .map(c=>({created:c.created,issue:c.issue,message:c.message}));
 try{
  const res = await apiFetch('/api/analyse',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({message,stakeholderType,province,stakeholder,history})
  });
  if(!res.ok) throw new Error(`API error ${res.status}`);
  const result = await res.json();
  return {...result, source:'ai'};
 }catch(err){
  console.warn('AI analysis unavailable, using local fallback:', err);
  return {...analyseLocal(message, stakeholderType, province), source:'fallback'};
 }
}


function escHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function loadInbox(){
 const list=document.getElementById('inboxList');
 try{
  const res=await apiFetch('/api/inbox');
  if(!res.ok) throw new Error(`API error ${res.status}`);
  const items=await res.json();
  if(!items.length){list.innerHTML='<div class="analysis-empty">You’re all caught up. There are no new messages.</div>';return;}
  list.innerHTML=items.map(i=>`
   <div class="inbox-item" data-id="${i.id}" data-table="${i.table}">
    <div class="inbox-item-main">
     <span class="inbox-channel">${escHtml(i.channel)}</span>
     <b>${escHtml(i.from||'Unknown sender')}</b>
     <span class="inbox-subject">${escHtml(i.subject||'')}</span>
     ${i.directedTo?`<span class="inbox-directed">→ ${escHtml(i.directedTo)}</span>`:''}
     <p>${escHtml(i.preview||'')}</p>
    </div>
    <button class="primary-btn inbox-analyse-btn">Analyse case</button>
   </div>`).join('');
  list.querySelectorAll('.inbox-analyse-btn').forEach(btn=>{
   btn.addEventListener('click',()=>analyseInboxItem(btn));
  });
 }catch(err){
  console.error('Failed to load inbox:',err);
  list.innerHTML='<div class="analysis-empty">Couldn’t load incoming messages. Please try again.</div>';
 }
}

async function analyseInboxItem(btn){
 const row=btn.closest('.inbox-item');
 const id=row.dataset.id, table=row.dataset.table;
 btn.disabled=true;btn.textContent='Analysing…';
 try{
  const res=await apiFetch('/api/inbox/analyse',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({id,table})
  });
  if(!res.ok){
   let serverMsg='';try{serverMsg=(await res.json()).error||''}catch(e){}
   throw new Error(serverMsg||`API error ${res.status}`);
  }
  const data=await res.json();
  if(data.autoRouted){
   row.remove();
   await loadCases();
   if(!document.querySelector('#inboxList .inbox-item')) document.getElementById('inboxList').innerHTML='<div class="analysis-empty">You’re all caught up. There are no new messages.</div>';
   toast(`${data.case.id}: message unclear — filed under Group CA`);
   return;
  }
  const {classification:a,raw}=data;

  // Reuse the same AI & Routing Preview panel the manual form uses, so
  // the admin reviews the risk score/routing before a case is created —
  // same review step, just triggered from an inbox row instead of typing.
  const preview=document.getElementById('analysisPreview');
  preview.className='analysis-result';
  preview.innerHTML=`<div class="risk-score"><strong>${a.score}</strong>/100<small>${escHtml(a.risk)} reputational / operational risk</small></div>
   ${[...(a.summary?[['What they reported',a.summary]]:[]),['Issue type',a.issue],['Sentiment',a.sentiment],['Urgency',a.priority],[a.directedByEnquirer?'OD (chosen by enquirer)':'Recommended OD',a.od],['Suggested owner',a.owner],['Duplicate check',a.duplicate],['SLA target',a.sla],...(a.confidence?[['AI confidence',a.confidence]]:[])].map(r=>`<div class="analysis-row"><span>${r[0]}</span><b>${escHtml(r[1])}</b></div>`).join('')}
   <button class="primary-btn" id="createCaseBtn">Confirm & create case</button>`;
  document.getElementById('createCaseBtn').addEventListener('click',()=>confirmInboxCase(row,raw,a));

  preview.scrollIntoView({behavior:'smooth',block:'start'});
  btn.textContent='Reviewed below ↓';
 }catch(err){
  console.error('Failed to analyse inbox item:',err);
  toast('Couldn’t analyse this message. Please try again.');
  btn.disabled=false;btn.textContent='Analyse case';
 }
}

async function confirmInboxCase(row,raw,classification){
 const createCaseBtn=document.getElementById('createCaseBtn');
 createCaseBtn.disabled=true;createCaseBtn.textContent='Creating…';
 try{
  const res=await apiFetch('/api/inbox/confirm',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({id:raw.id,table:raw.table,classification,message:raw.message,from_address:raw.from_address})
  });
  if(!res.ok){
   let serverMsg='';try{serverMsg=(await res.json()).error||''}catch(e){}
   throw new Error(serverMsg||`API error ${res.status}`);
  }
  const result=await res.json();
  row.remove();
  await loadCases();
  toast(`${result.case.id} created and assigned to ${result.case.od}`);
  setView('cases');
 }catch(err){
  console.error('Failed to confirm inbox case:',err);
  toast('Couldn’t save the case. Please try again.');
  createCaseBtn.disabled=false;createCaseBtn.textContent='Confirm & create case';
 }
}

const form=document.getElementById('intakeForm');
form.addEventListener('submit',async e=>{
 e.preventDefault();
 const data={channel:channel.value,type:stakeholderType.value,name:stakeholderName.value,stakeholder:organisation.value||stakeholderName.value,province:province.value,location:location.value,message:message.value};

 const preview=document.getElementById('analysisPreview');
 preview.className='analysis-empty';
 preview.textContent='Analysing interaction…';

 const a=await analyse(data.message,data.type,data.province,data.stakeholder);

 preview.className='analysis-result';
 preview.innerHTML=`<div class="risk-score"><strong>${a.score}</strong>/100<small>${escHtml(a.risk)} reputational / operational risk</small></div>
  ${[['Issue type',a.issue],['Sentiment',a.sentiment],['Urgency',a.priority],['Recommended OD',a.od],['Suggested owner',a.owner],['Duplicate check',a.duplicate],['SLA target',a.sla]].map(r=>`<div class="analysis-row"><span>${r[0]}</span><b>${escHtml(r[1])}</b></div>`).join('')}
  ${a.source==='fallback'?'<div class="analysis-row"><span>Note</span><b>AI unavailable — used local rules</b></div>':''}
  <button class="primary-btn" id="createCaseBtn">Confirm & create case</button>`;
 document.getElementById('createCaseBtn').addEventListener('click',()=>createCase(data,a));
});

async function createCase(data,a){
 const createCaseBtn=document.getElementById('createCaseBtn');
 if(createCaseBtn){createCaseBtn.disabled=true;createCaseBtn.textContent='Creating…';}
 const payload={stakeholder:data.stakeholder,name:data.name,type:data.type,channel:data.channel,issue:a.issue,od:a.od,owner:a.owner,risk:a.risk,status:a.risk==='High'?'Escalated':'Open',sla:a.sla==='1 hour'?'59m':'4h 00m',province:data.province,sentiment:a.sentiment,message:data.message};
 try{
  const res=await apiFetch('/api/cases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!res.ok){
   let serverMsg='';try{serverMsg=(await res.json()).error||''}catch(e){}
   throw new Error(serverMsg||`API error ${res.status}`);
  }
  const item=await res.json();
  await loadCases();
  toast(`${item.id} created and assigned to ${item.od}`);
  setView('cases');
 }catch(err){
  console.error('Failed to create case:',err);
  toast('Couldn’t save the case. Please try again.');
 }
}

document.getElementById('clearForm').addEventListener('click',()=>{form.reset();document.getElementById('analysisPreview').className='analysis-empty';document.getElementById('analysisPreview').textContent='Record the engagement to see a suggested issue type, sentiment, urgency, assigned division, risk score and SLA recommendation.'});
document.getElementById('seedBtn').addEventListener('click',async()=>{
 const seedBtn=document.getElementById('seedBtn');
 seedBtn.disabled=true;seedBtn.textContent='Resetting…';
 try{
  const res=await apiFetch('/api/seed',{method:'POST'});
  if(!res.ok) throw new Error(`API error ${res.status}`);
  await loadCases();
  if(isAdmin) await loadInbox();
  toast('Demo data reset');
 }catch(err){
  console.error('Failed to reset demo data:',err);
  toast('Couldn’t reset the demo data. Please try again.');
 }finally{
  seedBtn.disabled=false;seedBtn.textContent='Reset demo data';
 }
});

document.querySelectorAll('.report-card').forEach(card=>{const b=card.querySelector('button');if(b) b.addEventListener('click',()=>openReport(card.dataset.report));});
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500)}
function renderAll(){renderDashboard();renderCases();renderStakeholders();renderIntelligence()}
loadCases();
loadSupport();
if(isAdmin) loadInbox();

// Case detail modal — shows the full record for one case, including the
// original stakeholder message and every rating/classification field.
const caseModalBackdrop=document.getElementById('caseModalBackdrop');
const caseModalBody=document.getElementById('caseModalBody');
const CASE_STATUSES=['Open','In Progress','Escalated','Resolved'];

function openCaseModal(caseId){
 const c=cases.find(x=>x.id===caseId);
 if(!c) return;
 document.getElementById('caseModalId').textContent=c.id;
 document.getElementById('caseModalTitle').textContent=c.issue;
 caseModalBody.innerHTML=`
  <div class="modal-section">
   <h4>Stakeholder message</h4>
   <div class="modal-message">${escHtml(c.message||'No message recorded.')}</div>
  </div>
  <div class="modal-section">
   <h4>Rating & categorisation</h4>
   <div class="modal-fields">
    <div class="modal-field"><span>Risk</span><b>${riskPill(c.risk)}</b></div>
    <div class="modal-field">
     <span>Status</span>
     <div class="status-edit-row">
      <select id="modalStatusSelect">${CASE_STATUSES.map(s=>`<option value="${s}" ${s===c.status?'selected':''}>${s}</option>`).join('')}</select>
      <button class="ghost-btn" id="modalStatusSave">Update</button>
     </div>
    </div>
    <div class="modal-field"><span>Sentiment</span><b>${escHtml(c.sentiment)}</b></div>
    <div class="modal-field"><span>SLA</span><b class="sla ${slaClass(c.sla)}">${escHtml(c.sla)}</b></div>
    <div class="modal-field"><span>Recommended division</span><b>${escHtml(c.od)}</b></div>
    <div class="modal-field"><span>Owner</span><b>${escHtml(c.owner)}</b></div>
   </div>
  </div>
  <div class="modal-section">
   <h4>Stakeholder & engagement details</h4>
   <div class="modal-fields">
    <div class="modal-field"><span>Organisation</span><b>${escHtml(c.stakeholder)}</b></div>
    <div class="modal-field"><span>Contact name</span><b>${escHtml(c.name)}</b></div>
    <div class="modal-field"><span>Type</span><b>${escHtml(c.type)}</b></div>
    <div class="modal-field"><span>Channel</span><b>${escHtml(c.channel)}</b></div>
    <div class="modal-field"><span>Province</span><b>${escHtml(c.province)}</b></div>
    <div class="modal-field"><span>Created</span><b>${escHtml(c.created)}</b></div>
   </div>
  </div>`;
 caseModalBackdrop.classList.add('show');
 document.getElementById('modalStatusSave').addEventListener('click',()=>updateCaseStatus(c.id));
 enhanceCaseModal(c);
}

async function updateCaseStatus(caseId){
 const select=document.getElementById('modalStatusSelect');
 const saveBtn=document.getElementById('modalStatusSave');
 const newStatus=select.value;
 saveBtn.disabled=true;saveBtn.textContent='Saving…';
 try{
  const res=await apiFetch(`/api/cases/${encodeURIComponent(caseId)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:newStatus})});
  if(!res.ok){
   let serverMsg='';try{serverMsg=(await res.json()).error||''}catch(e){}
   throw new Error(serverMsg||`API error ${res.status}`);
  }
  let emailed=false;try{emailed=(await res.json()).emailSent===true}catch(e){}
  await loadCases();
  toast(`${caseId} status updated to ${newStatus}${emailed?' — enquirer emailed':''}`);
  openCaseModal(caseId); // re-render modal with fresh data/pill colours
 }catch(err){
  console.error('Failed to update case status:',err);
  toast('Couldn’t update the status. Please try again.');
  saveBtn.disabled=false;saveBtn.textContent='Update';
 }
}

function closeCaseModal(){caseModalBackdrop.classList.remove('show')}
document.getElementById('caseModalClose').addEventListener('click',closeCaseModal);
caseModalBackdrop.addEventListener('click',e=>{if(e.target===caseModalBackdrop)closeCaseModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCaseModal()});


// Prototype authentication controls
const signedIn = document.getElementById('signedInUser');
if (signedIn) signedIn.textContent = auth.email || 'Transnet User';
const signedInLabel = document.querySelector('.user-chip small');
if (signedInLabel) signedInLabel.textContent = isAdmin ? 'Signed in • All divisions' : `Signed in • ${auth.divisionLabel || auth.division}`;
const heroKicker = document.querySelector('.hero-kicker');
if (heroKicker && !isAdmin) heroKicker.textContent = `${(auth.divisionLabel || auth.division).toUpperCase()} • CASES DIRECTED TO YOUR DIVISION`;
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', async () => {
  // Record the sign-out so the admin Logins tab shows when the session ended (max 1.5s wait).
  await Promise.race([pingSession('logout'), new Promise(r => setTimeout(r, 1500))]);
  clearAuth();
  window.location.href = 'login.html';
});

// ===========================================================================
// Session tracking: a heartbeat while the app is open tells the server how
// long this user spent on the platform (shown to admins on the Logins tab).
// ===========================================================================
function pingSession(action, { keepalive = false } = {}) {
  if (!auth.sessionId) return Promise.resolve();
  return fetch('/api/auth/login', {
    method: 'POST', keepalive,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ action, sessionId: auth.sessionId }),
  }).catch(() => {});
}
if (auth.sessionId) {
  pingSession('heartbeat');
  setInterval(() => { if (document.visibilityState === 'visible') pingSession('heartbeat'); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pingSession('heartbeat'); });
  window.addEventListener('pagehide', () => pingSession('heartbeat', { keepalive: true }));
}

// ===========================================================================
// Admin: Login activity tab
// ===========================================================================
function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${sec}s`;
}
function fmtWhen(iso) {
  return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}
function sessionState(s, nowMs) {
  if (s.logout_at) return { key: 'out', label: 'Signed out' };
  if (nowMs - new Date(s.last_seen_at).getTime() < 150000) return { key: 'active', label: 'Active now' };
  return { key: 'ended', label: 'Session ended' }; // tab closed or timed out without signing out
}
function lgPill(st) { return `<span class="lg-status ${st.key}">${st.label}</span>`; }

async function loadLogins() {
  if (!isAdmin) return;
  const msg = document.getElementById('loginsMsg');
  try {
    const res = await apiFetch('/api/auth/login');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
    msg.hidden = true;
    renderLogins(data.sessions || [], new Date(data.now).getTime());
  } catch (err) {
    msg.textContent = err.message;
    msg.hidden = false;
    document.getElementById('loginsAccounts').innerHTML = '';
    document.getElementById('loginsSessions').innerHTML = '';
  }
}

function renderLogins(sessions, nowMs) {
  const byAccount = new Map();
  sessions.forEach(s => {
    const a = byAccount.get(s.email) || { email: s.email, division: s.division_label || s.division, sessions: 0, seconds: 0, latest: s };
    a.sessions++; a.seconds += s.active_seconds || 0;
    if (new Date(s.login_at) > new Date(a.latest.login_at)) a.latest = s;
    byAccount.set(s.email, a);
  });
  const accounts = [...byAccount.values()].sort((a, b) => new Date(b.latest.login_at) - new Date(a.latest.login_at));
  document.getElementById('loginsAccounts').innerHTML = accounts.length
    ? accounts.map(a => `<tr><td><b>${escHtml(a.email)}</b></td><td>${escHtml(a.division || '—')}</td><td>${lgPill(sessionState(a.latest, nowMs))}</td><td>${fmtWhen(a.latest.login_at)}</td><td>${a.sessions}</td><td><b>${fmtDuration(a.seconds)}</b></td></tr>`).join('')
    : '<tr><td colspan="6" class="lg-empty">No stakeholder or division sign-ins recorded yet.</td></tr>';
  document.getElementById('loginsSessions').innerHTML = sessions.length
    ? sessions.map(s => {
        const st = sessionState(s, nowMs);
        const end = s.logout_at || s.last_seen_at;
        return `<tr><td><b>${escHtml(s.email)}</b></td><td>${escHtml(s.division_label || s.division || '—')}</td><td>${fmtWhen(s.login_at)}</td><td>${st.key === 'active' ? '—' : fmtWhen(end)}</td><td><b>${fmtDuration(s.active_seconds)}</b></td><td>${lgPill(st)}</td></tr>`;
      }).join('')
    : '<tr><td colspan="6" class="lg-empty">Nothing to show yet.</td></tr>';
}
if (isAdmin) {
  document.getElementById('loginsRefresh').addEventListener('click', loadLogins);
  setInterval(() => { if (document.getElementById('logins').classList.contains('active')) loadLogins(); }, 30000);
}

// ===========================================================================
// Executive reports — built in the browser from the cases this user can see
// (admin: every case; division account: only that division's cases).
// ===========================================================================
function countBy(list, fn) {
  const m = new Map();
  list.forEach(x => { const k = fn(x) || 'Not specified'; m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
const pctOf = (n, d) => d ? `${Math.round(n / d * 100)}%` : '0%';
const unresolved = c => c.status !== 'Resolved';

function buildReport(kind) {
  const cases = reportCases();
  const total = cases.length;
  const resolved = cases.filter(c => c.status === 'Resolved').length;
  const escalated = cases.filter(c => c.status === 'Escalated').length;
  const highOpen = cases.filter(c => c.risk === 'High' && unresolved(c));
  const scope = isAdmin ? 'All divisions' : (auth.divisionLabel || auth.division);

  if (kind === 'pulse') {
    const sentiments = countBy(cases, c => c.sentiment);
    const orgs = countBy(cases, c => c.stakeholder).slice(0, 8);
    return {
      title: 'Stakeholder Pulse', scope,
      intro: 'Executive summary of volume, sentiment, major risks and emerging themes.',
      kpis: [['Total cases', total], ['Unresolved', total - resolved], ['Escalated', escalated], ['High risk, unresolved', highOpen.length], ['Resolution rate', pctOf(resolved, total)]],
      sections: [
        { heading: 'Sentiment', head: ['Sentiment', 'Cases', 'Share'], rows: sentiments.map(([k, v]) => [k, v, pctOf(v, total)]) },
        { heading: 'Most reported issues', head: ['Issue', 'Cases', 'Unresolved'], rows: countBy(cases, c => c.issue).slice(0, 8).map(([k, v]) => [k, v, cases.filter(c => c.issue === k && unresolved(c)).length]) },
        { heading: 'Stakeholders raising the most cases', head: ['Stakeholder', 'Cases', 'Unresolved', 'High risk'], rows: orgs.map(([k, v]) => [k, v, cases.filter(c => c.stakeholder === k && unresolved(c)).length, cases.filter(c => c.stakeholder === k && c.risk === 'High').length]) },
        { heading: 'Channel mix', head: ['Channel', 'Cases', 'Share'], rows: countBy(cases, c => c.channel).map(([k, v]) => [k, v, pctOf(v, total)]) },
        { heading: 'Major risks to watch', intro: 'High-risk cases that are not yet resolved.', head: ['Case', 'Stakeholder', 'Issue', 'Division', 'Status'], rows: highOpen.map(c => [c.id, c.stakeholder, c.issue, c.od, c.status]) },
      ],
    };
  }
  if (kind === 'od') {
    const ods = countBy(cases, c => c.od).map(([k]) => k).sort();
    const rows = ods.map(od => {
      const l = cases.filter(c => (c.od || 'Not specified') === od);
      const n = s => l.filter(c => c.status === s).length;
      return [od, l.length, n('Open'), n('In Progress'), n('Escalated'), n('Resolved'), pctOf(n('Resolved'), l.length), l.filter(c => c.risk === 'High' && unresolved(c)).length, l.filter(c => c.sla === 'Met').length];
    });
    return {
      title: 'OD Performance', scope,
      intro: 'SLA compliance, escalations and case closure by operating division.',
      kpis: [['Total cases', total], ['Closure rate', pctOf(resolved, total)], ['Escalation rate', pctOf(escalated, total)], ['SLA met', cases.filter(c => c.sla === 'Met').length], ['Divisions', ods.length]],
      sections: [
        { heading: 'Performance by division', head: ['Division', 'Cases', 'Open', 'In progress', 'Escalated', 'Resolved', 'Closure rate', 'High risk open', 'SLA met'], rows },
        { heading: 'Escalated cases', intro: 'Cases currently escalated, by division.', head: ['Case', 'Division', 'Owner', 'Issue', 'SLA'], rows: cases.filter(c => c.status === 'Escalated').map(c => [c.id, c.od, c.owner, c.issue, c.sla]) },
      ],
    };
  }
  if (kind === 'geo') {
    const provinces = countBy(cases, c => c.province).map(([k]) => k);
    const rows = provinces.map(p => {
      const l = cases.filter(c => (c.province || 'Not specified') === p);
      return [p, l.length, l.filter(unresolved).length, l.filter(c => c.risk === 'High').length, l.filter(c => c.status === 'Escalated').length, (countBy(l, c => c.issue)[0] || ['—'])[0]];
    }).sort((a, b) => b[3] - a[3] || b[1] - a[1]);
    return {
      title: 'Geographic Risk', scope,
      intro: 'Province-level concentration of stakeholder issues and risk.',
      kpis: [['Provinces', provinces.filter(p => p !== 'Not specified').length], ['Total cases', total], ['High risk cases', cases.filter(c => c.risk === 'High').length], ['No province recorded', cases.filter(c => !c.province).length]],
      sections: [
        { heading: 'Risk by province', intro: 'Sorted by number of high-risk cases.', head: ['Province', 'Cases', 'Unresolved', 'High risk', 'Escalated', 'Top issue'], rows },
        { heading: 'High-risk cases by location', head: ['Case', 'Province', 'Stakeholder', 'Issue', 'Status'], rows: cases.filter(c => c.risk === 'High').map(c => [c.id, c.province || 'Not specified', c.stakeholder, c.issue, c.status]) },
      ],
    };
  }
  // recurrence
  const issues = countBy(cases, c => c.issue);
  const repeated = issues.filter(([, n]) => n > 1);
  const pairs = countBy(cases, c => `${c.stakeholder}||${c.issue}`).filter(([, n]) => n > 1);
  return {
    title: 'Issue Recurrence', scope,
    intro: 'Duplicate and recurring matters that point to systemic pressure points.',
    kpis: [['Distinct issues', issues.length], ['Recurring issues', repeated.length], ['Cases in recurring issues', repeated.reduce((a, [, n]) => a + n, 0)], ['Repeat stakeholder + issue', pairs.length]],
    sections: [
      { heading: 'Recurring issues', intro: repeated.length ? 'Issues reported more than once.' : 'No issue has been reported more than once yet.', head: ['Issue', 'Cases', 'Unresolved', 'Stakeholders', 'Divisions', 'Latest case'], rows: repeated.map(([k, n]) => { const l = cases.filter(c => c.issue === k); return [k, n, l.filter(unresolved).length, new Set(l.map(c => c.stakeholder)).size, [...new Set(l.map(c => c.od))].join(', '), l[0].id]; }) },
      { heading: 'Same stakeholder, same issue', head: ['Stakeholder', 'Issue', 'Times reported', 'Still unresolved'], rows: pairs.map(([k, n]) => { const [org, issue] = k.split('||'); return [org, issue, n, cases.filter(c => c.stakeholder === org && c.issue === issue && unresolved(c)).length]; }) },
      { heading: 'Unresolved causes', intro: 'Oldest unresolved cases first.', head: ['Case', 'Stakeholder', 'Issue', 'Division', 'Status'], rows: cases.filter(unresolved).slice().reverse().slice(0, 15).map(c => [c.id, c.stakeholder, c.issue, c.od, c.status]) },
    ],
  };
}

const reportOverlay = document.getElementById('reportOverlay');
let currentReport = null;

function openReport(kind) {
  if (!cases.length) { toast('There are no cases to report on yet.'); return; }
  const r = (kind && typeof kind === 'object') ? kind : buildReport(kind);
  currentReport = r;
  const stamp = new Date().toLocaleString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  document.getElementById('reportBody').innerHTML = `
    <div class="rp-brand">
      <div><h1 id="reportTitle">${escHtml(r.title)}</h1><p>${escHtml(r.intro)}<br>${escHtml(r.scope)} • Generated ${escHtml(stamp)} by ${escHtml(auth.email || 'Transnet user')}</p></div>
      <img src="images/transnet-logo.png" alt="Transnet">
    </div>
    <div class="rp-kpis">${r.kpis.map(([l, v]) => `<div class="rp-kpi"><b>${escHtml(String(v))}</b><span>${escHtml(l)}</span></div>`).join('')}</div>
    ${r.sections.map(s => `<div class="rp-section"><h2>${escHtml(s.heading)}</h2>${s.intro ? `<p>${escHtml(s.intro)}</p>` : ''}
      <table><thead><tr>${s.head.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead><tbody>${
        s.rows.length ? s.rows.map(row => `<tr>${row.map(v => `<td>${escHtml(String(v))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${s.head.length}" class="lg-empty">Nothing to report.</td></tr>`
      }</tbody></table></div>`).join('')}
    <div class="rp-foot">Transnet Connect • Stakeholder Management Connector • Based on ${cases.length} case${cases.length === 1 ? '' : 's'} at the time of generation.</div>`;
  reportOverlay.classList.add('show');
  reportOverlay.setAttribute('aria-hidden', 'false');
  reportOverlay.scrollTop = 0;
}
function closeReport() { reportOverlay.classList.remove('show'); reportOverlay.setAttribute('aria-hidden', 'true'); }
document.getElementById('reportClose').addEventListener('click', closeReport);
reportOverlay.addEventListener('click', e => { if (e.target === reportOverlay) closeReport(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && reportOverlay.classList.contains('show')) closeReport(); });
document.getElementById('reportPrint').addEventListener('click', () => {
  document.body.classList.add('printing-report');
  window.print();
});
window.addEventListener('afterprint', () => document.body.classList.remove('printing-report'));
document.getElementById('reportCsv').addEventListener('click', () => {
  if (!currentReport) return;
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [[currentReport.title], [currentReport.scope], []];
  currentReport.kpis.forEach(([l, v]) => lines.push([l, v]));
  currentReport.sections.forEach(s => { lines.push([], [s.heading], s.head, ...s.rows); });
  const csv = '\ufeff' + lines.map(r => r.map(q).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${currentReport.title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
});

/* insights-live-panels: sentiment + duplication clusters from real cases, with empty states */
function renderInsightPanels(){
  const list = (typeof cases !== 'undefined' && Array.isArray(cases)) ? cases : [];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const emptyMsg = t => `<div class="analysis-empty" style="grid-column:1/-1;width:100%;text-align:center;align-self:center">${t}</div>`;

  // Issue trend + high-impact cases: friendly empty states
  const trend = document.getElementById('trendChart');
  if (trend && !list.length) trend.innerHTML = emptyMsg('No cases yet.');
  const risk = document.getElementById('riskCards');
  if (risk && !risk.innerHTML.trim()) risk.innerHTML = emptyMsg(list.length ? 'No high-risk cases right now.' : 'No cases yet.');

  // Sentiment
  const donut = document.getElementById('sentimentDonut');
  const pct   = document.getElementById('sentimentPct');
  const label = document.getElementById('sentimentLabel');
  const key   = document.getElementById('sentimentKey');
  if (donut && pct && label && key) {
    const tally = { negative: 0, neutral: 0, positive: 0 };
    list.forEach(c => { const s = String(c.sentiment || '').toLowerCase(); if (s in tally) tally[s]++; });
    const total = tally.negative + tally.neutral + tally.positive;
    if (!total) {
      donut.style.background = '#e6e9ee';
      pct.textContent = '\u2013';
      label.textContent = 'no data';
      key.innerHTML = '<span>No data yet</span>';
    } else {
      const neg = Math.round(tally.negative / total * 100);
      const neu = Math.round(tally.neutral / total * 100);
      const pos = Math.max(0, 100 - neg - neu);
      donut.style.background = `conic-gradient(var(--red,#d4292e) 0 ${neg}%,#a8b6c8 ${neg}% ${neg + neu}%,var(--teal2,#7dbe00) ${neg + neu}% 100%)`;
      pct.textContent = neg + '%';
      label.textContent = 'negative';
      key.innerHTML = `<span>${neg}% Negative</span><span>${neu}% Neutral</span><span>${pos}% Positive</span>`;
    }
  }

  // Duplication clusters: same issue raised by 2+ cases
  const clusterEl = document.getElementById('clusterList');
  if (clusterEl) {
    const groups = {};
    list.forEach(c => { const k = c.issue || 'Other'; (groups[k] = groups[k] || []).push(c); });
    const clusters = Object.entries(groups).filter(([, v]) => v.length > 1)
      .sort((a, b) => b[1].length - a[1].length).slice(0, 3);
    clusterEl.innerHTML = clusters.length
      ? clusters.map(([k, v], i) => `<div><b>#CL-${String(i + 1).padStart(3, '0')}</b><span>${esc(k)} \u2022 ${v.length} cases</span></div>`).join('')
      : '<div><span>No related matters yet</span></div>';
  }
}
if (typeof renderIntelligence === 'function') {
  const _origRenderIntelligence = renderIntelligence;
  renderIntelligence = function () { _origRenderIntelligence.apply(this, arguments); renderInsightPanels(); };
}
renderInsightPanels();
