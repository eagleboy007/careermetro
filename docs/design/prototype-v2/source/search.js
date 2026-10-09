  /* ---------- job search switch + notice period ---------- */
  function setSearch(v, quiet){
    app.dataset.search = v ? 'on' : 'off';
    document.querySelectorAll('.srch-in').forEach(function(i){ i.checked=v; });
    var st=$('me-status');
    if(st) st.innerHTML = v ? '<svg class="icon"><use href="#i-search"/></svg>Looking for a next role' : '<svg class="icon"><use href="#i-brief"/></svg>Working at Konkan Co-operative Bank';
    if(!quiet) toast(v ? 'Job search is on. Departures and Arrivals are back.' : 'Job search is off. Your rides and map keep going.');
  }
  document.addEventListener('change', function(e){ if(e.target.classList && e.target.classList.contains('srch-in')) setSearch(e.target.checked); });
  app.addEventListener('click', function(e){ if(e.target.closest('[data-srch-on]')) setSearch(true); });

  var NP={days:60, step:0, on:'2026-10-01'}, NP_TODAY=new Date(2026,9,9);
  function npDate(s){ var p=s.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
  function npFmt(d){ return d.toLocaleDateString("en-GB",{weekday:"short", day:"numeric", month:"short"}).replace(",",""); }
  function renderNP(){
    var c=$('npcard'), h='';
    var days='<div class="ptype" role="group" aria-label="Notice period">'+[15,30,60,90].map(function(d){ return '<button type="button" aria-pressed="'+(d===NP.days)+'" data-np="'+d+'">'+d+' days</button>'; }).join('')+'</div>';
    if(NP.step<2){
      h+='<div class="np-h"><svg class="icon" style="width:18px;height:18px"><use href="#i-clock"/></svg><b>Notice period</b><span class="label">only you see this</span></div>';
      h+='<div class="np-row"><span>Your notice period at your current job</span>'+days+'</div>';
      if(NP.step===0) h+='<div class="np-row"><span>Already resigned? Start a countdown to your last working day, so companies know when you can join.</span><button class="btn btn-ghost btn-sm" type="button" data-np-act="resign">I have resigned</button></div>';
      else h+='<div class="np-row"><span>When did you hand in your resignation?</span><input type="date" id="np-on" value="'+NP.on+'" max="2026-10-09" aria-label="Resignation date"><button class="btn btn-primary btn-sm" type="button" data-np-act="start">Start countdown</button></div>';
    } else {
      var on=npDate(NP.on), lwd=new Date(on); lwd.setDate(lwd.getDate()+NP.days);
      var join=new Date(lwd); join.setDate(join.getDate()+1);
      var left=Math.max(0, Math.round((lwd-NP_TODAY)/864e5)), pct=Math.min(100, Math.round((NP.days-left)/NP.days*100));
      h+='<div class="np-h"><svg class="icon" style="width:18px;height:18px"><use href="#i-clock"/></svg><b>Notice period</b><span class="label">resigned '+npFmt(on)+' · '+NP.days+' days</span><button class="btn btn-quiet btn-sm" type="button" data-np-act="edit">Change</button></div>';
      h+='<div class="np-timer"><div class="np-big"><b>'+left+'</b><small>days left</small></div><div><b>Last working day: '+npFmt(lwd)+'</b><small>Free to join from '+npFmt(join)+'</small><div class="np-bar" role="progressbar" aria-label="Notice period served" aria-valuenow="'+pct+'" aria-valuemin="0" aria-valuemax="100"><i style="width:'+pct+'%"></i></div></div></div>';
      h+='<ul class="np-notes"><li><svg class="icon"><use href="#i-check"/></svg>Keep applying and interviewing, even after you accept an offer, until the day you join.</li><li><svg class="icon"><use href="#i-check"/></svg>Companies you apply to see "Can join from '+npFmt(join)+'". Your notice terms stay private.</li><li><svg class="icon"><use href="#i-check"/></svg>Express apply checks a company\'s notice period rule against your days left.</li></ul>';
    }
    c.innerHTML=h;
  }
  $('npcard').addEventListener('click', function(e){
    var d=e.target.closest('[data-np]'); if(d){ NP.days=+d.dataset.np; renderNP(); return; }
    var b=e.target.closest('[data-np-act]'); if(!b) return;
    var a=b.dataset.npAct;
    if(a==='resign'){ NP.step=1; renderNP(); }
    else if(a==='start'){ var i=$('np-on'); if(i && i.value) NP.on=i.value; NP.step=2; renderNP(); toast('Countdown started. Companies now see when you can join.'); }
    else if(a==='edit'){ NP.step=1; renderNP(); }
  });
  /* streak popover */
  function streakPop(){
    var n=+$('streak').textContent||0, today=$('wd-today') && $('wd-today').classList.contains('on');
    var first=app.dataset.state==='first';
    $('streak-pop').innerHTML='<b>Your streak: '+(isNaN(n)||!n?'starting today':n+(n===1?' day':' days')+' in a row')+'</b><p>A day counts when you finish at least one task from that day\'s ride (the 2 or 3 tasks on Today).</p><p>'+(first?'Finish one task today to start it.':(today?'Today is counted.':'Today is not counted yet. Finish one task and it goes to '+(n+1)+'.'))+'</p><p class="muted">Miss a day and it pauses. It never drops back to zero.</p>';
  }
  on('streak-btn','click',function(e){ e.stopPropagation(); var p=$('streak-pop'), open=p.hidden; if(open) streakPop(); p.hidden=!open; $('streak-btn').setAttribute('aria-expanded',open); });
  document.addEventListener('click',function(e){ var p=$('streak-pop'); if(p && !p.hidden && !e.target.closest('.streak-w')){ p.hidden=true; $('streak-btn').setAttribute('aria-expanded','false'); } });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ var p=$('streak-pop'); if(p && !p.hidden){ p.hidden=true; $('streak-btn').setAttribute('aria-expanded','false'); $('streak-btn').focus(); } } });
  /* pitstop explainer */
  on('pit-btn','click',function(e){ e.stopPropagation(); var p=$('pit-pop'), open=p.hidden; p.hidden=!open; $('pit-btn').setAttribute('aria-expanded',open); });
  document.addEventListener('click',function(e){ var p=$('pit-pop'); if(p && !p.hidden && !e.target.closest('#pit-btn, #pit-pop')){ p.hidden=true; $('pit-btn').setAttribute('aria-expanded','false'); } });

  /* your own pitstops, drawn as spurs below the line */
  var PIT_SUG=[
    {name:'Networking basics', t:'Read network traffic with Wireshark', l:[['i-play','Computer networking basics','freeCodeCamp · video · 4 h'],['i-book','Wireshark user guide','Wireshark · docs · 2 h']]},
    {name:'Linux hardening', t:'Harden a Linux server', l:[['i-play','Linux command line basics','freeCodeCamp · video · 5 h'],['i-book','CIS Benchmarks overview','CIS · docs · 1 h']]},
    {name:'Explaining risk', t:'Explain a security risk to a manager', l:[['i-play','Communication skills','SWAYAM · video · 8 h'],['i-pen','Proof: a one-page risk note','add to your profile']]}
  ];
  var MINE=[], PIT_X=[720,980,560], PIT_Y=[410,410,480], BASE_PITS=11;
  function drawMine(){
    var g0=$('mcustom'); if(g0) g0.remove();
    var g=el('g',{id:'mcustom'});
    MINE.forEach(function(c,i){
      var x=PIT_X[i], y=PIT_Y[i];
      g.appendChild(el('path',{d:'M'+x+' 310 V'+y,'class':'m-track',style:'stroke-dasharray:6 6'}));
      var s=el('g',{'class':'m-st future',tabindex:0,role:'button','aria-label':'Your pitstop, '+c.name}); s.dataset.id=c.id;
      s.appendChild(el('circle',{'class':'ring-sel',cx:x,cy:y,r:19})); s.appendChild(el('circle',{'class':'dot',cx:x,cy:y,r:10}));
      s.appendChild(txt(x,y+36,c.goal?'ADDED BY YOU':'YOUR CHOICE','n')); s.appendChild(txt(x,y+56,c.name));
      s.addEventListener('click',function(){ select(c.id); mineActs(c.id); });
      s.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); select(c.id); mineActs(c.id); } });
      g.appendChild(s);
    });
    var tr=$('mtrain'); map.insertBefore(g, tr);
    $('pitcount').textContent='Cyber Security Analyst · '+(9+MINE.filter(function(c){return !c.goal;}).length)+' goals, '+(BASE_PITS+MINE.length)+' pitstops';
  }
  function mineActs(id){
    var b=document.createElement('button'); b.type='button'; b.className='btn btn-quiet btn-sm'; b.textContent='Remove this pitstop';
    b.addEventListener('click',function(){ MINE=MINE.filter(function(c){return c.id!==id;}); delete INFO[id]; drawMine(); select('p4'); toast('Removed. Your line is shorter again.'); });
    var w=sheet.querySelector('.sheet-anim'); if(w) w.appendChild(b);
  }
  function addPit(c){
    if(MINE.length>=3){ toast('Up to 3 of your own pitstops in this prototype.'); return; }
    var id='c'+(Date.now()%100000);
    INFO[id]= c.goal ? {k:c.goal+' goal · added today',t:c.t,p:'An extra pitstop on your '+c.goal+' goal. It gets you ready; the prove pitstop still fills the gap.',l:c.l}
      : {k:'Your choice · added today',t:c.t,p:'A goal you want, even if your track does not ask for it. It gets its own pitstops and proof and shows on your profile, but it does not change your match for the destination.',fill:'A skill check, a certification, or work experience someone confirms. Courses alone do not fill it.',l:c.l};
    MINE.push({id:id,name:c.name,goal:c.goal}); drawMine(); select(id); mineActs(id);
    toast('Pitstop added: '+c.name+'. Prep material is in it.');
  }
  function addSheet(){
    map.querySelectorAll('.m-st').forEach(function(g){ g.classList.remove('sel'); });
    var taken=MINE.map(function(c){return c.name;});
    var h='<div class="sheet-anim" style="display:flex;flex-direction:column;gap:14px"><div class="kicker"><span class="label">Add a pitstop</span></div><h3>Where do you want to halt?</h3><p>Pick a gap you want to fill on the way. Free courses and videos get you ready; you fill it by proving it. Your destination stays the same.</p><div class="pit-sug">';
    PIT_SUG.forEach(function(c,i){ if(taken.indexOf(c.name)<0) h+='<button type="button" class="pit-opt" data-pit="'+i+'"><b>'+c.name+'</b><small>'+c.l[0][1]+' · '+c.l[0][2]+'</small></button>'; });
    h+='</div><label class="pit-own"><span class="label">Or your own</span><span class="pit-row"><input type="text" id="pit-own" placeholder="e.g. Photography, Excel, Public speaking" maxlength="40"><button class="btn btn-primary btn-sm" type="button" id="pit-own-go">Add</button></span></label></div>';
    sheet.innerHTML=h;
    sheet.querySelectorAll('[data-pit]').forEach(function(b){ b.addEventListener('click',function(){ addPit(PIT_SUG[+b.dataset.pit]); }); });
    on('pit-own-go','click',function(){ var v=$('pit-own').value.trim(); if(!v){ $('pit-own').focus(); return; } addPit({name:v.length>18?v.slice(0,17)+'…':v, t:v, l:[['i-search','Courses and videos for '+v,'free sources']]}); });
    if(app.getBoundingClientRect().width<760) sheet.scrollIntoView({block:'start', behavior: reduce?'auto':'smooth'});
  }
  on('addpit','click',addSheet);
  $('gap-sug').addEventListener('click',function(e){ if(!e.target.closest('#sugpit')) return; addPit(PIT_SUG[0]); var g=$('gap-sug'); g.innerHTML='<svg class="icon"><use href="#i-check"/></svg><span><b>Networking basics added as your choice</b>It is on your map with prep material. Prove it with a skill check or a certificate.</span><a class="btn btn-ghost btn-sm" href="#map" data-go2="map">Open map</a>'; var a=g.querySelector('[data-go2]'); a.addEventListener('click',function(ev){ ev.preventDefault(); go('map'); }); });
  var GSUG={threat:{goal:'Threat detection',name:'Blue team labs',t:'Practise detections in blue team labs',l:[['i-flask','Blue team labs','free · practice'],['i-play','Detection engineering basics','YouTube · video · 2 h']]},
    python:{goal:'Python',name:'Python for logs',t:'Learn Python for log parsing',l:[['i-play','Python','Kaggle Learn · 5 h'],['i-book','Python docs: the csv and re modules','docs · 1 h']]}};
  $('signals').addEventListener('click',function(e){ var b=e.target.closest('[data-gsug]'); if(!b) return; var c=GSUG[b.dataset.gsug]; addPit(c); var w=b.closest('.gsug'); w.innerHTML='<svg class="icon"><use href="#i-check"/></svg><span><b>'+c.name+' added to your '+c.goal+' goal</b>It is on your map, before the prove pitstop.</span>'; });
  drawMine();

  /* ---------- proof: the only way a gap is filled ---------- */
  var PROOF={st:'',by:''};
  function renderProof(){
    var c=$('proof'); if(!c || !PROOF) return;
    var ready=count()===3, h='';
    if(PROOF.st==='filled'){
      h='<div class="proof-done"><svg class="icon"><use href="#i-badge"/></svg><span><b>SIEM goal met: gap filled</b>'+PROOF.by+' Added to your profile.</span></div>';
    } else {
      h+='<div class="proof-h"><b>Pitstop 5 · Prove SIEM</b><span class="label">any one of three</span></div>';
      h+='<p class="proof-why">'+(ready?'Pitstop 4 is done. This is the pitstop that fills the SIEM gap.':'Pitstop 4 (the course and tasks above) gets you ready. Only this pitstop fills the gap. You can prove it any time.')+'</p>';
      h+='<div class="proof-opts">';
      h+='<div class="popt"><svg class="icon"><use href="#i-q"/></svg><span><b>Skill check</b><small>40 min, free, on camera. Real alerts to investigate, from the same areas as your tasks.</small></span><button class="btn '+(ready?'btn-primary':'btn-ghost')+' btn-sm" type="button" data-proof="check">'+(ready?'Take it now':'Take it')+'</button></div>';
      h+='<div class="popt"><svg class="icon"><use href="#i-award"/></svg><span><b>Certification</b><small>Splunk Core Certified User or Microsoft SC-200. Add the Credly badge or certificate ID; we check it with the issuer.</small></span><button class="btn btn-ghost btn-sm" type="button" data-proof="cert">Add certificate</button></div>';
      if(PROOF.st==='pending'){
        h+='<div class="popt wait"><svg class="icon"><use href="#i-clock"/></svg><span><b>Work experience · waiting</b><small>Sent to Anil Kulkarni, your manager at Konkan Co-operative Bank, to confirm. Backed by your Google Cybersecurity Certificate (SIEM module) from your resume.</small></span><button class="btn btn-quiet btn-sm" type="button" data-proof="confirm">Demo: confirmed</button></div>';
      } else {
        h+='<div class="popt"><svg class="icon"><use href="#i-brief"/></svg><span><b>Work experience</b><small>Used a SIEM at work? Add the role and what you did. A course or certificate on your resume has to back it, and a manager or colleague confirms it.</small></span><button class="btn btn-ghost btn-sm" type="button" data-proof="exp">Add experience</button></div>';
      }
      h+='</div>';
    }
    c.innerHTML=h;
  }
  function fillGap(by){ PROOF={st:'filled',by:by}; renderProof(); clearStop(); }
  $('proof').addEventListener('click',function(e){
    var b=e.target.closest('[data-proof]'); if(!b) return;
    var a=b.dataset.proof;
    if(a==='check'){ b.disabled=true; b.textContent='Checking…'; setTimeout(function(){ fillGap('Proved by the SIEM skill check: you investigated 6 of 6 alerts correctly.'); }, reduce?0:700); }
    else if(a==='cert'){ b.disabled=true; b.textContent='Verifying…'; setTimeout(function(){ fillGap('Proved by Splunk Core Certified User, verified with Credly.'); }, reduce?0:700); }
    else if(a==='exp'){ PROOF.st='pending'; renderProof(); toast('Sent to your manager to confirm. The gap fills once they do.'); }
    else if(a==='confirm'){ fillGap('Proved by work experience at Konkan Co-operative Bank, confirmed by your manager and backed by your Google Cybersecurity Certificate.'); }
  });
  renderProof();


  /* ---------- tracks and "Not for me" ---------- */
  function gRow(k,cls,name,st,ev,rows){
    return '<li class="sig '+cls+'" data-g="'+k+'"><button type="button"><span class="lamp"><i></i><i></i><i></i></span><b>'+name+'</b><span class="st">'+st+'</span></button><div class="more-i"><span>'+ev+'</span><ol class="gpits">'+rows.map(function(r){ return '<li><span class="pn">'+r[0]+'</span><span>'+r[1]+'</span><small>'+r[2]+'</small></li>'; }).join('')+'</ol>'+(NFM[k]?'<div class="nfm-w"><button type="button" class="nfm" data-nfm="'+k+'">Not for me</button></div>':'')+'</div></li>';
  }
  var NFM={
    siem:{lvl:'Required for the SOC track',n:'12 of 14 SOC analyst posts in Pune ask for a SIEM. Posts accept Splunk or Microsoft Sentinel.',req:1,swap:['Use Sentinel instead of Splunk','SIEM (Microsoft Sentinel)','Learn: Microsoft Learn Sentinel path','Prove: skill check or SC-200']},
    threat:{lvl:'Required for the SOC track',n:'11 of 14 SOC analyst posts ask for threat detection.',req:1},
    python:{lvl:'Nice to have for the SOC track',n:'4 of 14 posts mention Python. Your match does not depend on it.',opt:1},
    aws:{lvl:'One of: AWS or Azure security',n:'The posts on your board accept either cloud.',swap:['Use Azure instead of AWS','Azure security','','Prove: AZ-500 or an Azure skill check']},
    iso:{lvl:'Required for the GRC track',n:'10 of 12 GRC analyst posts ask for ISO 27001.',req:1},
    dlp:{lvl:'Nice to have for the GRC track',n:'5 of 12 GRC posts mention DLP.',opt:1}
  };
  var SIG_SOC=$('signals').innerHTML, MORE_SOC=$('goal-more')?$('goal-more').innerHTML:'';
  var GRC_HTML=gRow('iso','missing','ISO 27001 controls','Missing · 2 pitstops','No standard or audit work appears in your resume.',[['1','Learn: ISO 27001 basics, free course','about 6 h'],['2','Prove: skill check or a gap assessment you did','fills the gap']])
    +gRow('risk','weak','Risk assessment','Weak · 2 pitstops','You wrote <q>kept the asset register for 3 branches</q>, a good start, but no risk ratings.',[['3','Learn: NIST SP 800-30 risk method','about 3 h'],['4','Prove: a graded risk register','fills the gap']])
    +gRow('dlp','missing','Data loss prevention (DLP)','Missing · 2 pitstops','No DLP tool appears in your resume.',[['5','Learn: Microsoft Purview DLP, Microsoft Learn','about 4 h'],['6','Prove: DLP skill check or a Purview certification','fills the gap']])
    +gRow('audit','missing','Audit evidence','Missing · 1 pitstop','Your incident notes are close; an auditor needs them in a set format.',[['7','Prove: an audit evidence pack, graded','fills the gap']]);
  var TRK={soc:{n:'SOC and detection'},grc:{n:'GRC and compliance',p:'Your goals become ISO 27001, risk assessment, DLP, audit evidence and 3 more. Proof carries over: App security and Vuln management count here too. SIEM becomes optional, and your SIEM prep stays on your profile. Departures shows GRC analyst roles instead.'},
    data:{n:'Data protection',p:'Your goals would become DLP, the DPDP Act, data classification and 5 more. In this prototype only GRC is drawn in full.'},
    appsec:{n:'Application security',p:'Your goals would become secure code review, OWASP testing and 4 more, with App security already met. In this prototype only GRC is drawn in full.'},
    cloud:{n:'Cloud security',p:'Your goals would become IAM, cloud logging, AWS or Azure security and 5 more, with Cloud basics already met. In this prototype only GRC is drawn in full.'}};
  var CUR_TRK='soc', GSU_SOC='';
  function trkOpen(o){ $('trk').hidden=!o; $('trk-btn').setAttribute('aria-expanded',o); }
  on('trk-btn','click',function(){ trkOpen($('trk').hidden); });
  function setTrack(k){
    CUR_TRK=k; $('trk-name').textContent=TRK[k].n;
    $('trk-list').querySelectorAll('[data-trk]').forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.trk===k?'true':'false'); });
    $('signals').innerHTML= k==='grc'?GRC_HTML:SIG_SOC;
    var gsu=$('gap-sug'); if(gsu){ if(!GSU_SOC) GSU_SOC=gsu.innerHTML; gsu.innerHTML= k==='grc'?'<svg class="icon"><use href="#i-bulb"/></svg><span><b>Suggested goal: DPDP Act basics</b>India\'s data protection law shows up in 7 of the 12 GRC analyst posts on your board.</span>':GSU_SOC; }
    var gm=$('goal-more'); if(gm) gm.innerHTML= k==='grc'?'3 more goals after these: vendor risk, policy writing and incident response.':MORE_SOC;
    $('trk-prev').innerHTML= k==='grc'?'<p class="trk-note">Prototype note: Today\'s ride and the map still show the SOC line. In the app both are redrawn for the new track.</p>':'';
  }
  $('trk-list').addEventListener('click',function(e){
    var b=e.target.closest('[data-trk]'); if(!b) return; var k=b.dataset.trk;
    if(k===CUR_TRK){ $('trk-prev').innerHTML=''; return; }
    var full= k==='grc'||k==='soc';
    $('trk-prev').innerHTML='<p><b>Switch to '+TRK[k].n+'?</b> '+(TRK[k].p||'Your SOC goals come back. Proof you added on other tracks stays on your profile.')+'</p><div class="actions">'+(full?'<button type="button" class="btn btn-primary btn-sm" data-trkgo="'+k+'">Switch track</button>':'')+'<button type="button" class="btn btn-quiet btn-sm" data-trkgo="">Cancel</button></div>';
  });
  $('trk-prev').addEventListener('click',function(e){
    var b=e.target.closest('[data-trkgo]'); if(!b) return; var k=b.dataset.trkgo;
    if(!k){ $('trk-prev').innerHTML=''; return; }
    setTrack(k); toast('Track changed to '+TRK[k].n+'. Your goals were worked out again from your resume.');
  });
  function nfmHTML(k){
    var c=NFM[k], h='<div class="nfm-box"><span class="label">'+c.lvl+'</span><span>'+c.n+'</span><div class="actions">';
    if(c.swap) h+='<button type="button" class="btn btn-ghost btn-sm" data-nfa="swap" data-k="'+k+'">'+c.swap[0]+'</button>';
    if(c.req) h+='<button type="button" class="btn btn-ghost btn-sm" data-nfa="track">See other tracks</button><button type="button" class="btn btn-quiet btn-sm" data-nfa="skip" data-k="'+k+'">Skip anyway</button>';
    if(c.opt) h+='<button type="button" class="btn btn-ghost btn-sm" data-nfa="remove" data-k="'+k+'">Remove this goal</button>';
    h+='<button type="button" class="btn btn-quiet btn-sm" data-nfa="keep" data-k="'+k+'">Keep it</button></div>';
    if(c.req) h+='<small>Skip it and the roles that ask for it stay amber on Departures, so your readiness stays honest.</small>';
    return h+'</div>';
  }
  $('signals').addEventListener('click',function(e){
    var b=e.target.closest('[data-nfm]'); if(b){ b.parentNode.innerHTML=nfmHTML(b.dataset.nfm); return; }
    var a=e.target.closest('[data-nfa]'); if(!a) return;
    var act=a.dataset.nfa, k=a.dataset.k, li=a.closest('.sig'), w=a.closest('.nfm-w');
    if(act==='keep'){ w.innerHTML='<button type="button" class="nfm" data-nfm="'+k+'">Not for me</button>'; }
    else if(act==='track'){ trkOpen(true); $('trk').scrollIntoView({block:'nearest', behavior: reduce?'auto':'smooth'}); }
    else if(act==='swap'){ var s=NFM[k].swap; li.querySelector(':scope > button b').textContent=s[1]; var ps=li.querySelectorAll('.gpits li > span:nth-child(2)'); if(s[2]&&ps[0]) ps[0].textContent=s[2]; if(s[3]&&ps[ps.length-1]) ps[ps.length-1].textContent=s[3]; w.innerHTML='<span class="nfm-done">Swapped. Same goal, a different tool; your match does not change.</span>'; toast('Swapped: '+s[1]+'. Your pitstops were updated.'); }
    else if(act==='skip'){ li.classList.add('skipped'); li.querySelector('.st').textContent='Skipped · roles stay amber'; w.innerHTML='<span class="nfm-done">Skipped. Roles that ask for it stay amber on Departures.</span> <button type="button" class="nfm" data-nfa="undo" data-k="'+k+'">Undo</button>'; }
    else if(act==='undo'){ li.classList.remove('skipped'); li.querySelector('.st').textContent=li.classList.contains('weak')?'Weak · 2 pitstops':'Missing · 2 pitstops'; w.innerHTML='<button type="button" class="nfm" data-nfm="'+k+'">Not for me</button>'; }
    else if(act==='remove'){ var nm=li.querySelector(':scope > button b').textContent; li.remove(); toast(nm+' removed. It was nice to have, so your match does not change.'); }
  });
  on('reset','click',function(){ setTrack('soc'); trkOpen(false); $('trk-prev').innerHTML=''; });

  setSearch(true, true);
  renderNP();

