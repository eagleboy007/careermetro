import re,sys
sys.argv=['x'];exec(open('genb.py').read().split("out='/mnt")[0])
def sized(svgtxt,w):
    s=re.sub(r' width="[\d.]+" height="[\d.]+"','',svgtxt,count=1)
    return s.replace('<svg ','<svg style="width:%spx;max-width:100%%;height:auto" '%w,1)
def ttile(px,flip=False):
    t=tile('var(--flap-top)','var(--flap-bot)','#fff','x')
    if flip: t=t.replace('<g clip-path="url(#t','<g class="flip-top" clip-path="url(#t',1)
    return '<svg viewBox="0 0 48 48" width="%d" height="%d" role="img" aria-label="careermetro mark">%s</svg>'%(px,px,t)
def tlock(w):
    S=1.15;pad=6;T=48*S
    body=tile('var(--flap-top)','var(--flap-bot)','#fff','x',pad-4*S,pad-4*S,S)
    size=34;base=pad-4*S+T/2+size*0.53/2
    wd,ww=word('var(--ink)',size,pad-4*S+T+8,base,'var(--seam)',1.4)
    W=ww+pad;H=pad*2+40*S
    return '<svg viewBox="0 0 %g %g" style="width:%dpx;max-width:100%%;height:auto" role="img" aria-label="careermetro">%s%s</svg>'%(W,H,w,body,wd)
B='/mnt/project-files/careermetro/brand/'
r=lambda p:open(B+p).read()
html=open('page.html').read()
for k,v in {'{{MARK_BIG}}':ttile(220,True),'{{LOGO}}':sized(r('concept-b/logo.svg'),560),'{{LOGO_DARK}}':sized(r('concept-b/logo-on-dark.svg'),380),
 '{{ICON_96}}':sized(r('concept-b/app-icon.svg'),96).replace('<svg ','<svg style="border-radius:22px" ',1) if False else '<span style="display:inline-block;width:96px;height:96px;border-radius:22px;overflow:hidden">'+sized(r('concept-b/app-icon.svg'),96)+'</span>',
 '{{FAV_32}}':sized(r('concept-b/favicon.svg'),32),'{{FAV_16}}':sized(r('concept-b/favicon.svg'),16),
 '{{LOGO_SM}}':tlock(170),'{{LOGO_SM2}}':sized(r('concept-b/logo.svg'),260),'{{A_LOGO}}':sized(r('logo.svg'),260),
 '{{ICON_40}}':'<span style="flex:none;display:inline-block;width:40px;height:40px;border-radius:10px;overflow:hidden">'+sized(r('concept-b/app-icon.svg'),40)+'</span>'}.items():
    assert k in html,k; html=html.replace(k,v)
# unique clip ids per inline copy
n=[0]
def ren(m):
    n[0]+=1; return m.group(0)
ids=re.findall(r'id="([tb]\d+)"',html)
out=html; c=0
for i,svgm in enumerate(re.findall(r'<svg[\s\S]*?</svg>',html)):
    new=re.sub(r'(id="|url\(#)([tb])(\d+)',lambda m:'%s%s%d_%d'%(m.group(1),m.group(2),i,int(m.group(3))),svgm)
    out=out.replace(svgm,new,1)
assert '{{' not in out
open(B+'concept-b/careermetro-logo-b.html','w').write(out); print(len(out))
