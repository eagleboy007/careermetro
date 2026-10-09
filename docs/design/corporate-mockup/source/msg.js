  /* ---------- messages ---------- */
  var calOn=true, curCo='t-kav', curMe='t-kav', meFilter='all', pickOpen=false, picks={};
  var PROWS=[1,4,6,7]; // rows offered in the candidate's picker: 11:00, 15:00, 17:00, 18:00
  var TH={
    't-kav':{id:'t-kav',kind:'app',cand:'c1',job:'soc',co:'Kavach Cyber Labs',msgs:[
      {by:'sys',t:'Conversation started when Priya applied with Express apply, 3 Oct.'},
      {by:'co',who:'Rahul Menon',t:'Hi Priya, thanks for doing the AI round. The team would like a 45-minute Level 2 call with our SOC lead next week.',at:'Wed 16:10'},
      {by:'co',who:'Rahul Menon',type:'times',state:'open',t:'Which times work for you between Mon 13 and Fri 17 Oct?',at:'Wed 16:11'}
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
      var h='<div class="rcard'+(mine?' me':'')+'"><span class="label">'+ic('cal','sm')+' Asking for interview times</span><p class="small">'+esc(m.t)+'</p>';
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
        h+='<span class="small">'+esc((candOf(th)||{n:''}).n.split(' ')[0])+' offered '+m.picks.length+' times: '+m.picks.map(slotName).join(' · ')+'</span>';
        if(side==='co') h+='<div><button class="btn sm" type="button" data-act="tosched">'+ic('cal','sm')+'Pick one and schedule</button></div>';
      }
      return h+'<span class="meta">'+esc(name)+' · '+esc(m.at)+'</span></div>';
    }
    return '<div class="msg'+(mine?' me':'')+'">'+(m.type==='question'?'<span class="label">Question</span>':'')+'<div class="bub">'+esc(m.t)+'</div><span class="meta">'+esc(name)+' · '+esc(m.at||'now')+'</span></div>';
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
      if(a==='sendpick'){ var ks=Object.keys(picks); var m=th.msgs.filter(function(x){return x.type==='times' && x.state==='open';}).pop(); m.state='done'; m.picks=ks; FREE={}; ks.forEach(function(k){FREE[k]=1;}); pickOpen=false; th.msgs.push({by:'cand',who:candOf(th).n,t:'I have offered '+ks.length+' times. Any of them works.',at:'now'}); th.unreadCo=true; rerender(); toast('Sent. Kavach sees only the times you picked.'); }
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
