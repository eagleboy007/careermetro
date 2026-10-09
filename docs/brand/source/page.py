import sys, re
sys.path.insert(0,'.')
from gen import mark, word, F, text_path, COBALT, COBALT_D, INK, PAPER, NIGHT
B='/mnt/project-files/careermetro/brand/'
def f(n): 
    s=open(B+n).read()
    return re.sub(r' width="[\d.]+" height="[\d.]+"','',s,count=1)
# theme-aware lockup using CSS vars
def tlock(h=44):
    S=1.25; pad=4; Bl=40+pad; mx=pad-0.8*S; my=Bl+1-38.2*S
    d,w=text_path(F,'careermetro',40,mx+46.6*S+9,Bl,-0.03)
    g='<g transform="translate(%g %g) scale(%g)"><path d="M8 31H18L32 17H40" fill="none" stroke="var(--ink)" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="31" r="4.8" fill="var(--bg)" stroke="var(--ink)" stroke-width="4.4"/><circle cx="40" cy="17" r="6.6" fill="var(--accent)"/></g>'%(mx,my,S)
    return '<svg viewBox="0 0 %g 60" style="height:%dpx;width:auto" role="img" aria-label="careermetro">%s<path d="%s" fill="var(--ink)"/></svg>'%(w+6,h,g,d)
def tmark(px, grid=False):
    g=''
    if grid:
        for i in range(0,49,4): g+='<path d="M%d 0V48M0 %dH48" stroke="var(--line)" stroke-width="0.15"/>'%(i,i)
        g+='<path d="M18 31L32 17" stroke="var(--accent)" stroke-width="0.25" stroke-dasharray="1 1"/><circle cx="24" cy="24" r="22" fill="none" stroke="var(--line)" stroke-width="0.2"/>'
    return '<svg viewBox="0 0 48 48" width="%d" height="%d" role="img" aria-label="careermetro mark">%s<path d="M8 31H18L32 17H40" fill="none" stroke="var(--ink)" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="31" r="4.8" fill="var(--bg)" stroke="var(--ink)" stroke-width="4.4"/><circle cx="40" cy="17" r="6.6" fill="var(--accent)"/></svg>'%(px,px,g)
alt1='<svg viewBox="0 0 48 48" width="96" height="96" aria-hidden="true"><path d="M33.5 12.5A15 15 0 1 0 35 34" fill="none" stroke="var(--muted)" stroke-width="5" stroke-linecap="round"/><circle cx="35.5" cy="12.5" r="5.5" fill="var(--muted)"/></svg>'
alt2='<svg viewBox="0 0 48 48" width="96" height="96" aria-hidden="true"><path d="M6 34H18L30 22V8M6 22H42" fill="none" stroke="var(--muted)" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="22" r="6" fill="var(--surface)" stroke="var(--muted)" stroke-width="4"/></svg>'
alt3='<svg viewBox="0 0 48 48" width="96" height="96" aria-hidden="true"><rect x="5" y="5" width="38" height="38" rx="19" fill="none" stroke="var(--muted)" stroke-width="4.4"/><path d="M5 24H43" stroke="var(--muted)" stroke-width="7"/></svg>'

html=open('page.html').read()
for k,v in {'{{LOCK}}':tlock(44),'{{LOCK_SM}}':tlock(26),'{{MARK_GRID}}':tmark(320,True),'{{MARK_96}}':tmark(96),'{{MARK_48}}':tmark(48),'{{MARK_24}}':tmark(24),
  '{{LOGO}}':f('logo.svg'),'{{LOGO_DARK}}':f('logo-on-dark.svg'),'{{LOGO_COBALT}}':f('logo-on-cobalt.svg'),'{{STACK}}':f('logo-stacked.svg'),
  '{{ICON}}':f('app-icon.svg'),'{{ICON_N}}':f('app-icon-night.svg'),'{{FAV}}':f('favicon.svg'),'{{SOCIAL}}':f('social-card.svg'),
  '{{ALT1}}':alt1,'{{ALT2}}':alt2,'{{ALT3}}':alt3}.items(): html=html.replace(k,v)
open('/mnt/project-files/careermetro/brand/careermetro-brand.html','w').write(html)
print(len(html))
