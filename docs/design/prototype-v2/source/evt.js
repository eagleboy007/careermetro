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
