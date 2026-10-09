
  /* ---------- departures page ---------- */
  var JOBS=[
    {id:'j1',role:'IT support and security engineer',co:'Sahyadri Fintech',city:'Pune',exp:'0 to 2 years',posted:'2 days ago',when:'now',lab:'Boarding now',gaps:[],have:['Windows admin','Networking basics','Vulnerability scans','Communication'],ready:'Ready now',why:'Every required skill in the post is on your resume.'},
    {id:'j2',express:true,crit:[['id','Identity verified with DigiLocker',1],['cert','At least one security certificate',1],['proof','Verified skill: Incident notes (proof task)',1],['gaps','Gaps allowed: up to 2 (you have 2)',1],['check','Skill check for SOC L1: Good or better',0,'Take the 15-minute skill check']],role:'SOC analyst L1',co:'Kavach Cyber Labs',city:'Pune',exp:'0 to 3 years',posted:'today',when:'soon',lab:'After 2 goals',gaps:[['missing','SIEM','4'],['weak','Threat detection','5']],have:['Linux','Incident notes','Networking basics'],ready:'Two gaps away',why:'About 3 weeks at 5 hours a week. You can still apply now.'},
    {id:'j3',express:true,crit:[['id','Identity verified with DigiLocker',1],['cert','At least one security certificate',1],['gaps','Gaps allowed: up to 1 (you have 2)',0,'Prove SIEM: your goal this week'],['check','Skill check for security analyst: Good or better',0,'Take the 15-minute skill check']],role:'Junior security analyst',co:'Indus Health Systems',city:'Remote',exp:'1 to 3 years',posted:'4 days ago',when:'soon',lab:'After 2 goals',gaps:[['missing','SIEM','4'],['weak','Threat detection','5']],have:['Vulnerability management','Application security','Linux'],ready:'Two gaps away',why:'Same two gaps as most SOC roles. Your ride this week closes the first.'},
    {id:'j4',role:'Security analyst',co:'Nimbus Retail Tech',city:'Bengaluru',exp:'2 to 4 years',posted:'1 week ago',when:'later',lab:'After 4 goals',gaps:[['missing','SIEM','4'],['weak','Python scripting','6'],['missing','AWS security','7']],have:['Vulnerability scans','Application security'],ready:'Three gaps away',why:'About 7 weeks. Save it and we tell you when it is one gap away.'},
    {id:'j5',role:'Cyber security analyst',co:'Garuda Logistics',city:'Hyderabad',exp:'2 to 5 years',posted:'3 days ago',when:'later',lab:'After 6 goals',gaps:[['missing','SIEM','4'],['weak','Threat detection','5'],['weak','Python scripting','6'],['missing','AWS security','7']],have:['Networking basics','Windows admin'],ready:'Your destination',why:'This is the role your line is built for.'},
    {id:'j6',express:true,crit:[['id','Identity verified with DigiLocker',1],['proof','Verified skill: Windows admin',1],['np','Notice period 30 days or less',1]],role:'IT security associate',co:'Deccan Data Services',city:'Pune',exp:'0 to 2 years',posted:'5 days ago',when:'now',lab:'Boarding now',gaps:[],have:['Windows admin','Linux','Communication'],ready:'Ready now',why:'No required gaps. One nice-to-have (Python) is a goal on your line.'},
    {id:'j7',jt:'Part time',hrs:'20 h a week, evenings',role:'Security awareness trainer',co:'Konkan Skills Academy',city:'Pune',exp:'1 to 3 years',posted:'yesterday',when:'now',lab:'Boarding now',gaps:[],have:['Communication','Incident notes','Networking basics'],ready:'Ready now',why:'Evenings only, so it fits around your ride. Your communication and incident notes cover what they ask for.'},
    {id:'j8',jt:'Freelance',hrs:'2-week project, fixed fee',role:'Vulnerability assessment for a clinic chain',co:'Medisetu Clinics',city:'Remote',exp:'Project',posted:'3 days ago',when:'now',lab:'Boarding now',gaps:[],have:['Vulnerability scans','Vulnerability management'],ready:'Ready now',why:'A two-week project that matches your Vuln management proof. Once the client confirms the work, it can count as work proof on your profile.'},
    {id:'j9',jt:'Part time',hrs:'Weekends, 16 h a week',role:'Weekend SOC analyst L1',co:'Kavach Cyber Labs',city:'Pune',exp:'0 to 2 years',posted:'4 days ago',when:'soon',lab:'After 1 goal',gaps:[['missing','SIEM']],have:['Linux','Incident notes'],ready:'One gap away',why:'Weekend shifts only. Prove SIEM and this one boards.'}
  ];
  var jstate={q:'',city:'',jt:'',now:false,tab:'all',sel:'j2',saved:{j4:true},applied:{j1:3,j6:2},via:{j1:'site',j6:'xp'}};
  var jlist=$('jlist'), jd=$('jdetail');
  function initials(s){ return s.split(' ').slice(0,2).map(function(w){return w[0];}).join(''); }
  function jvis(j){
    if(jstate.tab==='saved' && !jstate.saved[j.id]) return false;
    if(jstate.tab==='applied' && !jstate.applied[j.id]) return false;
    if(jstate.city && j.city!==jstate.city) return false;
    if(jstate.jt && (j.jt||'Full time')!==jstate.jt) return false;
    if(jstate.now && j.when!=='now') return false;
    if(jstate.q){ var hay=(j.role+' '+j.co+' '+j.city+' '+j.have.join(' ')+' '+j.gaps.map(function(g){return g[1];}).join(' ')).toLowerCase(); if(hay.indexOf(jstate.q)<0) return false; }
    return true;
  }
  function whenTag(j){ if(jstate.applied[j.id]) return '<span class="when applied">Applied</span>'; if(STATE==='noresume') return ''; return '<span class="when '+j.when+'">'+j.lab+'</span>'; }
  function renderJobs(){
    var nores= STATE==='noresume';
    var shown=JOBS.filter(jvis);
    jlist.innerHTML=shown.map(function(j){
      var chips= nores ? '' : (j.gaps.length ? j.gaps.map(function(g){return chip(g[0],g[1]);}).join('') : chip('met','No required gaps'));
      if(j.express) chips+='<span class="chip neutral xp"><svg class="icon"><use href="#i-zap"/></svg>Express apply</span>';
      return '<li class="job'+(j.id===jstate.sel?' sel':'')+'" data-j="'+j.id+'" tabindex="0" role="button" aria-label="'+j.role+' at '+j.co+'"><span class="logo">'+initials(j.co)+'</span><div class="job-main"><b>'+j.role+'</b><div class="job-meta"><span>'+j.co+'</span><span>·</span><span>'+j.city+'</span><span>·</span><span class="jt">'+(j.jt||'Full time')+'</span><span>·</span><span>'+j.exp+'</span><span>·</span><span>'+j.posted+'</span></div><div class="job-chips">'+chips+'</div></div><div class="job-end">'+whenTag(j)+'<button class="savebtn" type="button" data-save-j="'+j.id+'" aria-pressed="'+(jstate.saved[j.id]?'true':'false')+'" aria-label="Save"><svg class="icon"><use href="#i-bookmark"/></svg></button></div></li>';
    }).join('');
    $('jempty').hidden= shown.length>0;
    $('jobs-total').textContent=JOBS.length;
    $('n-saved').textContent=Object.keys(jstate.saved).filter(function(k){return jstate.saved[k];}).length;
    $('n-applied').textContent=Object.keys(jstate.applied).length;
    renderJD();
  }
  var TRACK=['Applied','Heard back','Interview','Offer'];
  function renderJD(){
    var j=JOBS.filter(function(x){return x.id===jstate.sel;})[0]; if(!j){ jd.innerHTML=''; return; }
    var nores= STATE==='noresume', ap=jstate.applied[j.id];
    var h='<div class="sheet-anim" style="display:flex;flex-direction:column;gap:16px">';
    h+='<div class="jd-head"><span class="logo">'+initials(j.co)+'</span><div><h3>'+j.role+'</h3><small>'+j.co+' · '+j.city+' · '+(j.jt||'Full time')+(j.hrs?' ('+j.hrs+')':'')+' · '+j.exp+'</small></div></div>';
    if(nores){ h+='<div class="ready"><b>Fit unknown yet</b><span>Add your resume and this shows what you have and what is missing for this role.</span><a class="btn btn-primary btn-sm" href="#today" data-jgo="today" style="align-self:flex-start;margin-top:4px">Add resume</a></div>'; }
    else{
      h+='<div class="ready"><b>'+j.ready+'</b><span>'+j.why+'</span></div>';
      h+='<div class="jd-sec"><h4>You have · '+j.have.length+'</h4><div class="chips">'+j.have.map(function(x){return chip('met',x);}).join('')+'</div></div>';
      if(j.gaps.length) h+='<div class="jd-sec"><h4>Between you and this role · '+j.gaps.length+'</h4><div class="chips">'+j.gaps.map(function(g){return chip(g[0],g[1]+' goal');}).join('')+'</div><a class="link" href="#map" data-jgo="map">See these goals on your map<svg class="icon"><use href="#i-arrow"/></svg></a></div>';
    }
    if(ap){
      h+='<div class="jd-sec"><h4>Your application</h4><ol class="track">'+TRACK.map(function(t,i){ return '<li class="'+(i<ap?'on':'')+'"><button type="button" data-tr="'+(i+1)+'"><span class="td"></span>'+t+(i===0?(jstate.via[j.id]==='xp'?' · sent through CareerMetro':' · on the company site'):'')+'</button></li>'; }).join('')+'</ol><p>Tap a step when it happens. Only you see this.</p>'+((j.id==='j1'||j.id==='j6')?'<a class="link" href="#arrivals" data-jgo="arr">Interview dates are in Arrivals<svg class="icon"><use href="#i-arrow"/></svg></a>':'')+'</div>';
      h+='<div class="jd-actions"><button class="btn btn-ghost" type="button" data-jask>Ask people who work in this role</button></div>';
    } else {
      if(j.express && !nores){
        var met=j.crit.filter(function(c){return c[2];}).length, all=met===j.crit.length;
        h+='<div class="crit"><div class="crit-h"><b>Express apply</b><span>'+(all?'You meet all of '+j.co+'\'s criteria':met+' of '+j.crit.length+' criteria met')+'</span></div><ul>'+j.crit.map(function(c,i){ return '<li class="'+(c[2]?'ok':'')+'"><span class="cd">'+(c[2]?'<svg class="icon"><use href="#i-check"/></svg>':'')+'</span><span class="ct">'+c[1]+(c[2]||!c[3]?'':'<button type="button" class="link" data-fix="'+i+'">'+c[3]+'<svg class="icon"><use href="#i-arrow"/></svg></button>')+'</span></li>'; }).join('')+'</ul><small>Set by '+j.co+' for this role. Gaps can be fine; the company decides how many.</small></div>';
        h+='<div class="jd-actions"><button class="btn btn-primary" type="button" data-xp'+(all?'':' disabled')+'><svg class="icon"><use href="#i-zap"/></svg>'+(all?'Express apply':'Express apply opens when all are met')+'</button><button class="btn btn-ghost" type="button" data-apply><svg class="icon"><use href="#i-ext"/></svg>Apply on '+j.co+'\'s site</button></div>';
        h+='<p class="jd-note"><svg class="icon"><use href="#i-shield"/></svg><span>Express apply fills everything from your profile: skills, verified certificates, proof of work and resume. You review it and nothing is sent until you say so.</span></p>';
      } else {
        h+='<div class="jd-actions"><button class="btn btn-primary" type="button" data-apply><svg class="icon"><use href="#i-ext"/></svg>Apply on '+j.co+'\'s site</button>'+(j.gaps.length && !nores?'<button class="btn btn-ghost" type="button" data-jask>Ask someone who got this role</button>':'')+'</div>';
        h+='<p class="jd-note"><svg class="icon"><use href="#i-shield"/></svg><span>'+(nores?'Opens the company\'s own careers page.':'This company takes applications on its own site only. We note that you applied so you can track it here.')+'</span></p>';
      }
    }
    if(!nores) h+=prepHTML(j);
    h+='<p class="jd-note"><svg class="icon"><use href="#i-clock"/></svg><span>Posted '+j.posted+' on the company\'s public job board.</span></p></div>';
    jd.innerHTML=h;
  }
  jlist.addEventListener('click',function(e){
    var sb=e.target.closest('[data-save-j]'); if(sb){ e.stopPropagation(); var id=sb.dataset.saveJ; jstate.saved[id]=!jstate.saved[id]; toast(jstate.saved[id]?'Saved. We tell you when it is one gap away.':'Removed from saved.'); renderJobs(); return; }
    var li=e.target.closest('.job'); if(!li) return; jstate.sel=li.dataset.j; renderJobs();
    if(frame.classList.contains('phone') || app.getBoundingClientRect().width<760) jd.scrollIntoView({block:'start', behavior: reduce?'auto':'smooth'});
  });
  jlist.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ var li=e.target.closest('.job'); if(li){ e.preventDefault(); jstate.sel=li.dataset.j; renderJobs(); } } });
  jd.addEventListener('click',function(e){
    var t=e.target.closest('button, a'); if(!t) return;
    var j=JOBS.filter(function(x){return x.id===jstate.sel;})[0];
    if(t.dataset.fix){ var c=j.crit[+t.dataset.fix];
      if(c[0]==='check'){ t.disabled=true; t.textContent='Checking…'; setTimeout(function(){ c[2]=1; c[1]=c[1].replace(': Good or better',': you scored Good'); renderJD(); toast('Skill check done: Good. That criterion is met.'); }, reduce?100:900); }
      else { go('today'); toast('Your ride this week clears SIEM. This role updates when it does.'); }
      return; }
    if(t.hasAttribute('data-xp')){ openXP(j); return; }
    if(t.hasAttribute('data-prep')){ toast('Elite: a 20-minute mock round for '+j.role+', with feedback on each answer.'); return; }
    if(t.hasAttribute('data-apply')){ jstate.applied[j.id]=1; jstate.via[j.id]='site'; toast('Opened '+j.co+'\'s careers page. Marked as applied.'); renderJobs(); }
    else if(t.dataset.tr){ jstate.applied[j.id]=+t.dataset.tr; renderJD(); if(+t.dataset.tr===3) toast('Interview! Practice has a mock round for this role.'); }
    else if(t.hasAttribute('data-jask')){ go('junction'); }
    else if(t.dataset.jgo){ e.preventDefault(); go(t.dataset.jgo); }
  });
  on('job-q','input',function(){ jstate.q=this.value.trim().toLowerCase(); renderJobs(); });
  on('jf-city','click',function(e){ var b=e.target.closest('button'); if(!b) return; this.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed', x===b?'true':'false');}); jstate.city=b.dataset.v; renderJobs(); });
  on('jf-type','click',function(e){ var b=e.target.closest('button'); if(!b) return; this.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed', x===b?'true':'false');}); jstate.jt=b.dataset.v; renderJobs(); });
  on('jf-now','change',function(){ jstate.now=this.checked; renderJobs(); });
  on('jf-tab','click',function(e){ var b=e.target.closest('button'); if(!b) return; this.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed', x===b?'true':'false');}); jstate.tab=b.dataset.t; renderJobs(); });
  on('paste-go','click',function(){
    var ta=$('paste-t'), out=$('paste-out');
    if(!ta.value.trim()){ ta.value='SOC Analyst, Night shift. Monitor alerts in Microsoft Sentinel, triage phishing, write KQL queries, map incidents to MITRE ATT&CK. 1 to 3 years.'; }
    out.hidden=false;
    out.innerHTML='<b>Two gaps away for this post</b><div class="chips">'+chip('met','Incident notes')+chip('met','Networking basics')+chip('missing','SIEM (Sentinel, KQL)')+chip('weak','Threat detection')+chip('weak','Phishing triage')+'</div><span class="muted" style="font-size:0.8rem">Phishing triage is not on your line yet. Add it as a side stop?</span>';
    toast('Checked against your resume.');
  });

  var QS={
    j2:['Walk me through how you would triage 46 failed logins followed by one success.','Which Windows event IDs would you check first for a brute-force attempt?','Write a SIEM search that finds logins from a new country for one user.','How do you decide an alert is a false positive, and how do you record that?','Tell me about an incident you handled end to end.'],
    def:['Tell me about a time you found a security problem nobody asked you to look for.','How would you explain a phishing risk to a non-technical manager?','What does least privilege mean in your last job, in practice?','Which security news from this month would you brief your team on, and why?','What would you learn first in your first 30 days here?']
  };
  function prepHTML(j){
    var q=QS[j.id]||QS.def;
    return '<div class="prep"><div class="prep-h"><svg class="icon" style="width:16px;height:16px"><use href="#i-q"/></svg><b>Interview prep for this role</b><span class="elite">Elite</span></div><ol>'+q.map(function(x,i){ return '<li'+(i>0?' class="lock" aria-hidden="true"':'')+'>'+x+'</li>'; }).join('')+'</ol><button class="btn btn-ghost btn-sm" type="button" data-prep><svg class="icon"><use href="#i-play"/></svg>Practice a mock round</button><p class="jd-note" style="margin:0"><svg class="icon"><use href="#i-lock"/></svg><span>One question free. All five, model answers and a timed mock round come with Elite.</span></p></div>';
  }
  var xover=document.createElement('div'); xover.className='xover'; xover.id='xover'; xover.setAttribute('role','dialog'); xover.setAttribute('aria-modal','true'); xover.setAttribute('aria-label','Express apply'); app.appendChild(xover);
  function closeXP(){ xover.classList.remove('open'); xover.innerHTML=''; }
  function openXP(j){
    var top=Math.max(20, -app.getBoundingClientRect().top+20);
    var mk=function(lbl,val,ok,wide){ return '<label class="xf'+(wide?' wide':'')+'"><span>'+(ok?'<svg class="icon"><use href="#i-check"/></svg>':'')+lbl+'</span><input value="'+val+'"></label>'; };
    var h='<div class="xcard" style="margin-top:'+top+'px">';
    h+='<div class="xhead"><span class="logo">'+initials(j.co)+'</span><div><h3>Express apply · '+j.role+'</h3><small>'+j.co+' · '+j.city+' · everything below is filled from your profile</small></div><button class="iconbtn" type="button" data-xclose aria-label="Close"><svg class="icon"><use href="#i-x"/></svg></button></div>';
    h+='<div class="xgrid">'+mk('Name','Priya Nair',1)+mk('City','Pune',1)+mk('Email','priya.n@example.com',1)+mk('Phone','+91 98xxx xxx21',1)+mk('Notice period','30 days',0)+mk('Experience','2 years 4 months',1);
    h+='<div class="xf wide"><span><svg class="icon"><use href="#i-check"/></svg>Skills for this role</span><div class="chips">'+j.have.map(function(x){return chip('met',x);}).join('')+'</div></div>';
    h+='<div class="xf wide"><span><svg class="icon"><use href="#i-check"/></svg>Certificates and proof of work</span><div class="chips"><span class="chip neutral"><svg class="icon"><use href="#i-badge"/></svg>Google Cybersecurity Certificate · verified</span><span class="chip neutral"><svg class="icon"><use href="#i-flask"/></svg>3 proof tasks</span></div></div>';
    h+='<div class="xf wide"><span><svg class="icon"><use href="#i-check"/></svg>Resume</span><b style="display:flex;gap:8px;align-items:center"><svg class="icon" style="width:16px;height:16px;color:var(--muted)"><use href="#i-file"/></svg>priya-nair-resume.pdf</b></div>';
    h+='<label class="xf wide"><span>Short note · drafted for you, edit freely</span><textarea>I am finishing a SIEM module this week and have three public proof tasks on my CareerMetro profile. I handled first-line security alerts for 40 users in my current role and would like to grow into a SOC team at '+j.co+'.</textarea></label></div>';
    h+='<label class="xconsent"><input type="checkbox" id="xok"><span>Share the details above and my resume with <b>'+j.co+'</b> for this role only. They cannot see my gaps or my path.</span></label>';
    h+='<div class="xfoot"><button class="btn btn-primary" type="button" id="xsend" disabled><svg class="icon"><use href="#i-zap"/></svg>Send application</button><button class="btn btn-quiet" type="button" data-xclose>Cancel</button></div></div>';
    xover.innerHTML=h; xover.classList.add('open');
    var ok=xover.querySelector('#xok'), send=xover.querySelector('#xsend');
    ok.addEventListener('change',function(){ send.disabled=!ok.checked; });
    send.addEventListener('click',function(){
      jstate.applied[j.id]=1; jstate.via[j.id]='xp';
      xover.querySelector('.xcard').innerHTML='<div class="xsent"><span class="big"><svg class="icon"><use href="#i-check"/></svg></span><b>Sent to '+j.co+'</b><p>Track it on Departures. While you wait, the first interview question for this role is ready.</p><div class="actions" style="display:flex;gap:8px"><button class="btn btn-primary" type="button" data-xclose>Done</button></div></div>';
      renderJobs(); toast('Application sent to '+j.co+'.');
    });
  }
  xover.addEventListener('click',function(e){ if(e.target===xover || e.target.closest('[data-xclose]')) closeXP(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape' && xover.classList.contains('open')) closeXP(); });
  renderJobs();
