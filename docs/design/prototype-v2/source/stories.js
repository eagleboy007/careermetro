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
