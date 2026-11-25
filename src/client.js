'use strict';
const $=id=>document.getElementById(id)||(()=>{const e=document.createElement('div');e.append(document.createElement('b'));return e;})(), view=$('view'),out=view.getContext('2d'),map=$('map');
let W=128,H=48;const source=document.createElement('canvas');source.width=W;source.height=H;const g=source.getContext('2d',{willReadFrequently:true});
const road=Race.circuit(TRACK),L=road.length,N=road.points.length,step=road.step,half=Race.HALF,pi=Math.PI,TAU=2*pi,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=(v,n)=>((v%n)+n)%n,ang=a=>wrap(a+pi,TAU)-pi;
const track=road.points,at=road.at;
function pos(p,d,h=0){return [p.x+p.rx*d,p.y+h,p.z+p.rz*d]}
function rng(seed){let t=Math.sin(seed*127.1+311.7)*43758.5453;return t-Math.floor(t)}
let challenge=Race.challenge(),carState=Race.initial(challenge),s=carState.s,d=0,v=carState.v,heading=0,steer=0,elapsed=0,active=false,paused=false,hit=0,keys={};
// Depth-buffered 3D mesh renderer. The final framebuffer is sampled into ASCII.
const raster=document.createElement('canvas');raster.width=1920;raster.height=1080;let gl=null;try{if(!new URLSearchParams(location.search).has('cpu'))gl=raster.getContext('webgl',{antialias:false,preserveDrawingBuffer:false,alpha:false,powerPreference:'high-performance'});}catch(e){console.warn('GPU unavailable',e);}function useCPU(error){if(error)console.warn('Switching to CPU renderer',error);gl=null;raster.remove();view.style.display='block';}if(gl){raster.id='gpuview';raster.style.cssText='display:block;width:100%;height:auto;max-height:100vh;object-fit:contain';view.before(raster);view.style.display='none';}
const vs=`attribute vec3 aPosition;attribute vec3 aColor;uniform vec3 uEye;uniform vec3 uRight;uniform vec3 uUp;uniform vec3 uForward;uniform vec2 uFocal;varying vec3 vColor;varying float vDepth;varying vec3 vWorld;void main(){vWorld=aPosition;vec3 d=aPosition-uEye;float z=dot(d,uForward);float x=dot(d,uRight);float y=dot(d,uUp);gl_Position=vec4(x*uFocal.x,y*uFocal.y+0.06*z,z*1.0004-0.50,z);vColor=aColor;vDepth=z;}`;
const fs=`precision highp float;varying vec3 vColor;varying float vDepth;varying vec3 vWorld;
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main(){vec3 c=vColor;bool green=c.g>c.r*1.28&&c.g>c.b*1.35;bool grey=abs(c.r-c.b)<.12&&abs(c.g-c.r)<.08&&c.r>.22&&c.r<.72;float tex=noise(vWorld*(green?3.6:12.));float broad=noise(vWorld*.47);float f=green?.70+.48*tex+.24*broad:grey?.83+.27*tex+.12*broad:.98+.04*tex;float fog=1.0-exp(-max(vDepth,0.0)*.00032);gl_FragColor=vec4(mix(c*f,vec3(.60,.76,.94),fog),1.0);}`;
function shader(kind,src){let sh=gl.createShader(kind);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh;}let program,loc={},buffer,staticBuffer;if(gl){try{program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);for(let n of ['aPosition','aColor'])loc[n]=gl.getAttribLocation(program,n);for(let n of ['uEye','uRight','uUp','uForward','uFocal'])loc[n]=gl.getUniformLocation(program,n);buffer=gl.createBuffer();staticBuffer=gl.createBuffer();gl.enable(gl.DEPTH_TEST);gl.clearColor(0,0,0,0);}catch(e){useCPU(e);}}let verts=[];
const sub=(a,b)=>a.map((x,i)=>x-b[i]), cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),norm=a=>{let l=Math.hypot(...a)||1;return a.map(x=>x/l)},sun=norm([-.65,.72,-.42]);
function tri(a,b,c,color,flat=false){let n=norm(cross(sub(b,a),sub(c,a)));let light=flat?1:.48+.68*Math.abs(dot(n,sun));let glossy=!flat&&color[0]>.63&&color[1]>.12&&color[1]<.6&&color[2]<.15;let spec=glossy?Math.pow(Math.abs(dot(n,norm([-.32,.91,-.25]))),14)*.28:0;let rgb=color.map((x,i)=>clamp(x*light+(i===2?.023:.008)+spec*(i===2?.9:1),0,1));for(let p of [a,b,c])verts.push(...p,...rgb);}
function quad(a,b,c,d,color,flat=false){tri(a,b,c,color,flat);tri(a,c,d,color,flat);}
const paint={road:[.30,.31,.34],grass:[.24,.76,.10],darkgrass:[.12,.44,.05],white:[1,.99,.95],red:[.97,.08,.04],steel:[.77,.83,.89],bark:[.48,.31,.16]};
function bank(p){return .075*Math.sin(p.x*.006+p.z*.003)+.035*Math.sin(p.z*.018);}
// Roadside terrain and trees must never sit on another stretch of road (inside of bends, hairpins,
// parallel sections). A spatial hash of the centreline answers "is this point on some other road?".
const HASH=16,roadHash=new Map();track.forEach((p,i)=>{p.idx=i;const key=Math.floor(p.x/HASH)+','+Math.floor(p.z/HASH);(roadHash.get(key)||roadHash.set(key,[]).get(key)).push(i);});
function nearOtherRoad(x,z,idx,clear){const r=Math.ceil(clear/HASH),cx=Math.floor(x/HASH),cz=Math.floor(z/HASH),c2=clear*clear;
 for(let i=-r;i<=r;i++)for(let j=-r;j<=r;j++){const list=roadHash.get((cx+i)+','+(cz+j));if(!list)continue;for(const k of list){const di=Math.abs(k-idx),near=Math.min(di,N-di);if(near<=5)continue;const q=track[k],dx=q.x-x,dz=q.z-z;if(dx*dx+dz*dz<c2)return true;}}return false;}
// How far terrain may extend sideways from each point before it would reach another stretch of road.
const sideExtent=track.map((p,i)=>[-1,1].map(side=>{for(let x=8;x<=200;x+=4)if(nearOtherRoad(p.x+p.rx*side*x,p.z+p.rz*side*x,i,7.7))return x;return 200;}));
const extentAt=(i,side)=>{const n=N,e=sideExtent[i%n][side>0?1:0],f=sideExtent[(i+1)%n][side>0?1:0],g=sideExtent[(i+n-1)%n][side>0?1:0];return Math.min(e,f,g);};
// Gentle hills grow only well away from the road, and stay flat on a side where another stretch of road
// lies within 200 m, so terrain never hides the road around a bend.
function ground(p,d){let a=Math.max(0,Math.abs(d)-24),side=Math.sign(d),open=p.idx==null||a===0?1:clamp((extentAt(p.idx,side)-80)/120,0,1);
 return p.y+bank(p)*clamp(d,-8,8)+open*(Math.min(a*.25,14)*(.73*Math.sin(p.x*.003+p.z*.004+side*2)+.45*Math.sin(p.z*.012+side))+Math.min(a*.08,8));}
function wp(p,d,h=0){return [p.x+p.rx*d,ground(p,d)+h,p.z+p.rz*d]}
function roadstrip(a,b,x1,x2,c,h=0){quad(wp(a,x1,h),wp(b,x1,h),wp(b,x2,h),wp(a,x2,h),c);}
function cylinder(base,r1,r2,h,c,sides=7,phase=0){let top=[base[0],base[1]+h,base[2]];for(let k=0;k<sides;k++){let a=phase+k*TAU/sides,b=phase+(k+1)*TAU/sides;let p=[base[0]+r1*Math.cos(a),base[1],base[2]+r1*Math.sin(a)],q=[base[0]+r1*Math.cos(b),base[1],base[2]+r1*Math.sin(b)],u=[top[0]+r2*Math.cos(a),top[1],top[2]+r2*Math.sin(a)],w=[top[0]+r2*Math.cos(b),top[1],top[2]+r2*Math.sin(b)];quad(p,u,w,q,c);if(r2>0)tri(top,w,u,c);}}
function ellipsoid(base,rx,ry,rz,c,seed,detail=8){let rings=5,pt=(i,j)=>{let t=i*Math.PI/rings,a=j*TAU/detail;let rr=1+(.19*(rng(seed+i*91+(j%detail)*13)-.5));return [base[0]+rx*Math.sin(t)*Math.cos(a)*rr,base[1]+ry*Math.cos(t)*rr,base[2]+rz*Math.sin(t)*Math.sin(a)*rr]};for(let i=0;i<rings;i++)for(let j=0;j<detail;j++){let tint=.83+.30*rng(seed+i*19+j*31);quad(pt(i,j),pt(i+1,j),pt(i+1,j+1),pt(i,j+1),c.map(x=>x*tint));}}
function forest(p,side,i,row,detail=true){let seed=i*83+side*19+row*101,dist=side*(12+row*17+rng(seed)*13),h=9+rng(seed+1)*13,r=h*(.17+rng(seed+2)*.12),base=wp(p,dist);if(p.idx!=null&&(Math.abs(dist)>extentAt(p.idx,side)-r-2||nearOtherRoad(base[0],base[2],p.idx,8+r)))return;let tint=.79+rng(seed+3)*.34,near=row===0&&detail&&!!gl; if(row===0){treeShadow(p,dist,h,r);trackShadow(p,dist,h,r,i);}let style=rng(seed+4),bark=[.30,.24,.16];cylinder(base,.35,.10,h*.91,bark,near?9:5);
if(style<.29){for(let j=0;j<(near?7:4);j++){let f=j/(near?7:4),rr=r*(1-f*.86),y=base[1]+h*(.20+f*.68),color=[(.15+f*.055)*tint,(.33+f*.15)*tint,(.095+f*.025)*tint];cylinder([base[0],y,base[2]],rr*.75,rr,h*.06,color,near?12:7,j*.3);cylinder([base[0],y+h*.06,base[2]],rr,.035,h*(.29-f*.14),color,near?12:7,j*.3);}}
else{let c=[(.19+rng(seed+6)*.09)*tint,(.39+rng(seed+7)*.15)*tint,.105*tint];let count=near?13:gl?4:2;for(let j=0;j<count;j++){let a=j*2.399+seed*.18,f=j/(count-1),rr=r*(j===0?0:.60+.32*rng(seed+j*7)),size=r*(.50+.30*rng(seed+j*11));let b=[base[0]+Math.cos(a)*rr*(1-f*.5),base[1]+h*(.46+.40*f),base[2]+Math.sin(a)*rr*(1-f*.5)];ellipsoid(b,size,size*(.9+rng(seed+j)*.48),size*.87,c.map((x,k)=>x*(.88+f*.28)),seed+j*65,near?9:gl?5:4);}}}
function trackShadow(p,d,h,r,i){let sunX=-.65,sunZ=-.42,sunY=.72;let dx=-(sunX*p.rx+sunZ*p.rz)/sunY,dz=-(sunX*Math.sin(p.yaw)+sunZ*Math.cos(p.yaw))/sunY;for(let j=0;j<5;j++){let f=.63+j*.075,cd=d+dx*h*f+(rng(i*47+j)-.5)*r*.8,cs=i*step+dz*h*f+(rng(i*31+j)-.5)*r*1.1,rx=r*(.63+rng(i*11+j)*.32),rz=r*(.85+rng(i*7+j)*.46);if(Math.abs(cd)>half+rx)continue;let poly=[];for(let k=0;k<14;k++){let a=k*TAU/14,rr=.82+rng(i*19+j*23+k)*.27;poly.push([cd+Math.cos(a)*rx*rr,Math.sin(a)*rz*rr]);}for(let side of [-1,1]){let clipped=[];for(let k=0;k<poly.length;k++){let a=poly[k],b=poly[(k+1)%poly.length],inside=side*a[0]<=half-.40,next=side*b[0]<=half-.40;if(inside)clipped.push(a);if(inside!==next){let lim=side*(half-.40),t=(lim-a[0])/(b[0]-a[0]);clipped.push([lim,a[1]+(b[1]-a[1])*t]);}}poly=clipped;}if(poly.length<3)continue;let to=v=>wp(at(cs+v[1]),v[0],.073+j*.0008);for(let k=1;k<poly.length-1;k++)tri(to(poly[0]),to(poly[k]),to(poly[k+1]),[.28,.31,.32],true);}}
function treeShadow(p,d,h,r){ // soft shade on the verge: follows the ground along the track and never reaches the road
 const side=Math.sign(d),edge=d-side*Math.min(6,h*.38),c=[.20,.43,.105],s0=(p.idx??0)*step,lim=half+1.3,cx=x=>side*Math.max(side*x,lim),
  pt=(x,z)=>wp({...at(wrap(s0+z,L)),idx:p.idx},cx(x),.019),center=pt(edge,0);
 for(let j=0;j<10;j++){const a=j*TAU/10,b=(j+1)*TAU/10;tri(center,pt(edge+Math.cos(a)*r*.92,Math.sin(a)*h*.34),pt(edge+Math.cos(b)*r*.92,Math.sin(b)*h*.34),c,true);}}
function shadow(p,d,spread,length,opacity=.65){let c=[.17*opacity,.30*opacity,.075*opacity];let center=wp(p,d,.015);for(let k=0;k<12;k++){let a=k*TAU/12,b=(k+1)*TAU/12;let pt=t=>{let u=d+Math.cos(t)*spread,z=Math.sin(t)*length;let q={...p,x:p.x+Math.sin(p.yaw)*z,z:p.z+Math.cos(p.yaw)*z};return wp(q,u,.016);};tri(center,pt(a),pt(b),c,true);}}
function marker(p,side,i){let d=side*7.2,b=wp(p,d);cylinder(b,.055,.055,1.1,[.95,.95,.93],5);let v=wp(p,d,.77),w=wp(p,d+side*.16,.98);quad(v,[w[0],v[1],w[2]],w,[v[0],w[1],v[2]],[1,.18,.07],true);}
function grassTuft(p,side,i){let d=side*(6.1+rng(i*7+side)*1.6),b=wp(p,d,.03),c=[.43,.75,.16];for(let j=0;j<3;j++){let a=j*2.1+i;tri([b[0]-.12,b[1],b[2]],[b[0]+.12,b[1],b[2]],[b[0]+Math.cos(a)*.22,b[1]+.25+rng(i+j)*.28,b[2]+Math.sin(a)*.22],c);}}
function rail(a,b,x){for(let h of [.36,.75]){let c=paint.steel;quad(wp(a,x-.12,h-.14),wp(b,x-.12,h-.14),wp(b,x-.12,h+.14),wp(a,x-.12,h+.14),c);quad(wp(a,x-.12,h+.14),wp(b,x-.12,h+.14),wp(b,x+.12,h+.14),wp(a,x+.12,h+.14),[.78,.82,.79]);}if(Math.round(a.x+a.z)%2===0)cylinder(wp(a,x),.10,.10,1.08,[.32,.35,.34],4);}
let customBody=null,modelRevision=0;
const PAINTS=[{name:'White',c:[.90,.91,.90],stripe:[.86,.08,.05]},{name:'Signal yellow',c:[.96,.74,.07],stripe:[.05,.05,.06]},{name:'Orange',c:[.98,.40,.07],stripe:[.05,.05,.06]},{name:'Racing green',c:[.07,.40,.19],stripe:[.95,.95,.92]},{name:'Electric blue',c:[.08,.30,.85],stripe:[.95,.95,.92]},{name:'Gunmetal',c:[.30,.33,.36],stripe:[.95,.30,.06]}];
let paintIndex=0,carBody='f1';let assistPrefs={};const getAssists=car=>Race.assistsFor(car,assistPrefs[car]);let pendingShift=0,padShiftHeld=0;const bodyNow=()=>active?raceConfig.car:carBody;const BODIES={kestrel:'KESTREL RS',f1:"FORMULA '86"};
function parseBodyOBJ(text){let vertices=[],faces=[];let col=[.88,.90,.88];for(let line of text.split(/\r?\n/)){let parts=line.trim().split(/\s+/);if(parts[0]==='v'&&parts.length>=4){let v=parts.slice(1,4).map(Number);if(!v.every(Number.isFinite))throw Error('Invalid vertex');vertices.push(v);}else if(parts[0]==='usemtl'){let n=parts.slice(1).join(' ').toLowerCase();col=/glass|window/.test(n)?[.11,.22,.27]:/carbon|black|rubber|trim/.test(n)?[.08,.09,.10]:/light|tail|red/.test(n)?[.9,.09,.06]:[.88,.90,.88];}else if(parts[0]==='f'){let ids=parts.slice(1).map(v=>{let k=Number(v.split('/')[0]);return k<0?vertices.length+k:k-1;});if(ids.some(i=>!Number.isInteger(i)||!vertices[i]))throw Error('Invalid face');for(let i=1;i<ids.length-1;i++)faces.push([ids[0],ids[i],ids[i+1],col]);}if(faces.length>18000||vertices.length>60000)throw Error('Decimate the body to 18,000 triangles or fewer');}if(faces.length<20)throw Error('No usable mesh');let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let v of vertices)for(let j=0;j<3;j++){lo[j]=Math.min(lo[j],v[j]);hi[j]=Math.max(hi[j],v[j]);}if(hi[2]-lo[2]<.01||hi[1]-lo[1]<.01||hi[0]-lo[0]<.01)throw Error('Invalid model dimensions');let f=4.60/(hi[2]-lo[2]);if((hi[0]-lo[0])*f>2.7||(hi[1]-lo[1])*f>2.2)throw Error('Export Y-up, Z-forward, X-width');return faces.map(([a,b,c,col])=>[...[a,b,c].map(i=>[(vertices[i][0]-(lo[0]+hi[0])/2)*f,(vertices[i][1]-lo[1])*f+.10,(vertices[i][2]-(lo[2]+hi[2])/2)*f]),col]);}
$('importModel').onclick=()=>{if(!active)$('bodyFile').click();};$('bodyFile').onchange=async()=>{try{let file=$('bodyFile').files[0];if(!file)return;if(file.size>8e6)throw Error('OBJ exceeds 8 MB');customBody=parseBodyOBJ(await file.text());modelRevision++;$('modelStatus').textContent='Custom body loaded';}catch(e){$('modelStatus').textContent=e.message;}finally{$('bodyFile').value='';}};
function car(p,yaw,off,g,sv=s){const CS=g||carState,v0=verts.length;
// Sit the car on the road: height and tilt from the ground under the axles and both sides.
const hd=yaw-p.yaw,ch=Math.cos(hd),shh=Math.sin(hd),gAt=(fwd,lat)=>{const ss=wrap(sv+fwd*ch-lat*shh,L),dd=off+fwd*shh+lat*ch,ad=Math.abs(dd);return ground(at(ss),dd)+(ad>half&&ad<half+1.15&&road.curb(ss,Math.sign(dd))?.05:0);};
const yF=gAt(1.22,0),yB=gAt(-1.237,0),yR=gAt(0,.8),yL=gAt(0,-.8),gz=(yF-yB)/2.457,gx=(yR-yL)/1.6;
let X=p.x+p.rx*off,Z=p.z+p.rz*off,Y=(yF+yB)/2+.04+.19,sy=Math.sin(yaw),cy=Math.cos(yaw),isF1=bodyNow()==='f1',roll=clamp(-(CS.ay||0)*.0042,-.05,.05)*(isF1?.2:1),pitch=clamp(-(CS.ax||0)*.0032,-.035,.035)*(isF1?.2:1),ax=.94;
function world(x,y,z){return [X+x*cy+z*sy,Y+y+z*gz+x*gx,Z-x*sy+z*cy]};const floorY=-.17;function local(x,y,z){let xx=x*ax;return world(xx,Math.max(floorY,y+roll*xx+pitch*z),z)}
function panel(a,b,c,d,col,flat=false){quad(local(...a),local(...b),local(...c),local(...d),col,flat)}
// Smooth (per-vertex) shading for the bodywork: sun in car space, sky fill and a paint highlight.
const sunL=[sun[0]*cy-sun[2]*sy,sun[1],sun[0]*sy+sun[2]*cy],halfV=norm([sunL[0],sunL[1]+1,sunL[2]]);
function shadeN(n,col,gloss){const l=.36+.62*Math.max(0,dot(n,sunL))+.16*Math.max(0,n[1]),sp=gloss?Math.pow(Math.max(0,dot(n,halfV)),28)*.42:0;return col.map(x=>clamp(x*l+sp,0,1));}
function triS(a,b,c,na,nb,nc,col,gloss){const P=[local(...a),local(...b),local(...c)],C=[shadeN(na,col,gloss),shadeN(nb,col,gloss),shadeN(nc,col,gloss)];for(let k=0;k<3;k++)verts.push(...P[k],...C[k]);}
// Loft a grid of points (rows x cols) with averaged normals pointing away from the given axis.
function loft(G,colorAt,closed,skip){const R=G.length,K=G[0].length,Nn=G.map((row,i)=>row.map((pt,j)=>{const a=G[Math.min(R-1,i+1)][j],b=G[Math.max(0,i-1)][j],c=row[closed?(j+1)%K:Math.min(K-1,j+1)],d=row[closed?(j-1+K)%K:Math.max(0,j-1)];
  let n=norm(cross(sub(c,d),sub(a,b)));const out=[pt[0],pt[1]-.3,0];if(dot(n,out)<0)n=n.map(x=>-x);return n;}));
 for(let i=0;i<R-1;i++)for(let j=0;j<(closed?K:K-1);j++){const k=(j+1)%K,q=[G[i][j],G[i][k],G[i+1][k],G[i+1][j]],mid=q.reduce((r,p)=>r.map((x,n)=>x+p[n]/4),[0,0,0]);if(skip&&skip(mid))continue;
  const col=colorAt(i,j,mid);triS(q[0],q[1],q[2],Nn[i][j],Nn[i][k],Nn[i+1][k],col,col===red);triS(q[0],q[2],q[3],Nn[i][j],Nn[i+1][k],Nn[i+1][j],col,col===red);}}
let red=[.88,.90,.88],dark=[.14,.15,.17],glass=[.095,.18,.23],carbon=[.09,.105,.12],rubber=[.10,.115,.13],metal=[.60,.66,.72];
const P=PAINTS[paintIndex],paintC=P.c,stripeC=P.stripe;red=paintC;
const B=[[2.31,.70,.05,.25],[2.18,.86,.00,.33],[1.95,.96,-.04,.42],[1.60,1.00,-.06,.55],[1.22,1.01,-.06,.62],[.85,.99,-.06,.57],[.40,.95,-.06,.54],[0,.96,-.06,.55],[-.45,1.00,-.06,.60],[-.90,1.04,-.06,.68],[-1.24,1.05,-.06,.71],[-1.62,1.03,-.05,.70],[-1.98,.98,-.02,.67],[-2.22,.90,.03,.63],[-2.32,.84,.08,.58]];
const lerpT=(T,z,k)=>{for(let i=0;i<T.length-1;i++){const a=T[i],b=T[i+1];if(z<=a[0]&&z>=b[0]){const t=(a[0]-z)/(a[0]-b[0]);return a[k]+(b[k]-a[k])*t;}}return T.at(-1)[k];};
const C=[[1.30,.66,.55,.57],[1.00,.71,.56,.84],[.62,.74,.57,1.05],[.18,.75,.58,1.12],[-.28,.73,.59,1.10],[-.60,.68,.61,1.01],[-.82,.62,.63,.86],[-.92,.58,.65,.70]];
if(bodyNow()==='f1'){
// Generic mid-1980s turbo-era single-seater (original design, no team livery): needle nose, low front
// wing, flat sidepods, open cockpit with helmet, airbox, tall rear wing, exposed wheels with fat rear slicks.
const pc=paintC,ac=stripeC,blk=[.06,.065,.07],helm=[.93,.93,.95];
const ell=(z,hw,lo,hi,n=16)=>Array.from({length:n},(_,j)=>{const a=TAU*j/n,c=Math.cos(a),sn=Math.sin(a);return [hw*Math.sign(c)*Math.pow(Math.abs(c),.7),(hi+lo)/2+(hi-lo)/2*Math.sign(sn)*Math.pow(Math.abs(sn),.7),z];});
// nose cone + monocoque
const tub=[[2.28,.06,-.04,.06],[2.05,.12,-.07,.13],[1.70,.19,-.09,.20],[1.30,.25,-.10,.27],[.90,.30,-.11,.33],[.50,.34,-.11,.36],[.10,.36,-.11,.37],[-.25,.36,-.11,.38]];
let tr=[];for(let i=0;i<tub.length-1;i++)for(let q=0;q<3;q++)tr.push(tub[i].map((x,k)=>x+(tub[i+1][k]-x)*q/3));tr.push(tub.at(-1));
loft(tr.map(r=>ell(...r)),(i,j,mid)=>mid[1]>.30&&mid[2]<.62&&mid[2]>-.08&&Math.abs(mid[0])<.24?blk:(Math.abs(mid[0])<.07&&mid[1]>0?ac:pc),true);
{const a=ell(...tub[0]),m=[0,.01,2.29];for(let j=0;j<a.length;j++)tri(local(...m),local(...a[j]),local(...a[(j+1)%a.length]),ac);}
// cockpit rim, driver helmet, roll hoop / airbox, engine cover tapering to the gearbox
panel([-.25,.375,.62],[.25,.375,.62],[.25,.38,-.06],[-.25,.38,-.06],blk);
for(let i=0;i<6;i++)for(let j=0;j<10;j++){const t1=i/6*Math.PI/2,t2=(i+1)/6*Math.PI/2,a1=j*TAU/10,a2=(j+1)*TAU/10,pt=(t,a)=>[Math.cos(t)*Math.cos(a)*.13,.40+Math.sin(t)*.14,.12+Math.cos(t)*Math.sin(a)*.15];panel(pt(t1,a1),pt(t1,a2),pt(t2,a2),pt(t2,a1),i<2&&j>=3&&j<=6?blk:i===2||i===3?ac:helm);}
const eng=[[-.10,.20,.30,.80],[-.30,.24,.28,.86],[-.70,.26,.22,.70],[-1.10,.24,.12,.55],[-1.50,.20,.05,.42],[-1.85,.16,0,.30],[-2.05,.12,-.02,.20]];
let er=[];for(let i=0;i<eng.length-1;i++)for(let q=0;q<2;q++)er.push(eng[i].map((x,k)=>x+(eng[i+1][k]-x)*q/2));er.push(eng.at(-1));
loft(er.map(r=>ell(...r)),(i,j,mid)=>Math.abs(mid[0])<.06&&mid[1]>.3?ac:pc,true);
panel([-.13,.62,-.08],[.13,.62,-.08],[.12,.80,-.24],[-.12,.80,-.24],blk); // airbox intake
// sidepods with radiator inlets, coke-bottle taper
for(const sd of [-1,1]){const pod=[[.47,.34,.86,-.10,.20],[.40,.33,.89,-.11,.26],[.0,.35,.92,-.11,.30],[-.55,.35,.90,-.11,.28],[-1.05,.33,.70,-.10,.20],[-1.45,.28,.48,-.08,.11],[-1.55,.27,.40,-.06,.07]];
 const rows=pod.map(([z,xa,xb,lo,hi])=>Array.from({length:18},(_,j)=>{const t=TAU*j/18,c=Math.cos(t),sn=Math.sin(t),hw=(xb-xa)/2;return [sd*((xa+xb)/2+hw*Math.sign(c)*Math.pow(Math.abs(c),.45)),(hi+lo)/2+(hi-lo)/2*Math.sign(sn)*Math.pow(Math.abs(sn),.6),z];}));
 loft(rows,(i,j,mid)=>mid[1]<-.05?blk:pc,true);
 panel([sd*.36,-.10,.46],[sd*.88,-.10,.46],[sd*.88,.25,.46],[sd*.36,.25,.46],blk); // inlet
 panel([sd*.925,-.06,.30],[sd*.925,-.06,-.50],[sd*.925,.06,-.50],[sd*.925,.06,.30],ac,true); // pod stripe
 panel([sd*.30,.36,.70],[sd*.52,.40,.66],[sd*.52,.46,.66],[sd*.30,.42,.70],blk);} // mirrors
// front wing: twin elements on the nose with end plates
panel([-.96,-.13,2.36],[.96,-.13,2.36],[.96,-.10,2.06],[-.96,-.10,2.06],pc);panel([-.96,-.08,2.08],[.96,-.08,2.08],[.96,-.03,1.92],[-.96,-.03,1.92],ac);
for(const sd of [-1,1])panel([sd*.97,-.15,2.38],[sd*.97,.05,2.38],[sd*.97,.05,1.88],[sd*.97,-.15,1.92],blk);
// rear wing: tall end plates, main plane and flap, central pillar
for(const sd of [-1,1])panel([sd*.52,.18,-2.42],[sd*.52,1.00,-2.42],[sd*.52,1.00,-1.88],[sd*.52,.30,-1.88],pc);
panel([-.52,.78,-2.38],[.52,.78,-2.38],[.52,.84,-1.98],[-.52,.84,-1.98],blk);panel([-.52,.90,-2.40],[.52,.90,-2.40],[.52,.98,-2.18],[-.52,.98,-2.18],ac);
panel([-.03,.25,-2.10],[.03,.25,-2.10],[.03,.78,-2.18],[-.03,.78,-2.18],blk);
// gearbox, diffuser, rain light, exhausts
panel([-.40,-.12,-2.30],[.40,-.12,-2.30],[.40,.10,-2.25],[-.40,.10,-2.25],blk);panel([-.06,.16,-2.31],[.06,.16,-2.31],[.06,.24,-2.31],[-.06,.24,-2.31],CS.brake>.12?[1,.4,.3]:[.9,.05,.04],true);
for(const sd of [-1,1])for(let j=0;j<10;j++){const a=j*TAU/10,b=(j+1)*TAU/10,pt=(t,r)=>[sd*.22+Math.cos(t)*r,.14+Math.sin(t)*r,-2.0];panel(pt(a,.06),pt(b,.06),pt(b,.04),pt(a,.04),metal);}
// exposed wheels: narrow fronts, fat rear slicks, wishbones to the tub
const fs=clamp(CS.delta||0,-.48,.48);
for(const sd of [-1,1])for(const [wz,front] of [[1.40,true],[-1.36,false]]){const R=.33,w=front?.15:.215,cx=sd*(front?.86:.80),a=front?fs:0,co=Math.cos(a),si=Math.sin(a),cyw=R-.19,ph=wheelAngle[(front?0:2)+(sd>0?1:0)];
 const W=(u,y,f)=>world(cx+u*co+f*si,cyw+y,wz-u*si+f*co),T=(t,r,u)=>W(u,Math.cos(t)*r,Math.sin(t)*r);
 // Tyre: rounded shoulders and bulged sidewalls, smooth-shaded; machined rim with a lip, five spokes and a centre-lock nut.
 const prof=[[-1.04,.70],[-1.06,.82],[-1.0,.93],[-.86,.985],[-.6,1],[0,1],[.6,1],[.86,.985],[1.0,.93],[1.06,.82],[1.04,.70]].map(([uu,rr])=>[uu*w,rr*R]),Nt=30;
 const nrm=(k,t)=>{const a=prof[Math.max(0,k-1)],b=prof[Math.min(prof.length-1,k+1)],du=b[0]-a[0],dr=b[1]-a[1],L2=Math.hypot(du,dr)||1,nu=dr/L2,nr=-du/L2,c=Math.cos(t),sn=Math.sin(t),lx=nu*co*(-1)+0,ux=nu;return [ux*co+nr*sn*si,nr*c,-ux*si+nr*sn*co];};
 const sh=(n,col)=>shadeN(n,col,false),Vt=(t,k)=>T(t,prof[k][1],prof[k][0]);
 for(let j=0;j<Nt;j++){const t=j*TAU/Nt,n2=(j+1)*TAU/Nt;for(let k=0;k<prof.length-1;k++){const P=[Vt(t,k),Vt(n2,k),Vt(n2,k+1),Vt(t,k+1)],Nn=[nrm(k,t),nrm(k,n2),nrm(k+1,n2),nrm(k+1,t)],col=k===0||k===prof.length-2?[.13,.14,.155]:rubber;
  for(const [x,y,z] of [[0,1,2],[0,2,3]])verts.push(...P[x],...sh(Nn[x],col),...P[y],...sh(Nn[y],col),...P[z],...sh(Nn[z],col));}}
 for(const k of [-1,1]){const uu=k*w*.98,rim=[.66,.69,.73],dish=[.30,.32,.35];for(let j=0;j<Nt;j++){const t=j*TAU/Nt,n2=(j+1)*TAU/Nt;quad(T(t,R*.70,uu),T(n2,R*.70,uu),T(n2,R*.62,uu*1.01),T(t,R*.62,uu*1.01),rim);quad(T(t,R*.62,uu*.97),T(n2,R*.62,uu*.97),T(n2,R*.20,uu*.85),T(t,R*.20,uu*.85),dish);}
  for(let j=0;j<5;j++){const t=j*TAU/5+ph;quad(T(t-.16,R*.18,uu*.84),T(t-.09,R*.62,uu*.98),T(t+.09,R*.62,uu*.98),T(t+.16,R*.18,uu*.84),rim);}
  for(let j=0;j<6;j++){const t=j*TAU/6+ph,n2=(j+1)*TAU/6+ph;tri(W(uu*.80,0,0),T(t,.055,uu*.82),T(n2,.055,uu*.82),[.85,.62,.10]);}}
 for(const yy of [.02,.20])panel([sd*.30,yy,wz+.12],[sd*(Math.abs(cx)-w),cyw+yy-.10,wz+.02],[sd*(Math.abs(cx)-w),cyw+yy-.08,wz-.02],[sd*.30,yy+.02,wz-.12],blk);}
}else{
if(customBody){for(let [a,b,c,col] of customBody)tri(local(...a),local(...b),local(...c),col);}else{
// Original "Kestrel" body (Redline's own design, not a replica). Lower body loft, forward bubble canopy,
// buttresses to a flat louvred engine deck. Wheelbase, tracks and tyre sizes follow the simulated car.
function ring([z,w,lo,hi]){let pts=[];for(let j=0;j<32;j++){let a=TAU*j/32,c=Math.cos(a),sn=Math.sin(a);pts.push([w*Math.sign(c)*Math.pow(Math.abs(c),.42),(hi+lo)/2+(hi-lo)/2*Math.sign(sn)*Math.pow(Math.abs(sn),.55),z]);}return pts;}
let rows=[];for(let i=0;i<B.length-1;i++)for(let q=0;q<4;q++)rows.push(B[i].map((x,k)=>x+(B[i+1][k]-x)*q/4));rows.push(B.at(-1));
loft(rows.map(ring),(i,j,mid)=>mid[1]<-.02?dark:red,true,mid=>{const dz=Math.min(Math.abs(mid[2]+1.237),Math.abs(mid[2]-1.22));return Math.abs(mid[0])>.62&&dz<.43&&mid[1]<.18+Math.sqrt(.43*.43-dz*dz);});
for(let e of [B[0],B.at(-1)]){let a=ring(e),mid=[0,(e[2]+e[3])/2,e[0]];for(let j=0;j<32;j++)tri(local(...mid),local(...a[j]),local(...a[(j+1)%32]),red);}
// Wheel-arch liners and inner walls so the arches read as wells, not holes through the car.
for(const az of [1.22,-1.237])for(const sd of [-1,1]){for(let j=0;j<10;j++){const a1=j*Math.PI/10,a2=(j+1)*Math.PI/10,pt=(a,x)=>[x,.18+Math.sin(a)*.44,az+Math.cos(a)*.44];panel(pt(a1,sd*.56),pt(a2,sd*.56),pt(a2,sd*1.02),pt(a1,sd*1.02),[.05,.055,.06]);tri(local(sd*.56,.18,az),local(...pt(a1,sd*.56)),local(...pt(a2,sd*.56)),[.04,.045,.05]);}}
// Canopy: raked screen, short roof, steep rear glass. Body-coloured roof panel carries the stripes.
function arc([z,w,lo,hi],j){let a=Math.PI*j/16;return [w*Math.cos(a),lo+(hi-lo)*Math.pow(Math.sin(a),.55),z];}
let crow=[];for(let i=0;i<C.length-1;i++)for(let q=0;q<2;q++)crow.push(C[i].map((x,k)=>x+(C[i+1][k]-x)*q/2));crow.push(C.at(-1));
loft(crow.map(r=>Array.from({length:17},(_,j)=>arc(r,j))),(i,j)=>{const roof=i>=4&&i<=9&&j>=4&&j<=11,edge=j===0||j===15;return roof||edge?red:glass;},false);
// Buttresses from the roof to the rear haunches; flat engine deck with louvres between them.
for(const sd of [-1,1]){panel([sd*.60,.90,-.80],[sd*.70,.86,-.80],[sd*.95,.70,-1.80],[sd*.82,.72,-1.80],red);panel([sd*.60,.90,-.80],[sd*.82,.72,-1.80],[sd*.80,.66,-1.80],[sd*.58,.80,-.85],dark);}
panel([-.58,.705,-.95],[.58,.705,-.95],[.70,.69,-2.15],[-.70,.69,-2.15],[.06,.065,.075]);for(let j=0;j<7;j++){let z=-1.05-j*.15;panel([-.52,.712,z],[.52,.712,z],[.52,.712,z-.07],[-.52,.712,z-.07],carbon);}

}
// Wheels have independent steering pivots and rolling spokes. The fronts turn, rears do not.
let frontSteer=clamp(CS.delta||0,-.48,.48),rearSteer=clamp((CS.delta||0)*clamp(((CS.vx||0)-22)/40,-.15,.08),-.035,.035);
// Published geometry: wheelbase 2457 mm, tracks 1630/1582 mm, 275/35 R20 and 335/30 R21 tyres.
for(let side of [-1,1])for(let z of [-1.237,1.22]){let front=z>0,a=front?frontSteer:rearSteer,co=Math.cos(a),si=Math.sin(a),cx=side*(front?.815:.791),R=front?.350:.367,cy=R-.17,w=front?.1375:.1675,phase=wheelAngle[(front?0:2)+(side>0?1:0)];let wheel=(u,y,f)=>world(cx+u*co+f*si,cy+y,z-u*si+f*co);let tire=(j,radius,u)=>wheel(u,Math.cos(j)*radius,Math.sin(j)*radius);let count=24;
for(let j=0;j<count;j++){let t=j*TAU/count,n=(j+1)*TAU/count;quad(tire(t,R,-w),tire(n,R,-w),tire(n,R,w),tire(t,R,w),rubber);for(let k of [-1,1]){quad(tire(t,R,k*w),tire(n,R,k*w),tire(n,.245,k*(w+.003)),tire(t,.245,k*(w+.003)),rubber);quad(tire(t,.245,k*(w+.008)),tire(n,.245,k*(w+.008)),tire(n,.218,k*(w+.012)),tire(t,.218,k*(w+.012)),metal);}}
let u=side*(w+.013);for(let j=0;j<24;j++){let t=j*TAU/24,n=(j+1)*TAU/24;tri(wheel(u,0,0),tire(t,.219,u),tire(n,.219,u),carbon);}
for(let j=0;j<10;j++){let a=j*TAU/10+phase,t=a-.09,n=a+.09;quad(tire(t,.045,u+side*.004),tire(t,.213,u+side*.004),tire(n,.213,u+side*.004),tire(n,.045,u+side*.004),metal);}
for(let j=0;j<10;j++){let t=j*TAU/10,n=(j+1)*TAU/10;tri(wheel(u+side*.008,0,0),tire(t,.052,u+side*.008),tire(n,.052,u+side*.008),[.72,.75,.77]);}
// Brake caliper fixed in the wheel carrier, independent of spin.
quad(wheel(u+side*.016,-.11,.16),wheel(u+side*.016,.055,.16),wheel(u+side*.016,.055,.20),wheel(u+side*.016,-.11,.20),[.93,.63,.09]);}
if(!customBody){
// Twin racing stripes over nose, roof and deck.
for(const sx of [-1,1]){const x1=sx*.07,x2=sx*.21;for(let z=2.15;z>1.30;z-=.17){const y1=lerpT(B,z,3)+.012,y2=lerpT(B,z-.17,3)+.012;panel([x1,y1,z],[x2,y1,z],[x2,y2,z-.17],[x1,y2,z-.17],stripeC,true);}
 for(let i=2;i<5;i++){const z1=C[i][0],z2=C[i+1][0],y1=C[i][3]+.012,y2=C[i+1][3]+.012;panel([x1,y1,z1],[x2,y1,z1],[x2,y2,z2],[x1,y2,z2],stripeC,true);}
 panel([x1,.72,-.95],[x2,.72,-.95],[x2,.70,-2.15],[x1,.70,-2.15],stripeC,true);}
// Nose: thin LED strips, dark intakes, carbon splitter and canards.
let lit=[.92,.97,1];for(const sd of [-1,1]){panel([sd*.50,.31,2.205],[sd*.86,.36,2.06],[sd*.86,.39,2.07],[sd*.50,.34,2.215],lit,true);panel([sd*.30,.06,2.30],[sd*.78,.04,2.20],[sd*.78,.22,2.20],[sd*.30,.20,2.29],[.03,.035,.04]);panel([sd*.86,.10,2.05],[sd*1.02,.10,1.95],[sd*1.02,.12,1.95],[sd*.86,.12,2.05],carbon);}
panel([-.88,-.04,2.35],[.88,-.04,2.35],[.88,-.02,2.16],[-.88,-.02,2.16],carbon);panel([-.25,.10,2.31],[.25,.10,2.31],[.25,.20,2.30],[-.25,.20,2.30],[.03,.035,.04]);
for(const sd of [-1,1])panel([sd*.25,.395,1.75],[sd*.55,.405,1.75],[sd*.55,.47,1.45],[sd*.25,.46,1.45],[.04,.045,.05]);
// Track-car vents: louvres on top of the front arches and behind the front wheels.
for(const sd of [-1,1]){for(let j=0;j<6;j++){const z=1.52-j*.11;panel([sd*.66,.625,z],[sd*.93,.60,z],[sd*.93,.60,z-.05],[sd*.66,.625,z-.05],carbon);}panel([sd*1.005,.12,.86],[sd*1.005,.12,.62],[sd*1.01,.40,.62],[sd*1.01,.40,.80],[.03,.035,.04]);}
// Sides: large intakes ahead of the rear wheels, carbon skirts, mirrors.
for(const sd of [-1,1]){panel([sd*1.005,.18,-.30],[sd*1.005,.18,-.80],[sd*1.03,.46,-.84],[sd*1.00,.44,-.30],[.03,.035,.04]);panel([sd*1.02,-.05,.85],[sd*1.02,-.05,-.75],[sd*1.02,.06,-.75],[sd*1.02,.06,.85],carbon);
 panel([sd*.74,.74,.78],[sd*1.08,.78,.72],[sd*1.08,.88,.72],[sd*.74,.84,.78],red);panel([sd*1.0,.74,.70],[sd*1.10,.74,.70],[sd*1.10,.87,.70],[sd*1.0,.87,.70],carbon);}
// Tail: bracket-shaped lights, diffuser with fins, quad exhausts at the outer corners.
let stop=CS.brake>.12,light=stop?[1,.42,.30]:[.98,.07,.04],rev=CS.reverse;for(const sd of [-1,1]){panel([sd*.36,.52,-2.335],[sd*.88,.52,-2.335],[sd*.88,.565,-2.335],[sd*.36,.565,-2.335],light,true);panel([sd*.83,.34,-2.335],[sd*.88,.34,-2.335],[sd*.88,.565,-2.335],[sd*.83,.565,-2.335],light,true);
 if(rev)panel([sd*.40,.42,-2.335],[sd*.52,.42,-2.335],[sd*.52,.46,-2.335],[sd*.40,.46,-2.335],[1,1,1],true);}
panel([-.86,-.03,-2.36],[.86,-.03,-2.36],[.86,.24,-2.34],[-.86,.24,-2.34],carbon);for(let j=0;j<5;j++){let x=-.50+j*.25;panel([x,-.04,-2.42],[x,-.04,-2.05],[x,.20,-2.05],[x,.20,-2.37],[.14,.15,.17]);}
for(const sd of [-1,1])for(const ex of [.60,.74])for(let j=0;j<12;j++){let a=j*TAU/12,b=(j+1)*TAU/12,pt=(t,r)=>[sd*ex+Math.cos(t)*r,.13+Math.sin(t)*r,-2.37];panel(pt(a,.055),pt(b,.055),pt(b,.04),pt(a,.04),metal);tri(local(sd*ex,.13,-2.375),local(...pt(a,.04)),local(...pt(b,.04)),[.02,.02,.025]);}
// Blade wing on two pylons with end plates.
for(const sd of [-1,1]){panel([sd*.42,.70,-1.92],[sd*.46,.70,-1.92],[sd*.46,1.10,-2.08],[sd*.42,1.10,-2.08],carbon);panel([sd*1.02,1.02,-2.30],[sd*1.02,1.20,-2.30],[sd*1.02,1.20,-1.92],[sd*1.02,1.02,-1.95],carbon);}
panel([-1.02,1.10,-2.28],[1.02,1.10,-2.28],[1.02,1.15,-1.96],[-1.02,1.15,-1.96],carbon);panel([-1.02,1.10,-2.28],[1.02,1.10,-2.28],[1.02,1.06,-2.28],[-1.02,1.06,-2.28],stripeC,true);panel([-1.02,1.15,-1.96],[1.02,1.15,-1.96],[1.02,1.12,-1.96],[-1.02,1.12,-1.96],carbon);
}
}
if(g)for(let q=v0;q<verts.length;q+=6){const l=.3*verts[q+3]+.59*verts[q+4]+.11*verts[q+5];verts[q+3]=.12+.30*l;verts[q+4]=.45+.55*l;verts[q+5]=.60+.40*l;}}
let swimg=g.createImageData(W,H), zbuf=new Float32Array(W*H);
function software(eye,right,up,forward,lists){let pix=swimg.data;for(let i=0;i<W*H;i++){let q=i*4;pix[q]=0;pix[q+1]=0;pix[q+2]=0;pix[q+3]=0;}zbuf.fill(0);let fx=camFocal*W/2,fy=camFocal*view.width/view.height*H/2;
function project(v){let iz=1/v[2];return [W/2+v[0]*fx*iz,H*.47-v[1]*fy*iz,iz];}
function draw(a,b,c,r,gg,bb){let p=project(a),q=project(b),t=project(c),x0=p[0],y0=p[1],x1=q[0],y1=q[1],x2=t[0],y2=t[1];let minx=Math.max(0,Math.floor(Math.min(x0,x1,x2))),maxx=Math.min(W-1,Math.ceil(Math.max(x0,x1,x2))),miny=Math.max(0,Math.floor(Math.min(y0,y1,y2))),maxy=Math.min(H-1,Math.ceil(Math.max(y0,y1,y2)));if(minx>maxx||miny>maxy)return;let den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2);if(Math.abs(den)<1e-6)return;let inv=1/den;let fog=1-Math.exp(-Math.max(0,(a[2]+b[2]+c[2])/3)*.00045);let R=(r*(1-fog)+.60*fog)*255,G=(gg*(1-fog)+.76*fog)*255,B=(bb*(1-fog)+.94*fog)*255;for(let y=miny;y<=maxy;y++)for(let x=minx;x<=maxx;x++){let u=((y1-y2)*(x+.5-x2)+(x2-x1)*(y+.5-y2))*inv,v=((y2-y0)*(x+.5-x2)+(x0-x2)*(y+.5-y2))*inv,w=1-u-v;if(u<-.0001||v<-.0001||w<-.0001)continue;let iz=u*p[2]+v*q[2]+w*t[2],idx=y*W+x;if(iz<=zbuf[idx])continue;zbuf[idx]=iz;let j=idx*4;pix[j]=R;pix[j+1]=G;pix[j+2]=B;pix[j+3]=255;}}
for(const [vb,v0,v1] of lists)for(let i=v0;i<v1;i+=18){let a=[];for(let j=i;j<i+18;j+=6){let x=vb[j]-eye[0],y=vb[j+1]-eye[1],z=vb[j+2]-eye[2];a.push([x*right[0]+y*right[1]+z*right[2],x*up[0]+y*up[1]+z*up[2],x*forward[0]+y*forward[1]+z*forward[2]]);}if(a.every(p=>p[2]<.25))continue;let clip=[];for(let j=0;j<3;j++){let u=a[j],v=a[(j+1)%3],ins=u[2]>=.25,next=v[2]>=.25;if(ins)clip.push(u);if(ins!==next){let t=(.25-u[2])/(v[2]-u[2]);clip.push([u[0]+(v[0]-u[0])*t,u[1]+(v[1]-u[1])*t,.25]);}}for(let j=1;j<clip.length-1;j++)draw(clip[0],clip[j],clip[j+1],vb[i+3],vb[i+4],vb[i+5]);}for(let y=0;y<H;y++)for(let x=0;x<W;x++){let idx=y*W+x,j=idx*4,iz=zbuf[idx];if(!iz)continue;let depth=1/iz, vx=(x+.5-W/2)*depth/fx,vy=(H*.47-y-.5)*depth/fy;
let wx=eye[0]+vx*right[0]+vy*up[0]+depth*forward[0], wy=eye[1]+vx*right[1]+vy*up[1]+depth*forward[1], wz=eye[2]+vx*right[2]+vy*up[2]+depth*forward[2];let r=pix[j],gg=pix[j+1],b=pix[j+2],green=gg>r*1.28&&gg>b*1.35,grey=Math.abs(r-b)<31&&Math.abs(gg-r)<21&&r>56&&r<184;let n=hash3(Math.floor(wx*(green?4:13)),Math.floor(wy*(green?4:13)),Math.floor(wz*(green?4:13))),big=hash3(Math.floor(wx*.55),Math.floor(wy*.55),Math.floor(wz*.55));let detail=Math.exp(-depth*.009);let f=1+(green?(.46*(n-.5)+.24*(big-.5)):grey?(.24*(n-.5)+.11*(big-.5)):.035*(n-.5))*detail;pix[j]=r*f;pix[j+1]=gg*f;pix[j+2]=b*f;}}

function hash3(x,y,z){let h=Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(z,1274126177);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;}
// Far level of detail: a low-detail ribbon and treeline for the whole lap, built once. The detailed
// near scene replaces the ribbon around the car; the far treeline sits beyond the near forest rows.
const FAR_STEP=2,NEAR_GPU=110,NEAR_CPU=64;let farData=null,farTreeData=null,farSeg=[],farTreeSeg=[],farBuf=null,farTreeBuf=null,farRanges=[];
function buildFar(){const save=verts,S=Math.ceil(N/FAR_STEP);verts=[];farSeg=[];
 for(let g=0;g<S;g++){farSeg.push(verts.length/6);const i=g*FAR_STEP,a=track[i%N],b=track[(i+FAR_STEP)%N],gr=.94+rng(i*37)*.13,grass=[.27*gr,.74*gr,.11*gr];
  roadstrip(a,b,-half,half,paint.road,.04);
  for(const side of [-1,1]){roadstrip(a,b,side*(half-.45),side*(half-.12),paint.white,.06);roadstrip(a,b,side*half,side*(half+.9),[.78,.70,.42],.0);
   const bounds=[half+.9,13,40,90,190],ext=extentAt(i,side);for(let q=0;q<bounds.length-1;q++)if(bounds[q]<ext)roadstrip(a,b,side*bounds[q],side*Math.min(bounds[q+1],ext),grass.map(x=>x*(.92+q*.03+rng(i+q*7)*.08)),-.03);}}
 farSeg.push(verts.length/6);farData=new Float32Array(verts);verts=[];farTreeSeg=[];
 for(let g=0;g<S;g++){farTreeSeg.push(verts.length/6);const i=g*FAR_STEP;if(g%2)continue;const a=track[i%N];
  for(const side of [-1,1]){const seed=i*13+side*7;if(rng(seed)<.18)continue;const dist=side*(66+rng(seed+1)*70),h=13+rng(seed+2)*12,base=wp(a,dist),t=.8+rng(seed+3)*.35;if(Math.abs(dist)>extentAt(i,side)-h*.3-2||nearOtherRoad(base[0],base[2],i,9+h*.3))continue;
   cylinder(base,h*.30,0,h,[.10*t,.36*t,.07*t],5,rng(seed)*3);}}
 farTreeSeg.push(verts.length/6);farTreeData=new Float32Array(verts);verts=save;
 if(gl){farBuf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,farBuf);gl.bufferData(gl.ARRAY_BUFFER,farData,gl.STATIC_DRAW);farTreeBuf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,farTreeBuf);gl.bufferData(gl.ARRAY_BUFFER,farTreeData,gl.STATIC_DRAW);}}
// Vertex ranges of the far ribbon outside the near window [k-10, k+near).
// Driving line (Gran Turismo style): apex-biased line coloured by what the car should be doing there:
// teal = accelerate, amber = hold/lift near the corner speed, red = brake. Built once from a grip/power profile.
let lineOn=true;const lineOff=new Float32Array(N);const bodyNowPhys=()=>active?raceConfig.car:carBody;
function buildLine(K){const lineCol=new Uint8Array(N),m=K.mass,kz=K.downforce,mu=K.mu*.80,vmax=new Float64Array(N),pw=Math.max(...K.torque.map(([r,t])=>t*r*TAU/60))*K.driveEfficiency;
 for(let i=0;i<N;i++){let k=0,kk=0;for(let j=-3;j<=3;j++){const q=track[(i+j+N)%N].k;k=Math.max(k,Math.abs(q));}for(let j=-7;j<=7;j++)kk+=track[(i+j+N)%N].k*(1-Math.abs(j)/8);
  lineOff[i]=clamp(kk*24,-2.6,2.6);const den=k-mu*kz/m;vmax[i]=den>1e-5?Math.min(90,Math.sqrt(mu*9.81/den)):90;}
 const back=Float64Array.from(vmax),fwd=Float64Array.from(vmax);
 for(let pass=0;pass<2;pass++)for(let i=2*N-1;i>=0;i--){const a=i%N,b=(i+1)%N,dec=6.0*K.mu+mu*kz*back[b]*back[b]/m;back[a]=Math.min(back[a],Math.sqrt(back[b]*back[b]+2*dec*step));}
 for(let pass=0;pass<2;pass++)for(let i=1;i<2*N;i++){const a=i%N,b=(i-1+N)%N,u=Math.max(fwd[b],5),acc=Math.max(.5,Math.min(K.mu*5,pw/(m*u))-.5*1.225*K.dragArea*u*u/m);fwd[a]=Math.min(vmax[a],Math.sqrt(u*u+2*acc*step));}
 for(let i=0;i<N;i++){const v=Math.min(back[i],fwd[i]);lineCol[i]=back[i]<fwd[i]-.4?2:v>vmax[i]-1.2?1:0;}return lineCol;}
const LINE_COL={};const curLineCol=()=>LINE_COL[bodyNowPhys()]||(LINE_COL[bodyNowPhys()]=buildLine(Race.spec(bodyNowPhys())));
const LINE_COLORS=[[.18,.55,1],[1,.80,.05],[1,.12,.06]];
const lineAt=q=>{const f=wrap(q,L)/step,i=Math.floor(f),t=f-i;return lineOff[i%N]+(lineOff[(i+1)%N]-lineOff[i%N])*t;};
// Drawn per frame from just ahead of the car, so it never sweeps under the camera or pops at rebuilds.
// Tyre smoke: puffs from the rear tyres while they spin or slide hard (burnouts, drifts, lock-ups).
const smoke=[];let lastSmokeT=0;
function updateSmoke(){const t=performance.now(),dt=clamp((t-lastSmokeT)/1000,0,.05);lastSmokeT=t;
 for(const q of smoke){q.age+=dt;q.y+=dt*(.6+q.age*.4);q.r+=dt*(1.2+q.age);q.x+=q.vx*dt;q.z+=q.vz*dt;}while(smoke.length&&smoke[0].age>2.2)smoke.shift();
 if(!active||paused)return;const K=Race.spec(raceConfig.car),p=at(s),yaw=p.yaw+heading,sy=Math.sin(yaw),cy=Math.cos(yaw),cx=p.x+p.rx*d,cz=p.z+p.rz*d,gy=ground(p,d);
 const spin=Math.max((carState.w[2]+carState.w[3])/2*K.tyreR.radius-Math.max(carState.vx,0),0),slide=Math.max(carState.slip[2],carState.slip[3]),amt=carState.burnout?clamp(spin/8,0,1):clamp((slide-1.7)/1.5,0,1)*clamp(v/6,0,1);
 if(amt<.05||smoke.length>160)return;const rz=-K.wheelbase*K.frontWeight;
 for(const sd of [-1,1])if(Math.random()<amt){const lx=sd*K.trackR/2,x=cx+lx*cy+rz*sy,z=cz-lx*sy+rz*cy;smoke.push({x,y:gy+.25,z,r:.35,age:0,vx:(Math.random()-.5)*1.2-sy*Math.min(v,8)*.2,vz:(Math.random()-.5)*1.2-cy*Math.min(v,8)*.2});}}
function drawSmoke(){for(const q of smoke){const f=1-q.age/2.2,c=[.78*f+.2,.79*f+.2,.82*f+.21],r=q.r;
 quad([q.x-r,q.y-r*.6,q.z],[q.x+r,q.y-r*.6,q.z],[q.x+r,q.y+r*.6,q.z],[q.x-r,q.y+r*.6,q.z],c,true);quad([q.x,q.y-r*.6,q.z-r],[q.x,q.y-r*.6,q.z+r],[q.x,q.y+r*.6,q.z+r],[q.x,q.y+r*.6,q.z-r],c,true);}}
function drivingLine(){const s0=Math.ceil((s+4)/10)*10;for(let q=s0;q<s+300;q+=10){const x=q-s,q1=q,q2=q+7,p1=at(q1),p2=at(q2),w1=.55*clamp((x-4)/12,0,1),w2=.55*clamp((x+7)/12,0,1),o1=lineAt(q1),o2=lineAt(q2),c=LINE_COLORS[curLineCol()[Math.floor(wrap(q1,L)/step)%N]];
 quad(wp(p1,o1-w1,.07),wp(p2,o2-w2,.07),wp(p2,o2+w2,.07),wp(p1,o1+w1,.07),c,true);}}
function farWindow(k,near){const S=farSeg.length-1,gA=Math.floor(wrap(k-10,N)/FAR_STEP),gB=Math.min(S,Math.ceil(wrap(k+near,N)/FAR_STEP));
 const r=gA<gB?[[0,gA],[gB,S]]:[[gB,gA]];return r.filter(([x,y])=>y>x).map(([x,y])=>[farSeg[x],farSeg[y]]);}
// Camera presets in the spirit of Gran Turismo's views.
const CAMS={high:{dist:11.5,h:5.6,pitch:-.20,focal:1.0,blend:.30,rate:8},far:{dist:8.4,h:3.4,pitch:-.11,focal:1.06,blend:.28,rate:9},
 bumper:{fwd:2.3,h:.62,pitch:0,focal:1.0,blend:.12,rate:14},hood:{fwd:.38,h:1.36,pitch:0,focal:1.08,blend:.2,rate:12}};
let camYaw=0,lastCamT=0,camFocal=1.0,camLag=0;let cachedK=-1,cachedScene=[],staticCount=0;let baseK=0;let cameraMode='high';$('camera').onchange=e=>cameraMode=e.target.value;
function render(){let p=at(s),yaw=p.yaw+heading,sy=Math.sin(yaw),cy=Math.cos(yaw),pitch=Math.atan2(at(s+14).y-at(s-4).y,18)*.65, cam=CAMS[cameraMode]||CAMS.high,chase=!!cam.dist;let cx=p.x+p.rx*d,cz=p.z+p.rz*d,cyy=ground(p,d);// Camera aims between where the car is travelling and where the road goes 10-40 m ahead, smoothed,
// so the road ahead stays in view through bends and slides.
 const tNow=performance.now(),cdt=clamp((tNow-lastCamT)/1000,0,.1);lastCamT=tNow;
 const tgt=at(s+clamp(v*.55,10,40)),roadYaw=Math.atan2(tgt.x+tgt.rx*d*.5-cx,tgt.z+tgt.rz*d*.5-cz);
 const travel=(carState.vx||0)>1?yaw+clamp(Math.atan2(carState.vy||0,carState.vx),-.6,.6):yaw,camTarget=travel+ang(roadYaw-travel)*cam.blend;
 const dy=ang(camTarget-camYaw);camYaw=Math.abs(dy)>1.2||cdt===0?camTarget:camYaw+dy*Math.min(1,cdt*cam.rate);camFocal=cam.focal*(1-(active?.20*clamp((v-15)/70,0,1):0)); // field of view widens with speed
 if(!active){camYaw=yaw+tNow*.00028+.6;} // lobby showroom: slow orbit around the car
 const ks=Math.sin(camYaw),kc=Math.cos(camYaw);
 camLag+=(clamp(-(carState.ax||0)*.045,-.35,.55)-camLag)*Math.min(1,cdt*4); // slight pull-back under braking, GT-style
 let dist=!active?6.2:chase?cam.dist+camLag:0,eye=!active||chase?[cx-ks*dist,cyy+(active?cam.h:1.55),cz-kc*dist]:[cx+sy*cam.fwd,cyy+cam.h,cz+cy*cam.fwd];pitch+=active?cam.pitch:-.06;
 if(active&&!paused){const rough=(carState.surface||[]).reduce((m,x)=>Math.max(m,x),0),amp=(rough===1?.016:rough===2?.03:0)*clamp(v/20,0,1),t=tNow/1000; // speed buzz, kerb and grass rumble
  eye[1]+=amp*(Math.sin(t*41)+.6*Math.sin(t*67+1.3));eye[0]+=amp*.6*Math.sin(t*53+.4);eye[2]+=amp*.6*Math.sin(t*47+2.1);pitch+=amp*.15*Math.sin(t*59);}let cameraYaw=camYaw,cs=Math.sin(cameraYaw),cc=Math.cos(cameraYaw);let right=[cc,0,-cs],forward=[cs*Math.cos(pitch),Math.sin(pitch),cc*Math.cos(pitch)],up=cross(forward,right);verts=[];if(!farData)buildFar();let k=Math.floor(s/step/8)*8;let rebuild=k!==cachedK;if(rebuild){
// Continuous road, sloped terrain strips, geometric roadside objects.
for(let j=-10;j<(gl?NEAR_GPU:NEAR_CPU);j++){let i=wrap(k+j,N),a=track[i],b=track[(i+1)%N];let alt=i%2,gr=.94+rng(i*37)*.13,grass=[.27*gr,.74*gr,.11*gr];roadstrip(a,b,-half,half,[.31+(gr-1)*.10,.32+(gr-1)*.10,.355+(gr-1)*.10],.04);
// Subtle wear bands, placed on the road geometry, not on the screen.
for(let side of [-1,1])roadstrip(a,b,side*1.25,side*1.60,[.26+(gr-1)*.08,.27+(gr-1)*.08,.30+(gr-1)*.08],.046);for(let side of [-1,1]){let bounds=[half,half+.8,8,13,23,40,70,110],ext=extentAt(i,side);for(let q=0;q<bounds.length-1;q++)if(bounds[q]<ext)roadstrip(a,b,side*bounds[q],side*Math.min(bounds[q+1],ext),q===0?[.78,.70,.42]:grass.map((x,k)=>x*(.95+rng(i*2+q)*.09)),-.025);roadstrip(a,b,side*(half-.20),side*(half-.35),paint.white,.065);if(road.curb(i*step,side))roadstrip(a,b,side*(half+.05),side*(half+1.10),alt?paint.red:paint.white,.09);else roadstrip(a,b,side*(half+.05),side*(half+.22),[.80,.79,.74],.07);rail(a,b,side*8.2);if(i%3===0)marker(a,side,i);if(i%2===0)grassTuft(a,side,i);if(i%2===0)forest(a,side,i,0,j<30);if(i%4===1)forest(a,side,i+5,1,false);if(gl&&j<55&&i%6===3)forest(a,side,i+11,2,false);}}
cachedK=k;farRanges=farWindow(k,gl?NEAR_GPU:NEAR_CPU);if(gl){gl.bindBuffer(gl.ARRAY_BUFFER,staticBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(verts),gl.STATIC_DRAW);staticCount=verts.length/6;}else cachedScene=verts.slice();}verts=gl?[]:cachedScene.slice();if(lineOn&&active)drivingLine();updateSmoke();drawSmoke();if(chase||!active){ // contact shadow follows the road surface (grade and banking) so it never slices the car
 const hd=yaw-p.yaw,ch=Math.cos(hd),sh=Math.sin(hd),pt=t=>{const lat=Math.cos(t)*1.14,fwd=Math.sin(t)*2.35;return wp(at(wrap(s+fwd*ch-lat*sh,L)),d+fwd*sh+lat*ch,.047);},center=wp(p,d,.047);for(let j=0;j<24;j++)tri(center,pt(j*TAU/24),pt((j+1)*TAU/24),[.19,.22,.25],true);car(p,yaw,d,null,s);}if(ghostOn&&active&&ghost&&ghost.id===raceConfig.id){const t=Math.min(carState.ticks,ghost.n-1),gs=ghost.s[t],gp=at(gs),gd=ghost.d[t];if(Math.abs(gs-s)<300)car(gp,gp.yaw+ghost.h[t],gd,{ax:ghost.ax[t],ay:ghost.ay[t],delta:ghost.delta[t],vx:ghost.vx[t],brake:0},gs);}if(active&&cameraMode==='hood'&&bodyNow()!=='f1'){ // Physical hood mesh, not a screen-space illustration.
let X=cx,Z=cz,Y=cyy;let lp=(x,y,z)=>[X+x*cy+z*sy,Y+y,Z-x*sy+z*cy];quad(lp(-.95,.68,.95),lp(.95,.68,.95),lp(.83,.45,2.2),lp(-.83,.45,2.2),[.88,.90,.88]);quad(lp(-.95,.68,.95),lp(-.83,.45,2.2),lp(-.9,.40,2.2),lp(-1,.58,.95),[.65,.68,.66]);}
if(gl){gpuRender(eye,right,up,forward,cameraYaw,pitch);}else {cpuGrid();const S=farSeg.length-1,g0=Math.ceil(wrap(k+NEAR_CPU,N)/FAR_STEP),lists=[[verts,0,verts.length]];
 for(let g=g0;g<g0+170;g++){const q=g%S;lists.push([farData,farSeg[q]*6,farSeg[q+1]*6],[farTreeData,farTreeSeg[q]*6,farTreeSeg[q+1]*6]);}software(eye,right,up,forward,lists);paintASCII(swimg.data,cameraYaw,pitch);}}
// Each cell is a real monochrome ASCII font mask. No scene-colored background.
const cw=4,ch=6,aw=16,ah=24;const glyphCanvas=document.createElement('canvas');const glyphCtx=glyphCanvas.getContext('2d',{willReadFrequently:true});
const candidates=' .,:;-=+*oxX#%@';
function drawGlyph(c){glyphCtx.clearRect(0,0,aw,ah);glyphCtx.font='bold 24px monospace';glyphCtx.textBaseline='middle';glyphCtx.textAlign='center';glyphCtx.fillStyle='#fff';glyphCtx.fillText(c,aw/2,ah/2+.2);return glyphCtx.getImageData(0,0,aw,ah).data;}
glyphCanvas.width=aw;glyphCanvas.height=ah;const sorted=[...candidates].map(c=>({c,coverage:drawGlyph(c).filter((_,i)=>i%4===3).reduce((a,b)=>a+b,0)})).sort((a,b)=>a.coverage-b.coverage);const ramp=sorted.map(o=>o.c).join('');glyphCanvas.width=aw*ramp.length;glyphCanvas.height=ah;glyphCtx.font='bold 24px monospace';glyphCtx.textBaseline='middle';glyphCtx.textAlign='center';glyphCtx.fillStyle='#fff';for(let i=0;i<ramp.length;i++)glyphCtx.fillText(ramp[i],i*aw+aw/2,ah/2+.2);
const SS=2; // scene rendered at 2x the glyph grid, averaged per cell: stable, less shimmer
const levels=[[320,120],[480,180],[640,240],[800,300],[960,360]],modeNames=['color','raw','pure','mono','white'];let skyProgram,skyLoc;let level=2,autoLevel=2,gridW=0,gridH=0,post,postLoc={},quadBuffer,sceneTex,depthRB,fbo,atlas;let fps=0,frameCount=0,measureAt=performance.now(),lastAdjust=measureAt,slowWindows=0,fastWindows=0,renderMs=0;
function setGrid(next){level=next;let [w,h]=levels[next];if(w===gridW&&h===gridH)return;gridW=w;gridH=h;gl.bindTexture(gl.TEXTURE_2D,sceneTex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w*SS,h*SS,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.bindRenderbuffer(gl.RENDERBUFFER,depthRB);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_STENCIL,w*SS,h*SS);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('ASCII framebuffer incomplete');gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
if(gl){try{sceneTex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,sceneTex);for(let [key,val] of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,val);depthRB=gl.createRenderbuffer();fbo=gl.createFramebuffer();
 // The depth renderbuffer must be bound and given storage before it can be attached; otherwise WebGL rejects the
 // attachment and the scene renders without depth testing (far terrain painted over the road).
 gl.bindRenderbuffer(gl.RENDERBUFFER,depthRB);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_STENCIL,levels[level][0]*SS,levels[level][1]*SS);
 gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,sceneTex,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.RENDERBUFFER,depthRB);
 if(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE)!==gl.RENDERBUFFER)throw Error('Depth buffer could not be attached');
 gridW=0;gridH=0;setGrid(level);
 atlas=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,atlas);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,glyphCanvas);for(let [key,val] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,val);
 post=gl.createProgram();gl.attachShader(post,shader(gl.VERTEX_SHADER,`attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`));gl.attachShader(post,shader(gl.FRAGMENT_SHADER,`precision highp float; varying vec2 uv;uniform sampler2D scene, glyphs;uniform vec2 grid;uniform float yaw,pitch,mode,speedFx;
 void main(){vec2 cell=floor(uv*grid),at=(cell+.5)/grid,o=.25/grid;vec3 c=(texture2D(scene,at+vec2(-o.x,-o.y)).rgb+texture2D(scene,at+vec2(o.x,-o.y)).rgb+texture2D(scene,at+vec2(-o.x,o.y)).rgb+texture2D(scene,at+o).rgb)*.25;vec2 rd=at-vec2(.5,.46);float sk=speedFx*dot(rd,rd)*.55;if(sk>.002){c=(c+texture2D(scene,at-rd*sk*.33).rgb+texture2D(scene,at-rd*sk*.66).rgb+texture2D(scene,at-rd*sk).rgb)*.25;}
 float l=dot(c,vec3(.2126,.7152,.0722));float ix=clamp(floor((.52+.48*sqrt(clamp(l,0.,1.)))*float(${ramp.length-1})+.5),2.,float(${ramp.length-1}));if(mode==1.){gl_FragColor=vec4(c,1.);return;}vec2 fr=fract(uv*grid);vec2 sampleUV=vec2((ix+clamp(fr.x,.04,.96))/float(${ramp.length}),clamp(1.-fr.y,.03,.97));float mask=texture2D(glyphs,sampleUV).a;float peak=max(max(c.r,c.g),c.b);vec3 cs=clamp(mix(vec3(l),c,1.6),0.,1.);vec3 fg=clamp(pow(cs,vec3(.78))*1.45+.04,0.,1.);if(mode==2.)fg=clamp(c/max(peak,.001)*.99+.08,0.,1.);if(mode==3.)fg=vec3(.28,1.,.53)*(.52+.48*sqrt(l));else if(mode==4.)fg=vec3(.55+.45*sqrt(l));vec3 bg=mode==0.?clamp(pow(cs,vec3(.85))*.78,0.,1.):vec3(.012,.018,.026);if(mode==0.)fg=clamp(pow(cs,vec3(.8))*1.22+.05,0.,1.);gl_FragColor=vec4(mix(bg,fg,mask*(mode==0.?.85:1.)),1.);}`));gl.linkProgram(post);if(!gl.getProgramParameter(post,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(post));for(let name of ['scene','glyphs','grid','yaw','pitch','mode','speedFx'])postLoc[name]=gl.getUniformLocation(post,name);postLoc.p=gl.getAttribLocation(post,'p');quadBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);skyProgram=gl.createProgram();gl.attachShader(skyProgram,shader(gl.VERTEX_SHADER,`attribute vec2 p; varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`));gl.attachShader(skyProgram,shader(gl.FRAGMENT_SHADER,`precision highp float;varying vec2 uv;uniform float yaw,pitch;
 float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.)),f.x),f.y);}
void main(){vec2 at=uv;vec3 c;float yy=1.-at.y;float f=clamp((yy+pitch*.36)/.64,0.,1.);float az=yaw+atan((at.x-.5)/.59);float el=(.47-yy)*.75+pitch;vec2 p=vec2(az*5.,el*12.);float cloud=clamp((.65*n(p)+.25*n(p*2.1)+.1*n(p*4.4)-.48)*6.5,0.,1.)*clamp((el+.07)*10.,0.,1.);c=mix(mix(vec3(.08,.40,.88),vec3(.55,.75,.97),f),vec3(1.,1.,.98),cloud);gl_FragColor=vec4(c,1.);}`));gl.linkProgram(skyProgram);if(!gl.getProgramParameter(skyProgram,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(skyProgram));skyLoc={p:gl.getAttribLocation(skyProgram,'p'),yaw:gl.getUniformLocation(skyProgram,'yaw'),pitch:gl.getUniformLocation(skyProgram,'pitch')};}catch(e){useCPU(e);autoLevel=2;}}
function gpuRender(eye,right,up,forward,yaw,pitch){let q=$('quality').value;setGrid(q==='auto'?autoLevel:Number(q));let width=Math.min(3840,Math.max(gridW*4,Math.round(raster.clientWidth*(window.devicePixelRatio||1))));width=Math.round(width/16)*16;let height=width*9/16;if(raster.width!==width||raster.height!==height){raster.width=width;raster.height=height;}
 gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.viewport(0,0,gridW*SS,gridH*SS);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.disable(gl.DEPTH_TEST);gl.useProgram(skyProgram);gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer);gl.enableVertexAttribArray(skyLoc.p);gl.vertexAttribPointer(skyLoc.p,2,gl.FLOAT,false,0,0);gl.uniform1f(skyLoc.yaw,yaw);gl.uniform1f(skyLoc.pitch,pitch);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.disableVertexAttribArray(skyLoc.p);gl.useProgram(program);gl.enable(gl.DEPTH_TEST);gl.uniform3fv(loc.uEye,eye);gl.uniform3fv(loc.uRight,right);gl.uniform3fv(loc.uUp,up);gl.uniform3fv(loc.uForward,forward);gl.uniform2f(loc.uFocal,camFocal,camFocal*16/9);
 function draw(buf,count,first=0){if(count<=0)return;gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.enableVertexAttribArray(loc.aPosition);gl.vertexAttribPointer(loc.aPosition,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(loc.aColor);gl.vertexAttribPointer(loc.aColor,3,gl.FLOAT,false,24,12);gl.drawArrays(gl.TRIANGLES,first,count);}
 draw(staticBuffer,staticCount);if(farBuf){for(const [a,b] of farRanges)draw(farBuf,b-a,a);draw(farTreeBuf,farTreeData.length/6);}gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(verts),gl.DYNAMIC_DRAW);draw(buffer,verts.length/6);gl.disableVertexAttribArray(loc.aPosition);gl.disableVertexAttribArray(loc.aColor);
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,raster.width,raster.height);gl.disable(gl.DEPTH_TEST);gl.useProgram(post);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,sceneTex);gl.uniform1i(postLoc.scene,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,atlas);gl.uniform1i(postLoc.glyphs,1);gl.uniform2f(postLoc.grid,gridW,gridH);gl.uniform1f(postLoc.yaw,yaw);gl.uniform1f(postLoc.pitch,pitch);gl.uniform1f(postLoc.mode,modeNames.indexOf($('mode').value));gl.uniform1f(postLoc.speedFx,active?clamp((v-25)/55,0,1):0);gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer);gl.enableVertexAttribArray(postLoc.p);gl.vertexAttribPointer(postLoc.p,2,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.disableVertexAttribArray(postLoc.p);gl.activeTexture(gl.TEXTURE0);
}
raster.addEventListener('webglcontextlost',e=>{e.preventDefault();useCPU('WebGL context lost');cachedK=-1;autoLevel=1;lastState='';});
function noise2(x,y){let a=Math.floor(x),b=Math.floor(y),u=x-a,v=y-b;u=u*u*(3-2*u);v=v*v*(3-2*v);return (hash3(a,b,7)*(1-u)+hash3(a+1,b,7)*u)*(1-v)+(hash3(a,b+1,7)*(1-u)+hash3(a+1,b+1,7)*u)*v;}
function skyColor(x,y,yaw,pitch){let f=clamp((y/H+pitch*.36)/.64,0,1),az=yaw+Math.atan((x-W*.5)/(W*.59)),el=(.47-y/H)*.75+pitch;let ax=az*5,ay=el*12,n=.57*noise2(ax,ay)+.26*noise2(ax*2.1,ay*2.1)+.11*noise2(ax*4.4,ay*4.4)+.06*noise2(ax*9,ay*9);let cloud=clamp((n-.48)*6.5,0,1)*clamp((el+.07)*10,0,1),shade=clamp(.78+.28*noise2(ax+2,ay+1),0,1);let rr=20+120*f,gg=102+89*f,bb=224+23*f;return [rr+(255*shade-rr)*cloud,gg+(250*shade-gg)*cloud,bb+(244*shade-bb)*cloud];}
let cpuFrame=out.createImageData(view.width,view.height);const maskPixels=glyphCtx.getImageData(0,0,glyphCanvas.width,glyphCanvas.height).data;const cpuMasks=Array.from(ramp,(_,i)=>Array.from({length:cw*ch},(_,j)=>{let total=0;for(let yy=0;yy<4;yy++)for(let xx=0;xx<4;xx++)total+=maskPixels[((Math.floor(j/cw)*4+yy)*glyphCanvas.width+i*aw+(j%cw)*4+xx)*4+3];return Math.round(total/16);}));
const cpuLevels=[[240,90],[400,150],[480,180],[640,240],[768,288]];function cpuGrid(){let q=$('quality').value,next=q==='auto'?autoLevel:Number(q),[w,h]=cpuLevels[next];if(w===W&&h===H&&view.width===W*cw)return;W=w;H=h;source.width=W;source.height=H;view.width=W*cw;view.height=H*ch;swimg=g.createImageData(W,H);zbuf=new Float32Array(W*H);cpuFrame=out.createImageData(view.width,view.height);}
const skyW=128,skyH=48,skyPixels=new Uint8Array(skyW*skyH*3);let skyKey='';function refreshSky(yaw,pitch){let key=Math.round(yaw*80)+':'+Math.round(pitch*80);if(key===skyKey)return;skyKey=key;for(let y=0;y<skyH;y++)for(let x=0;x<skyW;x++){let c=skyColor(x*W/skyW,y*H/skyH,yaw,pitch),q=(y*skyW+x)*3;skyPixels[q]=c[0];skyPixels[q+1]=c[1];skyPixels[q+2]=c[2];}}
const tileCache=new Array(32768);const gamma=Array.from({length:256},(_,i)=>Math.min(255,Math.round(Math.pow(i/255,.72)*390+14)));const indexLUT=Array.from({length:256},(_,i)=>Math.max(2,Math.round((.52+.48*Math.sqrt(i/255))*(ramp.length-1))));
function smoothTile(r,g,b){let key=(r>>3)<<10|(g>>3)<<5|(b>>3),tile=tileCache[key];if(tile)return tile;r=(r&248)|4;g=(g&248)|4;b=(b&248)|4;let lum=(.2126*r+.7152*g+.0722*b),sat=v=>Math.max(0,Math.min(255,Math.round(lum+(v-lum)*1.6)));let m=cpuMasks[indexLUT[lum|0]],fr=gamma[sat(r)],fg=gamma[sat(g)],fb=gamma[sat(b)];tile=new Uint32Array(24);for(let j=0;j<24;j++){let t=m[j]/255;const br=r*.62,bgc=g*.62,bb=b*.62;tile[j]=0xff000000|(((bb+(fb-bb)*t*.85)|0)<<16)|(((bgc+(fg-bgc)*t*.85)|0)<<8)|((br+(fr-br)*t*.85)|0);}return tileCache[key]=tile;}
function paintASCII(img,yaw,pitch){let mode=$('mode').value, dest=new Uint32Array(cpuFrame.data.buffer),raw=mode==='raw',smooth=mode==='color',br=smooth?19:3,bg=smooth?23:5,bb=smooth?27:7;if(!smooth)dest.fill(0xff000000|(bb<<16)|(bg<<8)|br);refreshSky(yaw,pitch);for(let y=0;y<H;y++)for(let x=0;x<W;x++){let q=(y*W+x)*4;let r=img[q],gg=img[q+1],b=img[q+2];if(img[q+3]<100){let k=((y*skyH/H|0)*skyW+(x*skyW/W|0))*3;r=skyPixels[k];gg=skyPixels[k+1];b=skyPixels[k+2];}if(smooth){let t=smoothTile(r,gg,b),j=y*ch*view.width+x*cw,w=view.width;for(let k=0;k<24;k+=4,j+=w){dest[j]=t[k];dest[j+1]=t[k+1];dest[j+2]=t[k+2];dest[j+3]=t[k+3];}continue;}let lum=(.2126*r+.7152*gg+.0722*b)|0,ix=indexLUT[lum],fr=gamma[r],fg=gamma[gg],fb=gamma[b];if(mode==='pure'){let peak=Math.max(r,gg,b,1);fr=Math.min(255,r*255/peak+18);fg=Math.min(255,gg*255/peak+18);fb=Math.min(255,b*255/peak+18);}else if(mode==='mono'){fg=132+123*Math.sqrt(lum/255);fr=fg*.28;fb=fg*.53;}else if(mode==='white'){fr=fg=fb=140+115*Math.sqrt(lum/255);}let m=cpuMasks[ix],origin=y*ch*view.width+x*cw;if(raw){let col=0xff000000|(b<<16)|(gg<<8)|r;for(let dy=0;dy<ch;dy++)dest.fill(col,origin+dy*view.width,origin+dy*view.width+cw);continue;}for(let dy=0;dy<ch;dy++){let row=origin+dy*view.width;for(let dx=0;dx<cw;dx++){let t=m[dy*cw+dx];if(t===0)continue;dest[row+dx]=0xff000000|(((bb+(fb-bb)*t/255)|0)<<16)|(((bg+(fg-bg)*t/255)|0)<<8)|((br+(fr-br)*t/255)|0);}}}out.putImageData(cpuFrame,0,0);}

// ---------- Game flow, ASCII interface and input ----------
const storage={mem:{},get(k){try{let v=localStorage.getItem(k);return v==null?this.mem[k]??null:JSON.parse(v);}catch{return this.mem[k]??null;}},set(k,v){this.mem[k]=v;try{localStorage.setItem(k,JSON.stringify(v));}catch{}}};
function guestName(){let n=storage.get('redline-guest');if(!n){n='Driver '+Math.floor(1000+Math.random()*9000);storage.set('redline-guest',n);}return n;}
let online=false,ranked=false,runningToken=null,attempt=null,leaderboard=null,runs=[],raceConfig=challenge,accumulator=0,finishBusy=false,ready=false,practiceBest={},latestResult=null,lastRun=null,startPending=false,goAt=0;
function time(t){if(t==null)return '--:--.---';let ms=Math.round(t*1000),m=Math.floor(ms/60000),sec=Math.floor(ms/1000)%60;return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;}
async function api(path,data){let res=await fetch('/api/'+path,{...(data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),signal:AbortSignal.timeout(5000)});let b=await res.json();if(!res.ok)throw Error(b.error||'Server unavailable');return b;}
// Ghost and best runs. Runs replay exactly from their inputs, so a best run is stored as inputs and
// re-simulated into a pose track (and a time-at-distance table for the live delta) when a run starts.
let ghostOn=true,ghost=null,runTrace=[];const TRACE_STEP=10;
const bestKey=c=>Race.VERSION+'-best-'+(c.practiceOnly?'lap':c.number)+'-'+c.car;
function loadBest(c){const b=storage.get(bestKey(c));return b&&b.id===c.id.replace(/-\d{4}-\d\d-\d\d/,'')?b:null;}
function saveBest(c,time,inputs){const cur=loadBest(c);if(cur&&cur.time<=time)return false;storage.set(bestKey(c),{id:c.id.replace(/-\d{4}-\d\d-\d\d/,''),time,inputs,assists:c.assists});return true;}
function buildGhost(c){const b=loadBest(c);if(!b)return null;const cfg=Race.withCar(c,c.car,b.assists),a=Race.initial(cfg),max=cfg.maxTicks;const S=[],D=[],Hd=[],AX=[],AY=[],DL=[],VX=[],tAt=[],tr=[];
 try{for(const [code,n] of b.inputs)for(let j=0;j<n&&!a.done&&a.ticks<max;j++){Race.step(a,code,cfg,road);S.push(a.s);D.push(a.d);Hd.push(a.heading);AX.push(a.ax);AY.push(a.ay);DL.push(a.delta);VX.push(a.vx);
  const x=Math.floor((a.s-cfg.start)/TRACE_STEP);while(tAt.length<=x&&x>=0){tAt.push(a.ticks/Race.HZ);tr.push(a.v);}}}catch{return null;}
 if(!a.done||a.invalid)return null;const F=x=>Float32Array.from(x);return {id:c.id,n:S.length,s:F(S),d:F(D),h:F(Hd),ax:F(AX),ay:F(AY),delta:F(DL),vx:F(VX),tAt,trace:tr,time:b.time};}
function liveDelta(){if(!ghost||ghost.id!==raceConfig.id)return null;const x=(s-raceConfig.start)/TRACE_STEP,i=Math.floor(x);if(i<1||i+1>=ghost.tAt.length)return null;
 const tg=ghost.tAt[i]+(ghost.tAt[i+1]-ghost.tAt[i])*(x-i);return carState.ticks/Race.HZ-tg;}
function traceChart(a,b){if(!a||a.length<4)return '';const cols=46,rows=7,n=Math.max(a.length,b?b.length:0),top=Math.max(...a,...(b||[0]))*1.05,grid=Array.from({length:rows},()=>Array(cols).fill(' '));
 const plot=(arr,ch)=>{for(let c=0;c<cols;c++){const i=Math.min(arr.length-1,Math.floor(c/cols*n));if(i<0)continue;const r=rows-1-Math.min(rows-1,Math.floor(arr[i]/top*rows));grid[r][c]=grid[r][c]!==' '&&grid[r][c]!==ch?'#':ch;}};
 if(b)plot(b,'.');plot(a,'*');return `\nSPEED TRACE  * this run${b?'  . best':''}  (max ${Math.round(top*3.6/1.05)} km/h)\n`+grid.map(r=>'|'+r.join('')).join('\n')+'\n+'+'-'.repeat(cols);}
let wheelAngle=[0,0,0,0],lastWheelT=0;
function syncState(){let now=performance.now(),dt=clamp((now-lastWheelT)/1000,0,.05);lastWheelT=now;for(let i=0;i<4;i++)wheelAngle[i]=(wheelAngle[i]+(carState.w?carState.w[i]:0)*dt)%TAU;
 s=carState.s;d=carState.d;v=carState.v;heading=carState.heading;steer=carState.steer;elapsed=carState.time??carState.ticks/Race.HZ+carState.penalty;hit=carState.contact?1:0;}

// ASCII helpers
const esc=x=>String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const padS=(x,n)=>String(x).padStart(n),padE=(x,n)=>{x=String(x);return x.length>n?x.slice(0,n-1)+'~':x.padEnd(n);};
const span=(cls,t)=>`<span class="${cls}">${esc(t)}</span>`;
const ramp10=' .:-=+*#%@';
function frames(){for(const box of document.querySelectorAll('.box')){if(box.querySelector('.fr'))continue;const title=box.dataset.title||'';
 const mk=(cls,html)=>{const e=document.createElement('span');e.className='fr '+cls;e.setAttribute('aria-hidden','true');e.innerHTML=html;box.prepend(e);};
 const dash='-'.repeat(600);mk('fr-t','+--'+(title?'[ <b>'+esc(title)+'</b> ]':'')+dash);mk('fr-b','+'+dash);mk('fr-l','|\n'.repeat(300));mk('fr-r','|\n'.repeat(300));mk('fr-c fr-c1','+');mk('fr-c fr-c2','+');}}
function sectorName(c){return c.name;}

// HUD -------------------------------------------------------------
function rpmBar(rpm){const K=Race.spec(raceConfig.car),cells=26,hi=K.redline,lo=hi*.33,n=clamp(Math.round((rpm-lo)/(hi-lo)*cells),0,cells);let out='';
 for(let i=0;i<cells;i++){const r=lo+(i+1)*(hi-lo)/cells,ch=i<n?'|':'.';out+=i<n?span(r>hi*.955?'red':r>hi*.87?'amb':'acc',ch):span('muted',ch);}return '['+out+']';}
function tyreCell(i){const slip=carState.slip?carState.slip[i]:0,load=carState.load?carState.load[i]:0,g=ramp10[clamp(Math.round(load/900),1,9)],cls=slip>1.15?'red':slip>.85?'amb':'acc';return '['+span(cls,g+g)+']';}
function gMeter(){const cols=11,rows=5,ax=(carState.ax||0)/9.81,ay=(carState.ay||0)/9.81,x=clamp(Math.round(5+ay*2.5),0,cols-1),y=clamp(Math.round(2-ax*1.6),0,rows-1);const lines=[];
 for(let r=0;r<rows;r++){let line='';for(let c=0;c<cols;c++){line+=c===x&&r===y?span('acc','o'):span('muted',c===5&&r===2?'+':c===5?':':r===2?'-':' ');}lines.push(line);}return lines;}
function hud(){const AFh=raceConfig.assists||{},kmh=Math.round(v*3.6),gear=carState.reverse?'R':(AFh.auto===false?'M':'')+carState.gear,target=carState.cornerSpeed,dist=clamp(s-raceConfig.start,0,raceConfig.length),corner=road.corner(s);
 $('hudNext').innerHTML=active&&!paused&&performance.now()>goAt?nextCorner():'';$('cue').textContent=active&&!paused&&v>target*.80+1.5&&performance.now()>goAt?'BRAKE > '+Math.round(target*.78*3.6):''; // cautious: following it keeps the car on the road
 const pen=carState.penalty>0?span('red','  +'+carState.penalty.toFixed(1)+'s'):'';
 const status=paused?span('amb','PAUSED'):active&&performance.now()<goAt?'ROLLING START':carState.invalid?span('red','INVALID · '+carState.reason):carState.contact?span('red','BARRIER CONTACT'):carState.burnout&&carState.gas>.5?span('amb','BURNOUT'):(carState.drift||0)>3?span('amb',`DRIFT ${Math.round(Math.abs(Math.atan2(carState.vy,Math.max(Math.abs(carState.vx),.1)))*57.3)}° · ${Math.round(carState.drift)}`):carState.airborne?span('amb','LIGHT · CREST'):carState.surface&&carState.surface.filter(x=>x===2).length>=2?span('amb','GRASS'):(ranked?'RANKED':'PRACTICE');
 $('hudMain').innerHTML=`<span class="big">${padS(kmh,3)}</span> km/h  ${span('acc',(String(gear)[0]==='M'?'':'G')+gear)}\n${rpmBar(carState.rpm||0)} ${padS(Math.round(carState.rpm||0),4)}\n${span('acc',time(elapsed))}${pen}${(()=>{const dl=liveDelta();return dl==null?'':'  '+span(dl<=0?'acc':'red',(dl<=0?'-':'+')+Math.abs(dl).toFixed(3));})()}\n${padS(Math.floor(dist),5)} / ${raceConfig.length.toFixed(0)} m  ${esc(corner.toUpperCase())}\n${status}`;
 const gm=gMeter(),gTot=Math.sqrt((carState.ax||0)**2+(carState.ay||0)**2)/9.81;
 const bt=carState.bt||[0,0,0,0],tf=Math.max(bt[0],bt[1]),tr=Math.max(bt[2],bt[3]),Kb=Race.spec(raceConfig.car),tcol=t=>t>Kb.padFade?'red':t>Kb.padFade*.85?'amb':t<Kb.padCold?'muted':'acc';
 $('hudCar').innerHTML=`DISC F ${span(tcol(tf),padS(Math.round(tf),3)+'C')} R ${span(tcol(tr),padS(Math.round(tr),3)+'C')}\nTYRES        G ${gTot.toFixed(2)}\n${tyreCell(0)} ${tyreCell(1)}  ${gm[0]}\n             ${gm[1]}\n             ${gm[2]}\n${tyreCell(2)} ${tyreCell(3)}  ${gm[3]}\n             ${gm[4]}`;
 const flag=(on,t,en=true)=>!en?span('red','-'.repeat(t.length)):on?span('acc',t):span('muted',t),k=Math.round(clamp(carState.steer,-1,1)*4)+4;
 const absOn=carState.abs&&carState.abs.some(x=>x<.97),tcOn=carState.tc<.97,psmOn=(carState.psm||0)>.02;
 $('hudPed').innerHTML=`THR [${span('acc','#'.repeat(Math.round(carState.gas*10)).padEnd(10,'.'))}]\nBRK [${span('red','#'.repeat(Math.round(carState.brake*10)).padEnd(10,'.'))}]\nSTR [${Array.from({length:9},(_,i)=>i===k?span('acc','#'):i===4?'|':'-').join('')}]\n${flag(absOn,'ABS',AFh.abs)} ${flag(tcOn,'TC',AFh.tc)} ${flag(psmOn,'STAB',AFh.stab)} ${flag(carState.reverse,'REV')}`;
 const pct=dist/raceConfig.length,cols=200;$('progress').textContent='['+'='.repeat(Math.floor(pct*cols))+'>'+' '.repeat(Math.max(0,cols-Math.floor(pct*cols)))+']';}
// What is coming: direction and sharpness of the next bend, its distance and name, and blind crests.
function nextCorner(){let found=-1,x0=8;while(x0<200&&Math.abs(at(s+x0).k)>1/400)x0+=4; // skip the bend we are in
 for(let x=x0+8;x<=x0+420;x+=4){const k=Math.abs(at(s+x).k);if(k>1/240){found=x;break;}}let out='';
 if(found>=0){let kMax=0,sum=0;for(let x=found;x<found+140;x+=4){const k=at(s+x).k;sum+=k;if(Math.abs(k)>Math.abs(kMax))kMax=k;}
  const R=1/Math.abs(kMax),n=R<45?3:R<95?2:1,dir=sum>0?'R':'L',arrow=(dir==='R'?'>':'<').repeat(n),name=road.corner(s+found+30)||road.corner(s+found);
  out=`<span class="arrow">${dir==='L'?arrow+' ':''}${dir==='R'?'RIGHT':'LEFT'}${dir==='R'?' '+arrow:''}</span>\n${padS(Math.round(found/10)*10,3)} m${name?'  '+esc(name.toUpperCase()):''}`;}
 for(let x=25;x<=260;x+=5){const q=at(s+x);if(q.kv*Math.max(v*v,900)<-1.6){out+=`\n${span('amb','CREST · '+Math.round(x/5)*5+' m')}`;break;}}
 return out;}
function drawMap(){let cols=26,rows=11,grid=Array.from({length:rows},()=>Array(cols).fill(' ')),pts=[];const len=raceConfig.length,stepM=Math.max(5,len/600);
 for(let i=0;i<=len;i+=stepM)pts.push(at(raceConfig.start+i));let xs=pts.map(p=>p.x),zs=pts.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),scale=Math.min((cols-3)/Math.max(1,maxX-minX),(rows-2)*2/Math.max(1,maxZ-minZ));
 let put=(p,c)=>{let x=Math.round((p.x-(minX+maxX)/2)*scale+(cols-1)/2),y=Math.round(-(p.z-(minZ+maxZ)/2)*scale/2+(rows-1)/2);if(grid[y]&&x>=0&&x<cols)grid[y][x]=c;};
 pts.forEach((p,i)=>put(p,i*stepM<=s-raceConfig.start?'+':'.'));if(!raceConfig.practiceOnly)put(at(raceConfig.start+len),'F');put(at(clamp(s,raceConfig.start,raceConfig.start+len)),'@');
 map.innerHTML=grid.map(r=>r.map(c=>c==='@'?span('acc','@'):c==='F'?span('red','F'):c==='+'?span('acc','+'):esc(c)).join('')).join('\n');}

// Lobby panels ----------------------------------------------------
function drawBoard(){const lb=leaderboard,you=lb?.you,lines=[];
 $('boardNote').innerHTML=online?(lb?.total?`<span class="acc">●</span> LIVE · ${lb.total} ${lb.total===1?'driver':'drivers'} today`:'<span class="acc">●</span> LIVE · no finishers yet'):'Offline · local times only';
 lines.push(' POS  DRIVER            TIME      GAP');
 if(!(lb?.rows?.length))lines.push(esc(online?'      be the first to set a time':'      run the server to race globally'));
 const p1=lb?.rows?.[0]?.time;for(const r of lb?.rows||[]){const row=`${padS(r.rank,4)}  ${padE(r.name,16)}  ${time(r.time)}  ${r.rank===1?'':'+'+(r.time-p1).toFixed(3)}`;lines.push(r.you?span('you',row):esc(row));}
 if(you&&you.rank>(lb.rows?.length||0))lines.push('  ···',span('you',`${padS(you.rank,4)}  ${padE(storage.get('redline-name')||'You',16)}  ${time(you.time)}  +${you.delta.toFixed(3)}`));
 $('leader').innerHTML=lines.join('\n');$('resultText').textContent='';$('resultTime').textContent='';$('resultDetail').textContent=attempt&&!you?attempt.reason||(attempt.status==='running'?'Attempt used':''):'';
 $('share').hidden=attempt?.status!=='finished';drawField();}
// Your result against everyone else's: rank, percentile, spread of times, and where the time was won or lost.
function drawField(){const box=$('fieldBox'),lb=leaderboard,you=lb?.you,F=lb?.field;if(!you||!F){box.hidden=true;return;}box.hidden=false;const o=[];
 o.push(`${span('acc','P'+you.rank)} of ${lb.total}   ${time(you.time)}`,you.percentile==null?'only finisher so far':`faster than ${span('acc',you.percentile.toFixed(1)+'%')} of the field`,`+${you.delta.toFixed(3)} to P1 · ${you.time<=F.median?'-':'+'}${Math.abs(you.time-F.median).toFixed(3)} to median`,'');
 const mx=Math.max(...F.hist),myBin=Math.min(F.hist.length-1,Math.floor((you.time-F.lo)/F.binWidth));
 o.push('TIMES  (each row a slice of the field)');F.hist.forEach((n,i)=>{const t0=F.lo+i*F.binWidth,bar='#'.repeat(Math.round(n/mx*18));o.push(`${time(t0).padStart(9)} ${i===myBin?span('you',padE(bar,18)+' < you'):padE(bar,18)} ${n||''}`);});
 if(F.you&&F.leader&&F.medianSplits){o.push('','SPLITS  vs P1        vs median');let pl=0,pm=0;F.you.forEach((t,k)=>{const dl=t-F.leader[k],dm=t-F.medianSplits[k],sl=dl-pl,sm=dm-pm;pl=dl;pm=dm;
  const cell=(x,seg)=>{const c=x<=0?'acc':'red';return span(c,((x<=0?'-':'+')+Math.abs(x).toFixed(2)).padStart(7))+span('muted',` ${seg<=0?'▲':'▼'}`);};o.push(`${padS((k+1)*10+'%',4)}  ${cell(dl,sl)}     ${cell(dm,sm)}`);});
  o.push(span('muted','▲ gained / ▼ lost on that tenth'));}
 $('field').innerHTML=o.join('\n');}
function routeArt(){const cols=40,rows=19,pts=track,xs=pts.map(p=>p.x),zs=pts.map(p=>p.z),minX=Math.min(...xs),minZ=Math.min(...zs),maxX=Math.max(...xs),maxZ=Math.max(...zs);
 const sx=(cols-3)/(maxX-minX),sz=(rows-3)/(maxZ-minZ),grid=Array.from({length:rows},()=>Array(cols).fill(' '));
 const put=(p,ch)=>{let x=Math.round((p.x-minX)*sx)+1,y=Math.round((maxZ-p.z)*sz)+1;if(grid[y]&&x>=0&&x<cols&&(ch!==':'||grid[y][x]===' '))grid[y][x]=ch;};
 for(let q=0;q<L;q+=8)put(at(q),':');for(let q=0;q<=challenge.length;q+=5)put(at(challenge.start+q),'@');put(at(0),'S');
 $('asciiRoute').innerHTML=grid.map(r=>r.map(c=>c==='@'?span('selected','@'):c==='S'?span('sf','S'):c).join('')).join('\n');
 // Elevation profile of today's sector, 38 columns x 6 rows
 const ec=38,er=6,hs=[];for(let i=0;i<ec;i++)hs.push(at(challenge.start+challenge.length*i/(ec-1)).y);const lo=Math.min(...hs),hi=Math.max(...hs),out=[];
 for(let r=er-1;r>=0;r--){let line='';for(let i=0;i<ec;i++){const lvl=(hs[i]-lo)/Math.max(1,hi-lo)*(er-1);line+=lvl>=r+.5?'#':lvl>=r?'_':' ';}out.push(line);}
 $('elev').innerHTML=`\nELEVATION ${hi.toFixed(0)} m\n`+span('selected',out.join('\n'))+`\n${'-'.repeat(ec)}\n${padE(lo.toFixed(0)+' m',ec-6)}${(challenge.length/1000).toFixed(2)}km`;
 const total=track.reduce((m,p)=>Math.max(m,p.y),0)-track.reduce((m,p)=>Math.min(m,p.y),1e9);$('routeDist').textContent=`${(L/1000).toFixed(3)} km lap · ${total.toFixed(0)} m elevation range · ${Race.sectors.length} sectors`;}
function sectorList(){$('sectorList').innerHTML=Race.sectors.map((c,i)=>{const row=`${i+1===challenge.number?'>':' '} ${String(i+1).padStart(2,'0')} ${padE(c.name,30)} ${(c.length/1000).toFixed(2)}`,best=practiceBest[Race.VERSION+'-'+(i+1)];return (i+1===challenge.number?span('acc',row):esc(row))+(best?'\n      '+span('muted','practice best '+time(best)):'');}).join('\n')+`\n\n${span('muted','New sector daily at 00:00 UTC.')}`;}
function specSheet(){const C=Race.spec(carBody),pk=Math.max(...C.torque.map(([r,t])=>t*r*TAU/60)),pkR=C.torque.reduce((b,[r,t])=>t*r>b[1]?[r,t*r]:b,[0,0])[0],tq=C.torque.reduce((b,x)=>x[1]>b[1]?x:b,[0,0]);
 const est=C.id==='f1',down=r=>Math.round(C.downforce*(r/3.6)**2/9.81);
 $('spec').innerHTML=[span('acc',C.display),est?'Main car · daily runs':'Second car · practice',est?'Original generic 1980s single-seater':'Original body; performance from','',
  est?'':'published '+C.name+' figures',`RWD · ${C.ratios.length}-speed · ${C.redline} rpm${C.boostShare?' · turbo':''}`,`POWER   ${(pk/735.5).toFixed(0)} PS / ${pkR} rpm`,`TORQUE  ${tq[1]} Nm / ${tq[0]} rpm`,`MASS    ${C.mass} kg with driver`,`AERO    ${down(250)} kg @ 250 km/h`,`BASE    ${Math.round(C.wheelbase*1000)} mm`,'',
  span('muted',est?'Estimated period-typical figures.':'Tyre, inertia and CG estimated.'),span('muted','Assists: '+C.assistText)].filter((x,i)=>x!==''||i>3).join('\n');}
function resultCard(st,c){if(!st)return '';const W=34,row=(k,val)=>'| '+padE(k,10)+padE(val,W-14)+' |',line='+'+'-'.repeat(W-2)+'+';
 return [line,row('RUN',(c.practiceOnly?'FULL LAP · 20.8 km':'SECTOR '+c.number)),row('CAR',c.carName||''),...(c.practiceOnly?[]:[row('',c.name)]),row('TIME',st.time!=null?time(st.time):'DNF'),row('PENALTY','+'+st.penalty.toFixed(1)+' s'),row('CONTACTS',String(st.collisions)),row('TOP SPEED',(st.maxSpeed*3.6).toFixed(0)+' km/h'),...(st.driftBest>20?[row('BEST DRIFT',String(Math.round(st.driftBest)))]:[]),line].join('\n');}
function updateLobby(){routeArt();sectorList();
 $('stageMode').textContent='DAILY / '+String(challenge.number).padStart(2,'0');$('dailyLabel').textContent='Daily time trial · '+challenge.day;$('sectorTitle').textContent=challenge.name;
 $('sectorLabel').textContent=`Sector ${String(challenge.number).padStart(2,'0')} of ${Race.sectors.length} · ${(challenge.length/1000).toFixed(2)} km · rolling start ${Math.round(challenge.rolling*3.6)} km/h · dry · daily car ${challenge.carName}`;
 $('netLabel').textContent=online?'[ ONLINE ]':'[ OFFLINE / LOCAL ]';document.body.classList.remove('racing');$('overlay').hidden=false;
 $('overlayTag').textContent=attempt?'Daily challenge complete':'Daily challenge';$('overlayTitle').textContent=attempt?(attempt.status==='finished'?time(attempt.time):'Attempt used'):'Today’s race';$('overlayDesc').textContent=attempt?'Your daily score is locked. Practice is unlimited.':'One ranked attempt. Fastest time wins. Practice runs never count.';
 $('resultCard').textContent=lastRun?resultCard(lastRun.state,lastRun.config)+(lastRun.newBest?'\nNEW BEST'+(lastRun.prevBest?` (${(lastRun.state.time-lastRun.prevBest).toFixed(3)} s)`:'')+' · saved as your ghost':'')+traceChart(lastRun.trace,lastRun.ghostTrace):'';$('start').hidden=!!attempt;$('start').disabled=!ready;$('practice').disabled=!ready;$('lap').disabled=!ready;$('mStart').hidden=!!attempt;$('mStart').disabled=!ready;$('mPractice').disabled=!ready;$('mLap').disabled=!ready;
 $('perf').textContent='Ready · '+(gl?'GPU':'CPU');$('overlayBox').style.display=lastRun||attempt?'':'none';$('reset').disabled=true;$('pause').hidden=true;drawBoard();}
let liveSrc=null;function goLive(){if(!online||liveSrc||typeof EventSource==='undefined')return;liveSrc=new EventSource('/api/live');
 liveSrc.onmessage=async()=>{try{const data=await api('daily');if(data.challenge.id!==challenge.id)return;leaderboard=data.leaderboard;attempt=data.attempt||attempt;drawBoard();}catch{}};}
// Start playable at once in local mode; the leaderboard server, when there is one, is joined in the background.
async function init(){attempt=storage.get(challenge.id);practiceBest=storage.get('redline-practice-'+Race.VERSION)||{};$('name').value=storage.get('redline-name')||'';raceConfig=challenge;carState=Race.initial(challenge);syncState();cachedK=-1;ready=true;frames();specSheet();updateLobby();
 if(location.protocol==='file:')return;try{const data=await api('daily');if(active||startPending)return;online=true;const changed=data.challenge.id!==challenge.id;challenge=data.challenge;attempt=data.attempt;leaderboard=data.leaderboard;if(changed){raceConfig=challenge;carState=Race.initial(challenge);syncState();cachedK=-1;}updateLobby();goLive();}catch{online=false;}}
// Sound: synthesised flat-six (firing frequency = rpm/60 x 3), wind, tyre scrub and kerb rumble.
// Created on the first click (browsers only allow audio after a gesture). M mutes.
let audio=null,soundOn=storage.get('redline-sound')!==false;
function initAudio(){if(audio||!soundOn)return;try{const A=new (window.AudioContext||window.webkitAudioContext)(),master=A.createGain();master.gain.value=.55;master.connect(A.destination);
 const noiseBuf=A.createBuffer(1,A.sampleRate*2,A.sampleRate),nd=noiseBuf.getChannelData(0);let seed=1;for(let i=0;i<nd.length;i++){seed=(seed*16807)%2147483647;nd[i]=seed/1073741823.5-1;}
 const noise=()=>{const n=A.createBufferSource();n.buffer=noiseBuf;n.loop=true;n.start();return n;};
 const eng=A.createGain();eng.gain.value=0;const lp=A.createBiquadFilter();lp.type='lowpass';lp.Q.value=4;const shaper=A.createWaveShaper(),curve=new Float32Array(256);for(let i=0;i<256;i++){const x=i/128-1;curve[i]=Math.tanh(2.6*x);}shaper.curve=curve;
 // Engine voice: six-cylinder four-stroke fires 3 times per revolution. A periodic wave carries the firing order
 // and its harmonics plus half-orders (cylinder-to-cylinder variation), which gives the rasp of a racing six.
 const wave=(amps)=>{const re=new Float32Array(amps.length+1),im=new Float32Array(amps.length+1);amps.forEach((a,i)=>im[i+1]=a);return A.createPeriodicWave(re,im);};
 const o1=A.createOscillator(),o2=A.createOscillator(),o3=A.createOscillator(),g1=A.createGain(),g2=A.createGain(),g3=A.createGain();
 o1.setPeriodicWave(wave([1,.62,.45,.38,.22,.18,.12,.09,.06,.05,.04,.03]));o2.setPeriodicWave(wave([1,.35,.15,.08]));o3.setPeriodicWave(wave([1,.5,.33,.25,.2]));
 g1.gain.value=.55;g2.gain.value=.30;g3.gain.value=.16;
 o1.connect(g1);o2.connect(g2);o3.connect(g3);for(const g of [g1,g2,g3])g.connect(shaper);shaper.connect(lp);lp.connect(eng);eng.connect(master);o1.start();o2.start();o3.start();
 const wind=A.createGain(),wbp=A.createBiquadFilter();wbp.type='bandpass';wbp.Q.value=.6;wind.gain.value=0;noise().connect(wbp);wbp.connect(wind);wind.connect(master);
 const tyre=A.createGain(),tbp=A.createBiquadFilter();tbp.type='bandpass';tbp.frequency.value=1150;tbp.Q.value=9;tyre.gain.value=0;noise().connect(tbp);tbp.connect(tyre);tyre.connect(master);
 const rum=A.createGain(),ro=A.createOscillator();ro.type='square';ro.frequency.value=38;rum.gain.value=0;ro.connect(rum);rum.connect(master);ro.start();
 const turbo=A.createGain(),to=A.createOscillator();to.type='sine';turbo.gain.value=0;to.connect(turbo);turbo.connect(master);to.start();
 audio={A,master,eng,lp,o1,o2,o3,wind,wbp,tyre,rum,ro,turbo,to};}catch(e){audio=null;}}
function updateAudio(){if(!audio)return;const {A}=audio,t=A.currentTime,on=active&&!paused&&soundOn,tc=.04;
 if(!on){for(const g of [audio.eng,audio.wind,audio.tyre,audio.rum])g.gain.setTargetAtTime(0,t,.08);return;}
 const rpm=carState.rpm||1000,f=rpm/60*3,thr=carState.gas;audio.o1.frequency.setTargetAtTime(f,t,tc);audio.o2.frequency.setTargetAtTime(f/6,t,tc);audio.o3.frequency.setTargetAtTime(f*.5*1.004,t,tc); // firing order, crank order, half order
 const red=Race.spec(raceConfig.car).redline;audio.lp.frequency.setTargetAtTime(380+rpm/red*2400+thr*2400,t,tc);audio.eng.gain.setTargetAtTime(.035+.11*thr+.05*rpm/red,t,tc);
 audio.wbp.frequency.setTargetAtTime(400+v*14,t,.1);audio.wind.gain.setTargetAtTime(Math.min(.35,v*v/9000),t,.1);
 const slip=Math.max(...(carState.slip||[0]));audio.tyre.gain.setTargetAtTime(v>4?clamp((slip-.95)*.25,0,.16):0,t,.05);
 const K=Race.spec(raceConfig.car);if(K.boostShare){const b=carState.boost||0;audio.to.frequency.setTargetAtTime(1800+b*2600+rpm*.12,t,.08);audio.turbo.gain.setTargetAtTime(.018*b*thr,t,.08);}else audio.turbo.gain.setTargetAtTime(0,t,.05);
 const kerb=(carState.surface||[]).some(x=>x===1)&&v>5;audio.ro.frequency.setTargetAtTime(20+v*.9,t,.05);audio.rum.gain.setTargetAtTime(kerb?.05:0,t,.03);}
function setSound(on){soundOn=on;storage.set('redline-sound',on);$('soundBtn').querySelector('b').textContent=on?'ON':'OFF';if(on)initAudio();if(audio)audio.A[on?'resume':'suspend']().catch(()=>{});}
function launch(config,isRanked){initAudio();if(audio)audio.A.resume().catch(()=>{});$('stageMode').textContent=isRanked?'RANKED RUN':config.practiceOnly?'PRACTICE / FULL LAP':'PRACTICE';$('sectorTitle').textContent=sectorName(config);$('sectorLabel').textContent=config.practiceOnly?`Full Nordschleife lap · ${(config.length/1000).toFixed(3)} km · rolling start ${Math.round(config.rolling*3.6)} km/h · practice only`:`Sector ${String(config.number).padStart(2,'0')} · ${(config.length/1000).toFixed(2)} km · ${isRanked?'ranked':'practice'}`;raceConfig=config;carState=Race.initial(config);runs=[];runTrace=[];ghost=buildGhost(config);syncState();ranked=isRanked;active=true;paused=false;keys={};accumulator=0;goAt=performance.now()+3000;measureAt=goAt;frameCount=0;slowWindows=0;fastWindows=0;cachedK=-1;
 document.body.classList.add('racing');$('overlay').hidden=true;banner('3','ROLLING START');$('reset').disabled=false;$('reset').textContent=isRanked?'End run':'End practice';$('pause').hidden=isRanked;$('stage').focus({preventScroll:true});$('pause').textContent='Pause';$('stage').scrollIntoView({block:'nearest'});}
$('start').onclick=async()=>{if(!ready||attempt||startPending||active||finishBusy)return;if(!online&&storage.get(challenge.id)){attempt=storage.get(challenge.id);updateLobby();return;}startPending=true;$('start').disabled=true;let name=$('name').value.trim()||guestName();storage.set('redline-name',name);
 try{if(online){let data=await api('start',{day:challenge.day,name,assists:getAssists(Race.MAIN_CAR)});runningToken=data.token;challenge=data.challenge;}else storage.set(challenge.id,{status:'running'});attempt={status:'running'};drawBoard();launch(Race.withCar(challenge,Race.MAIN_CAR,online?challenge.assists:getAssists(Race.MAIN_CAR)),true);}
 catch(e){$('overlayDesc').textContent=e.message;try{let data=await api('daily');attempt=data.attempt;leaderboard=data.leaderboard;updateLobby();}catch{}}finally{startPending=false;$('start').disabled=!!attempt;}};
$('practice').onclick=()=>{if(active||startPending||finishBusy||!ready)return;launch(Race.withCar(challenge,carBody,getAssists(carBody)),false);};
$('lap').onclick=()=>{if(active||startPending||finishBusy||!ready)return;launch(Race.withCar(Race.fullLap(carBody),carBody,getAssists(carBody)),false);};
function addInput(code){let last=runs.at(-1);if(last&&last[0]===code)last[1]++;else runs.push([code,1]);}
// Gamepad: left stick steers, triggers are analogue throttle and brake (encoded into the replay).
let padActive=false;
function inputCode(){const pads=navigator.getGamepads?[...navigator.getGamepads()].filter(Boolean):[];const pad=pads.find(p=>p.connected);
 if(pad){const ax=pad.axes[0]||0,gas=pad.buttons[7]?.value||0,brk=pad.buttons[6]?.value||0;if(Math.abs(ax)>.15||gas>.05||brk>.05)padActive=true;
  if(padActive&&!keys.w&&!keys.s&&!keys.a&&!keys.d){const dz=.06,st=Math.abs(ax)<dz?0:Math.sign(ax)*Math.pow((Math.abs(ax)-dz)/(1-dz),1.4);const pb=(pad.buttons[5]?.pressed?1:0)-(pad.buttons[4]?.pressed?1:0);if(pb&&!padShiftHeld)pendingShift=pb;padShiftHeld=pb;
  return takeShift(Race.encodeAnalog(st,gas,brk));}}
 padActive=padActive&&!(keys.w||keys.s||keys.a||keys.d);return takeShift((keys.w?1:0)|(keys.s?2:0)|(keys.a?4:0)|(keys.d?8:0));}
function takeShift(code){const d=raceConfig.assists&&raceConfig.assists.auto===false?pendingShift:0;pendingShift=0;if(d)return Race.withShift(code,d);return handHeld()?Race.withHandbrake(code):code;}
function handHeld(){if(keys.hb)return true;const pads=navigator.getGamepads?[...navigator.getGamepads()].filter(Boolean):[];return pads.some(p=>p.connected&&p.buttons[1]?.pressed);}
async function finish(abandon=false){if(!active||finishBusy)return;active=false;keys={};banner('');finishBusy=true;$('reset').disabled=true;const valid=carState.done&&!carState.invalid&&!abandon&&carState.time!=null;
 let result={status:valid?'finished':'dnf',time:valid?carState.time:null,reason:valid?'':carState.reason||'Abandoned'};const ghostTrace=ghost&&ghost.id===raceConfig.id?ghost.trace:null,prevBest=ghost&&ghost.id===raceConfig.id?ghost.time:null;let newBest=false;if(valid)newBest=saveBest(raceConfig,carState.time,runs.map(x=>[...x]));lastRun={state:{...carState,time:valid?carState.time:null,driftBest:Math.max(carState.driftBest||0,carState.drift||0)},config:raceConfig,trace:runTrace.slice(),ghostTrace,prevBest,newBest};
 if(ranked){if(online){try{let data=await api('finish',{token:runningToken,inputs:runs,abandon});attempt=data.attempt;leaderboard=data.leaderboard;}catch(e){attempt={status:'dnf',reason:'Submission failed: '+e.message};}}else{attempt=result;storage.set(challenge.id,attempt);}latestResult=attempt;}
 else{latestResult=result;const key=raceConfig.practiceOnly?Race.VERSION+'-lap':Race.VERSION+'-'+raceConfig.number;if(valid){practiceBest[key]=Math.min(practiceBest[key]??Infinity,result.time);storage.set('redline-practice-'+Race.VERSION,practiceBest);}}
 finishBusy=false;updateLobby();$('overlayTag').textContent=ranked?'Ranked result':raceConfig.practiceOnly?'Full lap result':'Practice result';$('overlayTitle').textContent=latestResult.status==='finished'?time(latestResult.time):'Run ended';
 const pkey=raceConfig.practiceOnly?Race.VERSION+'-lap':Race.VERSION+'-'+raceConfig.number;$('overlayDesc').textContent=latestResult.status==='finished'?(ranked?'Your ranked time is final.':`Practice best: ${time(practiceBest[pkey])}${raceConfig.practiceOnly&&raceConfig.car==='kestrel'?' · real 992 GT3 RS: 6:49.328':''}`):latestResult.reason||'Attempt ended';}
// Two-click confirm for ending a ranked run (browser confirm() is unavailable in sandboxed frames).
let resetArmed=0;$('reset').onclick=()=>{if(!active)return;if(!ranked||performance.now()-resetArmed<3000){resetArmed=0;finish(true);return;}resetArmed=performance.now();$('reset').textContent='Click again to end';setTimeout(()=>{if(active&&ranked)$('reset').textContent='End run';},3000);};
$('share').onclick=async()=>{let you=leaderboard?.you,text=`REDLINE. ${challenge.day}\nNordschleife S${challenge.number} ${challenge.name}\n${time(attempt.time)}${you?` · #${you.rank}/${leaderboard.total}${you.percentile==null?'':` · faster than ${you.percentile.toFixed(1)}%`}`:' · offline run'}`;try{await navigator.clipboard.writeText(text);$('share').textContent='Copied';}catch{$('resultDetail').textContent=text;$('share').textContent='Copy blocked: text shown above';}};
// ASCII cycle buttons drive the (hidden) selects the renderer reads.
function cycle(btn,sel){const b=$(btn),el=$(sel),show=()=>b.querySelector('b').textContent=el.options[el.selectedIndex].text.toUpperCase();b.onclick=()=>{el.selectedIndex=(el.selectedIndex+1)%el.options.length;el.dispatchEvent(new Event('change'));show();if(active)$('stage').focus({preventScroll:true});};show();}
$('soundBtn').onclick=()=>setSound(!soundOn);$('soundBtn').querySelector('b').textContent=soundOn?'ON':'OFF';
paintIndex=clamp(storage.get('redline-paint')||0,0,PAINTS.length-1);const showPaint=()=>{$('paintBtn').querySelector('b').textContent=PAINTS[paintIndex].name.toUpperCase();$('mPaint').textContent=PAINTS[paintIndex].name.toUpperCase();};showPaint();$('paintBtn').onclick=()=>{paintIndex=(paintIndex+1)%PAINTS.length;storage.set('redline-paint',paintIndex);showPaint();lastState='';};
carBody=storage.get('redline-body')==='kestrel'?'kestrel':'f1';const showBody=()=>{drawAssists&&$('mAssists')&&drawAssists();$('bodyBtn').querySelector('b').textContent=BODIES[carBody];$('mCar').textContent=BODIES[carBody];$('mNote').textContent=carBody==='f1'?'Daily runs use this car':'Practice car · daily runs use the Formula \'86';};showBody();$('bodyBtn').onclick=()=>{carBody=carBody==='f1'?'kestrel':'f1';storage.set('redline-body',carBody);showBody();specSheet();lastState='';};
assistPrefs=storage.get('redline-assists-'+Race.VERSION)||{};
function drawAssists(){const as=getAssists(carBody),box=$('mAssists');box.replaceChildren();for(const k of Race.ASSIST_KEYS){const b=document.createElement('button');b.className='tog'+(as[k]?' on':'');b.textContent=Race.ASSIST_NAMES[k]+(as[k]?' ON':' OFF');b.title={abs:'Anti-lock brakes',tc:'Traction control',stab:'Stability control',counter:'Countersteer aid',steer:'Keyboard steering aid',auto:'Automatic gears (off: E/Q or pad bumpers to shift)'}[k];
 b.onclick=()=>{const cur=getAssists(carBody);assistPrefs[carBody]={...cur,[k]:!cur[k]};storage.set('redline-assists-'+Race.VERSION,assistPrefs);drawAssists();};box.append(b);}}
drawAssists();
$('mDrift').onclick=()=>{assistPrefs[carBody]={...getAssists(carBody),tc:false,stab:false};storage.set('redline-assists-'+Race.VERSION,assistPrefs);drawAssists();};$('mDefault').onclick=()=>{delete assistPrefs[carBody];storage.set('redline-assists-'+Race.VERSION,assistPrefs);drawAssists();};
const stepPaint=d=>{paintIndex=(paintIndex+d+PAINTS.length)%PAINTS.length;storage.set('redline-paint',paintIndex);showPaint();lastState='';};
$('mCarPrev').onclick=$('mCarNext').onclick=()=>$('bodyBtn').click();$('mPaintPrev').onclick=()=>stepPaint(-1);$('mPaintNext').onclick=()=>stepPaint(1);
$('mPractice').onclick=()=>$('practice').click();$('mLap').onclick=()=>$('lap').click();$('mStart').onclick=()=>$('start').click();
specSheet();cycle('cameraBtn','camera');cycle('qualityBtn','quality');cycle('modeBtn','mode');cycle('lineBtn','lineSel');cycle('ghostBtn','ghostSel');
$('lineSel').onchange=()=>{lineOn=$('lineSel').value==='1';cachedK=-1;lastState='';storage.set('redline-line',lineOn);};$('ghostSel').onchange=()=>{ghostOn=$('ghostSel').value==='1';storage.set('redline-ghost',ghostOn);};
if(storage.get('redline-line')===false){$('lineSel').value='0';$('lineSel').onchange();$('lineBtn').querySelector('b').textContent='OFF';}
if(storage.get('redline-ghost')===false){$('ghostSel').value='0';$('ghostSel').onchange();$('ghostBtn').querySelector('b').textContent='OFF';}
const aliases={arrowup:'w',arrowdown:'s',arrowleft:'a',arrowright:'d'};window.addEventListener('keydown',e=>{if(!active&&e.target instanceof Element&&e.target.matches('input,select,textarea'))return;let k=aliases[e.key.toLowerCase()]||e.key.toLowerCase();if('wasd'.includes(k)&&k.length===1&&active){e.preventDefault();keys[k]=true;}if(k==='r'&&active&&!ranked&&!e.repeat){launch(raceConfig,false);}if(k==='p'&&active&&!ranked&&!e.repeat){setPause(!paused);}if(!e.repeat&&!(e.target instanceof Element&&e.target.matches('input,textarea'))){if(k==='c')$('cameraBtn').click();if(active&&k===' '){keys.hb=true;e.preventDefault();}if(active&&(k==='e'||k==='q')){pendingShift=k==='e'?1:-1;e.preventDefault();}if(k==='m')setSound(!soundOn);if(k==='l')$('lineBtn').click();if(k==='g')$('ghostBtn').click();}});
window.addEventListener('keyup',e=>{const k=aliases[e.key.toLowerCase()]||e.key.toLowerCase();keys[k]=false;if(k===' ')keys.hb=false;});window.addEventListener('blur',()=>{keys={};if(active&&!ranked)setPause(true);});document.addEventListener('visibilitychange',()=>{if(document.hidden&&active){keys={};if(!ranked)setPause(true);}});
document.querySelectorAll('[data-key]').forEach(b=>{let k=b.dataset.key;b.onpointerdown=e=>{if(!active)return;e.preventDefault();b.setPointerCapture(e.pointerId);keys[k]=true;};b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>keys[k]=false;});
function setPause(value){paused=value;keys={};accumulator=0;$('pause').textContent=paused?'Resume':'Pause';banner(paused?'PAUSED':'',ranked?'':'[P] OR [ RESUME ] TO CONTINUE · [R] RESTART');if(!paused){goAt=performance.now()+700;$('stage').focus({preventScroll:true});}}
$('pause').onclick=()=>{if(active&&!ranked)setPause(!paused);};$('full').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('stage').requestFullscreen)await $('stage').requestFullscreen();else document.body.classList.toggle('wide');}catch{document.body.classList.toggle('wide');}if(active)$('stage').focus({preventScroll:true});};
// Block-letter countdown in the same 5-row font as the logo
const FONT={'0':['#####','##  ##','##  ##','##  ##','#####'],'1':['  ##  ',' ###  ','  ##  ','  ##  ',' #### '],'2':['##### ','    ##',' #### ','##    ','######'],'3':['##### ','    ##','  ### ','    ##','##### '],G:['####','#   ','# ##','#  #','####'],O:['####','#  #','#  #','#  #','####'],P:['### ','#  #','### ','#   ','#   '],A:[' ## ','#  #','####','#  #','#  #'],U:['#  #','#  #','#  #','#  #','####'],S:['####','#   ','####','   #','####'],E:['####','#   ','### ','#   ','####'],D:['### ','#  #','#  #','#  #','### '],' ':['  ','  ','  ','  ','  ']};
// Countdown / pause banner: large block letters, colour per state, stage dimmed behind it.
let bannerKey='';function banner(word,caption){const el=$('raceCountdown'),key=word?word+'|'+caption:'';if(key===bannerKey)return;bannerKey=key;
 el.hidden=!word;$('stage').classList.toggle('dim',!!word&&word!=='GO');if(!word)return;el.dataset.s=word;el.innerHTML='<span class="bigword">'+esc(bigText(word))+'</span>\n\n<span class="cap">'+esc(caption)+'</span>';}
function bigText(t){return [0,1,2,3,4].map(r=>[...t].map(c=>(FONT[c]||FONT[' '])[r]).join('  ')).join('\n');}
function tickClock(){let now=new Date(),end=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1),sec=Math.max(0,Math.floor((end-now)/1000));$('countdown').textContent=[Math.floor(sec/3600),Math.floor(sec/60)%60,sec%60].map(x=>String(x).padStart(2,'0')).join(':');}tickClock();setInterval(tickClock,1000);
let prev=performance.now(),lastHud=0,lastState='';
function loop(now){requestAnimationFrame(loop);let dt=Math.max(0,(now-prev)/1000);prev=now;try{
 if(active&&!paused&&now<goAt){banner(String(Math.max(1,Math.ceil((goAt-now)/1000))),paused?'':(ranked?'RANKED RUN · ONE ATTEMPT':'GET READY'));}
 else if(active&&!paused){if(now<goAt+650)banner('GO','');else banner('');
  if(dt>2&&ranked){carState.reason='Run interrupted by browser suspension';finish(true);accumulator=0;}
  else{accumulator+=Math.min(dt,Math.max(0,(now-goAt)/1000),.25);while(accumulator>=Race.DT&&active){let code=inputCode();addInput(code);Race.step(carState,code,raceConfig,road);{const x=Math.floor((carState.s-raceConfig.start)/TRACE_STEP);while(runTrace.length<=x&&x>=0)runTrace.push(carState.v);}accumulator-=Race.DT;if(carState.done||ranked&&carState.invalid){syncState();finish(false);break;}}syncState();}}
 let state=[active?0:Math.floor(now/50),s,d,heading,cameraMode,modelRevision,$('mode').value,$('quality').value,active,paused,autoLevel].join('|');if(state!==lastState||active&&!paused){let t=performance.now();try{render();}catch(e){if(gl){useCPU(e);cachedK=-1;autoLevel=1;lastState='';return;}throw e;}renderMs=renderMs*.9+(performance.now()-t)*.1;lastState=state;frameCount++;}
 updateAudio();if(now-lastHud>=66){if(active){drawMap();hud();}lastHud=now;}
 if(now-measureAt>=1000){fps=frameCount*1000/(now-measureAt);frameCount=0;measureAt=now;let moving=active&&!paused;$('perf').textContent=(moving?Math.round(fps)+' FPS':'Ready')+' · '+(gl?gridW+'x'+gridH+' GPU':W+'x'+H+' CPU');
  if(moving&&now>goAt+1200&&$('quality').value==='auto'){slowWindows=fps<55?slowWindows+1:0;fastWindows=fps>=58&&renderMs<9?fastWindows+1:0;if(slowWindows>=1&&autoLevel>0){autoLevel--;slowWindows=0;fastWindows=0;}else if(fastWindows>=6&&autoLevel<4){autoLevel++;fastWindows=0;slowWindows=0;}}}
}catch(e){console.error('Race frame error',e);if(active){if(!ranked)setPause(true);$('status')&&($('status').textContent='Graphics error - lower detail');}else $('perf').textContent='Graphics error';}}
init();
setInterval(async()=>{if(active||finishBusy||startPending||!ready)return;if(online){try{let a=await api('daily');if(active||startPending||finishBusy)return;if(a.challenge.id!==challenge.id){challenge=a.challenge;raceConfig=challenge;carState=Race.initial(challenge);syncState();cachedK=-1;attempt=a.attempt;leaderboard=a.leaderboard;updateLobby();}else{attempt=a.attempt;leaderboard=a.leaderboard;drawBoard();}}catch{}}
 else{let c=Race.challenge();if(c.id!==challenge.id){challenge=c;attempt=storage.get(c.id);raceConfig=c;carState=Race.initial(c);syncState();cachedK=-1;updateLobby();}}},20000);
requestAnimationFrame(loop);
