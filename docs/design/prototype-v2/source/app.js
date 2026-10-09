<script>
(function(){
  var $=function(id){return document.getElementById(id);};
  var app=$('app'), frame=$('frame');
  var reduce=false; try{ reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
  var SVGNS='http://www.w3.org/2000/svg';

  /* ---------- chrome ---------- */
  var sf=$('seg-frame');
  sf.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; sf.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed', x===b?'true':'false');}); frame.classList.toggle('phone', b.dataset.v==='phone'); });
  var dev=$('dev');
  $('devopen').addEventListener('click',function(){ dev.classList.add('open'); dev.setAttribute('aria-hidden','false'); });
  $('devclose').addEventListener('click',function(){ dev.classList.remove('open'); dev.setAttribute('aria-hidden','true'); });

  var toastT; function toast(t){ var el=$('toast'); $('toast-t').textContent=t; el.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(function(){el.classList.remove('show');},2600); }

  /* ---------- navigation ---------- */
  function go(v){
    app.dataset.view=v;
    var lit=(v==='profile')?'network':v;
    document.querySelectorAll('.app [data-go]').forEach(function(a){ a.classList.toggle('on', a.dataset.go===lit && !!a.closest('.topnav, .tabs')); });
    if(v==='map'){ drawDone(true); var ms=document.querySelector('.map-scroll'); if(ms && ms.scrollWidth>ms.clientWidth){ ms.scrollLeft=Math.max(0, ms.scrollWidth*0.42 - ms.clientWidth/2); } }
    var r=app.getBoundingClientRect(); if(r.top<0) app.scrollIntoView({block:'start', behavior: reduce?'auto':'smooth'});
  }
  document.querySelectorAll('.app [data-go]').forEach(function(a){ a.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); document.querySelectorAll('.menu.open').forEach(function(x){x.classList.remove('open');}); go(a.dataset.go); }); });

  /* ---------- today: mini line ---------- */
  var ml=$('miniline'), mlsvg=$('mlsvg'), train=$('train');
  var STOPS=['1','2','3','4','5','6','7','8','9','10','11','Practice','Match'];
  var SP=560/12;
  function sx(i){ return 20+i*SP; }
  function el(tag,attrs){ var n=document.createElementNS(SVGNS,tag); for(var k in attrs) n.setAttribute(k,attrs[k]); return n; }
  mlsvg.appendChild(el('line',{x1:20,y1:40,x2:580,y2:40,'class':'ml-track','vector-effect':'non-scaling-stroke'}));
  mlsvg.appendChild(el('line',{x1:20,y1:40,x2:sx(2),y2:40,'class':'ml-done','vector-effect':'non-scaling-stroke'}));
  var seg=el('line',{x1:sx(2),y1:40,x2:sx(3),y2:40,'class':'ml-today','vector-effect':'non-scaling-stroke','stroke-dasharray':SP+' '+SP,'stroke-dashoffset':SP});
  mlsvg.appendChild(seg);
  var seg2=el('line',{x1:sx(3),y1:40,x2:sx(4),y2:40,'class':'ml-done','vector-effect':'non-scaling-stroke',style:'display:none'});
  mlsvg.appendChild(seg2);
  STOPS.forEach(function(s,i){
    var d=document.createElement('span'); d.className='ml-dot'+(i<3?' done':'')+(i>=11?' big':''); d.style.left=(sx(i)/600*100)+'%'; d.dataset.i=i; ml.appendChild(d);
    var l=document.createElement('span'); l.className='ml-lab'+(i===3?' on':''); l.style.left=(sx(i)/600*100)+'%'; l.textContent=s; l.dataset.i=i; ml.appendChild(l);
  });
  var pulse=document.createElement('span'); pulse.className='pulse'; train.appendChild(pulse);
  function placeTrain(i){ train.style.left=(sx(i)/600*100)+'%'; }

  /* ---------- today: state ---------- */
  var BASE=2, done={t1:false,t2:false,t3:false}, cleared=false;
  var RT0=$('ride-title').innerHTML, RS0=$('ride-sub').textContent;
  var STREAK0=11;
  function count(){ return (done.t1?1:0)+(done.t2?1:0)+(done.t3?1:0); }
  function render(){
    var k=count(), p=(BASE+k)/5;
    $('ringfg').setAttribute('stroke-dashoffset', (263.9*(1-p)).toFixed(1));
    $('ringnum').textContent=(BASE+k)+'/5';
    seg.setAttribute('stroke-dashoffset', (SP*(1-p)).toFixed(1));
    ['t1','t2','t3'].forEach(function(id){ var c=$(id); c.checked=done[id]; c.closest('.task-i').classList.toggle('done',done[id]); });
    var rode=k>0;
    $('wd-today').classList.toggle('on',rode);
    $('streak').textContent=STREAK0+(rode?1:0);
    if(!cleared){
      var lr=k===3;
      placeTrain(lr?3.3:2+p*0.94);
      ml.querySelectorAll('.ml-dot').forEach(function(d){ if(+d.dataset.i===3) d.classList.toggle('done',lr); });
      ml.querySelectorAll('.ml-lab').forEach(function(l){ l.classList.toggle('on', +l.dataset.i===(lr?4:3)); });
      $('stopchip').textContent= lr?'Pitstop 5 of 11':'Pitstop 4 of 11';
      var g4=$('gp-4'); if(g4){ g4.className= lr?'done':'now'; g4.querySelector('small').textContent= lr?'done':(BASE+k)+' of 5 tasks'; var g5=$('gp-5'); g5.className= lr?'now':''; g5.querySelector('small').textContent= lr?'you are here':'fills the gap'; }
      if(typeof mapStage==='function' && MSTAGE!==(lr?1:0)) mapStage(lr?1:0);
      $('ringtxt').textContent = lr ? "Pitstop 4 done. Pitstop 5 is where you prove SIEM and fill the gap." : k===0 ? 'Tasks get you ready. Proof fills the gap.' : (3-k)+' to go this week. Then prove it.';
    }
    renderProof();
  }
  function clearStop(){
    cleared=true;
    var ride=$('ride');
    var b=$('burst'); b.innerHTML='';
    if(!reduce){ for(var i=0;i<22;i++){ var s=document.createElement('i'); var a=Math.random()*Math.PI*2, d=120+Math.random()*220; s.style.left='38%'; s.style.top='46%'; s.style.setProperty('--dx',Math.cos(a)*d+'px'); s.style.setProperty('--dy',Math.sin(a)*d+'px'); s.style.setProperty('--r',(Math.random()*540-270)+'deg'); s.style.animationDelay=(Math.random()*0.15)+'s'; if(i%3===0){ s.style.borderRadius='50%'; } b.appendChild(s);} }
    ride.classList.add('cleared');
    setTimeout(function(){
      placeTrain(4.3); seg2.style.display='';
      ml.querySelectorAll('.ml-dot').forEach(function(d){ if(+d.dataset.i===3 || +d.dataset.i===4) d.classList.add('done'); });
      ml.querySelectorAll('.ml-lab').forEach(function(l){ l.classList.toggle('on', +l.dataset.i===5); });
    }, reduce?0:350);
    $('ride-title').innerHTML='SIEM goal met. <em>Next goal: threat detection.</em>';
    $('ride-sub').textContent='You proved SIEM, so the gap is filled and on your profile. Your next goal has two pitstops: learn MITRE ATT&CK, then prove it. The SOC Analyst L1 roles on the board are one goal closer.';
    $('stopchip').textContent='Pitstop 6 of 11';
    $('ringtxt').textContent='Goal met. Next week\'s prep is for Pitstop 6.';
    toast('SIEM gap filled. Your train moved on.');
    setBoardCleared(true);
    mapCleared(true);
  }
  ['t1','t2'].forEach(function(id){ $(id).addEventListener('change',function(e){ done[id]=e.target.checked; render(); if(e.target.checked) toast(count()<3 ? count()+' of 3 done. Your train is closer to Pitstop 4.' : 'Pitstop 4 done. Next: prove SIEM at Pitstop 5.'); }); });

  /* ---------- signal check ---------- */
  var opts=$('opts');
  opts.addEventListener('click',function(e){
    var b=e.target.closest('.opt'); if(!b || b.disabled) return;
    var right=b.dataset.ok==='1';
    opts.querySelectorAll('.opt').forEach(function(o){ o.disabled=true; if(o.dataset.ok==='1') o.classList.add('right'); else if(o===b) o.classList.add('wrong'); });
    $('explain-t').textContent=(right?'Right. ':'Close, but it is A. ')+'Many failed logins, then a success from one source, is password guessing: T1110. Next, check what the account did after it logged in (T1078 Valid Accounts).';
    $('explain').classList.add('show');
    done.t3=true; render();
    toast(count()<3 ? 'Signal check done. '+count()+' of 3.' : 'Pitstop 4 done. Next: prove SIEM at Pitstop 5.');
  });

  /* ---------- departure board ---------- */
  var ROWS=[
    {role:'IT support + security', where:'Pune · 22 posts', when:'Boarding now', cls:'now', gaps:[], note:'No required gaps. Your resume already fits these. Apply while you ride.'},
    {role:'SOC analyst L1', where:'Pune · 14 posts', when:'After 2 goals', cls:'soon', gaps:[['missing','SIEM'],['weak','Threat detection']], note:'Two gaps between you and these.'},
    {role:'Security analyst', where:'Bengaluru · 31 posts', when:'After 4 goals', cls:'later', gaps:[['missing','SIEM'],['weak','Python'],['missing','AWS security']], note:'Three gaps.'},
    {role:'Cyber security analyst', where:'Hyderabad · 9 posts', when:'After 6 goals', cls:'later', gaps:[['missing','SIEM'],['weak','Threat detection'],['weak','Python'],['missing','AWS security']], note:'Your destination.'}
  ];
  var CHARS='ABCDEFGHIJKLMNOPRSTUVWXYZ0123456789';
  function flap(node, text, delay){
    text=text.toUpperCase(); node.innerHTML='';
    var spans=[];
    for(var i=0;i<text.length;i++){ var s=document.createElement('span'); s.className='flap'; s.textContent=text[i]===' '?' ':(reduce?text[i]:CHARS[Math.floor(Math.random()*CHARS.length)]); node.appendChild(s); spans.push(s); }
    if(reduce) return;
    spans.forEach(function(s,i){ var ch=text[i]; if(ch===' ') return; var n=0, max=4+i%6; setTimeout(function tick(){ if(n++<max){ s.textContent=CHARS[Math.floor(Math.random()*CHARS.length)]; setTimeout(tick,45); } else s.textContent=ch; }, delay+i*18); });
  }
  var brows=$('brows');
  function chip(st,t){ var ic= st==='missing'?'i-alert':st==='weak'?'i-contrast':'i-check'; return '<span class="chip '+st+'"><svg class="icon"><use href="#'+ic+'"/></svg>'+t+'</span>'; }
  function buildBoard(){
    brows.innerHTML='';
    ROWS.forEach(function(r,i){
      var row=document.createElement('div'); row.className='brow'; row.tabIndex=0; row.setAttribute('role','button'); row.setAttribute('aria-expanded','false');
      row.innerHTML='<span class="role"></span><span class="where"></span><span class="when"><b class="'+r.cls+'"></b></span><span class="gaps">'+(r.gaps.length? r.gaps.map(function(g){return chip(g[0],g[1]);}).join(''):'')+'<span>'+r.note+'</span></span>';
      brows.appendChild(row);
      flap(row.querySelector('.role'), r.role, i*120);
      row.querySelector('.where').textContent=r.where;
      flap(row.querySelector('.when b'), r.when, i*120+200);
      function tog(){ var o=row.classList.toggle('open'); row.setAttribute('aria-expanded',o?'true':'false'); }
      row.addEventListener('click',tog);
      row.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); tog(); } });
    });
  }
  function setBoardCleared(on){
    ROWS[1].when= on?'Boarding soon':'After 2 goals';
    ROWS[1].cls= on?'soon':'soon';
    ROWS[1].gaps= on?[['weak','Threat detection']]:[['missing','SIEM'],['weak','Threat detection']];
    ROWS[1].note= on?'One gap left. SIEM turned green today.':'Two gaps between you and these.';
    var row=brows.children[1]; if(!row) return;
    flap(row.querySelector('.when b'), ROWS[1].when, 300);
    row.querySelector('.gaps').innerHTML=ROWS[1].gaps.map(function(g){return chip(g[0],g[1]);}).join('')+'<span>'+ROWS[1].note+'</span>';
    var sig=document.querySelector('#signals .sig'); if(sig && on){ sig.className='sig met'; sig.querySelector('.st').textContent='Met · today'; sig.querySelector('.more-i').innerHTML='<span>'+(PROOF&&PROOF.by||'Filled today with proof.')+' It shows on your profile.</span>'; }
  }
  buildBoard();

  /* ---------- signals ---------- */
  var SIG0=$('signals').innerHTML, GS0=$('gap-sug').innerHTML;
  $('signals').addEventListener('click',function(e){ var b=e.target.closest('.sig > button'); if(!b) return; b.parentNode.classList.toggle('open'); });

  /* ---------- reset ---------- */
  $('reset').addEventListener('click',function(){
    done={t1:false,t2:false,t3:false}; cleared=false;
    $('ride').classList.remove('cleared'); $('burst').innerHTML='';
    PROOF={st:'',by:''};
    seg2.style.display='none'; $('signals').innerHTML=SIG0; $('gap-sug').innerHTML=GS0;
    ml.querySelectorAll('.ml-dot').forEach(function(d){ d.classList.toggle('done', +d.dataset.i<3); });
    ml.querySelectorAll('.ml-lab').forEach(function(l){ l.classList.toggle('on', +l.dataset.i===3); });
    $('ride-title').innerHTML=RT0; $('ride-sub').textContent=RS0;
    $('stopchip').textContent='Pitstop 4 of 11';
    opts.querySelectorAll('.opt').forEach(function(o){ o.disabled=false; o.classList.remove('right','wrong'); });
    $('explain').classList.remove('show');
    ROWS[1].when='After 2 goals'; ROWS[1].gaps=[['missing','SIEM'],['weak','Threat detection']]; ROWS[1].note='Two gaps between you and these.';
    buildBoard(); mapCleared(false); render(); go('today');
  });

  /* ---------- map ---------- */
  var map=$('mapsvg');
  var ST=[
    {id:'resume',name:'Resume',x:70,y:470,s:'done'},
    {id:'gaps',name:'Gaps',x:180,y:470,s:'done',lab:'above'},
    {id:'p1',n:'1 · PROVED ✓',name:'App security',x:290,y:470,s:'done'},
    {id:'p2',n:'2 · PROVED ✓',name:'Vuln management',x:400,y:470,s:'done',lab:'above'},
    {id:'p3',n:'3 · PROVED ✓',name:'Cloud basics',x:480,y:390,s:'done',lab:'right',dy:14},
    {id:'p4',n:'4 · LEARN',name:'SIEM',x:560,y:310,s:'now',lab:'above'},
    {id:'p5',n:'5 · PROVE',name:'SIEM',x:650,y:310,s:'future'},
    {id:'p6',n:'6 · LEARN',name:'Threat detection',x:740,y:310,s:'future',lab:'br'},
    {id:'p7',n:'7 · PROVE',name:'Threat detection',x:830,y:310,s:'future',lab:'above'},
    {id:'p8',n:'8 · PROVE',name:'Python',x:935,y:310,s:'future'},
    {id:'p9',n:'9 · PROVE',name:'AWS security',x:1010,y:310,s:'future',lab:'right',dy:-14},
    {id:'p10',n:'10 · PROVE',name:'Incident response',x:1090,y:230,s:'future',lab:'right'},
    {id:'p11',n:'11 · PROVE',name:'Alert triage',x:1170,y:150,s:'future',lab:'br'},
    {id:'practice',name:'Practice',x:1260,y:150,s:'future',cap:true,lab:'above'},
    {id:'match',name:'Match',x:1350,y:150,s:'future',cap:true,lab:'above'}
  ];
  var INFO={
    resume:{k:'Done · 6 Oct',t:'Resume',p:'Priya_Nair_resume.pdf. 14 skills found, 2 years in IT support.',l:[['i-file','Replace resume','PDF or Word']],cta:[['Replace','other']]},
    gaps:{k:'Done · 6 Oct',t:'Gaps',p:'10 of 17 skills to work on for Cyber Security Analyst. Each gap quotes the line from your resume it is based on.',l:[['i-alert','SIEM','missing'],['i-contrast','Threat detection','weak'],['i-contrast','Python','weak'],['i-alert','AWS security','missing']],cta:[['See all gaps','other']]},
    p1:{k:'Goal met · 28 Sep',t:'Application security',by:'Skill check passed, plus your notes on three OWASP flaws on your profile.',p:'One goal, one gap. You got ready with the OWASP Top 10, then proved it.',l:[['i-book','OWASP Top 10','OWASP · docs · 2 h']]},
    p2:{k:'Goal met · 2 Oct',t:'Vulnerability management',by:'Work experience: patch triage at Konkan Co-operative Bank, confirmed by your manager and backed by your Google Cybersecurity Certificate.',p:'Your work already covered it, so the app suggested a single prove pitstop.',l:[['i-book','CVSS v3.1 specification','FIRST · docs · 1.5 h']]},
    p3:{k:'Goal met · 5 Oct',t:'Cloud basics',by:'Skill check passed.',p:'Foundations for your AWS security goal (Pitstop 9).',l:[['i-play','AWS Cloud Practitioner Essentials','AWS Skill Builder · 6 h']]},
    p4:{k:'You are here · SIEM goal',t:'Pitstop 4: learn SIEM',p:'The free Splunk course plus daily tasks: 2 of 5 done. This pitstop gets you ready. It does not fill the gap; Pitstop 5 does.',l:[['i-play','Free Splunk courses','Splunk · video · 10 h'],['i-flask','Boss of the SOC v3 dataset','Splunk · practice'],['i-pen','Three searches, explained','practice for Pitstop 5']],cta:[['Go to today\'s ride','today']],who:'SK RV +5 are on the SIEM goal with you'},
    p5:{k:'Next · SIEM goal',t:'Pitstop 5: prove SIEM',p:'The pitstop that fills the SIEM gap. Pick any one way to prove it.',lt:'Ways to prove it',l:[['i-q','SIEM skill check','40 min · free · on camera'],['i-award','Splunk Core Certified User or Microsoft SC-200','verified with the issuer'],['i-brief','SIEM work you did','a manager or colleague confirms']]},
    p6:{k:'Next goal · Threat detection',t:'Pitstop 6: learn ATT&CK',p:'Map attacks with MITRE ATT&CK. About 4 hours of prep, spread over daily tasks.',l:[['i-book','MITRE ATT&CK','MITRE · docs · 3 h'],['i-play','Threat hunting basics','YouTube · video · 1 h']]},
    p7:{k:'Ahead · Threat detection goal',t:'Pitstop 7: prove threat detection',p:'Fills the threat detection gap.',fill:'A threat detection skill check, an ATT&CK-based certification, or detection work someone confirms.',l:[]},
    p8:{k:'Interchange · Data Analyst line',t:'Pitstop 8: prove Python',fill:'A Python skill check, or a log-parsing script you wrote at work that someone confirms.',p:'Python is already on your resume, so the app suggests only a prove pitstop. 38 people on the Data Analyst line are here too.',lt:'Brush up if you need to',l:[['i-play','Python','Kaggle Learn · 5 h']],cta:[['Meet them on Junction','junction']],who:'Arjun Mehta is here now'},
    p9:{k:'Interchange · Cloud Engineer line',t:'Pitstop 9: prove AWS security',fill:'AWS Certified Security Specialty, or an AWS IAM skill check.',p:'Cloud basics (Pitstop 3) covered the ground, so this goal is one prove pitstop. 51 people on the Cloud Engineer line share it.',lt:'Brush up if you need to',l:[['i-book','Security best practices in IAM','AWS · docs · 1 h']],cta:[['Meet them on Junction','junction']]},
    p10:{k:'Ahead',t:'Pitstop 10: prove incident response',fill:'A graded incident report, or incident work someone confirms.',p:'Practise the write-up hiring managers ask about in interviews.',lt:'Brush up if you need to',l:[['i-book','SP 800-61 Rev. 3','NIST · docs · 3 h']]},
    p11:{k:'Ahead',t:'Pitstop 11: prove alert triage',fill:'A timed mock SOC shift, graded.',p:'The last goal before your destination. Your proof becomes the story for your interviews.',lt:'Brush up if you need to',l:[['i-flask','Boss of the SOC v3 dataset','Splunk · practice']]},
    practice:{k:'Opens after Pitstop 8',t:'Practice',p:'Short interview rounds on the goals you just met. Signal checks on Today are a taste.',l:[['i-msg','10 questions by role','free']]},
    match:{k:'Destination',t:'Match: Cyber Security Analyst',p:'Your next role, not your last. Roles and pasted job posts are matched against your updated profile; 4 departures on the board today. Once you get there, pick a new destination and a new line starts from here. Past pitstops stay on your Life line.',l:[['i-brief','SOC analyst L1','Pune · boarding after 2 goals'],['i-brief','Security analyst','Bengaluru · after 4 goals']],cta:[['See departures','today']]},
    xdata:{k:'Other line',t:'Data Analyst line',p:'212 people ride it. It crosses yours at Python (Pitstop 8). Shared pitstops are where people swap notes.',l:[],cta:[['See people','network']]},
    xcloud:{k:'Other line',t:'Cloud Engineer line',p:'164 people ride it. It crosses yours at AWS security (Pitstop 9).',l:[],cta:[['See people','network']]}
  };
  function txt(x,y,s,cls,anchor){ var t=el('text',{x:x,y:y,'class':cls||'', 'text-anchor':anchor||'middle'}); t.textContent=s; return t; }
  function drawMap(){
    map.innerHTML='';
    var grid=el('g',{'class':'m-grid'}); for(var gx=40;gx<1280;gx+=80) grid.appendChild(el('line',{x1:gx,y1:20,x2:gx,y2:540})); map.appendChild(grid);
    // other lines
    var o1=el('g',{'class':'m-x',tabindex:0,role:'button','aria-label':'Data Analyst line'}); o1.appendChild(el('path',{d:'M935 20 V540','class':'m-other'})); o1.appendChild(txt(949,534,'DATA ANALYST LINE','m-other-label','start')); o1.dataset.id='xdata'; map.appendChild(o1);
    var o2=el('g',{'class':'m-x',tabindex:0,role:'button','aria-label':'Cloud Engineer line'}); o2.appendChild(el('path',{d:'M1010 20 V310 L1240 540','class':'m-other'})); o2.appendChild(txt(996,40,'CLOUD ENGINEER LINE','m-other-label','end')); o2.dataset.id='xcloud'; map.appendChild(o2);
    // your line
    map.appendChild(el('path',{d:'M70 470 H400 L560 310 H1010 L1170 150 H1350','class':'m-track'}));
    var dn=el('path',{id:'mdone',d:'M70 470 H400 L480 390','class':'m-done',pathLength:1,'stroke-dasharray':'1 1','stroke-dashoffset':'0'}); map.appendChild(dn);
    var pr=el('path',{id:'mprep',d:'M480 390 L512 358','class':'m-prep'}); map.appendChild(pr);
    var dn2=el('path',{id:'mdone2',d:'M560 310 H592','class':'m-prep',style:'display:none'}); map.appendChild(dn2);
    // destination
    var dst=el('g',{'class':'m-dest'}); dst.appendChild(txt(1375,58,'Cyber Security Analyst','big','end')); dst.appendChild(txt(1375,82,'NEXT DESTINATION · NOT YOUR LAST','sm','end')); map.appendChild(dst);
    // interchange rings on shared stops
    [[935,310],[1010,310]].forEach(function(c){ map.appendChild(el('circle',{'class':'m-ring',cx:c[0],cy:c[1],r:16,fill:'none',stroke:'var(--muted)','stroke-width':2,'stroke-dasharray':'3 4',opacity:.6})); });
    // stations
    ST.forEach(function(s){
      var g=el('g',{'class':'m-st '+s.s,tabindex:0,role:'button','aria-label':(s.n?s.n+', ':'')+s.name}); g.dataset.id=s.id;
      if(s.cap){ g.appendChild(el('rect',{'class':'ring-sel',x:s.x-30,y:s.y-20,width:60,height:40,rx:20})); g.appendChild(el('rect',{'class':'cap',x:s.x-22,y:s.y-12,width:44,height:24,rx:12})); }
      else { g.appendChild(el('circle',{'class':'ring-sel',cx:s.x,cy:s.y,r:19})); g.appendChild(el('circle',{'class':'dot',cx:s.x,cy:s.y,r:10})); }
      if(s.lab==='right'){ var dy=s.dy||0; if(s.n) g.appendChild(txt(s.x+24,s.y-4+dy,s.n,'n','start')); g.appendChild(txt(s.x+24,s.y+16+dy,s.name,'','start')); }
      else if(s.lab==='br'){ if(s.n) g.appendChild(txt(s.x+14,s.y+36,s.n,'n','start')); g.appendChild(txt(s.x+14,s.y+56,s.name,'','start')); }
      else if(s.lab==='above'){ if(s.n) g.appendChild(txt(s.x,s.y-48,s.n,'n')); g.appendChild(txt(s.x,s.y-(s.cap?26:28),s.name)); }
      else { if(s.n) g.appendChild(txt(s.x,s.y+36,s.n,'n')); g.appendChild(txt(s.x,s.y+(s.n?56:40),s.name)); }
      map.appendChild(g);
    });
    // riders on the SIEM goal and at Python
    [[420,336,'SK'],[442,336,'RV'],[464,336,'+5'],[968,282,'AM']].forEach(function(r){ var g=el('g',{'class':'m-rider'}); g.appendChild(el('circle',{cx:r[0],cy:r[1],r:10})); g.appendChild(txt(r[0],r[1]+3,r[2])); map.appendChild(g); });
    // train
    var tr=el('g',{'class':'m-train',id:'mtrain',transform:'translate(512,316)'});
    tr.appendChild(el('circle',{'class':'m-pulse',cx:0,cy:42,r:14}));
    tr.appendChild(el('rect',{x:-30,y:-13,width:60,height:24,rx:12}));
    tr.appendChild(el('path',{d:'M-19 -5 h8 a2 2 0 0 1 2 2 v7 a2 2 0 0 1 -2 2 h-8 a2 2 0 0 1 -2 -2 v-7 a2 2 0 0 1 2 -2 z M-19 0 h12'}));
    tr.appendChild(txt(7,3,'YOU'));
    tr.appendChild(el('rect',{x:-1,y:11,width:2,height:20}));
    map.appendChild(tr);
    map.querySelectorAll('[data-id]').forEach(function(g){ g.addEventListener('click',function(){ select(g.dataset.id); }); g.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); select(g.dataset.id); } }); });
  }
  var sheet=$('sheet');
  function select(id){
    var d=INFO[id]; if(!d) return;
    map.querySelectorAll('.m-st').forEach(function(g){ g.classList.toggle('sel', g.dataset.id===id); });
    var h='<div class="sheet-anim" style="display:flex;flex-direction:column;gap:14px">';
    h+='<div class="kicker"><span class="label">'+d.k+'</span></div><h3>'+d.t+'</h3><p>'+d.p+'</p>';
    if(d.by) h+='<div class="proofline ok"><svg class="icon"><use href="#i-badge"/></svg><span><b>Proved by</b>'+d.by+'</span></div>';
    if(d.fill) h+='<div class="proofline"><svg class="icon"><use href="#i-award"/></svg><span><b>Fill this gap with</b>'+d.fill+'</span></div>';
    if(d.l.length){ h+=(/^(p\d|c\d)/.test(id)?'<span class="label">'+(d.lt||'Get ready: courses, videos and practice')+'</span>':'')+'<ul class="list">'+d.l.map(function(x){ return '<li><svg class="icon"><use href="#'+x[0]+'"/></svg><span>'+x[1]+'</span><small>'+x[2]+'</small></li>'; }).join('')+'</ul>'; }
    if(d.who){ h+='<div class="who"><svg class="icon" style="width:16px;height:16px"><use href="#i-users"/></svg>'+d.who+'</div>'; }
    if(d.cta){ h+='<div class="actions">'+d.cta.map(function(c,i){ return '<a class="btn '+(i===0?'btn-primary':'btn-ghost')+' btn-sm" href="#'+c[1]+'" data-go2="'+c[1]+'">'+c[0]+'<svg class="icon"><use href="#i-arrow"/></svg></a>'; }).join('')+'</div>'; }
    h+='</div>';
    sheet.innerHTML=h;
    sheet.querySelectorAll('[data-go2]').forEach(function(a){ a.addEventListener('click',function(e){ e.preventDefault(); go(a.dataset.go2); }); });
  }
  function drawDone(animate){
    var dn=$('mdone'); if(!dn) return;
    if(!animate || reduce){ dn.style.transition='none'; dn.setAttribute('stroke-dashoffset','0'); return; }
    dn.style.transition='none'; dn.setAttribute('stroke-dashoffset','1');
    var tr=$('mtrain'); tr.style.transition='none'; tr.style.opacity='0';
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ dn.style.transition='stroke-dashoffset 1.6s cubic-bezier(.3,.8,.2,1)'; dn.setAttribute('stroke-dashoffset','0'); setTimeout(function(){ tr.style.transition='opacity .4s'; tr.style.opacity='1'; },1300); }); });
  }
  // 0: learning SIEM (Pitstop 4) · 1: at Pitstop 5, prove SIEM · 2: SIEM goal met, learning ATT&CK
  var MSTAGE=0;
  var MST=[
    {mp:'M480 390 L512 358',mc:'m-prep',d2:'',tr:'translate(512,316)'},
    {mp:'M480 390 L560 310',mc:'m-done m-solid',d2:'M560 310 H630',tr:'translate(630,268)'},
    {mp:'M480 390 L560 310 H650',mc:'m-done m-solid',d2:'M650 310 H690',tr:'translate(690,268)'}
  ];
  function stLab(id,t){ var n=map.querySelector('[data-id="'+id+'"] text.n'); if(n) n.textContent=t; }
  function stCls(id,c){ var g=map.querySelector('[data-id="'+id+'"]'); if(g) g.setAttribute('class','m-st '+c+(g.classList.contains('sel')?' sel':'')); }
  function mapStage(n,quiet){
    MSTAGE=n; var c=MST[n];
    var mp=$('mprep'); if(!mp) return;
    mp.setAttribute('d',c.mp); mp.setAttribute('class',c.mc);
    var d2=$('mdone2'); d2.style.display= c.d2?'':'none'; if(c.d2) d2.setAttribute('d',c.d2);
    $('mtrain').setAttribute('transform',c.tr);
    stLab('p4', n>=1?'4 · LEARNED ✓':'4 · LEARN'); stCls('p4', n>=1?'done':'now');
    stLab('p5', n>=2?'5 · PROVED ✓':'5 · PROVE'); stCls('p5', n>=2?'done':n===1?'now':'future');
    stCls('p6', n===2?'now':'future');
    INFO.p4.k= n>=1?'Done · SIEM goal':'You are here · SIEM goal';
    INFO.p4.p= n>=1?'The free Splunk course plus 5 of 5 tasks: done. You are ready; Pitstop 5 fills the gap.':'The free Splunk course plus daily tasks: 2 of 5 done. This pitstop gets you ready. It does not fill the gap; Pitstop 5 does.';
    INFO.p5.k= n>=2?'Goal met · today':n===1?'You are here · SIEM goal':'Next · SIEM goal';
    INFO.p5.by= n>=2?(PROOF&&PROOF.by||'Skill check passed.'):'';
    INFO.p6.k= n===2?'You are here · Threat detection goal':'Next goal · Threat detection';
    if(!quiet) select(n===0?'p4':n===1?'p5':'p6');
  }
  function mapCleared(on){ mapStage(on?2:(count()===3?1:0)); }
  drawMap(); select('p4');
  $('replay').addEventListener('click',function(){ drawDone(true); });

  render();

  /* ---------- carried over: network, junction, profiles ---------- */
  function on(id,ev,fn){ var n=$(id); if(n) n.addEventListener(ev,fn); }
  document.querySelectorAll('.app [data-toggle]').forEach(function(b){ var t=b.dataset.toggle.split('|'); if(b.classList.contains('btn-primary')) b.dataset.primary='1'; b.addEventListener('click',function(){ var isFirst=b.textContent.trim()===t[0]; b.textContent=isFirst?t[1]:t[0]; if(isFirst){ b.classList.remove('btn-primary'); b.classList.add('btn-ghost'); } else if(b.dataset.primary==='1'){ b.classList.add('btn-primary'); b.classList.remove('btn-ghost'); } }); });
  document.querySelectorAll('.app [data-menu]').forEach(function(b){ b.addEventListener('click',function(e){ e.stopPropagation(); var m=b.closest('.pact-wrap').querySelector('.menu'); var open=m.classList.contains('open'); document.querySelectorAll('.menu.open').forEach(function(x){x.classList.remove('open');}); if(!open) m.classList.add('open'); }); });
  document.addEventListener('click',function(){ document.querySelectorAll('.menu.open').forEach(function(x){x.classList.remove('open');}); });
  on('t-find','change',function(e){ var v=e.target.closest('.vis'); v.querySelector('b').textContent=e.target.checked?'People can find you by name or handle.':'You are hidden from search.'; });
  document.querySelectorAll('.app [data-vote]').forEach(function(b){ b.addEventListener('click',function(){ var was=b.getAttribute('aria-pressed')==='true'; b.setAttribute('aria-pressed', was?'false':'true'); var n=b.parentNode.querySelector('b'); n.textContent=(+n.textContent)+(was?-1:1); }); });
  document.querySelectorAll('.app [data-save], .app .save').forEach(function(b){ b.addEventListener('click',function(){ b.setAttribute('aria-pressed', b.getAttribute('aria-pressed')==='true'?'false':'true'); }); });
  var pb=$('postbtn'), ta=$('compose');
  if(pb) pb.addEventListener('click',function(){ if(!ta.value.trim()){ ta.focus(); return; } pb.innerHTML='<svg class="icon"><use href="#i-check"/></svg>Posted'; pb.disabled=true; ta.value=''; setTimeout(function(){ pb.innerHTML='<svg class="icon"><use href="#i-arrow"/></svg>Post to Junction'; pb.disabled=false; },1800); });
  document.querySelectorAll('.app .ptype').forEach(function(g){ g.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b || b.dataset.st) return; g.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed', x===b?'true':'false');}); }); });
  on('seg-feed','click',function(e){ var b=e.target.closest('button'); if(!b) return; this.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed', x===b?'true':'false');}); var f=b.dataset.feed; document.querySelectorAll('.posts[data-feed]').forEach(function(l){ l.hidden=(l.dataset.feed!==f); }); $('feed-label').textContent = f==='interests' ? 'AI · Design · Marketing · Public speaking' : 'Cyber Security Analyst · 0 to 4 years'; });
  on('addint','submit',function(e){ e.preventDefault(); var ni=$('newint'), v=ni.value.trim(); if(!v) return; var a=document.createElement('a'); a.href='#i'; a.textContent=v; var n=document.createElement('span'); n.className='n'; n.textContent='0'; a.appendChild(n); $('interest-tags').appendChild(a); ni.value=''; });
  var se=$('statusedit'), ce=$('company-row'), ci=$('company'), ms=$('mycard-status');
  if(se){
    var stIcon={work:'i-brief',free:'i-pen',look:'i-search',study:'i-book'}, cur='look';
    var paint=function(){ if(cur==='none'){ ms.hidden=true; return; } ms.hidden=false; var t= cur==='work' ? 'Working at '+(ci.value.trim()||'your company') : cur==='free' ? 'Freelance' : cur==='study' ? 'Studying' : 'Looking for a next role'; ms.innerHTML='<svg class="icon"><use href="#'+stIcon[cur]+'"/></svg>'; ms.appendChild(document.createTextNode(t)); };
    on('mycard-edit','click',function(e){ e.preventDefault(); se.hidden=!se.hidden; });
    se.querySelector('.ptype').addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; se.querySelectorAll('[data-st]').forEach(function(x){x.setAttribute('aria-pressed', x===b?'true':'false');}); cur=b.dataset.st; ce.hidden=(cur!=='work'); if(cur==='work') ci.focus(); paint(); });
    ci.addEventListener('input',paint);
  }
  document.querySelectorAll('.app a[href^="#"]').forEach(function(a){ if(!a.dataset.go) a.addEventListener('click',function(e){ e.preventDefault(); }); });

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




  /* ---------- life line: second map ---------- */
  var life=$('lifesvg');
  var P_TRK=[
    {id:'role',y:70,name:'Journey',cls:'l-role',from:2023.45,to:2026.77},
    {id:'edu',y:160,name:'Education',cls:'l-edu',from:2020.5,to:2023.45},
    {id:'work',y:250,name:'Work',cls:'l-work',from:2024.0,to:2026.77},
    {id:'cert',y:340,name:'Certificates',cls:'l-cert',from:2025.6,to:2026.77},
    {id:'int',y:430,name:'Interests',cls:'l-int',from:2021.2,to:2026.77}
  ];
  var P_LST=[
    {id:'l1',k:'role',t:2023.45,n:'Journey started',d:'Jun 2023 · after your B.Sc.',pos:'a',anc:'start',h:'Your journey started',p:'Your working life began when you finished your first degree, so your journey starts here, not the day you joined CareerMetro.',tags:[]},
    {id:'l1b',k:'role',t:2026.67,n:'Joined CareerMetro',d:'Sep 2026',pos:'a',anc:'end',h:'Joined CareerMetro · heading for Cyber Security Analyst',p:'You set your next destination here. Pitstops and prep live on the Role line; this map keeps only the big moments.',tags:['Cyber Security Analyst']},
    {id:'l2',k:'edu',t:2020.5,n:'B.Sc. Computer Science',d:'Jul 2020',pos:'a',anc:'start',h:'B.Sc. Computer Science',p:'Savitribai Phule Pune University. Networking and operating systems papers count as evidence for two skills.',tags:['Networking basics','Linux']},
    {id:'l3',k:'edu',t:2023.45,n:'Graduated',d:'Jun 2023',pos:'a',h:'Graduated, first class',p:'Final-year project: a small intrusion log viewer in Python. It is why Python shows as weak, not missing.',tags:['Python scripting']},
    {id:'l4',k:'work',t:2024.0,n:'IT Support Intern',d:'Jan 2024',pos:'a',anc:'end',h:'IT Support Intern · Western Ghats Logistics',p:'Five months setting up laptops, accounts and the network device list.',tags:['Networking basics','Windows admin']},
    {id:'l5',k:'work',t:2024.45,n:'IT Support and Security Associate',d:'Jun 2024',pos:'b',anc:'start',h:'IT Support and Security Associate · Konkan Co-operative Bank',p:'Current role. First-line security alerts for 40 users, monthly vulnerability scans.',tags:['Vulnerability scans','Incident notes']},
    {id:'l6',k:'work',t:2025.3,n:'Took over security alerts',d:'Apr 2025',pos:'a',h:'Took over security alerts',p:'The moment the role started pointing at security. This is the line in your resume that your gaps quote.',tags:['Incident notes']},
    {id:'l7',k:'cert',t:2025.6,n:'Google Cybersecurity Certificate',d:'Aug 2025',pos:'b',anc:'start',h:'Google Cybersecurity Certificate',p:'Verified through its Credly badge. Counted toward Application security turning green.',tags:['Application security'],v:1},
    {id:'l9',k:'int',t:2021.2,n:'Photography',d:'Mar 2021',pos:'a',anc:'start',h:'Photography',p:'Weekend street photography; you run the college club page. Not a job skill, still part of you.',tags:[]},
    {id:'l10',k:'int',t:2023.8,n:'Public speaking',d:'Oct 2023',pos:'b',h:'Public speaking · Toastmasters Pune',p:'Eight speeches so far. It shows in interviews: Practice uses it for the "explain to a manager" questions.',tags:['Communication']},
    {id:'l11',k:'int',t:2024.9,n:'Business writing',d:'Dec 2024',pos:'a',h:'Business writing workshop',p:'Fed straight into work: your incident notes template came after this.',tags:['Communication','Incident notes']},
    {id:'l12',k:'int',t:2025.9,n:'AI for everyone',d:'Nov 2025',pos:'b',h:'AI for everyone (free course)',p:'Prompting and AI basics. You also follow AI on Junction. It will help with Python scripting later on your journey.',tags:['AI']}
  ];
  var P_LINKS=[['l11','l5','Writing workshop shaped your incident notes'],['l7','l1b','Certificate counted as proof for a gap']];
  var R_TRK=[
    {id:'role',y:70,name:'Journey',cls:'l-role',from:2011.55,to:2026.77},
    {id:'edu',y:160,name:'Education',cls:'l-edu',segs:[[2007.6,2011.45],[2022.0,2022.9]]},
    {id:'work',y:250,name:'Work',cls:'l-work',from:2011.6,to:2026.77},
    {id:'cert',y:340,name:'Certificates',cls:'l-cert',from:2012.4,to:2026.77},
    {id:'int',y:430,name:'Interests',cls:'l-int',from:2012.0,to:2026.77}
  ];
  var R_LST=[
    {id:'r1',k:'role',t:2011.55,n:'Journey started',d:'Jul 2011 · after your B.E.',pos:'a',anc:'start',h:'Your journey started',p:'First job straight after engineering. Fifteen years of work since.',tags:[]},
    {id:'r2',k:'role',t:2026.6,n:'Joined CareerMetro',d:'Aug 2026',pos:'a',anc:'end',h:'Joined CareerMetro · heading for Head of Security',p:'Next destination set. Two gaps left: board-level risk reporting and security budgeting.',tags:['Head of Security']},
    {id:'r3',k:'edu',t:2007.6,n:'B.E. Electronics',d:'Aug 2007',pos:'a',anc:'start',h:'B.E. Electronics and Telecommunication',p:'University of Mumbai.',tags:['Networking basics']},
    {id:'r4',k:'edu',t:2011.45,n:'Graduated',d:'Jun 2011',pos:'b',h:'Graduated',p:'Final-year project on campus Wi-Fi coverage.',tags:[]},
    {id:'r5',k:'edu',t:2022.0,n:'PG Diploma, Cyber Law',d:'Jan 2022',pos:'a',anc:'start',h:'PG Diploma in Cyber Law (part-time)',p:'Weekend course while working. Feeds the compliance side of the destination.',tags:['Compliance']},
    {id:'r6',k:'work',t:2011.6,n:'Junior Network Engineer',d:'Jul 2011',h:'Junior Network Engineer · Sahyadri Telecom',p:'Branch routers and switches across Maharashtra.',tags:['Networking']},
    {id:'r7',k:'work',t:2013.5,n:'Network Engineer',d:'Jun 2013',h:'Network Engineer · Sahyadri Telecom',p:'Owned the core network for 40 sites.',tags:['Routing','Firewalls']},
    {id:'r8',k:'work',t:2015.3,n:'Senior Network Engineer',d:'Apr 2015',h:'Senior Network Engineer · Vega Cloud',p:'Data-centre networks and the first firewall rule reviews.',tags:['Firewalls']},
    {id:'r9',k:'work',t:2018.2,n:'Infrastructure Lead',d:'Mar 2018',h:'Infrastructure Lead · Deccan Data Services',p:'Led a team of six; started the security operations desk.',tags:['Team lead']},
    {id:'r10',k:'work',t:2021.3,n:'Security Operations Lead',d:'Apr 2021',pos:'a',anc:'start',h:'Security Operations Lead · Konark Payments',p:'Ran the SOC through a PCI DSS audit.',tags:['SIEM','PCI DSS']},
    {id:'r11',k:'work',t:2024.2,n:'Security Manager',d:'Mar 2024',pos:'b',h:'Security Manager · Western Ghats Logistics',p:'Current role. Owns security for 1,200 staff.',tags:['Risk','Vendor security']},
    {id:'r12',k:'cert',t:2012.4,n:'CCNA',d:'May 2012',h:'Cisco CCNA',p:'Verified with the issuer.',tags:['Networking'],v:1},
    {id:'r13',k:'cert',t:2014.1,n:'CCNP',d:'Feb 2014',h:'Cisco CCNP',p:'Verified with the issuer.',tags:['Routing'],v:1},
    {id:'r14',k:'cert',t:2016.8,n:'CEH',d:'Oct 2016',h:'Certified Ethical Hacker',p:'Verified with the issuer.',tags:['Pen testing'],v:1},
    {id:'r15',k:'cert',t:2020.4,n:'CISSP',d:'May 2020',h:'CISSP',p:'Verified with the issuer.',tags:['Security management'],v:1},
    {id:'r16',k:'cert',t:2023.1,n:'AWS Security Specialty',d:'Feb 2023',pos:'a',h:'AWS Certified Security Specialty',p:'Verified through its Credly badge.',tags:['AWS security'],v:1},
    {id:'r17',k:'cert',t:2025.5,n:'ISO 27001 Lead Auditor',d:'Jul 2025',pos:'b',anc:'end',h:'ISO 27001 Lead Auditor',p:'Verified with the issuer.',tags:['Compliance'],v:1},
    {id:'r18',k:'int',t:2012.0,n:'Running',d:'Jan 2012',h:'Running',p:'Two half marathons a year.',tags:[]},
    {id:'r19',k:'int',t:2016.0,n:'Marathi theatre',d:'Jan 2016',h:'Marathi theatre',p:'Amateur stage group in Pune.',tags:['Public speaking']},
    {id:'r20',k:'int',t:2019.3,n:'Mentoring',d:'Apr 2019',h:'Mentoring juniors',p:'Mentors three people a year.',tags:['Leadership']},
    {id:'r21',k:'int',t:2025.2,n:'AI for security',d:'Mar 2025',pos:'b',h:'AI for security',p:'Reading and small experiments with AI in the SOC.',tags:['AI']}
  ];
  var R_LINKS=[['r19','r20','Theatre made mentoring easier'],['r10','r16','Cloud move at Konark led to the AWS certificate']];
  var LIFE={priya:{trk:P_TRK,lst:P_LST,links:P_LINKS,zoom:'all',first:'l11'}, ravi:{trk:R_TRK,lst:R_LST,links:R_LINKS,zoom:'recent',first:'r11'}};
  var LUSER='priya', LZOOM='all', TRK=P_TRK, LST=P_LST, LINKS=P_LINKS, LNOW=2026.77, LX0=170, LX1=1300;
  var LX=function(t){ return LX0+(t-2020)*160; };
  function lifeScale(){
    var A=Math.min.apply(null, TRK.map(function(tk){ return tk.segs?tk.segs[0][0]:tk.from; }));
    var END=LNOW+0.35, W=LX1-LX0, A0=Math.floor(A);
    if(LZOOM==='recent'){ var W0=LNOW-5; if(A<W0-0.3){ A0=W0; LX=function(t){ return LX0+(t-W0)/(END-W0)*W; }; return {from:W0, split:null}; } }
    if(END-A0<=7.2){ LX=function(t){ return LX0+(t-A0)/(END-A0)*W; }; return {from:A0, split:null}; }
    var S=LNOW-5, old=0.36;
    LX=function(t){ return t>=S ? LX0+old*W+(t-S)/(END-S)*(1-old)*W : LX0+(t-A0)/(S-A0)*old*W; };
    return {from:A0, split:S};
  }
  function lt(x,y,s,cls,anc){ var t=el('text',{x:x,y:y,'class':cls||'','text-anchor':anc||'middle'}); t.textContent=s; return t; }
  function yr(t){ return Math.floor(t); }
  var LCL={};
  function drawLife(){
    life.innerHTML=''; LCL={};
    var sc=lifeScale(), from=sc.from;
    // year grid + axis; labels thin out when years are narrow
    var lastX=-99, nx=LX(LNOW);
    for(var y=Math.ceil(from); y<=2026; y++){ var x=LX(y); life.appendChild(el('line',{x1:x,y1:36,x2:x,y2:490,'class':'l-grid'})); if(x-lastX>=56 && nx-x>=50){ life.appendChild(lt(x,522,String(y),'l-year')); lastX=x; } }
    if(sc.split){ var sx2=LX(sc.split); life.appendChild(el('rect',{x:LX0,y:36,width:sx2-LX0,height:454,'class':'l-old'})); life.appendChild(lt(LX0+8,484,'EARLIER YEARS, SHOWN SMALLER','l-oldlab','start')); }
    life.appendChild(el('line',{x1:LX0,y1:496,x2:LX(LNOW+0.35),y2:496,'class':'l-axis'}));
    life.appendChild(el('line',{x1:nx,y1:36,x2:nx,y2:496,'class':'l-now'})); life.appendChild(lt(nx,522,'NOW','l-year now'));
    // which moments are drawn, grouped or hidden
    var shown=[], hidden=[];
    TRK.forEach(function(tk){
      var items=LST.filter(function(s){ return s.k===tk.id; });
      var vis=items.filter(function(s){ return s.t>=from-0.01; }); hidden=hidden.concat(items.filter(function(s){ return s.t<from-0.01; }));
      if(sc.split){
        var old=vis.filter(function(s){ return s.t<sc.split; }), rest=vis.filter(function(s){ return s.t>=sc.split; });
        if(old.length>=3){
          var cid='cl-'+tk.id, nm={work:'roles',cert:'certificates',int:'interests',edu:'moments',role:'moments'}[tk.id];
          LCL[cid]={id:cid,k:tk.id,t:(old[0].t+old[old.length-1].t)/2,n:old.length+' '+nm,d:yr(old[0].t)+' to '+yr(old[old.length-1].t),pos:'a',items:old,cl:1};
          shown.push(LCL[cid]); old=[];
        }
        shown=shown.concat(old, rest);
      } else shown=shown.concat(vis);
    });
    // tracks
    TRK.forEach(function(tk){
      life.appendChild(lt(20,tk.y+5,tk.name.toUpperCase(),'l-tlab','start'));
      (tk.segs||[[tk.from,tk.to]]).forEach(function(sg){ if(sg[1]<from) return; life.appendChild(el('path',{d:'M'+LX(Math.max(sg[0],from))+' '+tk.y+' H'+LX(sg[1]),'class':'l-track '+tk.cls+(sg[0]<from?' cut':'')})); });
      if(tk.id==='role'){ life.appendChild(el('path',{d:'M'+LX(tk.to)+' '+tk.y+' H'+LX(LNOW+0.35),'class':'l-track l-role ahead'})); life.appendChild(lt(LX(LNOW+0.35)+8,tk.y+5,'Destination','l-dest','start')); }
    });
    // links (only when both ends are drawn on their own)
    var ids={}; shown.forEach(function(s){ ids[s.id]=s; });
    LINKS.forEach(function(l){
      var a=ids[l[0]], b=ids[l[1]]; if(!a||!b) return;
      var ya=TRK.filter(function(t){return t.id===a.k;})[0].y, yb=TRK.filter(function(t){return t.id===b.k;})[0].y, xa=LX(a.t), xb=LX(b.t);
      var g=el('path',{d:'M'+xa+' '+ya+' C'+xa+' '+((ya+yb)/2)+' '+xb+' '+((ya+yb)/2)+' '+xb+' '+yb,'class':'l-link'}); var tt=el('title',{}); tt.textContent=l[2]; g.appendChild(tt); life.appendChild(g);
    });
    // stations; in a row, labels alternate above and below
    TRK.forEach(function(tk){
      shown.filter(function(s){ return s.k===tk.id; }).sort(function(a,b){ return a.t-b.t; }).forEach(function(s,i){
        var y=tk.y, x=LX(s.t), pos=s.pos||(i%2?'b':'a');
        var g=el('g',{'class':'m-st l-st '+s.k+(s.cl?' l-cl':''),tabindex:0,role:'button','aria-label':s.n+', '+s.d}); g.dataset.lid=s.id;
        g.appendChild(el('circle',{'class':'ring-sel',cx:x,cy:y,r:s.cl?21:17}));
        g.appendChild(el('circle',{'class':'dot',cx:x,cy:y,r:s.cl?13:9}));
        if(s.cl) g.appendChild(lt(x,y+5,String(s.items.length),'l-cln'));
        var anc=s.anc||(x<LX0+60?'start':x>LX1-40?'end':'middle'), dx= anc==='start'?-8:anc==='end'?8:0;
        if(pos==='a'){ g.appendChild(lt(x+dx,y-40,s.d,'n',anc)); g.appendChild(lt(x+dx,y-19,s.n,'',anc)); }
        else { g.appendChild(lt(x+dx,y+36,s.n,'',anc)); g.appendChild(lt(x+dx,y+55,s.d,'n',anc)); }
        life.appendChild(g);
      });
    });
    life.querySelectorAll('[data-lid]').forEach(function(g){ g.addEventListener('click',function(){ selLife(g.dataset.lid); }); g.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); selLife(g.dataset.lid); } }); });
    // earlier moments outside the window
    var eb=$('life-earlier');
    if(hidden.length){ var y0=Math.min.apply(null,hidden.map(function(s){return s.t;})); eb.hidden=false; eb.innerHTML='<svg class="icon"><use href="#i-arrow"/></svg><span><b>'+hidden.length+' earlier moments</b>, '+yr(y0)+' to '+yr(from)+'</span><span class="link">Show whole career</span>'; }
    else eb.hidden=true;
    $('seg-zoom').querySelectorAll('button').forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.z===LZOOM?'true':'false'); });
    $('seg-lifeuser').querySelectorAll('button').forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.u===LUSER?'true':'false'); });
  }
  function selLife(id){
    var s=LCL[id]||LST.filter(function(x){return x.id===id;})[0]; if(!s) return;
    life.querySelectorAll('.l-st').forEach(function(g){ g.classList.toggle('sel', g.dataset.lid===id); });
    var tk=TRK.filter(function(t){return t.id===s.k;})[0], h;
    if(s.cl){
      h='<div class="sheet-anim" style="display:flex;flex-direction:column;gap:14px"><div class="kicker"><span class="label">'+tk.name+' · '+s.d+'</span></div><h3>'+s.n+'</h3><p>Grouped so the earlier years stay readable. Tap one to open it.</p><ul class="list">'+s.items.map(function(x){ return '<li class="l-row" data-lsub="'+x.id+'" role="button" tabindex="0"><svg class="icon"><use href="#i-'+(x.v?'badge':'route')+'"/></svg><span>'+x.n+'</span><small>'+x.d+'</small></li>'; }).join('')+'</ul><div class="actions"><button class="btn btn-ghost btn-sm" type="button" data-lzoom="recent">Last 5 years</button></div></div>';
      sheet.innerHTML=h;
      sheet.querySelectorAll('[data-lsub]').forEach(function(r){ r.addEventListener('click',function(){ selLife(r.dataset.lsub); }); });
      return;
    }
    h='<div class="sheet-anim" style="display:flex;flex-direction:column;gap:14px"><div class="kicker"><span class="label">'+tk.name+' · '+s.d+'</span></div><h3>'+s.h+'</h3><p>'+s.p+'</p>';
    if(s.tags.length) h+='<div style="display:flex;gap:6px;flex-wrap:wrap">'+s.tags.map(function(x){return '<span class="chip neutral">'+x+'</span>';}).join('')+'</div>';
    if(s.v) h+='<span class="chip met" style="align-self:flex-start"><svg class="icon"><use href="#i-badge"/></svg>Verified</span>';
    var lk=LINKS.filter(function(l){return l[0]===id||l[1]===id;});
    if(lk.length) h+='<p class="jd-note"><svg class="icon"><use href="#i-route"/></svg><span>'+lk.map(function(l){return l[2];}).join('. ')+'.</span></p>';
    h+='<div class="actions"><button class="btn btn-ghost btn-sm" type="button" data-lifeadd><svg class="icon"><use href="#i-plus"/></svg>Add a moment</button></div></div>';
    sheet.innerHTML=h;
    var b=sheet.querySelector('[data-lifeadd]'); if(b) b.addEventListener('click',function(){ toast('Add anything: a course, a hobby, a certificate, a talk. It lands on the right line by date.'); });
  }
  function setLife(u,z){
    var d=LIFE[u]; LUSER=u; LZOOM=z||d.zoom; TRK=d.trk; LST=d.lst; LINKS=d.links;
    drawLife(); selLife(d.first);
    var ms=document.querySelector('.map-scroll'); if(ms && ms.clientWidth<700) ms.scrollLeft=ms.scrollWidth;
  }
  on('seg-zoom','click',function(e){ var b=e.target.closest('button'); if(b) setLife(LUSER,b.dataset.z); });
  on('seg-lifeuser','click',function(e){ var b=e.target.closest('button'); if(b) setLife(b.dataset.u); });
  on('life-earlier','click',function(){ setLife(LUSER,'all'); });
  sheet.addEventListener('click',function(e){ var b=e.target.closest('[data-lzoom]'); if(b) setLife(LUSER,b.dataset.lzoom); });
  var MODE='role';
  function setMapMode(m){
    MODE=m; document.querySelector('.view-map').classList.toggle('life', m==='life');
    $('seg-mapmode').querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed', x.dataset.m===m?'true':'false'); });
    if(m==='life'){ setLife(LUSER,LZOOM); }
    else { select(STATE==='first'?'p1':(cleared?'p5':'p4')); }
  }
  on('seg-mapmode','click',function(e){ var b=e.target.closest('button'); if(!b) return; setMapMode(b.dataset.m); });

  /* ---------- arrivals ---------- */
  var ARR=[
    {id:'a1',co:'Deccan Data Services',role:'IT security associate',job:'j6',lane:1,date:'Tue 13 Oct · 6:00 pm',day:13,via:'Express apply',
     tl:[['done','Applied with Express apply','8 Oct'],['done','Shortlisted','9 Oct · criteria all met'],['now','Level 1 · AI video interview','Tue 13 Oct, 6:00 pm · 25 min'],['','Level 2 · with the team','date set after Level 1'],['','Offer','']],
     ai:{topics:['Windows admin: a locked-out account at 2 am','Incident notes: write one for a phishing click','How you explain a risk to a branch manager'],len:'25 min, 6 questions'}},
    {id:'a2',co:'Sahyadri Fintech',role:'IT support and security engineer',job:'j1',lane:2,date:'Fri 16 Oct · 11:00 am',day:16,via:'company site',
     tl:[['done','Applied on the company site','24 Sep'],['done','Shortlisted','29 Sep'],['done','Level 1 · AI video interview','6 Oct · moved to Level 2'],['now','Level 2 · panel with the IT team','Fri 16 Oct, 11:00 am · Baner office, Pune'],['','Offer','']],
     l2:'Bring: a printed resume and one ID. Two people from IT and one from HR. About 45 minutes.'},
    {id:'a3',co:'Konark Payments',role:'Security operations trainee',lane:0,date:'Pick a slot',day:0,via:'Express apply',need:1,
     tl:[['done','Applied with Express apply','5 Oct'],['now','Shortlisted','7 Oct · choose your Level 1 slot'],['','Level 1 · AI video interview',''],['','Level 2 · with the team',''],['','Offer','']],
     slots:[['Wed 14 Oct','10:00 am'],['Thu 15 Oct','7:30 pm'],['Sat 17 Oct','11:00 am']],
     ai:{topics:['Reading a firewall log','Phishing: what you check first','Why payments security'],len:'20 min, 5 questions'}}
  ];
  var LANES=['Shortlisted','Level 1 · AI interview','Level 2 · team','Offer'];
  var asel='a1';
  function arrById(id){ return ARR.filter(function(a){return a.id===id;})[0]; }
  function renderArr(){
    // next up
    var dated=ARR.filter(function(a){return a.day;}).sort(function(a,b){return a.day-b.day;}), n=dated[0];
    var nx=$('nextup');
    if(n){ var ai=n.lane===1;
      nx.innerHTML='<div class="when-big"><small>Oct</small><b>'+n.day+'</b><small>'+n.date.split(' ')[0]+'</small></div><div><span class="count-in">in '+(n.day-9)+' days</span><h3>'+(ai?'Level 1 AI interview':'Level 2 panel')+' · '+n.co+'</h3><p>'+n.role+' · '+n.date.split(' · ')[1]+(ai?' · on video, from anywhere':'')+'</p></div><div class="acts">'+(ai?'<button class="btn btn-primary btn-sm" type="button" data-arr-act="check"><svg class="icon"><use href="#i-play"/></svg>Check camera and mic</button><button class="btn btn-ghost btn-sm" type="button" data-arr-act="practice">Practice round</button>':'<button class="btn btn-ghost btn-sm" type="button" data-arr-act="cal"><svg class="icon"><use href="#i-cal"/></svg>Add to calendar</button>')+'</div>';
    }
    // week strip 9..18 Oct
    var days=['Fri','Sat','Sun','Mon','Tue','Wed','Thu','Fri','Sat','Sun'], wk='';
    for(var d=9; d<=18; d++){ var has=ARR.filter(function(a){return a.day===d;})[0]; wk+='<div class="wd2'+(has?' has':'')+(d===9?' today':'')+'"'+(has?' data-arr="'+has.id+'" role="button" tabindex="0" aria-label="'+has.co+' on '+d+' Oct"':'')+'><span>'+days[d-9]+'</span><b>'+d+'</b><i></i></div>'; }
    $('week2').innerHTML=wk;
    // lanes
    $('lanes').innerHTML=LANES.map(function(l,i){
      var cards=ARR.filter(function(a){return a.lane===i;});
      return '<div class="lane"><div class="lane-h">'+l+'<span class="n">'+cards.length+'</span></div>'+(cards.length? cards.map(function(a){ return '<button type="button" class="acard'+(a.id===asel?' sel':'')+'" data-arr="'+a.id+'"><span class="top"><span class="logo">'+initials(a.co)+'</span><b>'+a.role+'</b></span><small>'+a.co+' · via '+a.via+'</small><span class="dt'+(a.need?' need':'')+'">'+a.date+'</span></button>'; }).join('') : '<div class="lane-empty">'+(i===3?'Offers land here. Your line keeps going while you wait.':'Nothing here right now.')+'</div>')+'</div>';
    }).join('');
    var waiting=Object.keys(jstate.applied).filter(function(k){ return !ARR.some(function(a){return a.job===k;}); }).length;
    $('arr-wait').textContent= waiting ? waiting+' more applied, waiting to hear' : '';
    var tc=document.querySelectorAll('.arrcount'); tc.forEach(function(x){ x.textContent=ARR.length; });
    renderArrDetail();
  }
  function renderArrDetail(){
    var a=arrById(asel), dd=$('arrdetail'); if(!a){ dd.innerHTML=''; return; }
    var h='<div class="sheet-anim" style="display:flex;flex-direction:column;gap:16px">';
    h+='<div class="jd-head"><span class="logo">'+initials(a.co)+'</span><div><h3>'+a.role+'</h3><small>'+a.co+' · via '+a.via+'</small></div></div>';
    h+='<ol class="atl">'+a.tl.map(function(t){ return '<li class="'+t[0]+'"><span class="td"></span><div><b>'+t[1]+'</b>'+(t[2]?'<small>'+t[2]+'</small>':'')+'</div></li>'; }).join('')+'</ol>';
    if(a.slots){ h+='<div class="jd-sec"><h4>Pick your Level 1 slot</h4><div class="slots">'+a.slots.map(function(s,i){ return '<button type="button" data-slot="'+i+'">'+s[0]+', '+s[1]+'<small>AI video · 20 min</small></button>'; }).join('')+'</div></div>'; }
    if(a.ai){
      h+='<div class="aibox"><div class="aibox-h"><svg class="icon" style="width:16px;height:16px"><use href="#i-q"/></svg><b>About Level 1: AI video interview</b></div><span style="font-size:0.84rem">An AI interviewer asks the questions '+a.co+' set for this role. '+a.ai.len+'. Topics they shared:</span><ul>'+a.ai.topics.map(function(t){return '<li>'+t+'</li>';}).join('')+'</ul>';
      h+='<div class="rules"><span><svg class="icon"><use href="#i-check"/></svg>You are told it is an AI before it starts.</span><span><svg class="icon"><use href="#i-check"/></svg>Recorded only if you agree; you can ask for a person instead.</span><span><svg class="icon"><use href="#i-check"/></svg>A person at '+a.co+' watches it and makes the decision.</span></div>';
      h+='<div class="actions" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" type="button" data-arr-act="practice"><svg class="icon"><use href="#i-play"/></svg>Practice round</button><span class="elite" style="align-self:center">Elite</span></div></div>';
    }
    if(a.l2) h+='<div class="aibox"><div class="aibox-h"><svg class="icon" style="width:16px;height:16px"><use href="#i-users"/></svg><b>Level 2 · in person</b></div><span style="font-size:0.84rem">'+a.l2+'</span><div class="actions" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" type="button" data-arr-act="cal"><svg class="icon"><use href="#i-cal"/></svg>Add to calendar</button><button class="btn btn-quiet btn-sm" type="button" data-arr-act="ask">Ask someone who works there</button></div></div>';
    h+='<p class="jd-note"><svg class="icon"><use href="#i-shield"/></svg><span>Dates come from the company. Reschedule or withdraw any time; it only tells '+a.co+'.</span></p><div class="actions" style="display:flex;gap:8px"><button class="btn btn-quiet btn-sm" type="button" data-arr-act="resched">Reschedule</button><button class="btn btn-quiet btn-sm" type="button" data-arr-act="withdraw">Withdraw</button></div></div>';
    dd.innerHTML=h;
  }
  function arrClick(e){
    var c=e.target.closest('[data-arr]'); if(c){ asel=c.dataset.arr; renderArr(); if(app.getBoundingClientRect().width<760) $('arrdetail').scrollIntoView({block:'start', behavior: reduce?'auto':'smooth'}); return; }
    var s=e.target.closest('[data-slot]'); if(s){ var a=arrById(asel), sl=a.slots[+s.dataset.slot]; a.lane=1; a.date=sl[0]+' · '+sl[1]; a.day=parseInt(sl[0].split(' ')[1],10); a.need=0; delete a.slots; a.tl[1]=['done','Shortlisted','7 Oct']; a.tl[2]=['now','Level 1 · AI video interview',sl[0]+', '+sl[1]+' · 20 min']; renderArr(); toast('Booked: '+sl[0]+', '+sl[1]+'. Konark Payments has been told.'); return; }
    var b=e.target.closest('[data-arr-act]'); if(!b) return;
    var act=b.dataset.arrAct;
    if(act==='check') toast('Camera, mic and connection look good.');
    else if(act==='practice') toast('Elite: a practice round with the same kind of AI interviewer and the company\'s topics.');
    else if(act==='cal') toast('Added to your calendar with a reminder the evening before.');
    else if(act==='ask') go('network');
    else if(act==='resched') toast('Pick a new slot; the company sees only the change.');
    else if(act==='withdraw') toast('In the real app this asks you to confirm first.');
  }
  document.querySelector('.view-arr').addEventListener('click',arrClick);
  document.querySelector('.view-arr').addEventListener('keydown',function(e){ if((e.key==='Enter'||e.key===' ') && e.target.closest('.wd2[data-arr]')){ e.preventDefault(); arrClick(e); } });
  renderArr();

  /* ---------- timetable: local events ---------- */
  var EVT=[
    {id:'e1',d:11,m:'Oct',w:'Sat',g:'This week',t:'Hunting with a SIEM: hands-on lab night',k:'Workshop',org:'Pune Security Meetup',where:'Baner, Pune',km:6,time:'5 to 8 pm',cost:'Free',on:0,tags:[['goal','SIEM']],prep:'Counts as a prep task for Pitstop 4 (learn SIEM).',go:14},
    {id:'e2',d:14,m:'Oct',w:'Tue',g:'This week',t:'MITRE ATT&CK mapping for beginners',k:'Online',org:'Blue Team Circle',where:'Online',km:0,time:'7 pm IST',cost:'Free',on:1,tags:[['goal','Threat detection']],prep:'Warms you up for Pitstop 6.',go:31},
    {id:'e3',d:18,m:'Oct',w:'Sat',g:'Later in October',t:'AI Builders Pune: monthly demo night',k:'Meetup',org:'AI Builders Pune',where:'Kharadi, Pune',km:14,time:'6 to 9 pm',cost:'Free',on:0,tags:[['int','AI']],go:9},
    {id:'e4',d:26,m:'Oct',w:'Sun',g:'Later in October',t:'Public speaking club, open session',k:'Meetup',org:'Kothrud Speakers Club',where:'Kothrud, Pune',km:11,time:'10 am to 12 pm',cost:'₹200',on:0,tags:[['int','Public speaking']],go:3},
    {id:'e5',d:14,m:'Nov',w:'Fri',g:'November',t:'West India Cyber Security Summit (sample)',k:'Conference',org:'Two days, 40 talks',where:'Mumbai',km:150,time:'14 and 15 Nov',cost:'₹1,500 student pass',on:0,tags:[['goal','SIEM'],['goal','Threat detection'],['goal','AWS security']],go:22},
    {id:'e6',d:22,m:'Nov',w:'Sat',g:'November',t:'Python for log analysis',k:'Workshop',org:'PyData Pune volunteers',where:'Hinjewadi, Pune',km:18,time:'2 to 5 pm',cost:'Free',on:0,tags:[['goal','Python']],prep:'Counts as a prep task for your Python goal.',go:7},
    {id:'e7',d:27,m:'Nov',w:'Thu',g:'November',t:'Design for non-designers',k:'Online',org:'Design Circle India',where:'Online',km:0,time:'6:30 pm IST',cost:'Free',on:1,tags:[['int','Design']],go:5}
  ];
  var EVF={f:'all',online:true,far:false}, EVSAVED={};
  function evtCard(e){
    var tags=e.tags.map(function(t){ return '<span class="evt-tag"><svg class="icon"><use href="#'+(t[0]==='goal'?'i-target':'i-bulb')+'"/></svg>'+(t[0]==='goal'?'Goal: ':'Interest: ')+t[1]+'</span>'; }).join('');
    var sv=!!EVSAVED[e.id];
    return '<article class="evt"><div class="evt-date"><span>'+e.w+'</span><b>'+e.d+'</b><span>'+e.m+'</span></div><div class="evt-body">'
      +'<div class="evt-top"><h4>'+e.t+'</h4><span class="evt-kind">'+e.k+'</span></div>'
      +'<div class="evt-meta"><span><svg class="icon"><use href="#'+(e.on?'i-play':'i-pin')+'"/></svg>'+e.where+(e.km>25?' · '+e.km+' km away':'')+'</span><span><svg class="icon"><use href="#i-clock"/></svg>'+e.time+'</span><span>'+e.cost+'</span><span><svg class="icon"><use href="#i-users"/></svg>'+e.org+'</span></div>'
      +'<div class="evt-why1">'+tags+'</div>'
      +(e.prep?'<div class="evt-prep">'+e.prep+'</div>':'')
      +'<div class="actions"><button type="button" class="btn btn-ghost btn-sm" aria-pressed="'+sv+'" data-evsave="'+e.id+'"><svg class="icon"><use href="#'+(sv?'i-check':'i-bookmark')+'"/></svg>'+(sv?'Going':'I\'m going')+'</button><button type="button" class="btn btn-quiet btn-sm" data-evcal="'+e.id+'"><svg class="icon"><use href="#i-cal"/></svg>Add to calendar</button><span class="evt-far">'+e.go+' people on CareerMetro going</span></div>'
      +'</div></article>';
  }
  function renderEvt(){
    var L=$('evt-list'); if(!L) return;
    var list=EVT.filter(function(e){
      if(EVF.f!=='all' && !e.tags.some(function(t){return t[0]===EVF.f;})) return false;
      if(e.on && !EVF.online) return false;
      if(!e.on && e.km>25 && !EVF.far) return false;
      return true;
    });
    var h='', g='';
    list.forEach(function(e){ if(e.g!==g){ g=e.g; h+='<p class="evt-group">'+g+'</p>'; } h+=evtCard(e); });
    var hidden=EVT.filter(function(e){ return !e.on && e.km>25; }).length;
    if(!EVF.far && hidden) h+='<p class="evt-far">'+hidden+' more outside 25 km. Turn on "Show outside 25 km" to see them.</p>';
    L.innerHTML= h || '<div class="evt-empty">Nothing matches right now. Add a goal or an interest and the Timetable fills in.</div>';
  }
  on('evt-seg','click',function(e){ var b=e.target.closest('button'); if(!b) return; this.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed', x===b?'true':'false'); }); EVF.f=b.dataset.f; renderEvt(); });
  on('evt-online','change',function(e){ EVF.online=e.target.checked; renderEvt(); });
  on('evt-far','change',function(e){ EVF.far=e.target.checked; renderEvt(); });
  on('evt-list','click',function(e){
    var s=e.target.closest('[data-evsave]'); if(s){ var id=s.dataset.evsave; EVSAVED[id]=!EVSAVED[id]; renderEvt(); var ev=EVT.filter(function(x){return x.id===id;})[0]; toast(EVSAVED[id] ? 'Saved. '+(ev.prep?'Tick it on Today after you go.':'It shows on your profile under Interests.') : 'Removed from your plans.'); return; }
    var c=e.target.closest('[data-evcal]'); if(c){ toast('Added to your calendar, with a reminder the day before.'); }
  });
  on('evt-where','click',function(){ toast('Change your city and distance in your profile settings.'); });
  on('evt-suggest','click',function(){ toast('Thanks. It goes live after a quick check.'); });
  on('evt-digest','change',function(e){ toast(e.target.checked?'Monday digest on.':'Monday digest off.'); });
  renderEvt();

  /* ---------- your stories: work sorted by what interviewers ask ---------- */
  var COMP=['Ownership','Problem solving','Delivering results','Learning','Working with others','Speaking up'];
  var LENS={
    common:{n:'Common principles',m:{}}
  };
  var STORIES=[
    {c:['Ownership','Working with others'],t:'Kept 3 branches safe with no SOC',src:'Konkan Co-operative Bank · 2024 to now',ok:1,smart:'SMART',s:'Three branches, 40 users, no security team.',k:'Be the first line for every security alert.',a:'Set up a daily alert check and an escalation list with the vendor.',r:'No critical alert missed in 2 years; average response under 1 hour.'},
    {c:['Problem solving','Delivering results'],t:'Cut open critical findings from 14 to 2',src:'Konkan Co-operative Bank · 2025',ok:1,smart:'SMART',s:'Monthly scans kept showing the same critical findings.',k:'Get them fixed, not just reported.',a:'Ranked them with CVSS, agreed fix dates with the vendor and tracked them every week.',r:'14 open critical findings down to 2 in 6 months.'},
    {c:['Delivering results','Working with others'],t:'Wrote the incident notes template the team still uses',src:'Konkan Co-operative Bank · 2024',ok:0,smart:'SAT',hint:'Add a number to make it Measurable, e.g. how many incidents used it.',s:'Each person wrote incident notes differently.',k:'Make them easy to read in an audit.',a:'Drafted a one-page template and walked the team through it.',r:'The whole IT team uses it.'},
    {c:['Learning'],t:'Taught myself SIEM searches on real attack data',src:'SIEM goal · Pitstop 4 · Oct 2026',ok:0,auto:1,smart:'SMAT',hint:'Fills in when you prove SIEM. Then it is Relevant to every SOC role.',s:'No SIEM at work, but every SOC post asks for one.',k:'Learn to find attacks in Splunk.',a:'Free Splunk course, then searches on the BOTS v3 dataset.',r:'Found 4 of 5 planted attacks on the practice data.'},
    {c:['Delivering results'],t:'Set up 60 laptops in two weeks',src:'Western Ghats Logistics · internship 2024',ok:0,smart:'SMAT',hint:'Say why it mattered, so it is Relevant to the role you want.',s:'A new office opened with no IT staff.',k:'Get 60 people working on day one.',a:'Wrote a setup checklist and imaged machines in batches.',r:'All 60 ready in 10 working days.'}
  ];
  var SLENS='common', SVIEW='board';
  function smartHTML(s){ return '<span class="smart" aria-label="SMART check">'+'SMART'.split('').map(function(ch){ return '<i class="'+(s.indexOf(ch)>=0?'on':'')+'">'+ch+'</i>'; }).join('')+'</span>'; }
  function storyCard(x){
    return '<details class="story"><summary><b>'+x.t+'</b><small>'+x.src+'</small><span class="story-tags">'+smartHTML(x.smart)+(x.ok?'<span class="story-ok"><svg class="icon"><use href="#i-badge"/></svg>Confirmed</span>':'')+(x.auto?'<span class="story-auto">From your goal</span>':'')+'</span></summary>'
      +'<dl class="star"><dt>Situation</dt><dd>'+x.s+'</dd><dt>Task</dt><dd>'+x.k+'</dd><dt>Action</dt><dd>'+x.a+'</dd><dt>Result</dt><dd>'+x.r+'</dd></dl>'
      +(x.hint?'<p class="story-hint">'+x.hint+'</p>':'')+'</details>';
  }
  function storiesHTML(st){
    if(st==='noresume') return '<div class="me-empty"><svg class="icon"><use href="#i-pen"/></svg><span>Your stories fill in from your resume, college projects, internships and goals you prove. Starting out? One college project you are proud of is a great first story.</span><button class="btn btn-ghost btn-sm" type="button" data-story-add>Add a story</button></div>';
    var L=LENS[SLENS], list= st==='first' ? STORIES.filter(function(x){return x.ok;}).slice(0,2) : STORIES;
    var h='<div class="stories st-'+SVIEW+'">';
    COMP.forEach(function(c){
      var cs=list.filter(function(x){ return x.c.indexOf(c)>=0; });
      h+='<section class="st-col"><div class="st-h"><b>'+c+'</b><span class="n">'+cs.length+'</span>'+(L.m[c]?'<small>'+L.m[c]+'</small>':'')+'</div>';
      h+= cs.length ? cs.map(storyCard).join('') : '<div class="st-empty">No story yet. Think of a time you '+({'Speaking up':'disagreed with a decision and said so','Learning':'learned something fast for work','Ownership':'took charge without being asked'}[c]||'did this')+'.<button class="nfm" type="button" data-story-add>Add one</button></div>';
      h+='</section>';
    });
    return h+'</div>';
  }
  function renderStories(st){ if(!STORIES) return; var n=$('me-stories'); if(n) n.innerHTML=storiesHTML(st||STATE); var c=$('me-storycount'); if(c) c.textContent= (st||STATE)==='noresume' ? 'none yet' : ((st||STATE)==='first'?2:STORIES.length)+' stories · 1 box empty'; }
  on('st-view','click',function(e){ var b=e.target.closest('button'); if(!b) return; this.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed', x===b?'true':'false'); }); SVIEW=b.dataset.sv; renderStories(); });
  document.addEventListener('click',function(e){
    if(e.target.closest('[data-story-add]')) toast('Pick a role, project or goal. We draft it as Situation, Task, Action, Result; you edit it before it is saved.');
  });
  renderStories();

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

})();
</script>
