import sys,os,re
sys.path.insert(0,'../brand')
from ttf2path import TTF, text_path
BR=TTF('/mnt/skills/examples/canvas-design/canvas-fonts/BricolageGrotesque-Bold.ttf')
GM=TTF('/mnt/skills/examples/canvas-design/canvas-fonts/GeistMono-Bold.ttf')
COBALT='#2448f5'; COBALT_D='#7e94ff'; INK='#12151c'; PAPER='#f4f5f8'; WHITE='#ffffff'; NIGHT='#0c0e13'; LIGHT='#eceef3'
def bbox(d):
    n=list(map(float,re.findall(r'-?\d+\.?\d*',d)));xs=n[0::2];ys=n[1::2];return min(xs),min(ys),max(xs),max(ys)
# glyph c centred in a 48 tile
cd,_=text_path(BR,'c',44,0,0)
x0,y0,x1,y1=bbox(cd); CW=x1-x0; CH=y1-y0
print('c bbox',CW,CH)
uid=[0]
def tile(top,bot,glyph,gap_bg,x=0,y=0,s=1.0,seam=1.6,rx=10):
    uid[0]+=1;i=uid[0]
    gx=24-(x0+x1)/2; gy=24-(y0+y1)/2+0.4
    g='<g transform="translate(%g %g) scale(%g)">'%(x,y,s)
    g+='<defs><clipPath id="t%d"><rect x="0" y="0" width="48" height="%g"/></clipPath><clipPath id="b%d"><rect x="0" y="%g" width="48" height="48"/></clipPath></defs>'%(i,24-seam/2,i,24+seam/2)
    shape='<rect x="4" y="4" width="40" height="40" rx="%g" fill="%%s"/><path transform="translate(%g %g)" d="%s" fill="%s"/>'%(rx,gx,gy,cd,glyph)
    g+='<g clip-path="url(#t%d)">'%i+shape%top+'</g><g clip-path="url(#b%d)">'%i+shape%bot+'</g>'
    return g+'</g>'
def svg(w,h,body,bg=None,title='careermetro'):
    b='<rect width="100%%" height="100%%" fill="%s"/>'%bg if bg else ''
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" width="%g" height="%g" role="img" aria-label="%s">%s%s</svg>'%(w,h,w,h,title,b,body)
def word(color,size,x,base,seamc,seam):
    d,w=text_path(GM,'careermetro',size,x,base,-0.02)
    bx=bbox(d)
    # flap seam through the middle of the x-height
    xh=size*0.53; my=base-xh/2
    s='<path d="%s" fill="%s"/>'%(d,color)
    s+='<rect x="%g" y="%g" width="%g" height="%g" fill="%s"/>'%(x-1,my-seam/2,w-x+2,seam,seamc)
    return s,w
def lockup(top,bot,glyph,bg,txt,bgfill=None,pad=6):
    S=1.15; T=48*S
    body=tile(top,bot,glyph,bg,pad-4*S,pad-4*S,S)
    size=34; base=pad-4*S+T/2+size*0.53/2
    wd,w=word(txt,size,pad-4*S+T+8,base,bg,1.4)
    W=w+pad; H=pad*2+40*S
    return svg(W,H,body+wd,bgfill)
out='/mnt/project-files/careermetro/brand/concept-b'; os.makedirs(out,exist_ok=True)
F={}
F['mark.svg']=svg(48,48,tile(INK,COBALT,WHITE,PAPER))
F['mark-on-dark.svg']=svg(48,48,tile('#2a2f3a',COBALT_D,NIGHT if False else WHITE,NIGHT),bg=NIGHT)
F['logo.svg']=lockup(INK,COBALT,WHITE,PAPER,INK)
F['logo-on-dark.svg']=lockup('#2a2f3a','#4a63ff',WHITE,NIGHT,LIGHT,bgfill=NIGHT,pad=16)
F['app-icon.svg']=svg(512,512,tile(INK,COBALT,WHITE,PAPER,-4*512/40,-4*512/40,512/40,seam=1.2,rx=9))
F['favicon.svg']=svg(32,32,tile(INK,COBALT,WHITE,'#fff',-2.67,-2.67,32/40,seam=2.4))
for k,v in F.items(): open(os.path.join(out,k),'w').write(v)
print(list(F))
