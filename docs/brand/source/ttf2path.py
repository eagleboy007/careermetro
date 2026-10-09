import struct, sys
class TTF:
    def __init__(s, path):
        d=s.d=open(path,'rb').read()
        n=struct.unpack('>H',d[4:6])[0]; s.t={}
        for i in range(n):
            tag,_,off,ln=struct.unpack('>4sIII',d[12+16*i:28+16*i]); s.t[tag.decode()]=(off,ln)
        ho=s.t['head'][0]; s.upm=struct.unpack('>H',d[ho+18:ho+20])[0]; s.locfmt=struct.unpack('>h',d[ho+50:ho+52])[0]
        mo=s.t['maxp'][0]; s.ng=struct.unpack('>H',d[mo+4:mo+6])[0]
        hh=s.t['hhea'][0]; s.nhm=struct.unpack('>H',d[hh+34:hh+36])[0]
        s.asc,s.desc=struct.unpack('>hh',d[hh+4:hh+8])
        lo=s.t['loca'][0]
        if s.locfmt==0: s.loca=[struct.unpack('>H',d[lo+2*i:lo+2*i+2])[0]*2 for i in range(s.ng+1)]
        else: s.loca=[struct.unpack('>I',d[lo+4*i:lo+4*i+4])[0] for i in range(s.ng+1)]
        s.cmap=s._cmap()
    def _cmap(s):
        d=s.d; co=s.t['cmap'][0]; n=struct.unpack('>H',d[co+2:co+4])[0]
        for i in range(n):
            pid,eid,off=struct.unpack('>HHI',d[co+4+8*i:co+12+8*i])
            o=co+off; fmt=struct.unpack('>H',d[o:o+2])[0]
            if fmt==4:
                segx2=struct.unpack('>H',d[o+6:o+8])[0]; sc=segx2//2
                ends=struct.unpack('>%dH'%sc,d[o+14:o+14+segx2]); st=o+16+segx2
                starts=struct.unpack('>%dH'%sc,d[st:st+segx2]); dl=struct.unpack('>%dh'%sc,d[st+segx2:st+2*segx2])
                ro=st+2*segx2; ros=struct.unpack('>%dH'%sc,d[ro:ro+segx2]); m={}
                for k in range(sc):
                    for c in range(starts[k],ends[k]+1):
                        if c==0xFFFF: continue
                        if ros[k]==0: g=(c+dl[k])&0xFFFF
                        else:
                            a=ro+2*k+ros[k]+2*(c-starts[k]); g=struct.unpack('>H',d[a:a+2])[0]
                            if g: g=(g+dl[k])&0xFFFF
                        m[c]=g
                return m
    def adv(s,g):
        o=s.t['hmtx'][0]; i=min(g,s.nhm-1); return struct.unpack('>H',s.d[o+4*i:o+4*i+2])[0]
    def contours(s,g):
        d=s.d; go=s.t['glyf'][0]+s.loca[g]
        if s.loca[g]==s.loca[g+1]: return []
        nc=struct.unpack('>h',d[go:go+2])[0]
        if nc<0:
            out=[]; p=go+10
            while True:
                fl,gi=struct.unpack('>HH',d[p:p+4]); p+=4
                if fl&1: dx,dy=struct.unpack('>hh',d[p:p+4]); p+=4
                else: dx,dy=struct.unpack('>bb',d[p:p+2]); p+=2
                if fl&8: p+=2
                elif fl&0x40: p+=4
                elif fl&0x80: p+=8
                for c in s.contours(gi): out.append([(x+dx,y+dy,on) for x,y,on in c])
                if not fl&0x20: break
            return out
        ends=struct.unpack('>%dH'%nc,d[go+10:go+10+2*nc]); npt=ends[-1]+1
        il=struct.unpack('>H',d[go+10+2*nc:go+12+2*nc])[0]; p=go+12+2*nc+il
        flags=[]
        while len(flags)<npt:
            f=d[p]; p+=1; flags.append(f)
            if f&8:
                r=d[p]; p+=1; flags+= [f]*r
        xs=[];x=0
        for f in flags:
            if f&2: v=d[p]; p+=1; x+= v if f&16 else -v
            elif not f&16: x+=struct.unpack('>h',d[p:p+2])[0]; p+=2
            xs.append(x)
        ys=[];y=0
        for f in flags:
            if f&4: v=d[p]; p+=1; y+= v if f&32 else -v
            elif not f&32: y+=struct.unpack('>h',d[p:p+2])[0]; p+=2
            ys.append(y)
        out=[];st=0
        for e in ends:
            out.append([(xs[i],ys[i],flags[i]&1) for i in range(st,e+1)]); st=e+1
        return out
def cpath(c,ox,oy,sc):
    P=lambda x,y:(ox+x*sc, oy-y*sc)
    n=len(c)
    # find start on-curve
    pts=c[:]
    if not pts[0][2]:
        if pts[-1][2]: pts=[pts[-1]]+pts[:-1]
        else:
            mx=((pts[0][0]+pts[-1][0])/2,(pts[0][1]+pts[-1][1])/2,1); pts=[mx]+pts
    x0,y0=P(pts[0][0],pts[0][1]); s='M%.2f %.2f'%(x0,y0)
    i=1; pts=pts+[pts[0]]
    while i<len(pts):
        x,y,on=pts[i]
        if on: X,Y=P(x,y); s+='L%.2f %.2f'%(X,Y); i+=1
        else:
            nx,ny,non=pts[i+1] if i+1<len(pts) else pts[0]
            if non: ex,ey=nx,ny; i+=2
            else: ex,ey=(x+nx)/2,(y+ny)/2; i+=1
            cx,cy=P(x,y); X,Y=P(ex,ey); s+='Q%.2f %.2f %.2f %.2f'%(cx,cy,X,Y)
    return s+'Z'
def text_path(f,txt,size,x,baseline,track=0):
    sc=size/f.upm; d=''
    for ch in txt:
        g=f.cmap.get(ord(ch),0)
        for c in f.contours(g): d+=cpath(c,x,baseline,sc)
        x+=f.adv(g)*sc+track*size
    return d,x
if __name__=='__main__':
    f=TTF(sys.argv[1]); d,w=text_path(f,sys.argv[2],100,0,100,-0.03); print(len(d),w)
