
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
