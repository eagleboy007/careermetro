D='/tmp/claude-0/-home-user-careermetro/edce0ed9-cd7f-5659-bd39-8b819d4b05e1/scratchpad/v2/'
s=open('/mnt/project-files/careermetro/post-login-home-fable-v1.html').read()
style=s[s.index('<style>')+7:s.index('</style>')]
syms=s[s.index('<svg width="0"'):s.index('</svg>\n\n<div class="page">')]
views=s[s.index('<div class="view view-network"'):s.index('<nav class="tabs"')]
views=views.replace('href="#home" data-go="home">Back to Home','href="#today" data-go="today">Back to Today').replace('Library, Resume builder and your own Profile get their own mocks next. Home, Network, Junction and another person\'s profile are drawn so far.','Library and the Resume builder get their own mocks next.')
ARJUN_EXP='''            <section class="me-sec" aria-label="Arjun's experience">
              <div class="me-h"><h3>Experience</h3><span class="label">3 years 1 month</span></div>
              <ol class="exp">
                <li><span class="logo">KC</span><div class="exp-main"><div class="exp-top"><b>Security Analyst</b><span class="exp-now">Current</span></div><div class="exp-meta">Kavach Cyber Labs · Bengaluru · Mar 2026 to now · 7 months</div><ul><li>Works SOC shifts on SIEM alerts for 12 client companies</li><li>Moved from SOC L1 to analyst in his first year</li></ul></div></li>
                <li><span class="logo">KC</span><div class="exp-main"><div class="exp-top"><b>SOC Analyst L1</b></div><div class="exp-meta">Kavach Cyber Labs · Bengaluru · Mar 2025 to Feb 2026 · 1 year</div></div></li>
                <li><span class="logo">MS</span><div class="exp-main"><div class="exp-top"><b>Desktop Support Engineer</b></div><div class="exp-meta">Malabar Systems · Kochi · Sep 2023 to Feb 2025 · 1 year 6 months</div><span class="exp-ev"><svg class="icon"><use href="#i-route"/></svg>Started where you are now: support role, then this line</span></div></li>
              </ol>
            </section>
'''
views=views.replace('''            </section>
          </div>

          <aside class="prail" aria-label="About Arjun">''','''            </section>

'''+ARJUN_EXP+'''          </div>

          <aside class="prail" aria-label="About Arjun">''')
views=views.replace('<div class="view view-other">', open(D+'jobs.html').read()+open(D+'arr.html').read()+open(D+'evt.html').read()+open(D+'me.html').read()+'        <div class="view view-other">')
extra_sym='''  <symbol id="i-train" viewBox="0 0 24 24"><path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/></symbol>
  <symbol id="i-map" viewBox="0 0 24 24"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/></symbol>
  <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></symbol>
  <symbol id="i-code" viewBox="0 0 24 24"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></symbol>
  <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></symbol>
  <symbol id="i-zap" viewBox="0 0 24 24"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></symbol>
  <symbol id="i-pin" viewBox="0 0 24 24"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></symbol>
'''
newcss=open(D+'new.css').read()+open(D+'me.css').read()+open(D+'jobs.css').read()+open(D+'arr.css').read()+open(D+'evt.css').read()+'''
.ml-dot{position:absolute; top:40px; width:16px; height:16px; border-radius:50%; transform:translate(-50%,-50%); background:var(--surface); border:3px solid var(--line); transition:background .4s, border-color .4s;}
.ml-dot.done{background:var(--accent); border-color:var(--accent);}
.ml-dot.big{width:20px; height:20px; border-radius:7px;}
.ml-lab{position:absolute; top:54px; transform:translateX(-50%); font-family:var(--mono); font-size:0.66rem; color:var(--muted); letter-spacing:.04em; text-transform:uppercase; white-space:nowrap;}
.ml-lab.on{color:var(--ink); font-weight:600;}
.train{top:-6px;}
.pulse{top:32px;}
.m-st text, .m-other-label, .m-dest text{paint-order:stroke; stroke:var(--surface); stroke-width:4px; stroke-linejoin:round;}
.m-train{transition:transform .9s cubic-bezier(.3,.9,.2,1);}
@container app (max-width: 760px){ .ml-lab{display:none;} .ml-lab.on{display:block;} .ml-dot{width:12px; height:12px;} }
'''
out='<title>CareerMetro Prototype v2</title>\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..700&family=Geist:wght@400..600&family=Geist+Mono:wght@400;500&display=swap">\n<style>'+style+newcss+'</style>\n\n'+syms+extra_sym+'</svg>\n\n'+open(D+'top.html').read()+'\n        '+views+open(D+'bottom.html').read()+'\n'+open(D+'app.js').read()
import re
# rename "stop" to "pitstop" in visible text (Milin, 2026-10-08); skip CSS classes, ids, SVG <stop>, JS identifiers
_si=out.index('<style>'); _se=out.index('</style>')+8
def _pit(m):
    w=m.group(0); return {'Stop':'Pitstop','Stops':'Pitstops','stop':'pitstop','stops':'pitstops','STOP':'PITSTOP'}[w]
_body=re.sub(r"(?<![\w.#</-])(Stops?|STOP)(?![\w{:'\"-])", _pit, out[_se:])
_body=re.sub(r"(?<![\w.#'\"</-])(stops?)(?![\w{:\"-])", _pit, _body)
out=out[:_se]+_body
open('/mnt/project-files/careermetro/careermetro-prototype-v2.html','w').write(out)
print(len(out))