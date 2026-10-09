import sys, os
sys.path.insert(0,'.')
from ttf2path import TTF, text_path
F=TTF('/mnt/skills/examples/canvas-design/canvas-fonts/BricolageGrotesque-Bold.ttf')
COBALT='#2448f5'; COBALT_D='#7e94ff'; INK='#12151c'; PAPER='#f4f5f8'; WHITE='#ffffff'; NIGHT='#0c0e13'

MARK_PATH="M8 31H18L32 17H40"
def mark(line, dest, bg, sw=4.4, x=0, y=0, s=1.0):
    # 48x48 grid: origin ring -> flat -> 45 degree climb -> flat -> destination
    g='<g transform="translate(%g %g) scale(%g)">'%(x,y,s)
    g+='<path d="%s" fill="none" stroke="%s" stroke-width="%g" stroke-linecap="round" stroke-linejoin="round"/>'%(MARK_PATH,line,sw)
    g+='<circle cx="8" cy="31" r="4.8" fill="%s" stroke="%s" stroke-width="%g"/>'%(bg,line,sw)
    g+='<circle cx="40" cy="17" r="6.6" fill="%s"/>'%dest
    return g+'</g>'

def word(color, size, x, base, txt='careermetro'):
    d,w=text_path(F,txt,size,x,base,-0.03)
    return '<path d="%s" fill="%s"/>'%(d,color), w

def svg(w,h,body,bg=None,title='CareerMetro'):
    b='<rect width="100%%" height="100%%" fill="%s"/>'%bg if bg else ''
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" width="%g" height="%g" role="img" aria-label="%s">%s%s</svg>'%(w,h,w,h,title,b,body)

out='/mnt/project-files/careermetro/brand'; os.makedirs(out,exist_ok=True)
files={}
files['mark.svg']=svg(48,48,mark(INK,COBALT,PAPER))
files['mark-on-dark.svg']=svg(48,48,mark('#eceef3',COBALT_D,NIGHT),bg=NIGHT)
# horizontal lockup: mark 48 tall, wordmark size so x-height aligns
def lockup(line,dest,bg,txtc,bgfill=None,pad=4):
    S=1.25; B=40+pad
    mx=pad-0.8*S; my=B+1-38.2*S
    wp,ww=word(txtc,40,mx+46.6*S+9,B)
    W=ww+pad+2
    return svg(W,52+2*pad,mark(line,dest,bg,x=mx,y=my,s=S)+wp,bg=bgfill), W
files['logo.svg'],LW=lockup(INK,COBALT,PAPER,INK)
files['logo-on-dark.svg'],_=lockup('#eceef3',COBALT_D,NIGHT,'#eceef3',NIGHT,pad=16)
files['logo-on-cobalt.svg'],_=lockup(WHITE,WHITE,COBALT,WHITE,COBALT,pad=16)
# stacked
wp,ww=word(INK,30,0,0)
sw_=ww
st='<g transform="translate(%g 0)">%s</g>'%((sw_-72)/2, mark(INK,COBALT,PAPER,s=1.5))+'<g transform="translate(0 100)">'+wp+'</g>'
files['logo-stacked.svg']=svg(sw_,116,st)
# app icon 512
def icon(tile,line,dest,inner,rx=116):
    return svg(512,512,'<rect width="512" height="512" rx="%d" fill="%s"/>'%(rx,tile)+mark(line,dest,inner,sw=4.4,x=256-23.8*7.6,y=256-24.3*7.6,s=7.6))
files['app-icon.svg']=icon(COBALT,WHITE,WHITE,COBALT)
files['app-icon-night.svg']=icon(NIGHT,'#eceef3',COBALT_D,NIGHT)
# favicon: thicker, tighter
fav='<rect width="32" height="32" rx="8" fill="%s"/>'%COBALT+'<g transform="translate(3.1 2.4) scale(0.56)"><path d="M8 31H18L32 17H40" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="31" r="4.8" fill="%s" stroke="#fff" stroke-width="5"/><circle cx="40" cy="17" r="7" fill="#fff"/></g>'%COBALT
files['favicon.svg']=svg(32,32,fav)
# social card 1200x630
wp2,ww2=word(INK,56,96+46.6*1.75+12,128)
hl,_=text_path(F,'Your next role,',84,96,340,-0.035)
hl2,_=text_path(F,'one pitstop at a time.',84,96,436,-0.035)
url,_=text_path(F,'careermetro.com',30,96,560,-0.01)
sc=mark(INK,COBALT,PAPER,x=96-0.8*1.75,y=129-38.2*1.75,s=1.75)+wp2+'<path d="%s" fill="%s"/>'%(hl,INK)+'<path d="%s" fill="%s"/>'%(hl2,COBALT)+'<path d="%s" fill="#586072"/>'%url
# decorative route on the right
sc+='<path d="M780 580H880L1040 420H1240" fill="none" stroke="#dce0e8" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>'
sc+='<path d="M780 580H880L960 500" fill="none" stroke="%s" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>'%INK
for cx,cy in [(880,580),(1040,420)]: sc+='<circle cx="%d" cy="%d" r="13" fill="%s" stroke="#dce0e8" stroke-width="8"/>'%(cx,cy,PAPER)
sc+='<circle cx="780" cy="580" r="15" fill="%s" stroke="%s" stroke-width="11"/>'%(PAPER,INK)
sc+='<circle cx="960" cy="500" r="22" fill="%s"/><circle cx="960" cy="500" r="38" fill="none" stroke="%s" stroke-width="3" opacity="0.35"/>'%(COBALT,COBALT)
files['social-card.svg']=svg(1200,630,sc,bg=PAPER)
for k,v in files.items(): open(os.path.join(out,k),'w').write(v)
import json; json.dump({'LW':LW},open('dims.json','w'))
print(sorted(files), LW)
