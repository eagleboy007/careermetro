
  /* ---------- user states: returning, first sign-up, no resume ---------- */
  var STATE='returning';
  var SK={
    have:['Networking basics','Linux','Windows admin','Vulnerability scans','Application security','Vulnerability management','Incident notes','Communication'],
    weak:['Threat detection','Python scripting'],
    miss:['SIEM','AWS security','Scripting for automation']
  };
  var J={
    returning:[['done','Signed up','2 Sep'],['done','Resume read','2 Sep · 11 gaps'],['done','Goal met · App security','proved 9 Sep'],['done','Goal met · Vuln management','proved 18 Sep'],['done','Goal met · Cloud basics','proved 29 Sep'],['now','SIEM goal · Pitstop 4, learn','getting ready'],['future','SIEM goal · Pitstop 5, prove','fills the gap'],['future','5 more goals','Pitstops 6 to 11 · about 9 weeks'],['future','Match','destination']],
    first:[['done','Signed up','today'],['done','Resume read','today · 11 gaps'],['now','App security goal · Pitstop 1','getting ready'],['future','8 more goals','Pitstops 2 to 11 · about 14 weeks'],['future','Match','destination']],
    noresume:[['done','Signed up','today'],['now','Add your resume','next'],['future','Your goals','one per gap, after your resume'],['future','Your line','pitstops for each goal'],['future','Match','destination']]
  };
  var STRIP={
    returning:'<span><b>12</b>day streak</span><span><b>3</b>gaps filled with proof</span><span><b>38</b>connections</span><span><b>9</b>posts on Junction</span>',
    first:'<span><b>Day 1</b>first ride ready</span><span><b>14</b>skills you have</span><span><b>11</b>gaps to close</span><span><b>0</b>connections</span>',
    noresume:'<span><b>0</b>goals yet</span><span><b>0</b>connections</span><span><b>4</b>interests</span>'
  };
  function skillsHTML(st){
    if(st==='noresume') return '<div class="me-empty"><svg class="icon"><use href="#i-file"/></svg><span>Your skills come from your resume. Add it and this fills in, with what is missing for your role.</span><a class="btn btn-primary btn-sm" href="#today" data-go2="today">Add resume</a></div>';
    var have=SK.have.slice(), weak=SK.weak.slice(), miss=SK.miss.slice();
    if(st==='first'){ have=have.filter(function(x){return x!=='Application security' && x!=='Vulnerability management';}); weak=weak.concat(['Application security']); miss=miss.concat(['Vulnerability management']); }
    function col(h,arr,c){ return '<div><h4>'+h+' · '+arr.length+'</h4><div class="chips">'+arr.map(function(x){return chip(c,x);}).join('')+'</div></div>'; }
    return '<div class="skillcols">'+col('Have',have,'met')+col('Weak',weak,'weak')+col('Missing',miss,'missing')+'</div>';
  }
  function proofHTML(st){
    if(st!=='returning') return '<div class="me-empty"><svg class="icon"><use href="#i-flask"/></svg><span>'+(st==='first'?'Prove your first goal and it shows here, for anyone you share your profile with.':'Your proof appears here as you meet goals.')+'</span></div>';
    var P=[['OWASP Top 10: three risks from my last job','App security goal · 9 Sep · public'],['Scored 5 real CVEs with CVSS 3.1','Vuln management goal · 18 Sep · public'],['Set up CloudTrail and read my first log','Cloud basics goal · 29 Sep · connections only']];
    return '<ul class="proofs">'+P.map(function(p){ return '<li><svg class="icon"><use href="#i-flask"/></svg><span><b>'+p[0]+'</b><small>'+p[1]+'</small></span><a class="link" href="#proof">Open<svg class="icon"><use href="#i-arrow"/></svg></a></li>'; }).join('')+'</ul>';
  }
  function resumeHTML(st){
    if(st==='noresume') return '<div class="me-empty"><span>No resume yet.</span><a class="btn btn-primary btn-sm" href="#today" data-go2="today">Add resume</a></div>';
    return '<div class="me-doc"><svg class="icon"><use href="#i-file"/></svg><span>priya-nair-resume.pdf<small>Read '+(st==='first'?'today':'2 Sep')+' · only you see it</small></span></div><div class="actions" style="margin-top:10px"><a class="btn btn-ghost btn-sm" href="#replace">Replace</a><a class="btn btn-quiet btn-sm" href="#builder">Edit in builder</a></div>';
  }
  function renderMe(st){
    $('me-strip').innerHTML=STRIP[st];
    $('me-jlabel').textContent= st==='noresume' ? 'starts with your resume' : 'Cyber Security Analyst · 9 goals, 11 pitstops';
    $('me-jline').innerHTML=J[st].map(function(j){ return '<li class="'+j[0]+'"><b>'+j[1]+'</b><small>'+j[2]+'</small></li>'; }).join('');
    $('me-skills').innerHTML=skillsHTML(st);
    if(typeof renderStories==='function') renderStories(st);
    $('me-proof').innerHTML=proofHTML(st);
    $('me-resume').innerHTML=resumeHTML(st);
    $('me-exp').innerHTML= st==='noresume' ? '<div class="me-empty"><svg class="icon"><use href="#i-brief"/></svg><span>Your roles fill in from your resume, or add them by hand.</span><a class="btn btn-ghost btn-sm" href="#addrole">Add a role</a><a class="btn btn-primary btn-sm" href="#today" data-go2="today">Add resume</a></div>' : expHTML(EXP);
    $('me-edu').innerHTML= st==='noresume' ? '<div class="me-empty"><svg class="icon"><use href="#i-book"/></svg><span>Degrees and courses fill in from your resume, or add them by hand.</span><a class="btn btn-ghost btn-sm" href="#addedu">Add education</a></div>' : expHTML(EDU);
    $('me-explabel').textContent= st==='noresume' ? 'none yet' : '2 years 4 months · from your resume';
    $('me-aim').textContent= st==='noresume' ? 'picking a target role' : 'aiming for Cyber Security Analyst';
    document.querySelectorAll('.view-me [data-go2]').forEach(function(a){ a.addEventListener('click',function(e){ e.preventDefault(); go(a.dataset.go2); }); });
  }
  on('me-preview-on','click',function(){ document.querySelector('.view-me').classList.add('preview'); });
  on('me-preview-off','click',function(){ document.querySelector('.view-me').classList.remove('preview'); });

  var BASEMAP={}; ST.forEach(function(s){ BASEMAP[s.id]=s.s; });
  function mapState(st){
    var first= st==='first';
    map.querySelectorAll('.m-st').forEach(function(g){
      var id=g.dataset.id, s=BASEMAP[id];
      if(first){ s = (id==='resume'||id==='gaps') ? 'done' : id==='p1' ? 'now' : 'future'; }
      g.setAttribute('class','m-st '+s+(g.classList.contains('sel')?' sel':''));
    });
    $('mdone').setAttribute('d', first ? 'M70 470 H180' : 'M70 470 H400 L480 390'); $('mprep').style.display= first ? 'none' : '';
    map.querySelectorAll('.m-rider').forEach(function(r){ r.style.display= first?'none':''; });
    INFO.p1.k0 = INFO.p1.k0 || INFO.p1.k; INFO.p1.k = first ? 'You are here' : INFO.p1.k0;
    ['p1','p2','p3'].forEach(function(id,i){ stLab(id, first ? (i+1)+(i===0?' · LEARN':' · PROVE') : (i+1)+' · PROVED ✓'); });
    if(first){ mapStage(0,true); stCls('p4','future'); $('mdone2').style.display='none'; $('mtrain').setAttribute('transform','translate(290,428)'); INFO.p4.k='Later · SIEM goal'; select('p1'); }
    else mapStage(MSTAGE);
  }

  function countUp(){
    var t=$('tally'); t.classList.remove('in'); void t.offsetWidth; t.classList.add('in');
    t.querySelectorAll('b[data-to]').forEach(function(b){ var to=+b.dataset.to; if(reduce){ b.textContent=to; return; } var n=0, step=Math.max(1,Math.round(to/12)); b.textContent='0'; var iv=setInterval(function(){ n=Math.min(to,n+step); b.textContent=n; if(n>=to) clearInterval(iv); },55); });
  }
  var fdone={f1:false,f2:false};
  function paintFirst(){
    ['f1','f2'].forEach(function(id){ $(id).checked=fdone[id]; $(id).closest('.task-i').classList.toggle('done',fdone[id]); });
    var k=(fdone.f1?1:0)+(fdone.f2?1:0);
    $('streak').textContent= k ? '1' : 'Day 1';
    $('streak-t').textContent= k ? '-day streak' : '';
  }
  ['f1','f2'].forEach(function(id){ $(id).addEventListener('change',function(e){ fdone[id]=e.target.checked; paintFirst(); var k=(fdone.f1?1:0)+(fdone.f2?1:0); if(e.target.checked) toast(k===2 ? 'First ride done. Your streak starts today.' : 'Nice start. One more for your first ride.'); }); });
  var HW={3:22,5:14,8:9,12:6};
  on('hours','click',function(e){ var b=e.target.closest('button'); if(!b) return; this.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed', x===b?'true':'false');}); $('hours-t').textContent='At '+b.dataset.h+' hours a week your line takes about '+HW[b.dataset.h]+' weeks.'; });
  on('rolepick','click',function(e){ var b=e.target.closest('button'); if(!b) return; this.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed', x===b?'true':'false');}); });

  var parseT=[];
  function runParse(){
    var h=document.querySelector('.hero-nores'), items=$('parse').querySelectorAll('li');
    h.classList.add('parsing'); items.forEach(function(li){ li.className=''; });
    var gap= reduce?150:750;
    items.forEach(function(li,i){
      parseT.push(setTimeout(function(){ if(i>0) items[i-1].className='ok'; li.className='on'; }, i*gap));
    });
    parseT.push(setTimeout(function(){ items[items.length-1].className='ok'; }, items.length*gap));
    parseT.push(setTimeout(function(){ setState('first'); toast('Your line is drawn. 11 gaps, 9 goals to start.'); }, items.length*gap+500));
  }
  document.querySelectorAll('[data-parse]').forEach(function(b){ b.addEventListener('click',runParse); });
  var drop=$('drop');
  ['dragenter','dragover'].forEach(function(ev){ drop.addEventListener(ev,function(e){ e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave','drop'].forEach(function(ev){ drop.addEventListener(ev,function(e){ e.preventDefault(); drop.classList.remove('over'); if(ev==='drop') runParse(); }); });

  function setState(st){
    STATE=st; app.dataset.state=st;
    $('seg-state').querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed', x.dataset.s===st?'true':'false'); });
    parseT.forEach(clearTimeout); parseT=[]; document.querySelector('.hero-nores').classList.remove('parsing');
    if(st==='returning'){ render(); $('streak-t').textContent='-day streak'; }
    if(st==='first'){ fdone={f1:false,f2:false}; paintFirst(); countUp(); }
    mapState(st); renderMe(st);
    if(app.dataset.view==='map') drawDone(true);
    if(st!=='returning' && app.dataset.view!=='me' && app.dataset.view!=='map') go('today');
  }
  $('seg-state').addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; setState(b.dataset.s); });
  $('reset').addEventListener('click',function(){ setState('returning'); });

  var EXP=[
    {r:'IT Support and Security Associate',co:'Konkan Co-operative Bank',city:'Pune',d:'Jun 2024 to now · 2 years 4 months',now:1,pts:['Handled first-line security alerts for 40 users and 3 branches','Ran monthly vulnerability scans and tracked fixes with the vendor','Wrote the incident notes template the IT team still uses'],sk:['Vulnerability scans','Incident notes','Windows admin'],ev:'Evidence for 3 skills on your line comes from this role'},
    {r:'IT Support Intern',co:'Western Ghats Logistics',city:'Pune',d:'Jan 2024 to May 2024 · 5 months',pts:['Set up laptops and user accounts for 60 staff','Kept the network device list up to date'],sk:['Networking basics','Linux']}
  ];
  var EDU=[
    {edu:1,r:'B.Sc. Computer Science',co:'Savitribai Phule Pune University',city:'Pune',d:'2020 to 2023 · First class'},
    {edu:1,r:'Higher Secondary (Science)',co:'Maharashtra State Board',city:'Pune',d:'2020'}
  ];
  function expHTML(list){
    return '<ol class="exp">'+list.map(function(e){
      var lg= e.edu ? '<span class="logo"><svg class="icon"><use href="#i-book"/></svg></span>' : '<span class="logo">'+initials(e.co)+'</span>';
      var h='<li'+(e.edu?' class="edu"':'')+'>'+lg+'<div class="exp-main"><div class="exp-top"><b>'+e.r+'</b>'+(e.now?'<span class="exp-now">Current</span>':'')+'</div><div class="exp-meta">'+e.co+' · '+e.city+' · '+e.d+'</div>';
      if(e.pts) h+='<ul>'+e.pts.map(function(p){return '<li>'+p+'</li>';}).join('')+'</ul>';
      if(e.sk) h+='<div class="chips">'+e.sk.map(function(x){return chip('met',x);}).join('')+'</div>';
      if(e.ev) h+='<span class="exp-ev"><svg class="icon"><use href="#i-check"/></svg>'+e.ev+'</span>';
      return h+'</div></li>';
    }).join('')+'</ol>';
  }
  window.__cmExp=expHTML;
  renderMe('returning');
