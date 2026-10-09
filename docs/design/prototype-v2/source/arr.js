
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
