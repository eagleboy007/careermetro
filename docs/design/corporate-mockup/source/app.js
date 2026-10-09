(function(){
  var $=function(id){return document.getElementById(id);};
  var qa=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));};
  var esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});};
  var ic=function(n,cls){return '<svg class="icon'+(cls?' '+cls:'')+'"><use href="#i-'+n+'"/></svg>';};
  var ini=function(n){return n.split(' ').map(function(w){return w[0];}).join('').slice(0,2);};

  /* ---------- data (all made up) ---------- */
  var LANES=[
    {k:'applied',t:'Applied',d:'New, not reviewed'},
    {k:'short',t:'Shortlisted',d:'Picked for interview'},
    {k:'ai',t:'Level 1 AI interview',d:'Company questions, AI-led'},
    {k:'team',t:'Level 2 team',d:'With your interviewers'},
    {k:'offer',t:'Offer',d:'Sent, waiting on reply'},
    {k:'closed',t:'Not this time',d:'Closed with a note'}
  ];
  var JOBS=[
    {id:'soc',t:'SOC analyst L1',city:'Pune',jt:'Full time',owner:'Rahul Menon',posted:'2 Oct',express:true,
     req:['SIEM (Splunk or Sentinel)','Incident triage','Networking basics','Linux','Threat detection'],
     crit:'Express apply: identity verified, at least one security certificate, gaps allowed up to 2, skill check Good or better'},
    {id:'wk',t:'Weekend SOC analyst L1',city:'Pune',jt:'Part time',owner:'Rahul Menon',posted:'5 Oct',express:false,
     req:['SIEM (Splunk or Sentinel)','Incident triage','Linux'],crit:'Apply on CareerMetro, no Express criteria'},
    {id:'cloud',t:'Cloud security engineer',city:'Remote',jt:'Full time',owner:'Anita Rao',posted:'29 Sep',express:true,
     req:['AWS security','IAM','Terraform','Threat detection'],crit:'Express apply: identity verified, AWS certificate, gaps allowed up to 1'}
  ];
  // req state per job requirement: p = proved, l = on resume not proved, n = not on resume
  var C=[
    {id:'c1',job:'soc',n:'Priya Nair',st:'Working at Konkan Co-operative Bank',city:'Pune',lane:'team',via:'Express',idv:true,join:'From 10 Nov',applied:'3 Oct',
     req:['n','p','p','p','l'],proofs:{1:'Skill check passed, 9 Sep',2:'Certificate: Google Cybersecurity',3:'Work, confirmed by manager'},
     certs:['Google Cybersecurity Certificate','CompTIA Security+ (Credly verified)'],assigned:['Sneha Kulkarni'],
     exp:[['IT security associate','Konkan Co-operative Bank','2022 to now','Patch triage for 40 branches, monthly vulnerability reports.'],['IT support engineer','Sahyadri Infotech','2020 to 2022','Windows and network support for 300 users.']],
     edu:'B.Sc. Computer Science, Pune University, 2020',
     stories:{own:[['Took over patch triage','S T A R','SMR']],prob:[['Fixed a phishing gap in branch email','S T A R','SMART']],res:[['Cut open critical vulns from 34 to 6','S T A R','SMART']],learn:[['Learned Splunk searches in 3 weeks','S T A R','SMA']],team:[],speak:[['Flagged an unsafe vendor login','S T A R','SAR']]},
     hist:[['Applied with Express apply','3 Oct'],['Shortlisted by Rahul Menon','4 Oct'],['Level 1 AI interview completed, recording consented','6 Oct'],['Moved to Level 2 team','7 Oct']]},
    {id:'c2',job:'soc',n:'Arjun Mehta',st:'Looking for a next role',city:'Pune',lane:'offer',via:'Express',idv:true,join:'From 20 Oct',applied:'28 Sep',
     req:['p','p','p','p','p'],proofs:{0:'Certificate: Splunk Core User',1:'Skill check passed',2:'Work, confirmed',3:'Work, confirmed',4:'Skill check passed'},
     certs:['Splunk Core Certified User'],assigned:['Sneha Kulkarni'],exp:[['Security analyst intern','Medisetu Clinics','2025','Alert triage and weekly reports.']],edu:'B.E. IT, VIT Pune, 2025',stories:{own:[],prob:[['Tuned noisy alerts','S T A R','SMART']],res:[],learn:[],team:[['Built a shared triage sheet','S T A R','SAR']],speak:[]},
     hist:[['Applied','28 Sep'],['Offer sent by Rahul Menon','7 Oct']]},
    {id:'c3',job:'soc',n:'Kavya Reddy',st:'Working at Garuda Logistics',city:'Hyderabad',lane:'team',via:'Applied',idv:false,join:'From 1 Dec',applied:'1 Oct',
     req:['p','l','p','p','n'],proofs:{0:'Certificate: Microsoft SC-200',2:'Work, confirmed',3:'Skill check passed'},
     certs:['Microsoft SC-200'],assigned:['Sneha Kulkarni'],exp:[['Network administrator','Garuda Logistics','2021 to now','Firewall rules and VPN for 12 sites.']],edu:'B.Tech ECE, JNTU, 2021',stories:{own:[['Owned VPN migration','S T A R','SMART']],prob:[],res:[],learn:[],team:[],speak:[]},
     hist:[['Applied','1 Oct'],['Shortlisted','2 Oct'],['Level 2 team round, 8 Oct','8 Oct']]},
    {id:'c4',job:'soc',n:'Rohan Das',st:'Studying',city:'Kolkata',lane:'ai',via:'Applied',idv:true,join:'From 15 Jun 2027',applied:'5 Oct',
     req:['l','l','p','p','n'],proofs:{2:'Skill check passed',3:'Course plus skill check'},certs:[],assigned:[],exp:[],edu:'B.Sc. CS final year, Jadavpur University',stories:{own:[],prob:[['College CTF team lead','S T A R','SAR']],res:[],learn:[['Linux in 30 days','S T A R','SMT']],team:[],speak:[]},
     hist:[['Applied','5 Oct'],['Shortlisted','6 Oct'],['Level 1 AI interview invited','7 Oct']]},
    {id:'c5',job:'soc',n:'Meera Joshi',st:'Working at Indus Health Systems',city:'Pune',lane:'applied',via:'Express',idv:true,join:'From 15 Nov',applied:'3 Oct',
     req:['p','p','l','p','l'],proofs:{0:'Certificate: Splunk Core User',1:'Work, confirmed',3:'Skill check passed'},certs:['Splunk Core Certified User'],assigned:[],exp:[['IT analyst','Indus Health Systems','2023 to now','Endpoint and email security.']],edu:'BCA, Symbiosis, 2023',stories:{own:[],prob:[],res:[['Cut phishing clicks by half','S T A R','SMART']],learn:[],team:[],speak:[]},
     hist:[['Applied with Express apply','3 Oct']]},
    {id:'c6',job:'soc',n:'Vikram Singh',st:'Freelance',city:'Remote',lane:'applied',via:'Applied',idv:false,join:'From now',applied:'8 Oct',
     req:['n','l','p','l','n'],proofs:{2:'Skill check passed'},certs:[],assigned:[],exp:[['Freelance IT support','Self','2022 to now','Small office networks.']],edu:'Diploma, Computer Engineering, 2021',stories:{own:[],prob:[],res:[],learn:[],team:[],speak:[]},
     hist:[['Applied','8 Oct']]},
    {id:'c7',job:'soc',n:'Ananya Ghosh',st:'Looking for a next role',city:'Pune',lane:'short',via:'Express',idv:true,join:'From 25 Oct',applied:'6 Oct',
     req:['p','p','p','l','l'],proofs:{0:'Certificate: Microsoft SC-200',1:'Skill check passed',2:'Work, confirmed'},certs:['Microsoft SC-200'],assigned:[],exp:[['SOC intern','Deccan Data Services','2025','L1 alert triage.']],edu:'M.Sc. Cyber Security, 2025',stories:{own:[],prob:[],res:[],learn:[['SC-200 in 6 weeks','S T A R','SMART']],team:[],speak:[]},
     hist:[['Applied with Express apply','6 Oct'],['Shortlisted','7 Oct']]},
    {id:'c8',job:'soc',n:'Imran Qureshi',st:'Working at Nimbus Retail Tech',city:'Bengaluru',lane:'closed',via:'Applied',idv:false,join:'From 1 Jan',applied:'29 Sep',
     req:['n','n','p','p','n'],proofs:{2:'Work, confirmed',3:'Work, confirmed'},certs:[],assigned:[],exp:[['System administrator','Nimbus Retail Tech','2019 to now','Linux servers.']],edu:'B.E. CS, 2019',stories:{own:[],prob:[],res:[],learn:[],team:[],speak:[]},
     hist:[['Applied','29 Sep'],['Not this time: "We need hands-on SIEM for this role. Your Linux depth is strong; reapply once SIEM is proved."','2 Oct']]},
    {id:'c9',job:'wk',n:'Sana Patil',st:'Studying',city:'Pune',lane:'applied',via:'Applied',idv:true,join:'From now',applied:'7 Oct',req:['l','p','p'],proofs:{1:'Skill check passed',2:'Skill check passed'},certs:[],assigned:[],exp:[],edu:'B.Sc. IT final year',stories:{own:[],prob:[],res:[],learn:[],team:[],speak:[]},hist:[['Applied','7 Oct']]},
    {id:'c10',job:'wk',n:'Nikhil Rao',st:'Working at Sahyadri Fintech',city:'Pune',lane:'short',via:'Applied',idv:true,join:'Weekends from 18 Oct',applied:'6 Oct',req:['p','p','p'],proofs:{0:'Certificate: Splunk Core User',1:'Work, confirmed',2:'Work, confirmed'},certs:['Splunk Core Certified User'],assigned:[],exp:[['IT support','Sahyadri Fintech','2023 to now','Weekday support desk.']],edu:'BCA, 2023',stories:{own:[],prob:[],res:[],learn:[],team:[],speak:[]},hist:[['Applied','6 Oct'],['Shortlisted','7 Oct']]},
    {id:'c11',job:'cloud',n:'Divya Menon',st:'Working at Medisetu Clinics',city:'Kochi',lane:'applied',via:'Express',idv:true,join:'From 1 Dec',applied:'4 Oct',req:['p','p','l','l'],proofs:{0:'Certificate: AWS Security Specialty',1:'Work, confirmed'},certs:['AWS Certified Security Specialty'],assigned:[],exp:[['Cloud engineer','Medisetu Clinics','2021 to now','AWS accounts for 30 clinics.']],edu:'B.Tech IT, 2021',stories:{own:[],prob:[],res:[],learn:[],team:[],speak:[]},hist:[['Applied with Express apply','4 Oct']]}
  ];
  var TEAM=[
    {n:'Anita Rao',h:'@anitarao',role:'Recruiter admin',mail:'anita.rao@kavachcyber.in',ok:true,jobs:'All jobs',title:'Head of Talent'},
    {n:'Karan Bhatt',h:'@karanb',role:'Recruiter admin',mail:'karan.bhatt@kavachcyber.in',ok:true,jobs:'All jobs',title:'Co-founder'},
    {n:'Rahul Menon',h:'@rahulm',role:'Hiring HR',mail:'rahul.menon@kavachcyber.in',ok:true,jobs:'SOC analyst L1, Weekend SOC',title:'Talent partner'},
    {n:'Sneha Kulkarni',h:'@snehak',role:'Interviewer',mail:'sneha.k@kavachcyber.in',ok:true,jobs:'3 candidates assigned',title:'SOC lead'},
    {n:'Farhan Shaikh',h:'@farhans',role:'Hiring HR',mail:'',ok:false,jobs:'',title:'Recruiter'},
    {n:'Deepa Iyer',h:'@deepai',role:'Interviewer',mail:'',ok:false,jobs:'',title:'Cloud architect'}
  ];
  var ROLES={
    admin:{who:'Anita Rao',name:'Recruiter admin',desc:'Manages the team, all jobs and company verification.'},
    hiring:{who:'Rahul Menon',name:'Hiring HR',desc:'Posts jobs and moves applicants on the jobs they own.'},
    interviewer:{who:'Sneha Kulkarni',name:'Interviewer',desc:'Sees only the candidates assigned to them.'},
    unverified:{who:'Farhan Shaikh',name:'Hiring HR, pending',desc:'Access given. Work email not confirmed yet.'},
    none:{who:'Priya Nair',name:'',desc:''}
  };
  var BOXES=[['own','Ownership'],['prob','Problem solving'],['res','Delivering results'],['learn','Learning'],['team','Working with others'],['speak','Speaking up']];

  var role='admin', view='overview', jobId='soc', sel=null, pick=null;

  /* ---------- helpers ---------- */
  function matchWords(c){
    var job=JOBS.filter(function(j){return j.id===c.job;})[0];
    var p=c.req.filter(function(x){return x==='p';}).length, tot=job.req.length, left=tot-p;
    if(left===0) return 'All required skills proved';
    var w=['','One','Two','Three','Four','Five'][left]||'Several';
    return w+' required '+(left===1?'skill':'skills')+' not proved yet';
  }
  function reqDots(c){
    return c.req.map(function(x){return '<span class="dot '+(x==='p'?'good':x==='l'?'warn':'bad')+'"></span>';}).join('');
  }
  function visible(c){
    if(role==='interviewer') return c.assigned.indexOf('Sneha Kulkarni')>-1;
    if(role==='hiring'){ var j=JOBS.filter(function(x){return x.id===c.job;})[0]; return j.owner==='Rahul Menon'; }
    return true;
  }
  function toast(t){ var el=$('toast'); el.textContent=t; el.hidden=false; clearTimeout(toast.h); toast.h=setTimeout(function(){el.hidden=true;},2600); }

  /* ---------- role switch ---------- */
  function setRole(r){
    role=r;
    qa('#role-seg button').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.role===r));});
    var R=ROLES[r];
    $('me-name').textContent=R.who; $('me-av').textContent=ini(R.who);
    var hasCorp=r!=='none';
    $('corp-tab').hidden=!hasCorp; $('corp-sep').hidden=!hasCorp;
    $('none-view').hidden=hasCorp; $('ws').hidden=!hasCorp; $('personal-note').hidden=true;
    qa('.nav a').forEach(function(a){a.classList.remove('on');});
    $('inbox-view').hidden=true; $('inbox-tab').classList.remove('on');
    $('inbox-n').textContent=(r==='none'?'2':''); $('inbox-n').hidden=(r!=='none');
    if(!hasCorp){ showInbox(); return; }
    $('corp-tab').classList.add('on');
    $('role-name').textContent=R.name; $('role-desc').textContent=R.desc;
    $('hello').textContent='Good evening, '+R.who.split(' ')[0]+'.';
    qa('[data-admin-hiring]').forEach(function(b){b.hidden=(r==='interviewer');});
    qa('.subnav button').forEach(function(b){
      var v=b.dataset.v;
      b.hidden = (r==='unverified' && v!=='notes') || (v==='team' && r!=='admin');
    });
    $('assigned-note').hidden=(r!=='interviewer');
    $('n-jobs').textContent = r==='interviewer' ? '1' : r==='hiring' ? '2' : '3';
    if(r==='unverified'){ go('verify'); resetVerify(); }
    else if(view==='verify' || (view==='team' && r!=='admin')) go('overview');
    else go(view);
  }

  /* ---------- navigation ---------- */
  function go(v){
    view=v;
    qa('.view').forEach(function(s){s.hidden=s.dataset.view!==v;});
    qa('.subnav button').forEach(function(b){ if(b.dataset.v===v) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
    if(v==='overview') renderOverview();
    if(v==='jobs') renderJob();
    if(v==='interviews') renderSched();
    if(v==='team') renderTeam();
    if(v==='notes') renderNotes();
    if(v==='messages') renderCoMsgs();
    window.scrollTo(0,0);
  }

  /* ---------- overview ---------- */
  function renderOverview(){
    var jobs=JOBS.filter(function(j){ return role==='admin' || (role==='hiring' && j.owner==='Rahul Menon') || (role==='interviewer' && j.id==='soc'); });
    $('ov-jobs').innerHTML=jobs.map(function(j){
      var cs=C.filter(function(c){return c.job===j.id && visible(c);});
      var counts=LANES.map(function(l){return cs.filter(function(c){return c.lane===l.k;}).length;});
      return '<div class="jobrow"><div><button class="link" type="button" data-job="'+j.id+'">'+esc(j.t)+'</button><div class="small muted">'+esc(j.city)+' · '+esc(j.jt)+' · owner '+esc(j.owner)+'</div></div>'+
        '<span class="chip">'+cs.length+(role==='interviewer'?' assigned':' applicants')+'</span>'+
        '<div class="lanebar">'+counts.slice(0,5).map(function(n){return '<span class="'+(n?'f':'')+'" style="--n:'+Math.max(n,0.4)+'"></span>';}).join('')+'</div>'+
        '<div class="lanecount">'+LANES.slice(0,5).map(function(l,i){return '<span>'+l.t+' <b>'+counts[i]+'</b></span>';}).join('')+'</div></div>';
    }).join('');
    qa('#ov-jobs [data-job]').forEach(function(b){b.onclick=function(){ jobId=b.dataset.job; go('jobs'); };});
    var ag=[['11:00','Kavya Reddy · Level 2 team','Sneha Kulkarni · SOC analyst L1'],['16:30','Nikhil Rao · HR round','Rahul Menon · Weekend SOC analyst L1']];
    if(role==='interviewer') ag=ag.slice(0,1);
    $('ov-agenda').innerHTML=ag.map(function(a){return '<li><span class="t">'+a[0]+'</span><span><b>'+esc(a[1])+'</b><br><span class="small muted">'+esc(a[2])+'</span></span></li>';}).join('');
  }

  /* ---------- pipeline ---------- */
  function renderJob(){
    var jobs=JOBS.filter(function(j){ return role==='admin' || (role==='hiring' && j.owner==='Rahul Menon') || (role==='interviewer' && j.id==='soc'); });
    if(!jobs.some(function(j){return j.id===jobId;})) jobId=jobs[0].id;
    $('job-sel').innerHTML=jobs.map(function(j){return '<option value="'+j.id+'"'+(j.id===jobId?' selected':'')+'>'+esc(j.t)+'</option>';}).join('');
    var J=jobs.filter(function(j){return j.id===jobId;})[0];
    $('job-facts').innerHTML='<span class="chip line">'+esc(J.city)+'</span><span class="chip line">'+esc(J.jt)+'</span>'+(J.express?'<span class="chip line">'+ic('zap','sm')+'Express apply on</span>':'')+'<span class="chip line">Owner '+esc(J.owner)+'</span>';
    var q=$('q').value.trim().toLowerCase(), f=$('f-proof').value;
    var cs=C.filter(function(c){
      if(c.job!==jobId || !visible(c)) return false;
      if(q && (c.n+' '+c.certs.join(' ')+' '+c.st).toLowerCase().indexOf(q)<0) return false;
      if(f==='ready' && c.req.indexOf('p')>-1 && c.req.some(function(x){return x!=='p';})) return false;
      if(f==='express' && c.via!=='Express') return false;
      if(f==='id' && !c.idv) return false;
      return true;
    });
    $('lanes').innerHTML=LANES.map(function(l){
      var lc=cs.filter(function(c){return c.lane===l.k;});
      return '<div class="lane'+(l.k==='closed'?' closed':'')+'"><div class="lane-h"><h4>'+l.t+'<small>'+l.d+'</small></h4><span class="n">'+lc.length+'</span></div>'+
        lc.map(function(c){
          return '<button type="button" class="cand'+(sel===c.id?' sel':'')+'" data-c="'+c.id+'">'+
            '<span class="cand-top"><span class="avatar">'+ini(c.n)+'</span><span><b>'+esc(c.n)+'</b><small>'+esc(c.st)+'</small></span></span>'+
            '<span class="reqdots">'+reqDots(c)+'<span class="w">'+matchWords(c)+'</span></span>'+
            '<span class="cand-meta">'+(c.via==='Express'?'<span class="chip line">'+ic('zap','sm')+'Express</span>':'')+(c.idv?'<span class="chip line">'+ic('shield','sm')+'ID verified</span>':'')+(c.certs.length?'<span class="chip line">'+ic('award','sm')+c.certs.length+' cert'+(c.certs.length>1?'s':'')+'</span>':'')+'</span>'+
            '<span class="cand-foot"><span>'+esc(c.city)+'</span><span>Can join '+esc(c.join.replace('From ','from '))+'</span></span></button>';
        }).join('')+(lc.length?'':'<p class="small muted" style="padding:4px">No one here.</p>')+'</div>';
    }).join('');
    qa('#lanes [data-c]').forEach(function(b){b.onclick=function(){ openCand(b.dataset.c); };});
  }

  /* ---------- candidate drawer ---------- */
  var dtab='profile';
  function openCand(id){ sel=id; dtab='profile'; renderDrawer(); $('drawer').hidden=false; $('scrim').hidden=false; renderJob(); $('drawer').querySelector('.x').focus(); }
  function closeCand(){ $('drawer').hidden=true; $('scrim').hidden=true; sel=null; if(view==='jobs') renderJob(); }
  function renderDrawer(){
    var c=C.filter(function(x){return x.id===sel;})[0]; if(!c) return;
    var J=JOBS.filter(function(j){return j.id===c.job;})[0];
    var lane=LANES.filter(function(l){return l.k===c.lane;})[0];
    var tabs=[['profile','Profile'],['match','Match to this job'],['stories','Stories'],['resume','Resume'],['msgs','Messages'],['activity','Activity']];
    var h='<div class="drawer-h"><div class="drawer-top"><span class="avatar lg">'+ini(c.n)+'</span><div><h2 id="d-name">'+esc(c.n)+'</h2><p class="muted small">'+esc(c.st)+' · '+esc(c.city)+'</p>'+
      '<div class="cand-meta" style="margin-top:6px"><span class="chip">'+lane.t+'</span>'+(c.idv?'<span class="chip good">'+ic('shield','sm')+'Identity verified, DigiLocker</span>':'<span class="chip line">Identity not verified</span>')+(c.via==='Express'?'<span class="chip line">'+ic('zap','sm')+'Express apply</span>':'')+'</div></div>'+
      '<button class="btn quiet x" type="button" aria-label="Close">'+ic('x')+'</button></div>'+
      '<div class="tabs" role="tablist">'+tabs.map(function(t){return '<button type="button" role="tab" data-t="'+t[0]+'" aria-selected="'+(dtab===t[0])+'">'+t[1]+'</button>';}).join('')+'</div></div><div class="drawer-b">';
    if(dtab==='profile'){
      h+='<div class="card"><dl class="kv"><dt>Applied for</dt><dd>'+esc(J.t)+', '+esc(c.applied)+'</dd><dt>Can join</dt><dd>'+esc(c.join)+'</dd><dt>Match</dt><dd>'+reqDots(c)+' <span class="small">'+matchWords(c)+'</span></dd><dt>Certifications</dt><dd>'+(c.certs.length?c.certs.map(esc).join('<br>'):'<span class="muted">None listed</span>')+'</dd><dt>Contact</dt><dd>'+(c.via==='Express'?'Shared with Express apply: <span class="mono small">'+c.n.split(' ')[0].toLowerCase()+'@example.in</span>':'<span class="muted">Shown after they accept an interview</span>')+'</dd></dl></div>';
      h+='<div class="card"><h3>Experience</h3><ul class="clean exp">'+(c.exp.length?c.exp.map(function(e){return '<li><b>'+esc(e[0])+' · '+esc(e[1])+'</b><span class="small muted mono">'+esc(e[2])+'</span><small>'+esc(e[3])+'</small></li>';}).join(''):'<li><span class="muted small">No work experience yet. See Stories for projects.</span></li>')+'</ul><h3 style="margin-top:10px">Education</h3><p class="small">'+esc(c.edu)+'</p></div>';
      h+='<div class="hidden-note">'+ic('lock')+'<span>Never shown to companies: phone number, salary, notice period (only "Can join"), their goals and path, streak, other applications and interviews, and anything they set to private.</span></div>';
    }
    if(dtab==='match'){
      h+='<div class="card"><div class="pagehead"><h3>'+esc(J.t)+': required skills</h3><span class="small">'+matchWords(c)+'</span></div>'+
        J.req.map(function(r,i){var s=c.req[i]; return '<div class="req"><span class="dot '+(s==='p'?'good':s==='l'?'warn':'bad')+'"></span><span><b>'+esc(r)+'</b></span><span class="chip '+(s==='p'?'good':s==='l'?'warn':'bad')+'">'+(s==='p'?'Proved':s==='l'?'On resume, not proved':'Not on resume')+'</span>'+(s==='p'?'<small>'+esc(c.proofs[i]||'Proof on profile')+'</small>':s==='l'?'<small>Listed on the resume. No skill check, certificate or confirmed work yet.</small>':'')+'</div>';}).join('')+'</div>';
      h+='<p class="small muted">Worked out from this job\'s requirements and the candidate\'s public skills and proofs. In words, never a score. Their own goals and learning plan stay private.</p>';
    }
    if(dtab==='stories'){
      h+='<p class="small muted">Their work as STAR stories, sorted into six common boxes. Letters show which parts of SMART each story covers.</p><div class="stories">'+BOXES.map(function(b){var L=c.stories[b[0]]||[]; return '<div class="sbox"><h4>'+b[1]+'</h4>'+(L.length?L.map(function(s){return '<div class="story"><b>'+esc(s[0])+'</b><span class="smart">'+'SMART'.split('').map(function(ch){return '<span class="'+(s[2].indexOf(ch)>-1?'y':'')+'">'+ch+'</span>';}).join('')+'</span></div>';}).join(''):'<span class="small muted">Nothing here yet</span>')+'</div>';}).join('')+'</div>';
    }
    if(dtab==='resume'){
      h+='<div class="resume"><h3>'+esc(c.n)+'</h3><span class="muted small">'+esc(c.city)+'</span><span class="label">Experience</span><ul>'+c.exp.map(function(e){return '<li><b>'+esc(e[0])+'</b>, '+esc(e[1])+' ('+esc(e[2])+'). '+esc(e[3])+'</li>';}).join('')+'</ul><span class="label">Education</span><p>'+esc(c.edu)+'</p><span class="label">Certifications</span><p>'+(c.certs.map(esc).join(', ')||'None')+'</p></div>';
      h+='<div class="inline"><button class="btn sm" type="button">'+ic('file','sm')+'Open PDF</button><span class="small muted">Shared with this application only. Every view is logged.</span></div>';
    }
    if(dtab==='msgs'){
      var tid=CO_THREADS.filter(function(id){return TH[id] && TH[id].cand===c.id;})[0];
      if(tid){ var th=TH[tid]; h+='<div class="card convo" style="min-height:0"><div class="convo-b">'+th.msgs.map(function(m,i){return msgHTML(th,m,'co',i);}).join('')+'</div></div><div><button class="btn sm" type="button" data-act="gomsg" data-tid="'+tid+'">'+ic('msg','sm')+'Open in Messages</button></div>'; }
      else h+='<div class="card"><p class="small muted">No messages yet.</p>'+(role!=='interviewer'?'<button class="btn sm" type="button" data-act="newmsg" style="margin-top:8px">'+ic('msg','sm')+'Message '+esc(c.n.split(' ')[0])+'</button>':'')+'</div>';
    }
    if(dtab==='activity'){
      h+='<div class="card"><ul class="clean timeline">'+c.hist.map(function(x,i){return '<li><span class="dot '+(i===c.hist.length-1?'good':'off')+'"></span><span>'+esc(x[0])+'</span><span class="small muted mono">'+esc(x[1])+'</span></li>';}).join('')+'</ul></div>';
      h+='<div class="field"><label for="fb">Feedback for the team</label><textarea id="fb" rows="3" placeholder="What did you see? Stick to the job\'s skills."></textarea></div>';
    }
    h+='</div><div class="drawer-f">';
    if(role==='interviewer'){
      h+='<button class="btn primary" type="button" data-act="fb">Write feedback</button><span class="sp"></span><span class="small muted">Interviewers cannot change stages.</span>';
    } else {
      var next={applied:'Shortlist',short:'Invite to AI interview',ai:'Move to Level 2 team',team:'Make an offer',offer:'Mark as joined',closed:'Reopen'}[c.lane];
      h+='<button class="btn primary" type="button" data-act="next">'+next+'</button>'+(c.lane==='short'||c.lane==='team'||c.lane==='ai'?'<button class="btn" type="button" data-act="sched">'+ic('cal','sm')+'Schedule interview</button>':'')+'<span class="sp"></span>'+(c.lane!=='closed'?'<button class="btn quiet" type="button" data-act="close">Not this time</button>':'');
    }
    h+='</div>';
    $('drawer').innerHTML=h;
    $('drawer').querySelector('.x').onclick=closeCand;
    qa('#drawer [data-t]').forEach(function(b){b.onclick=function(){dtab=b.dataset.t; renderDrawer();};});
    qa('#drawer [data-act]').forEach(function(b){b.onclick=function(){
      var a=b.dataset.act, order=['applied','short','ai','team','offer'];
      if(a==='next'){ if(c.lane==='closed') c.lane='applied'; else if(c.lane!=='offer') c.lane=order[order.indexOf(c.lane)+1]; c.hist.push(['Moved to '+LANES.filter(function(l){return l.k===c.lane;})[0].t+' by '+ROLES[role].who,'today']); toast('Moved. '+c.n.split(' ')[0]+' sees it on Arrivals.'); renderDrawer(); renderJob(); }
      if(a==='close'){ dtab='activity'; renderDrawer(); setTimeout(function(){ var t=$('fb'); t.placeholder='A short note the candidate will see on Arrivals, with what would help next time.'; t.focus(); },10); toast('Add a note, then close it. The note is required.'); }
      if(a==='sched'){ closeCand(); schedFor=c.id; go('interviews'); }
      if(a==='gomsg'){ curCo=b.dataset.tid; closeCand(); go('messages'); }
      if(a==='newmsg'){ var id='t-'+c.id; TH[id]={id:id,kind:'app',cand:c.id,job:c.job,co:'Kavach Cyber Labs',msgs:[{by:'sys',t:'Conversation for this application.'}]}; CO_THREADS.unshift(id); curCo=id; closeCand(); go('messages'); }
      if(a==='fb'){ dtab='activity'; renderDrawer(); setTimeout(function(){$('fb').focus();},10); }
    };});
  }

  /* ---------- scheduling ---------- */
  var schedFor='c1', iv='Sneha Kulkarni';
  var DAYS=[['Mon','13 Oct'],['Tue','14 Oct'],['Wed','15 Oct'],['Thu','16 Oct'],['Fri','17 Oct']];
  var TIMES=['10:00','11:00','12:00','14:00','15:00','16:00','17:00','18:00'];
  var FREE={'0-6':1,'0-7':1,'1-1':1,'1-7':1,'2-6':1,'3-0':1,'3-1':1,'3-7':1,'4-4':1,'4-5':1};
  var CBUSY={'0-0':1,'0-1':1,'0-2':1,'1-3':1,'1-4':1,'2-0':1,'2-1':1,'2-2':1,'2-3':1,'3-4':1,'4-0':1,'4-1':1};
  var IVBUSY={'Sneha Kulkarni':{'0-6':'SOC weekly','1-1':'Interview · Kavya Reddy','3-0':'Interview · Rohan Das','4-4':'On call'},'Karan Bhatt':{'1-7':'Board meeting','3-7':'Interview · Divya Menon'},'Rahul Menon':{'0-7':'HR round · Nikhil Rao','2-6':'Interview · Meera Joshi'}};
  function renderSched(){
    var c=C.filter(function(x){return x.id===schedFor;})[0]||C[0];
    var J=JOBS.filter(function(j){return j.id===c.job;})[0];
    $('sch-title').textContent=c.n+' · '+J.t;
    var ivs=TEAM.filter(function(t){return t.ok && t.role!=='Recruiter admin' || t.n==='Karan Bhatt';});
    $('iv-list').innerHTML=ivs.map(function(t){var load=Object.keys(IVBUSY[t.n]||{}).length; return '<li class="'+(iv===t.n?'on':'')+'"><label><input type="radio" name="iv" value="'+esc(t.n)+'"'+(iv===t.n?' checked':'')+'><span class="avatar">'+ini(t.n)+'</span><span><b>'+esc(t.n)+'</b><small>'+esc(t.title)+' · '+load+' this week</small></span></label></li>';}).join('');
    qa('#iv-list input').forEach(function(r){r.onchange=function(){iv=r.value; pick=null; renderSched();};});
    var busy=IVBUSY[iv]||{};
    var h='<div class="hd"></div>'+DAYS.map(function(d){return '<div class="hd">'+d[0]+'<small>'+d[1]+'</small></div>';}).join('');
    TIMES.forEach(function(t,ti){
      h+='<div class="tm">'+t+'</div>';
      DAYS.forEach(function(d,di){
        var k=di+'-'+ti, inner='';
        if(busy[k]) inner+='<span class="slot busy">'+esc(iv.split(' ')[0])+': '+esc(busy[k])+'</span>';
        if(CBUSY[k] && calOn) inner+='<span class="slot cbusy">Candidate busy</span>';
        if(FREE[k] && !busy[k]) inner+='<button type="button" class="slot '+(pick===k?'pick':'free')+'" data-k="'+k+'">'+(pick===k?'Picked · ':'')+t+' free</button>';
        if(FREE[k] && busy[k]) inner+='<span class="slot cbusy">Free for candidate, not '+esc(iv.split(' ')[0])+'</span>';
        h+='<div class="cell">'+inner+'</div>';
      });
    });
    $('cal').innerHTML=h;
    qa('#cal [data-k]').forEach(function(b){b.onclick=function(){pick=b.dataset.k; renderSched();};});
    if(pick){ var p=pick.split('-'); $('pick-note').innerHTML=ic('check')+'<span>'+DAYS[p[0]][0]+' '+DAYS[p[0]][1]+', '+TIMES[p[1]]+' with '+esc(iv)+'.</span>'; $('send-inv').disabled=false; }
    else { $('pick-note').innerHTML=ic('clock')+'<span>Pick a green slot. Each one is a time the candidate offered and '+esc(iv.split(' ')[0])+' is free.</span>'; $('send-inv').disabled=true; }
    $('send-inv').hidden=(role==='interviewer');
    var wk=[['Mon 10:00','Sneha Kulkarni · SOC weekly (internal)'],['Mon 17:00','Rahul Menon · HR round, Nikhil Rao'],['Tue 11:00','Sneha Kulkarni · Level 2, Kavya Reddy'],['Wed 16:00','Rahul Menon · Level 2, Meera Joshi'],['Thu 10:00','Sneha Kulkarni · Level 2, Rohan Das'],['Thu 18:00','Karan Bhatt · Level 2, Divya Menon']];
    $('iv-week').innerHTML=wk.map(function(a){return '<li><span class="t">'+a[0]+'</span><span>'+esc(a[1])+'</span></li>';}).join('');
  }
  $('send-inv').onclick=function(){ var c=C.filter(function(x){return x.id===schedFor;})[0]; toast('Invite sent. '+c.n.split(' ')[0]+' confirms on Arrivals.'); pick=null; renderSched(); };

  /* ---------- team ---------- */
  function renderTeam(){
    $('team-rows').innerHTML=TEAM.map(function(t,i){
      return '<tr><td><div class="who"><span class="avatar">'+ini(t.n)+'</span><span><b>'+esc(t.n)+'</b><small>'+esc(t.h)+' · '+esc(t.title)+'</small></span></div></td>'+
        '<td><select aria-label="Role for '+esc(t.n)+'" data-i="'+i+'">'+['Recruiter admin','Hiring HR','Interviewer'].map(function(r){return '<option'+(r===t.role?' selected':'')+'>'+r+'</option>';}).join('')+'</select></td>'+
        '<td>'+(t.ok?'<span class="chip good">'+ic('check','sm')+esc(t.mail)+'</span>':'<span class="chip warn">'+ic('clock','sm')+'Waiting for them to confirm</span>')+'</td>'+
        '<td class="small">'+(t.jobs||'<span class="muted">After they confirm</span>')+'</td>'+
        '<td><button class="btn sm quiet" type="button" data-rm="'+i+'">'+(t.ok?'Remove access':'Cancel')+'</button></td></tr>';
    }).join('');
    qa('#team-rows select').forEach(function(s){s.onchange=function(){TEAM[s.dataset.i].role=s.value; toast(TEAM[s.dataset.i].n+' is now '+s.value+'.');};});
    qa('#team-rows [data-rm]').forEach(function(b){b.onclick=function(){
      var t=TEAM[b.dataset.rm];
      if(t.role==='Recruiter admin' && TEAM.filter(function(x){return x.role==='Recruiter admin';}).length<=2){ toast('Keep at least two Recruiter admins. Add another admin first.'); return; }
      TEAM.splice(b.dataset.rm,1); renderTeam(); toast('Access removed. Their personal account is not affected.');
    };});
  }
  $('inv-btn').onclick=function(){ var v=$('inv-q').value.trim(); if(!v){ $('inv-q').focus(); return; } TEAM.push({n:v.replace(/^@/,'').replace(/\b\w/g,function(m){return m.toUpperCase();}),h:v.charAt(0)==='@'?v:'@'+v.toLowerCase().replace(/\s+/g,''),role:$('inv-role').value,mail:'',ok:false,jobs:'',title:'New'}); $('inv-q').value=''; renderTeam(); toast('Access given. They confirm their work email next.'); };

  /* ---------- verify ---------- */
  function resetVerify(){
    $('v1').hidden=false; $('v2').hidden=true; $('v3').hidden=true; $('st2').className=''; $('st3').className=''; $('email-err').hidden=true;
    $('otp').innerHTML=[0,1,2,3,4,5].map(function(i){return '<input inputmode="numeric" maxlength="1" aria-label="Digit '+(i+1)+'" id="otp'+i+'">';}).join('');
    qa('#otp input').forEach(function(inp,i,all){
      inp.oninput=function(){ inp.value=inp.value.replace(/\D/g,''); if(inp.value && all[i+1]) all[i+1].focus(); $('verify-btn').disabled=!all.every(function(x){return x.value;}); };
      inp.onkeydown=function(e){ if(e.key==='Backspace' && !inp.value && all[i-1]) all[i-1].focus(); };
    });
    $('verify-btn').disabled=true;
  }
  $('send-code').onclick=function(){
    var v=$('w-email').value.trim().toLowerCase();
    if(!/@kavachcyber\.in$/.test(v)){ $('email-err').hidden=false; return; }
    $('email-err').hidden=true; $('v1').hidden=true; $('v2').hidden=false; $('st2').className='on'; $('otp0').focus();
  };
  $('verify-btn').onclick=function(){ $('v2').hidden=true; $('v3').hidden=false; $('st3').className='on'; TEAM[4].ok=true; TEAM[4].mail='farhan.shaikh@kavachcyber.in'; TEAM[4].jobs='None yet'; };
  $('to-ws').onclick=function(){ ROLES.unverified.name='Hiring HR'; ROLES.unverified.desc='Posts jobs and moves applicants on the jobs they own.'; role='hiring'; ROLES.hiring.who='Farhan Shaikh'; setRole('hiring'); ROLES.hiring.who='Rahul Menon'; };

  /* ---------- notes ---------- */
  function renderNotes(){
    var clashes=[
      ['"Log in with a company ID" and "each HR logs in with a personal account"','One login only: the personal CareerMetro account. Corporate access is a role on that account, given by a Recruiter admin and switched on after the person confirms a work email on the company\'s verified domain (one-time code). No shared company logins or passwords. When someone leaves, removing the role ends access and their personal profile stays.'],
      ['Who verifies the company first?','The first Recruiter admin comes from Organization sign-up (pending item 17): work email on the domain, company details, and a document check later. After that, admins give access to others. Keep at least two admins so a company is never locked out.'],
      ['Recruiters see "everything on the user\'s page"','They see what any visitor sees on the profile (Experience, Education, Stories, certifications, verified badges) plus what the candidate sent with this application (resume, Express packet). Never: phone (until they accept an interview, unless Express shared it), salary, notice period (only "Can join"), streak, goals, path, other applications or interviews, Junction activity marked private.'],
      ['"Gaps" vs the v2 rule "gaps and path are never sent"','Show Match to this job, worked out from the job\'s own requirements against the candidate\'s public skills and proofs (Proved / On resume, not proved / Not on resume), in words. The candidate\'s personal goal list and learning plan stay private. Decided by Milin on 9 Oct: job match only. This replaces the v2 rule "gaps are never sent" for applications.'],
      ['Calendar showing the candidate\'s "other interviews"','Other companies\' interviews are never shown. The candidate offers free slots (or connects a calendar that shares only busy and free). Interviewers in the company see each other\'s interviews in full.'],
      ['An HR is also a job seeker','The company never sees an employee\'s own job search: their Departures, Arrivals, applications or job-search switch. If the job-search switch is on, they are hidden from their own company\'s candidate search. People who work at the company are hidden from its recruiters unless they apply to one of its jobs themselves.'],
      ['Calendar visible to recruiters, but not on the user\'s page','Nobody sees a calendar. Companies get only the slots a candidate offers in the application conversation, plus plain busy and free for that week if the candidate connected a calendar. Nothing about availability is on the profile.'],
      ['Recruiters messaging people who never applied','Not in this version. Companies can message only within an application. Reaching out to people who did not apply is a B2B feature (pending item 19) and needs the person to turn on "Open to recruiters".'],
      ['Readiness as words (FR-13)','Cards show "Two required skills not proved yet", not percentages. Recruiters can filter by "All required skills proved", identity verified, or Express apply, but there is no ranking score.'],
      ['Stages must match Arrivals','Applied, Shortlisted, Level 1 AI interview (per job, can be off), Level 2 team, Offer, Not this time. Each move updates the candidate\'s Arrivals page. "Not this time" needs a note the candidate sees. AI interview rules from v2 stay: says it is an AI, records only with consent, offers a person, a human decides.']
    ];
    var h='<div class="pagehead"><div><span class="label">For development</span><h1>Logic and dev notes</h1><p class="muted">Corporate side for recruiters and HR. Builds on prototype v2 and docs/design/post-login-handoff.md.</p></div></div>';
    h+='<h2>Clashes found, and how this design settles them</h2><div class="clash">'+clashes.map(function(c){return '<div class="card"><span class="label">Clash</span><h3>'+esc(c[0])+'</h3><p class="muted">'+esc(c[1])+'</p></div>';}).join('')+'</div>';
    h+='<div class="card"><h2>Messages</h2><ul>'+
      '<li><b>Inbox</b> in the personal app (top bar, with an unread count). Tabs: All, Applications, People, Requests.</li>'+
      '<li><b>People</b>: connections can message each other. Anyone else sends one message request; the person accepts, deletes (the sender is not told) or blocks and reports. No attachments or links in a first message.</li>'+
      '<li><b>Applications</b>: one conversation per application, opened when the person applies. Only that company can write in it, only about that application, and only while it is open plus 30 days after it closes.</li>'+
      '<li>On the company side it sits under Corporate, Messages, and on the candidate\'s card. It belongs to the company, not the HR: the job owner, admins and assigned interviewers (read only) all see it, so nothing is lost when someone leaves. The candidate sees "Rahul Menon · Kavach Cyber Labs".</li>'+
      '<li>Structured requests in the thread: <b>Ask for times</b> (the candidate picks slots, which feed the Interviews grid) and <b>Ask a question</b>. More types later (documents go through DigiLocker, never chat).</li>'+
      '<li>An HR\'s personal Inbox stays separate from Corporate Messages. Their company never sees their personal messages.</li>'+
      '<li>Safety: verified-company badge, a standing line that companies never ask for money, OTPs or bank details, Report on every conversation (24-hour review), block, and rate limits for new accounts. Phone and email are never shown in chat. User messages make us an intermediary (IT Rules 2021), the same grievance officer item as Junction.</li>'+
      '<li>No end-to-end encryption at first, so reports can be reviewed. Messages are stored encrypted at rest and never used for analytics or model training.</li></ul></div>';
    h+='<div class="card"><h2>Candidate availability</h2><ul>'+
      '<li>The candidate\'s calendar is never on their profile and never shown to a company.</li>'+
      '<li>A company asks for times in the application conversation. The candidate picks slots on a small week grid and sends them. Only those slots reach the company, as green slots on the Interviews grid.</li>'+
      '<li>Optional calendar connection (Google or Outlook) reads busy and free only, never event names or guests. It greys out busy times while the candidate picks, and lets the company see plain "Candidate busy" for the requested week. Disconnect removes it at once.</li>'+
      '<li>"Usually free" (for example weekdays after 17:00) is a private pattern that only pre-fills the picker. It is never shown to companies.</li>'+
      '<li>When an interview is booked it appears on the candidate\'s Arrivals and in their connected calendar as "Interview" with the company name, visible only to them.</li></ul></div>';
    h+='<div class="card"><h2>Access flow</h2><ul>'+
      '<li>Organization sign-up (not designed yet) creates the company with a verified email domain and its first Recruiter admin.</li>'+
      '<li>A Recruiter admin searches CareerMetro people by name or handle and gives a role: Recruiter admin, Hiring HR or Interviewer.</li>'+
      '<li>On their next visit the person sees a Corporate tab. Inside it, one screen asks for a work email on the company domain and a 6-digit code (10 minutes, 5 tries, then wait 15 minutes).</li>'+
      '<li>After the code, the role is active. Re-check the work email every 180 days or if it bounces. A person can hold a role at one company at a time.</li>'+
      '<li>Removing the role ends Corporate access at once. The personal account and profile are not touched.</li></ul></div>';
    h+='<div class="card"><h2>Roles</h2><ul>'+
      '<li><b>Recruiter admin</b>: everything below on every job, plus team, roles and company profile. At least two per company.</li>'+
      '<li><b>Hiring HR</b>: posts jobs and sets Express criteria (job posting design is pending item 18), moves applicants on jobs they own or were added to, schedules, assigns interviewers, makes offers.</li>'+
      '<li><b>Interviewer</b>: only candidates assigned to them, read-only profile, resume and match for that job; writes feedback; cannot move stages.</li></ul></div>';
    h+='<div class="card"><h2>Screens</h2><ul>'+
      '<li><b>Overview</b>: new applications, decisions waiting (applied over 5 days, offer replies, missing feedback), today\'s interviews, open jobs with counts per stage.</li>'+
      '<li><b>Jobs</b>: one job at a time as a board with six lanes. Cards: name and status, match dots per required skill (green proved, amber on resume, red not on resume) with the words, Express, ID verified, certificates, city, Can join. Filters: all required proved, Express only, identity verified. Only applications made on CareerMetro.</li>'+
      '<li><b>Candidate</b> (drawer): Profile, Match to this job, Stories (six boxes with SMART letters), Resume (shared with this application), Activity with feedback. Actions follow the stage.</li>'+
      '<li><b>Interviews</b>: week grid with the candidate\'s offered slots (green), the chosen interviewer\'s busy time and the candidate\'s plain busy time. Pick a slot, pick the round, send. The candidate confirms on Arrivals.</li>'+
      '<li><b>Team and access</b>: admins only. People, role picker, work email state, remove access.</li></ul></div>';
    h+='<div class="card"><h2>Data (needs approval before build)</h2><ul>'+
      '<li><code>organizations</code> adds <code>email_domain</code>, <code>verified_at</code>, <code>verified_by</code>.</li>'+
      '<li><code>org_members</code> (new): org_id, user_id, role (admin, hiring, interviewer), work_email, work_email_verified_at, granted_by, removed_at.</li>'+
      '<li><code>email_otps</code> (new): user_id, email, code_hash, expires_at, attempts. Never store the plain code.</li>'+
      '<li><code>jobs</code> (new): org_id, owner_id, role profile and track, work_type, city, requirements, Express criteria, ai_round on or off, status.</li>'+
      '<li><code>applications</code> (from the handoff) adds org_id and job_id; <code>application_events</code> (stage, by, note, at) feeds both the board and the candidate\'s Arrivals.</li>'+
      '<li><code>interviews</code> (new): application_id, round, starts_at, interviewer_ids, status; <code>interview_feedback</code>: interviewer, text, at.</li>'+
      '<li><code>candidate_slots</code> (new): offered free times per application.</li>'+
      '<li><code>conversations</code> (new): kind (person, request, application), application_id, created_at, closed_at; <code>conversation_members</code>: user or org; <code>messages</code>: conversation_id, sender_user_id, sender_org_id, kind (text, times_request, question), body, created_at; <code>blocks</code> and <code>reports</code>.</li>'+
      '<li><code>availability_patterns</code> (private): user_id, weekday, start, end. <code>calendar_links</code>: user_id, provider, scope (free and busy only), token stored encrypted.</li>'+
      '<li><code>audit_logs</code>: every view of a resume or candidate by a company member (DPDP Act). Company access to an application ends 180 days after it closes.</li></ul></div>';
    h+='<div class="card"><h2>Not in this mockup</h2><ul><li>Organization sign-up, job posting form, B2B billing and Elite: on the pending list.</li><li>Company profile page that candidates see.</li><li>Bulk actions and email templates.</li></ul></div>';
    $('main').querySelector('[data-view="notes"]').innerHTML=h;
  }

  /* ---------- messages ---------- */
  var calOn=true, curCo='t-kav', curMe='t-kav', meFilter='all', pickOpen=false, picks={};
  var PROWS=[1,4,6,7]; // rows offered in the candidate's picker: 11:00, 15:00, 17:00, 18:00
  var TH={
    't-kav':{id:'t-kav',kind:'app',cand:'c1',job:'soc',co:'Kavach Cyber Labs',msgs:[
      {by:'sys',t:'Conversation started when Priya applied with Express apply, 3 Oct.'},
      {by:'co',who:'Rahul Menon',t:'Hi Priya, thanks for doing the AI round. The team would like a 45-minute Level 2 call with our SOC lead next week.',at:'Wed 16:10'},
      {by:'co',who:'Rahul Menon',type:'times',state:'done',picks:['0-6','0-7','1-1','1-7','2-6','3-0','3-1','3-7','4-4','4-5'],t:'Which times work for you between Mon 13 and Fri 17 Oct?',at:'Wed 16:11'},
      {by:'cand',who:'Priya Nair',t:'Thank you! I have offered times above. Evenings are easiest for me.',at:'Wed 18:02'},
      {by:'co',who:'Rahul Menon',type:'times',state:'open',t:'Sneha is busy at most of those. Could you add a few more on Thu or Fri, even mornings?',at:'Thu 10:15'}
    ],unreadCand:true,unreadCo:false},
    't-kavya':{id:'t-kavya',kind:'app',cand:'c3',job:'soc',co:'Kavach Cyber Labs',msgs:[
      {by:'co',who:'Rahul Menon',t:'Hi Kavya, your Level 2 round is on Tue 14 Oct at 11:00 with Sneha Kulkarni.',at:'Mon 10:02'},
      {by:'cand',who:'Kavya Reddy',t:'Thank you. Should I prepare anything on Sentinel, or is it general SOC work?',at:'Mon 12:40'}
    ],unreadCand:false,unreadCo:true},
    't-ananya':{id:'t-ananya',kind:'app',cand:'c7',job:'soc',co:'Kavach Cyber Labs',msgs:[
      {by:'co',who:'Anita Rao',type:'question',t:'Quick question before we schedule: are you open to rotating shifts, including one night a week?',at:'Tue 09:15'},
      {by:'cand',who:'Ananya Ghosh',t:'Yes, one night a week is fine. I would prefer not to work two nights in a row.',at:'Tue 11:30'}
    ],unreadCand:false,unreadCo:false},
    't-nikhil':{id:'t-nikhil',kind:'app',cand:'c10',job:'wk',co:'Kavach Cyber Labs',msgs:[
      {by:'co',who:'Rahul Menon',t:'Hi Nikhil, is Saturday 10:00 to 18:00 the shift you can do, or Sundays too?',at:'Thu 14:05'}
    ],unreadCand:true,unreadCo:false},
    't-arjun':{id:'t-arjun',kind:'person',with:'Arjun Mehta',st:'Looking for a next role',msgs:[
      {by:'them',t:'Saw you are on the SIEM goal too. Want to do the BOTS v3 searches together on Saturday?',at:'Tue 21:04'},
      {by:'me',t:'Yes, 10 am works. I am stuck on the third search.',at:'Tue 21:30'},
      {by:'them',t:'Same. I will share my notes before.',at:'Tue 21:32'}
    ]},
    't-req':{id:'t-req',kind:'request',with:'Sameer Kulkarni',st:'Working at Garuda Logistics',msgs:[
      {by:'them',t:'Hi Priya, I read your Junction post on Splunk alerts. Could I ask you two questions about the Konkan bank setup?',at:'Thu 08:20'}
    ]},
    't-hr':{id:'t-hr',kind:'person',with:'Neha Gupta',st:'Working at Indus Health Systems',msgs:[
      {by:'them',t:'Are you going to the Pune HR meetup on the 18th?',at:'Wed 19:00'},
      {by:'me',t:'Planning to. See you there.',at:'Wed 19:12'}
    ]}
  };
  var CO_THREADS=['t-kav','t-kavya','t-ananya','t-nikhil'];
  function candOf(th){ return C.filter(function(c){return c.id===th.cand;})[0]; }
  function jobOf(th){ return JOBS.filter(function(j){return j.id===th.job;})[0]; }
  function last(th){ var m=th.msgs.filter(function(x){return x.by!=='sys';}); return m[m.length-1]; }
  function coCanSee(th){ var c=candOf(th); return c && visible(c); }
  function slotName(k){ var p=k.split('-'); return DAYS[p[0]][0]+' '+DAYS[p[0]][1].split(' ')[0]+', '+TIMES[p[1]]; }

  function msgHTML(th,m,side,i){
    if(m.by==='sys') return '<p class="sysmsg">'+esc(m.t)+'</p>';
    var mine = side==='co' ? m.by==='co' : side==='cand' ? m.by==='cand' : m.by==='me';
    var name = m.by==='co' ? m.who+' · '+th.co : m.by==='cand' ? m.who : m.by==='them' ? th.with : 'You';
    if(m.type==='times'){
      var h='<div class="rcard'+(mine?' mine':'')+'"><span class="label">'+ic('cal','sm')+' Asking for interview times</span><p class="small">'+esc(m.t)+'</p>';
      if(m.state==='open'){
        if(side==='cand'){
          if(!pickOpen) h+='<div class="inline"><button class="btn primary sm" type="button" data-act="openpick">Offer times</button><span class="small muted">You choose what to share. Your calendar stays private.</span></div>';
          else {
            h+='<div class="pickgrid" role="group" aria-label="Pick times"><span></span>'+DAYS.map(function(d){return '<span class="h">'+d[0]+'<br>'+d[1].split(' ')[0]+'</span>';}).join('');
            PROWS.forEach(function(r){ h+='<span class="t">'+TIMES[r]+'</span>'; DAYS.forEach(function(d,di){ var k=di+'-'+r, busy=calOn && CBUSY[k]; h+='<button type="button" data-pk="'+k+'" aria-pressed="'+(!!picks[k])+'"'+(busy?' disabled title="Busy in your calendar"':'')+'>'+(busy?'busy':picks[k]?'✓':'')+'</button>'; }); });
            h+='</div><p class="small muted">'+(calOn?'Striped times are busy in your connected calendar. Only "busy" is used, never event names.':'Connect a calendar to grey out times you are already busy.')+'</p>';
            h+='<div class="inline"><button class="btn primary sm" type="button" data-act="sendpick"'+(Object.keys(picks).length?'':' disabled')+'>Send '+Object.keys(picks).length+' times</button><button class="btn quiet sm" type="button" data-act="closepick">Cancel</button></div>';
          }
        } else h+='<span class="small muted">Waiting for '+esc(candOf(th).n.split(' ')[0])+' to offer times.</span>';
      } else {
        h+='<span class="small">'+esc((candOf(th)||{n:''}).n.split(' ')[0])+' offered '+m.picks.length+(m.picks.length===1?' time: ':' times: ')+m.picks.map(slotName).join(' · ')+'</span>';
        if(side==='co') h+='<div><button class="btn sm" type="button" data-act="tosched">'+ic('cal','sm')+'Pick one and schedule</button></div>';
      }
      return h+'<span class="meta">'+esc(name)+' · '+esc(m.at)+'</span></div>';
    }
    return '<div class="msg'+(mine?' mine':'')+'">'+(m.type==='question'?'<span class="label">Question</span>':'')+'<div class="bub">'+esc(m.t)+'</div><span class="meta">'+esc(name)+' · '+esc(m.at||'now')+'</span></div>';
  }

  function convoHTML(th,side){
    var c=candOf(th), J=jobOf(th);
    var head = th.kind==='app'
      ? (side==='co' ? '<span class="avatar">'+ini(c.n)+'</span><div><b>'+esc(c.n)+'</b><div class="small muted">'+esc(J.t)+' · '+LANES.filter(function(l){return l.k===c.lane;})[0].t+'</div></div><span class="sp"></span><button class="btn sm" type="button" data-act="opencand">Open candidate</button>'
                     : '<span class="avatar" style="background:var(--board); color:var(--board-ink)">K</span><div><b>'+esc(th.co)+'</b><div class="small muted">'+esc(J.t)+' · your application</div></div><span class="sp"></span><button class="btn sm quiet" type="button" data-act="report">Report</button>')
      : '<span class="avatar">'+ini(th.with)+'</span><div><b>'+esc(th.with)+'</b><div class="small muted">'+esc(th.st)+'</div></div><span class="sp"></span><button class="btn sm quiet" type="button" data-act="report">Block or report</button>';
    var h='<div class="card convo"><div class="convo-h">'+head+'</div>';
    if(th.kind==='app' && side==='co') h+='<div class="safety">'+ic('users','sm')+'<span>Shared with the job team: '+esc(jobOf(th).owner)+', Anita Rao and Karan Bhatt (admins)'+(c.assigned.length?', '+esc(c.assigned.join(', '))+' (interviewer, read only)':'')+'. The candidate sees each sender\'s name and the company.</span></div>';
    if(th.kind==='app' && side==='cand') h+='<div class="safety">'+ic('shield','sm')+'<span>Kavach Cyber Labs is a verified company. Companies on CareerMetro never ask for money, OTPs or bank details. Report it if anyone does.</span></div>';
    h+='<div class="convo-b">'+th.msgs.map(function(m,i){return msgHTML(th,m,side,i);}).join('')+'</div>';
    if(th.kind==='request' && !th.accepted){
      h+='<div class="convo-f"><p class="small">'+esc(th.with)+' is not a connection. They can\'t send more until you accept, and they never see your contact details.</p><div class="inline"><button class="btn primary sm" type="button" data-act="accept">Accept</button><button class="btn sm" type="button" data-act="decline">Delete</button><button class="btn sm quiet" type="button" data-act="report">Block and report</button></div></div>';
    } else if(side==='co' && role==='interviewer'){
      h+='<div class="convo-f"><p class="small muted">Interviewers can read this conversation. Hiring HR and admins send messages.</p></div>';
    } else {
      h+='<div class="convo-f">'+(side==='co'?'<div class="quick"><button class="btn sm" type="button" data-act="asktimes">'+ic('cal','sm')+'Ask for times</button><button class="btn sm" type="button" data-act="askq">'+ic('q','sm')+'Ask a question</button></div>':'')+
        '<div class="row"><textarea id="composer" rows="1" placeholder="Write a message" aria-label="Message"></textarea><button class="btn primary" type="button" data-act="send">Send</button></div></div>';
    }
    return h+'</div>';
  }

  function wireConvo(root,th,side,rerender){
    qa('[data-act]',root).forEach(function(b){ b.onclick=function(){
      var a=b.dataset.act;
      if(a==='send'){ var t=$('composer').value.trim(); if(!t) return; th.msgs.push({by:side==='co'?'co':side==='cand'?'cand':'me',who:side==='co'?ROLES[role].who:candOf(th)?candOf(th).n:'You',t:t,at:'now',type:th.askq?'question':undefined}); th.askq=false; rerender(); }
      if(a==='asktimes'){ th.msgs.push({by:'co',who:ROLES[role].who,type:'times',state:'open',t:'Which times work for you next week?',at:'now'}); rerender(); toast('Request sent. '+candOf(th).n.split(' ')[0]+' picks times in their Inbox.'); }
      if(a==='askq'){ th.askq=true; $('composer').placeholder='Your question. Keep it about the job.'; $('composer').focus(); }
      if(a==='openpick'){ pickOpen=true; picks={}; rerender(); }
      if(a==='closepick'){ pickOpen=false; rerender(); }
      if(a==='sendpick'){ var ks=Object.keys(picks); var m=th.msgs.filter(function(x){return x.type==='times' && x.state==='open';}).pop(); m.state='done'; m.picks=ks; ks.forEach(function(k){FREE[k]=1;}); pickOpen=false; th.msgs.push({by:'cand',who:candOf(th).n,t:'Added '+ks.length+' more '+(ks.length===1?'time':'times')+'. Any of them works.',at:'now'}); th.unreadCo=true; rerender(); toast('Sent. Kavach sees only the times you picked.'); }
      if(a==='tosched'){ schedFor=th.cand; showCorp(); go('interviews'); }
      if(a==='opencand'){ showCorp(); go('jobs'); jobId=th.job; renderJob(); openCand(th.cand); }
      if(a==='accept'){ th.accepted=true; th.kind='person'; th.msgs.push({by:'sys',t:'You accepted. You can now message each other.'}); rerender(); }
      if(a==='decline'){ delete TH[th.id]; curMe='t-kav'; rerender(); toast('Deleted. Sameer is not told.'); }
      if(a==='report'){ toast('Reported. Our team reviews it within 24 hours.'); }
    };});
    qa('[data-pk]',root).forEach(function(b){ b.onclick=function(){ var k=b.dataset.pk; if(picks[k]) delete picks[k]; else picks[k]=1; rerender(); };});
  }

  function renderCoMsgs(){
    var list=CO_THREADS.filter(function(id){return TH[id] && coCanSee(TH[id]);});
    if(list.indexOf(curCo)<0) curCo=list[0];
    $('n-msg').textContent=list.filter(function(id){return TH[id].unreadCo;}).length||'';
    var h='<div class="card" style="padding:0"><div class="thr-list">'+list.map(function(id){var th=TH[id], c=candOf(th), l=last(th); return '<button type="button" class="thr" data-th="'+id+'" aria-current="'+(id===curCo)+'"><span class="avatar">'+ini(c.n)+'</span><span><b>'+esc(c.n)+'</b><small>'+esc(jobOf(th).t)+' · '+esc(l.t)+'</small></span><span>'+(th.unreadCo?'<span class="unread" aria-label="unread"></span>':'<span class="when">'+esc(l.at||'')+'</span>')+'</span></button>';}).join('')+'</div></div>';
    h+= curCo ? convoHTML(TH[curCo],'co') : '<div class="card"><p class="muted">No conversations for your candidates yet.</p></div>';
    $('co-inbox').innerHTML=h;
    if(curCo) TH[curCo].unreadCo=false;
    qa('#co-inbox [data-th]').forEach(function(b){b.onclick=function(){curCo=b.dataset.th; renderCoMsgs();};});
    if(curCo) wireConvo($('co-inbox'),TH[curCo],'co',renderCoMsgs);
  }

  function renderMeInbox(){
    var cand = role==='none';
    var ids = cand ? ['t-kav','t-arjun','t-req'] : ['t-hr'];
    ids=ids.filter(function(id){return TH[id];});
    var shown=ids.filter(function(id){ var k=TH[id].kind; return meFilter==='all' || (meFilter==='app'&&k==='app') || (meFilter==='person'&&k==='person') || (meFilter==='request'&&k==='request'); });
    if(ids.indexOf(curMe)<0) curMe=ids[0];
    $('inbox-who').textContent=(cand?'Priya Nair':ROLES[role].who)+' · personal account';
    $('inbox-sub').textContent=cand?'Messages with people and with companies you applied to. Your phone number and email are never shared from here.':'Your personal messages. Conversations with applicants live in Corporate, under Messages, so they stay with the company.';
    var unread=ids.filter(function(id){var t=TH[id]; return (t.kind==='app'&&t.unreadCand) || t.kind==='request';}).length;
    $('inbox-n').textContent=unread; $('inbox-n').hidden=!unread;
    var tabs=[['all','All'],['app','Applications'],['person','People'],['request','Requests']];
    var h='<div class="card" style="padding:0"><div class="thr-tabs" role="group" aria-label="Show">'+tabs.map(function(t){return '<button type="button" data-f="'+t[0]+'" aria-pressed="'+(meFilter===t[0])+'">'+t[1]+'</button>';}).join('')+'</div><div class="thr-list">'+
      (shown.length?shown.map(function(id){var th=TH[id], l=last(th), app=th.kind==='app'; var nm=app?th.co:th.with; var un=(app&&th.unreadCand)||th.kind==='request'; return '<button type="button" class="thr" data-th="'+id+'" aria-current="'+(id===curMe)+'"><span class="avatar"'+(app?' style="background:var(--board); color:var(--board-ink)"':'')+'>'+(app?'K':ini(nm))+'</span><span><b>'+esc(nm)+'</b><small>'+(th.kind==='request'?'Message request · ':app?esc(jobOf(th).t)+' · ':'')+esc(l.t)+'</small></span><span>'+(un?'<span class="unread" aria-label="unread"></span>':'<span class="when">'+esc(l.at||'')+'</span>')+'</span></button>';}).join(''):'<p class="small muted" style="padding:10px">Nothing here.</p>')+'</div></div>';
    h+=convoHTML(TH[curMe], TH[curMe].kind==='app'?'cand':'person');
    if(cand){
      h+='<div class="card side avail"><h3>Your availability</h3><p class="small muted">Companies never see your calendar. They see only the times you offer when they ask.</p>'+
        '<div class="row"><span>Usually free</span><span class="muted">Weekdays after 17:00, Sat 10:00 to 13:00</span></div>'+
        '<div class="row"><span>Calendar</span><span>'+(calOn?'Google · busy and free only':'<span class="muted">Not connected</span>')+'</span></div>'+
        '<button class="btn sm" type="button" id="cal-toggle">'+(calOn?'Disconnect calendar':'Connect Google or Outlook')+'</button>'+
        '<p class="small muted">Connected, it greys out times you are busy when you pick slots. Event names, guests and other companies\' interviews are never read or shared.</p>'+
        '<h3 style="margin-top:6px">Who can message you</h3><p class="small muted">Your connections, and companies you applied to, about that application. Anyone else sends one message request; you accept or delete it.</p></div>';
    }
    $('me-inbox').innerHTML=h;
    if(TH[curMe].kind==='app') TH[curMe].unreadCand=false;
    qa('#me-inbox [data-f]').forEach(function(b){b.onclick=function(){meFilter=b.dataset.f; renderMeInbox();};});
    qa('#me-inbox [data-th]').forEach(function(b){b.onclick=function(){curMe=b.dataset.th; pickOpen=false; renderMeInbox();};});
    wireConvo($('me-inbox'),TH[curMe],TH[curMe].kind==='app'?'cand':'person',renderMeInbox);
    if($('cal-toggle')) $('cal-toggle').onclick=function(){ calOn=!calOn; renderMeInbox(); toast(calOn?'Calendar connected. Only busy and free are read.':'Calendar disconnected.'); };
  }

  function hideAll(){ ['ws','personal-note','none-view','inbox-view'].forEach(function(id){$(id).hidden=true;}); qa('.nav a').forEach(function(x){x.classList.remove('on');}); }
  function showCorp(){ hideAll(); $('ws').hidden=false; $('corp-tab').classList.add('on'); }
  function showInbox(){ closeCand(); hideAll(); $('inbox-view').hidden=false; $('inbox-tab').classList.add('on'); renderMeInbox(); window.scrollTo(0,0); }

  /* ---------- wiring ---------- */
  qa('#role-seg button').forEach(function(b){b.onclick=function(){ closeCand(); setRole(b.dataset.role); };});
  qa('.subnav button').forEach(function(b){b.onclick=function(){ go(b.dataset.v); };});
  $('job-sel').onchange=function(){ jobId=$('job-sel').value; renderJob(); };
  $('q').oninput=renderJob; $('f-proof').onchange=renderJob;
  $('scrim').onclick=closeCand;
  document.addEventListener('keydown',function(e){ if(e.key==='Escape' && !$('drawer').hidden) closeCand(); });
  qa('.nav a[data-p]').forEach(function(a){a.onclick=function(e){ e.preventDefault(); closeCand(); hideAll(); a.classList.add('on'); $(role==='none'?'none-view':'personal-note').hidden=false; };});
  $('inbox-tab').onclick=function(e){ e.preventDefault(); showInbox(); };
  $('corp-tab').onclick=function(e){ e.preventDefault(); showCorp(); };
  $('back-corp').onclick=function(){ $('corp-tab').click(); };
  $('post-job').onclick=function(){ toast('Job posting is designed next (pending item 18).'); };

  setRole('admin');
})();
