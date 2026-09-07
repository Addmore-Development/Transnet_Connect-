const auth = JSON.parse(localStorage.getItem('tc_auth') || 'null');
if (!auth) { window.location.replace('login.html'); }

// Cases now live in Supabase (via /api/cases), not localStorage. This array
// is populated by loadCases() below and re-populated after every create or
// reset, so the rest of the app (renderDashboard/renderCases/etc) can keep
// reading it exactly as before.
let cases = [];

async function loadCases(){
 try{
  const res=await fetch('/api/cases');
  if(!res.ok) throw new Error(`API error ${res.status}`);
  cases=await res.json();
 }catch(err){
  console.error('Failed to load cases:',err);
  toast('Could not load cases from the database — check the server.');
  cases=[];
 }
 renderAll();
}

const titleMap={dashboard:'Command Centre',intake:'New Intake',cases:'Case Management',stakeholders:'Stakeholders',questionnaire:'Stakeholder Questionnaire',intelligence:'Intelligence',reports:'Executive Reporting'};
const navItems=[...document.querySelectorAll('.nav-item')];
function setView(id){
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
 document.getElementById('priorityCases').innerHTML=cases.filter(c=>c.risk!=='Low').slice(0,6).map(c=>`<tr class="case-row" data-case-id="${c.id}"><td class="case-id">${c.id}</td><td>${c.stakeholder}</td><td>${c.issue}</td><td>${c.od}</td><td>${riskPill(c.risk)}</td><td class="sla ${slaClass(c.sla)}">${c.sla}</td></tr>`).join('');
 document.querySelectorAll('#priorityCases .case-row').forEach(row=>row.addEventListener('click',()=>openCaseModal(row.dataset.caseId)));
 const channelCounts={}; cases.forEach(c=>channelCounts[c.channel]=(channelCounts[c.channel]||0)+1); const max=Math.max(...Object.values(channelCounts),1);
 document.getElementById('channelBars').innerHTML=Object.entries(channelCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="channel-row"><span>${k}</span><div class="bar"><span style="width:${Math.round(v/max*100)}%"></span></div><b>${v}</b></div>`).join('');
}

// Computes a weighted risk index from actual open cases (High=3, Medium=1,
// Low=0 points, scaled to 0-100) rather than the hardcoded "62" this used
// to show. Distinguishes "no data in the database yet" from "everything is
// currently resolved" — those mean very different things and shouldn't
// look the same.
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
 document.getElementById('casesTable').innerHTML=filtered.map(c=>`<tr class="case-row" data-case-id="${c.id}"><td class="case-id">${c.id}</td><td>${c.created}</td><td><b>${c.stakeholder}</b><br><small>${c.name}</small></td><td>${c.channel}</td><td>${c.issue}</td><td>${c.od}</td><td>${c.owner}</td><td>${riskPill(c.risk)}</td><td>${statusPill(c.status)}</td><td class="sla ${slaClass(c.sla)}">${c.sla}</td></tr>`).join('');
 document.querySelectorAll('#casesTable .case-row').forEach(row=>row.addEventListener('click',()=>openCaseModal(row.dataset.caseId)));
}

document.getElementById('caseSearch').addEventListener('input',renderCases);document.getElementById('caseFilter').addEventListener('change',renderCases);

function renderStakeholders(){
 const map={}; cases.forEach(c=>{const k=c.stakeholder;if(!map[k])map[k]={stakeholder:k,name:c.name,type:c.type,province:c.province,cases:0,high:0,last:c.created};map[k].cases++; if(c.risk==='High')map[k].high++;});
 document.getElementById('stakeholderGrid').innerHTML=Object.values(map).map(s=>`<div class="stakeholder-card"><div class="stakeholder-card-head"><div class="stakeholder-avatar">${s.stakeholder.split(' ').slice(0,2).map(x=>x[0]).join('')}</div><div><h3>${s.stakeholder}</h3><p>${s.name} • ${s.type}</p></div></div><div class="stakeholder-meta"><div><small>Province</small><b>${s.province}</b></div><div><small>Interactions</small><b>${s.cases}</b></div><div><small>High-risk</small><b>${s.high}</b></div><div><small>Last contact</small><b>${s.last.split(' ').slice(0,2).join(' ')}</b></div></div></div>`).join('');
}

function renderIntelligence(){
 const counts={};cases.forEach(c=>counts[c.issue]=(counts[c.issue]||0)+1); const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,7); const max=Math.max(...entries.map(e=>e[1]),1);
 document.getElementById('trendChart').innerHTML=entries.map(([k,v])=>`<div class="trend-col"><b>${v}</b><div class="col" style="height:${Math.max(20,v/max*210)}px"></div><span>${k}</span></div>`).join('');
 document.getElementById('riskCards').innerHTML=cases.filter(c=>c.risk==='High').slice(0,3).map(c=>`<div class="risk-card"><b>${c.issue}</b><p>${c.message}</p><div class="risk-meta">${c.od} • ${c.stakeholder} • ${c.sla} SLA</div></div>`).join('');
}

const generateInsightBtn=document.getElementById('generateInsightBtn');
if(generateInsightBtn){
 generateInsightBtn.addEventListener('click',async()=>{
  const box=document.getElementById('insightResult');
  generateInsightBtn.disabled=true;generateInsightBtn.textContent='Analysing…';
  box.className='analysis-empty';box.textContent='Analysing all current cases for commonalities and anomalies…';
  try{
   const res=await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cases})});
   if(!res.ok){
    let serverMsg='';
    try{serverMsg=(await res.json()).error||''}catch(e){}
    throw new Error(serverMsg||`API error ${res.status}`);
   }
   const a=await res.json();
   box.className='analysis-result';
   box.innerHTML=`
    <div class="analysis-row" style="flex-direction:column;align-items:flex-start;gap:6px"><span>Summary</span><b style="text-align:left;font-weight:600">${a.summary}</b></div>
    ${a.commonalities.length?`<div class="analysis-row" style="flex-direction:column;align-items:flex-start"><span>Commonalities</span></div>
    <div class="risk-cards">${a.commonalities.map(c=>`<div class="risk-card" style="border-left-color:var(--teal)"><b>${c.title}</b><p>${c.detail}</p></div>`).join('')}</div>`:''}
    ${a.anomalies.length?`<div class="analysis-row" style="flex-direction:column;align-items:flex-start"><span>Anomalies</span></div>
    <div class="risk-cards">${a.anomalies.map(c=>`<div class="risk-card"><b>${c.title}</b><p>${c.detail}</p></div>`).join('')}</div>`:''}
    ${a.recommended_actions.length?`<div class="analysis-row" style="flex-direction:column;align-items:flex-start"><span>Recommended actions</span><ul style="margin:6px 0 0;padding-left:18px">${a.recommended_actions.map(x=>`<li style="font-size:12px;margin-bottom:4px">${x}</li>`).join('')}</ul></div>`:''}
   `;
  }catch(err){
   console.warn('Insight generation failed:',err);
   box.className='analysis-empty';
   box.textContent=err.message&&err.message!=='Failed to fetch'?err.message:'Could not generate insight right now. Check that the server is running and try again.';
  }finally{
   generateInsightBtn.disabled=false;generateInsightBtn.textContent='Generate insight';
  }
 });
}

// Local fallback classifier — used only if the AI endpoint is unreachable
// (offline demo, network issue, etc). Kept so the prototype still works
// without a backend deployed.
function analyseLocal(text, stakeholderType, province){
 const lower=text.toLowerCase();
 let issue='General stakeholder enquiry',od='Group CA',risk='Medium',sentiment='Neutral',priority='P2',sla='4 hours',owner='Corporate Affairs Queue';
 if(/crossing|train|rail|wagon|capacity|slot/.test(lower)){issue=/crossing|child|hurt|safety/.test(lower)?'Rail crossing safety':'Rail operations / capacity';od='TFR';owner='TFR Stakeholder Relations'}
 if(/port|permit|terminal|berth/.test(lower)){issue='Port access / operations';od='TNPA';owner='TNPA Stakeholder Relations'}
 if(/payment|invoice|supplier/.test(lower)){issue='Supplier payment';od='TE / SCM';owner='Supplier Resolution Desk'}
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
  const res = await fetch('/api/analyse',{
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

const form=document.getElementById('intakeForm');
form.addEventListener('submit',async e=>{
 e.preventDefault();
 const data={channel:channel.value,type:stakeholderType.value,name:stakeholderName.value,stakeholder:organisation.value||stakeholderName.value,province:province.value,location:location.value,message:message.value};

 const preview=document.getElementById('analysisPreview');
 preview.className='analysis-empty';
 preview.textContent='Analysing interaction…';

 const a=await analyse(data.message,data.type,data.province,data.stakeholder);

 preview.className='analysis-result';
 preview.innerHTML=`<div class="risk-score"><strong>${a.score}</strong>/100<small>${a.risk} reputational / operational risk</small></div>
  ${[['Issue type',a.issue],['Sentiment',a.sentiment],['Urgency',a.priority],['Recommended OD',a.od],['Suggested owner',a.owner],['Duplicate check',a.duplicate],['SLA target',a.sla]].map(r=>`<div class="analysis-row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}
  ${a.source==='fallback'?'<div class="analysis-row"><span>Note</span><b>AI unavailable — used local rules</b></div>':''}
  <button class="primary-btn" id="createCaseBtn">Confirm & create case</button>`;
 document.getElementById('createCaseBtn').addEventListener('click',()=>createCase(data,a));
});

async function createCase(data,a){
 const createCaseBtn=document.getElementById('createCaseBtn');
 if(createCaseBtn){createCaseBtn.disabled=true;createCaseBtn.textContent='Creating…';}
 const payload={stakeholder:data.stakeholder,name:data.name,type:data.type,channel:data.channel,issue:a.issue,od:a.od,owner:a.owner,risk:a.risk,status:a.risk==='High'?'Escalated':'Open',sla:a.sla==='1 hour'?'59m':'4h 00m',province:data.province,sentiment:a.sentiment,message:data.message};
 try{
  const res=await fetch('/api/cases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!res.ok){
   let serverMsg='';try{serverMsg=(await res.json()).error||''}catch(e){}
   throw new Error(serverMsg||`API error ${res.status}`);
  }
  const item=await res.json();
  await loadCases();
  toast(`${item.id} created and routed to ${item.od}`);
  setView('cases');
 }catch(err){
  console.error('Failed to create case:',err);
  toast('Could not save case to the database — check the server and try again.');
 }
}

document.getElementById('clearForm').addEventListener('click',()=>{form.reset();document.getElementById('analysisPreview').className='analysis-empty';document.getElementById('analysisPreview').textContent='Submit the interaction to generate an issue type, sentiment, urgency, OD route, risk score and SLA recommendation.'});
document.getElementById('seedBtn').addEventListener('click',async()=>{
 const seedBtn=document.getElementById('seedBtn');
 seedBtn.disabled=true;seedBtn.textContent='Resetting…';
 try{
  const res=await fetch('/api/seed',{method:'POST'});
  if(!res.ok) throw new Error(`API error ${res.status}`);
  await loadCases();
  toast('Demo data reset');
 }catch(err){
  console.error('Failed to reset demo data:',err);
  toast('Could not reset demo data — check the server and try again.');
 }finally{
  seedBtn.disabled=false;seedBtn.textContent='Reset demo data';
 }
});

document.querySelectorAll('.report-card button').forEach(b=>b.addEventListener('click',()=>toast('Executive report generated (prototype)')));
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500)}
function renderAll(){renderDashboard();renderCases();renderStakeholders();renderIntelligence()}
loadCases();

// Case detail modal — shows the full record for one case, including the
// original stakeholder message and every rating/classification field.
const caseModalBackdrop=document.getElementById('caseModalBackdrop');
const caseModalBody=document.getElementById('caseModalBody');
function openCaseModal(caseId){
 const c=cases.find(x=>x.id===caseId);
 if(!c) return;
 document.getElementById('caseModalId').textContent=c.id;
 document.getElementById('caseModalTitle').textContent=c.issue;
 caseModalBody.innerHTML=`
  <div class="modal-section">
   <h4>Stakeholder message</h4>
   <div class="modal-message">${c.message||'No message recorded.'}</div>
  </div>
  <div class="modal-section">
   <h4>Rating & classification</h4>
   <div class="modal-fields">
    <div class="modal-field"><span>Risk</span><b>${riskPill(c.risk)}</b></div>
    <div class="modal-field"><span>Status</span><b>${statusPill(c.status)}</b></div>
    <div class="modal-field"><span>Sentiment</span><b>${c.sentiment}</b></div>
    <div class="modal-field"><span>SLA</span><b class="sla ${slaClass(c.sla)}">${c.sla}</b></div>
    <div class="modal-field"><span>Recommended OD</span><b>${c.od}</b></div>
    <div class="modal-field"><span>Owner</span><b>${c.owner}</b></div>
   </div>
  </div>
  <div class="modal-section">
   <h4>Stakeholder & intake details</h4>
   <div class="modal-fields">
    <div class="modal-field"><span>Organisation</span><b>${c.stakeholder}</b></div>
    <div class="modal-field"><span>Contact name</span><b>${c.name}</b></div>
    <div class="modal-field"><span>Type</span><b>${c.type}</b></div>
    <div class="modal-field"><span>Channel</span><b>${c.channel}</b></div>
    <div class="modal-field"><span>Province</span><b>${c.province}</b></div>
    <div class="modal-field"><span>Created</span><b>${c.created}</b></div>
   </div>
  </div>`;
 caseModalBackdrop.classList.add('show');
}
function closeCaseModal(){caseModalBackdrop.classList.remove('show')}
document.getElementById('caseModalClose').addEventListener('click',closeCaseModal);
caseModalBackdrop.addEventListener('click',e=>{if(e.target===caseModalBackdrop)closeCaseModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCaseModal()});


// Prototype authentication controls
if (auth) {
  const signedIn = document.getElementById('signedInUser');
  if (signedIn) signedIn.textContent = auth.email || 'Transnet User';
}
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('tc_auth');
  window.location.href = 'login.html';
});
