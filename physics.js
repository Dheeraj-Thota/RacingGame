/* Redline shared deterministic vehicle simulation, SI units, version 5.
 *
 * Four-wheel planar vehicle model in track-relative (curvilinear) coordinates:
 *  - combined-slip tyre model (Pacejka "magic formula" shape on normalised slip), load-sensitive grip
 *  - quasi-static longitudinal/lateral load transfer with damper lag, crest/compression loads from real elevation
 *  - wheel spin dynamics per wheel, reflected engine inertia, limited-slip rear differential
 *  - published 992 GT3 RS figures: mass, wheelbase, tracks, tyre sizes, power/torque peaks, PDK ratios, aero
 *  - ABS, traction control and rear-axle steering (fixed for every driver), keyboard steering limiter
 *
 * Determinism: only +, -, *, /, sqrt, floor, round, abs, min, max are used inside the simulation.
 * Those are exactly specified by IEEE 754 in every JavaScript engine; Math.sin/atan2/exp are not, so
 * this file uses its own polynomial trigonometry. Server and browsers therefore replay identically.
 */
(function(root){'use strict';
const PI=3.141592653589793,TAU=2*PI,HALF_PI=PI/2;
const clamp=(v,a,b)=>v<a?a:v>b?b:v,wrap=(v,n)=>{v=v%n;return v<0?v+n:v;},ang=a=>wrap(a+PI,TAU)-PI,sgn=x=>x>0?1:x<0?-1:0;

// ---- Deterministic trigonometry (max error < 1e-9 over the ranges used) ----
function sin(x){x=ang(x);let s=1;if(x<0){x=-x;s=-1;}if(x>HALF_PI)x=PI-x;const x2=x*x;
 return s*x*(1+x2*(-1/6+x2*(1/120+x2*(-1/5040+x2*(1/362880+x2*(-1/39916800+x2*(1/6227020800+x2*(-1/1307674368000))))))));}
function cos(x){return sin(x+HALF_PI);}
const T12=0.2679491924311227,SQ3=1.7320508075688772;
function atan(x){let s=1;if(x<0){x=-x;s=-1;}let inv=false;if(x>1){x=1/x;inv=true;}let off=0;if(x>T12){x=(x*SQ3-1)/(x+SQ3);off=PI/6;}
 const x2=x*x;let r=off+x*(1+x2*(-1/3+x2*(1/5+x2*(-1/7+x2*(1/9+x2*(-1/11+x2*(1/13+x2*(-1/15))))))));if(inv)r=HALF_PI-r;return s*r;}
function atan2(y,x){if(x>0)return atan(y/x);if(x<0)return y>=0?atan(y/x)+PI:atan(y/x)-PI;return y>0?HALF_PI:y<0?-HALF_PI:0;}

// ---- 992 GT3 RS. Published: Porsche technical data (EU model, MY 08/2022). Estimated values marked "est". ----
const CAR={
 name:'911 GT3 RS (992)',
 mass:1525,            // 1450 kg DIN kerb weight + 75 kg driver
 wheelbase:2.457, trackF:1.630, trackR:1.582, length:4.572, width:1.900, height:1.322,
 frontWeight:.39,      // est: rear-engined 992 GT3 static distribution ~39/61
 cgHeight:.42,         // est
 yawInertia:2350,      // est, kg m^2
 rollFront:.50,        // est: front share of roll stiffness (stable, slightly understeering balance)
 tyreF:{radius:.350,width:.275,inertia:1.15}, // 275/35 ZR20
 tyreR:{radius:.367,width:.335,inertia:1.45}, // 335/30 ZR21
 // Engine: 386 kW at 8500 rpm, 465 Nm at 6300 rpm, 9000 rpm limit (published). Intermediate curve points est.
 torque:[[1000,250],[2000,325],[3000,372],[4000,405],[5000,438],[6300,465],[7000,462],[8000,446],[8500,433.7],[9000,405],[9400,0]],
 redline:9000, idle:1100, engineInertia:.17,
 ratios:[3.75,2.38,1.72,1.34,1.11,.96,.84], finalDrive:4.27, driveEfficiency:.91,
 // Aero: 409 kg at 200 km/h and 860 kg at 285 km/h (published) -> ~1.33 N/(m/s)^2.
 // cd x A 0.862 m^2 published (low-drag/DRS); 0.95 est for the high-downforce track setting -> ~296 km/h.
 downforce:1.33, aeroFront:.42, dragArea:.95, airDensity:1.225, rolling:.011,
 brakeF:4300, brakeR:2350, // est max torque per wheel, N m (408/380 mm discs): ~65% front brake force
 brakeLag:.045,       // s, hydraulic + pad response
 discHeat:5200,       // est J/K per corner (disc, pad, caliper share); steel discs
 brakeTemp0:260,      // degC at a rolling start
 mu:1.46, muLoadSens:.07, loadRef:4000, peakSlip:.12, peakRatio:.11, // est: Cup 2 R dry
 maxSteer:.43, rearSteer:.035
};

const SUB=4,HZ=120,DT=1/HZ,H=DT/SUB,G=9.81,HALF=4.7,WALL=8.05,PENALTY_LINE=HALF+.55;
const L=20822.565;   // must equal track.json length
const MF_B=2.646,MF_C=1.3; // magic-formula shape: peak at normalised slip 1, ~0.89 sliding ratio (progressive breakaway)

// ---- Track ----
function circuit(raw){
 const data=Array.isArray(raw)?{points:raw,step:6}:raw,src=data.points,n=src.length,len=data.length||n*data.step,step=len/n;
 const points=src.map(([x,y,z])=>({x,y,z}));
 for(let i=0;i<n;i++){const a=points[wrap(i-2,n)],b=points[wrap(i+2,n)],p=points[i];p.yaw=atan2(b.x-a.x,b.z-a.z);p.rx=cos(p.yaw);p.rz=-sin(p.yaw);}
 for(let i=0;i<n;i++){const p=points[i],a=points[wrap(i-3,n)],b=points[wrap(i+3,n)];
  p.k=ang(b.yaw-a.yaw)/(6*step);                      // horizontal curvature, + = right-hand bend
  p.grade=(b.y-a.y)/(6*step);
  const c=points[wrap(i-8,n)],d=points[wrap(i+8,n)];p.kv=(d.y-2*p.y+c.y)/(64*step*step); // + = compression, ~100 m baseline
 }
 // light smoothing of the derived curvature terms
 const ks=points.map(p=>p.k),kv=points.map(p=>p.kv);for(let i=0;i<n;i++){let s1=0,s2=0;for(let j=-2;j<=2;j++)s1+=ks[wrap(i+j,n)];for(let j=-6;j<=6;j++)s2+=kv[wrap(i+j,n)];points[i].k=s1/5;points[i].kv=s2/13;}
 function at(s){const q=wrap(s,len)/step,i=Math.floor(q),f=q-i,a=points[i],b=points[(i+1)%n],yaw=a.yaw+ang(b.yaw-a.yaw)*f;
  return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f,yaw,rx:cos(yaw),rz:-sin(yaw),k:a.k+(b.k-a.k)*f,grade:a.grade+(b.grade-a.grade)*f,kv:a.kv+(b.kv-a.kv)*f};}
 function corner(s){s=wrap(s,len);for(const c of data.corners||[])if(s>=c.start&&s<=c.end)return c.name;return '';}
 const curbs=data.curbs||[];
 function curb(s,side){s=wrap(s,len);for(const c of curbs)if(c.side===side&&s>=c.start&&s<=c.end)return true;return false;}
 return {points,at,length:len,step,corners:data.corners||[],curbs,corner,curb};
}

// ---- Challenges. Sector boundaries sit between named corners (corner ranges are approximate). ----
const sectors=[
 {start:260,length:2440,rolling:30,name:'Hatzenbach – Flugplatz'},
 {start:2700,length:2750,rolling:44,name:'Kottenborn – Adenauer Forst'},
 {start:5450,length:2200,rolling:36,name:'Metzgesfeld – Wehrseifen'},
 {start:7650,length:2750,rolling:24,name:'Breidscheid – Kesselchen'},
 {start:10400,length:2750,rolling:46,name:'Mutkurve – Karussell – Hohe Acht'},
 {start:13150,length:2650,rolling:30,name:'Wippermann – Pflanzgarten'},
 {start:15800,length:3100,rolling:42,name:'Bellof-S – Döttinger Höhe'}];
const VERSION='nord-v5';
function maxTicksFor(length){return Math.round(HZ*Math.max(180,length/10));}
const MAX_TICKS=maxTicksFor(3200);
function challenge(date){const day=typeof date==='string'?date:new Date().toISOString().slice(0,10),i=wrap(Math.floor(Date.parse(day+'T00:00:00Z')/86400000),sectors.length);
 return {day,id:VERSION+'-'+day,number:i+1,...sectors[i],car:CAR.name,surface:'Dry',assists:'ABS · TC · steering limiter',maxTicks:maxTicksFor(sectors[i].length)};}
function fullLap(){return {day:'lap',id:VERSION+'-lap',number:0,start:0,length:L,rolling:28,name:'Full lap · 20.8 km',car:CAR.name,surface:'Dry',assists:'ABS · TC · steering limiter',maxTicks:maxTicksFor(L),practiceOnly:true};}

// ---- Brakes: pad friction vs disc temperature (cold bite, plateau, fade above ~720 degC) ----
function padMu(t){if(t<120)return .80+.20*t/120;if(t<720)return 1;return Math.max(.55,1-(t-720)/950);}

// ---- Engine ----
function engineTorque(rpm){const t=CAR.torque;if(rpm<=t[0][0])return t[0][1];for(let i=1;i<t.length;i++)if(rpm<=t[i][0]){const a=t[i-1],b=t[i];return a[1]+(b[1]-a[1])*(rpm-a[0])/(b[0]-a[0]);}return 0;}
const gearRatio=g=>CAR.ratios[g-1]*CAR.finalDrive;
function rpmFor(wheelOmega,g){return wheelOmega*gearRatio(g)*60/TAU;}

// ---- Tyre: combined slip on normalised slip vector. Returns forces in the tyre frame. ----
function tyre(kappa,tanAlpha,fz,out){
 if(fz<=0){out.fx=0;out.fy=0;out.dfx=0;out.mu=0;return out;}
 const mu=CAR.mu*clamp(1-CAR.muLoadSens*(fz/CAR.loadRef-1),.78,1.12)*out.grip,D=mu*fz;
 const sx=kappa/CAR.peakRatio,sy=tanAlpha/CAR.peakSlip,s=Math.sqrt(sx*sx+sy*sy);
 if(s<1e-9){out.fx=0;out.fy=0;out.dfx=D*MF_C*MF_B/CAR.peakRatio;out.mu=mu;return out;}
 const bs=MF_B*s,phi=MF_C*atan(bs),F=D*sin(phi),dF=D*cos(phi)*MF_C*MF_B/(1+bs*bs),ux=sx/s,uy=sy/s;
 out.fx=F*ux;out.fy=-F*uy;out.mu=mu;
 out.dfx=Math.max((dF*ux*ux+F/s*(1-ux*ux))/CAR.peakRatio,.08*D*MF_C*MF_B/CAR.peakRatio); // d fx / d kappa, floored for implicit stability
 return out;
}

// ---- Inputs: 0..15 keyboard bitmask (1 gas, 2 brake, 4 left, 8 right) or 16+ quantised analogue ----
const ANALOG=16,MAX_CODE=16+255*256-1;
function decode(code){if(code<ANALOG)return {analog:false,gas:code&1?1:0,brake:code&2?1:0,steer:(code&8?1:0)-(code&4?1:0)};
 const c=code-ANALOG,st=c%255,pd=Math.floor(c/255);return {analog:true,steer:(st-127)/127,gas:(pd%16)/15,brake:Math.floor(pd/16)/15};}
function encodeAnalog(steer,gas,brake){return ANALOG+Math.round(clamp(steer,-1,1)*127+127)+255*(Math.round(clamp(gas,0,1)*15)+16*Math.round(clamp(brake,0,1)*15));}

function initial(c){const v=c.rolling,wf=v/CAR.tyreF.radius,wr=v/CAR.tyreR.radius;let gear=1;while(gear<7&&rpmFor(wr,gear)>7600)gear++;
 return {s:c.start,d:0,heading:0,vx:v,vy:0,yawRate:0,v,w:[wf,wf,wr,wr],gear,shift:0,rpm:rpmFor(wr,gear),abs:[1,1,1,1],tc:1,bp:0,bt:[CAR.brakeTemp0,CAR.brakeTemp0,CAR.brakeTemp0,CAR.brakeTemp0],reverse:false,revHold:0,steer:0,delta:0,gas:0,brake:0,ax:0,ay:0,
  load:[0,0,0,0],psm:0,slip:[0,0,0,0],surface:[0,0,0,0],ticks:0,offTicks:0,contact:false,invalid:false,done:false,time:null,reason:'',maxSpeed:v,penalty:0,wallTicks:0,collisions:0,lastContact:-10000,cornerSpeed:90,impact:0,airborne:false};}

// Corner-speed estimate for HUD cues and the test driver: grip + aero limited, braking-distance aware.
function safeSpeed(road,s,margin=1){const mu=1.42*margin,m=CAR.mass,kz=CAR.downforce;let target=92;
 for(let x=0;x<=320;x+=8){const k=Math.abs(road.at(s+x).k);if(k>.0004){const den=k-mu*kz/m;const vc=den>1e-5?Math.sqrt(mu*G/den):92;
  const decel=12.5*margin;target=Math.min(target,Math.sqrt(vc*vc+2*decel*x));}}return Math.min(target,92);}

const TW=[{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}],tyreOut={fx:0,fy:0,dfx:0,mu:0,grip:1};
const A=CAR.wheelbase*(1-CAR.frontWeight),B=CAR.wheelbase*CAR.frontWeight; // CG to front / rear axle
TW[0].x=A;TW[0].y=-CAR.trackF/2;TW[1].x=A;TW[1].y=CAR.trackF/2;TW[2].x=-B;TW[2].y=-CAR.trackR/2;TW[3].x=-B;TW[3].y=CAR.trackR/2;
const CORNERS=[[A+1.04,-.95],[A+1.04,.95],[-B-1.05,-.95],[-B-1.05,.95],[0,-.98],[0,.98]];

function psmCut(a){return clamp((a.psm||0)*1.4,0,.9);}
function step(a,code,c,road){if(a.done)return a;const inp=decode(code);
 // Pedal and steering input filters (keyboard pedals ramp like a quick foot; analogue is passed through).
 if(inp.analog){a.gas=inp.gas;a.brake=inp.brake;a.steer+=(inp.steer-a.steer)*.5;}
 else{a.gas+=(inp.gas-a.gas)*Math.min(1,DT*10);a.brake+=(inp.brake-a.brake)*Math.min(1,DT*14);
  const v=Math.max(a.vx,0),rate=(inp.steer?2.6:4.2)/(1+v/38);let t=inp.steer;
  a.steer+=clamp(t-a.steer,-rate*DT,rate*DT);}
 // Reverse: keep holding the brake once stopped (0.12 s); press the throttle at a standstill to go forward again.
 const still=Math.abs(a.vx)<.8;
 if(!a.reverse){a.revHold=still&&inp.brake>.9&&inp.gas<.1?a.revHold+DT:0;if(a.revHold>=.12){a.reverse=true;a.revHold=0;}}
 else if(still&&inp.gas>.5&&inp.brake<.1)a.reverse=false;
 const pedalGas=a.reverse?a.brake:a.gas,pedalBrake=a.reverse?a.gas:a.brake;
 const m=CAR.mass,Iz=CAR.yawInertia,L_=CAR.wheelbase,h=CAR.cgHeight;let contactNow=false,impact=0;
 for(let sub=0;sub<SUB;sub++){
  const p=road.at(a.s),u=a.vx,v=a.vy,r=a.yawRate,speed=Math.sqrt(u*u+v*v),cs=cos(a.heading),sn=sin(a.heading);
  // Steering: speed-dependent limit near the front tyres' peak slip (keyboard aid), plus self-alignment
  const uu=Math.max(u,3),aLat=CAR.mu*(G+CAR.downforce*u*u/m)*.92,kin=L_*aLat/(uu*uu),lim=clamp(kin+CAR.peakSlip*1.15,.07,CAR.maxSteer);
  const betaF=atan((v+r*A)/uu),align=clamp(betaF*.7,-lim,lim),mag=Math.abs(a.steer);
  const beta=atan(v/uu),sliding=Math.abs(beta)>.04&&sgn(beta)===-sgn(r)&&u>6;
  // Steering assist (as in arcade-sim racers on keyboard/pad): when the rear steps out, add countersteer.
  const counter=sliding?clamp(beta*(inp.analog?.45:.3),-.16,.16):0;
  const delta=(inp.analog?a.steer*clamp(kin+CAR.peakSlip*1.6,.1,CAR.maxSteer):a.steer*lim+(1-mag)*align)+counter;
  a.delta=delta;
  const rs=clamp(delta*clamp((u-22)/40,-.15,.08),-CAR.rearSteer,CAR.rearSteer);
  // Loads: static (with crests/compressions and grade), aero, transfer
  const vertical=clamp(1-p.grade*p.grade*.5+u*u*p.kv/G,.25,2.5),down=CAR.downforce*u*u,wF=m*G*vertical*(1-A/L_),wR=m*G*vertical*(A/L_);
  const dLong=m*a.ax*h/L_,dLatF=m*a.ay*h*CAR.rollFront/CAR.trackF,dLatR=m*a.ay*h*(1-CAR.rollFront)/CAR.trackR;
  const fF=(wF+down*CAR.aeroFront-dLong)/2,fR=(wR+down*(1-CAR.aeroFront)+dLong)/2;
  const fz=[Math.max(0,fF+dLatF),Math.max(0,fF-dLatF),Math.max(0,fR+dLatR),Math.max(0,fR-dLatR)]; // + ay (rightward) loads the left wheels
  a.airborne=fz[0]+fz[1]+fz[2]+fz[3]<m*G*.15;
  // Drivetrain
  const g=a.gear,gr=a.reverse?-3.42*CAR.finalDrive:gearRatio(g),wr=(a.w[2]+a.w[3])/2,rpmWheels=wr*gr*60/TAU;
  let rpm=rpmWheels,thr=a.reverse?(a.vx<-7?0:Math.min(pedalGas,.75)):pedalGas*(1-pedalBrake*.85);
  if(rpmWheels<2600&&thr>.05)rpm=Math.max(rpmWheels,2600+thr*1800); // clutch slip at very low road speed
  rpm=Math.max(rpm,CAR.idle);a.rpm=rpm;
  const limiter=rpm>=CAR.redline?0:1,tq=thr*engineTorque(rpm)*limiter*a.tc*(1-psmCut(a))-(1-thr)*(22+.0052*rpm);
  const axle=tq*gr*(tq>0?CAR.driveEfficiency:1/CAR.driveEfficiency);
  const reflected=CAR.engineInertia*gr*gr/2;
  const lock=clamp((a.w[2]-a.w[3])*650,-(140+.35*Math.abs(axle)),140+.35*Math.abs(axle));
  // PSM (stability control): when sideslip and yaw exceed what the steering asks for, cut torque and
  // brake the outer front wheel to create a stabilising yaw moment.
  const rRef=u*delta/(L_+.0006*u*u*L_),over=Math.abs(r)>Math.abs(rRef)+.06&&Math.abs(beta)>.035&&sgn(beta)===-sgn(r)&&u>8;
  const psm=over?clamp((Math.abs(beta)-.035)*9+(Math.abs(r)-Math.abs(rRef))*.8,0,1):0;a.psm=psm;
  const psmWheel=r>0?0:1; // turning right -> outer (left) front
  a.bp+=(pedalBrake-a.bp)*Math.min(1,H/CAR.brakeLag);
  let Fx=0,Fy=0,Mz=0,tcSlip=0;
  for(let i=0;i<4;i++){
   const W=TW[i],front=i<2,ty=front?CAR.tyreF:CAR.tyreR,R=ty.radius,st=front?delta:rs;
   const wu=u-r*W.y,wv=v+r*W.x,cd=cos(st),sd=sin(st),tu=wu*cd+wv*sd,tv=-wu*sd+wv*cd;
   const wd=a.d+W.x*sn+W.y*cs,side=sgn(wd),edge=Math.abs(wd);
   const surf=edge<HALF?0:(edge<HALF+.9&&road.curb(a.s+W.x,side))?1:edge<HALF+.55?1:2; // 0 asphalt, 1 kerb/verge, 2 grass
   a.surface[i]=surf;tyreOut.grip=surf===0?1:surf===1?.9:.55;
   const den=Math.max(Math.abs(tu),3),kappa=(a.w[i]*R-tu)/den,ta=tv/den;
   tyre(kappa,ta,fz[i],tyreOut);
   const fx=tyreOut.fx,fy=tyreOut.fy;const nk=kappa/CAR.peakRatio,na=ta/CAR.peakSlip;a.slip[i]=Math.sqrt(nk*nk+na*na);a.load[i]=fz[i];
   // ABS per wheel, TC on driven wheels
   const target=-CAR.peakRatio*(front?.95:.82); // ABS slip target; lower at the rear (EBD) for stability
   if(a.bp>.02&&kappa<target)a.abs[i]=Math.max(.05,a.abs[i]-H*(30+260*(target-kappa)/CAR.peakRatio));
   else a.abs[i]=Math.min(1,a.abs[i]+H*(kappa>target*.6?10:4));
   if(!front&&kappa>CAR.peakRatio*1.15)tcSlip=1;
   // Wheel spin, semi-implicit in the tyre's longitudinal stiffness
   const I=ty.inertia+(front?0:reflected),drive=front?0:axle/2+(i===2?-lock:lock);
   const brakeT=Math.min(1,a.bp+(i===psmWheel?psm*.55:0))*(front?CAR.brakeF:CAR.brakeR)*a.abs[i]*padMu(a.bt[i]),roll=CAR.rolling*fz[i]*R;
   let w=a.w[i];const net=drive-fx*R,dw=H*net/(I+H*tyreOut.dfx*R*R/den);w+=dw;
   const bt=(brakeT+roll)*H/I;if(w>0)w=Math.max(0,w-bt);else w=Math.min(0,w+bt);
   if(!a.reverse&&w<0&&tu>=0)w=0;a.w[i]=w;
   a.bt[i]+=H*(brakeT*Math.abs(w)*.92-(9+1.7*Math.abs(u))*(a.bt[i]-20))/CAR.discHeat; // heat in, convective cooling out
   // tyre forces to body frame
   const bx=fx*cd-fy*sd,by=fx*sd+fy*cd;Fx+=bx;Fy+=by;Mz+=W.x*by-W.y*bx;
  }
  a.tc=tcSlip?Math.max(.2,a.tc-H*9):Math.min(1,a.tc+H*4);
  // Aero drag, grade, off-road drag
  const drag=.5*CAR.airDensity*CAR.dragArea*u*Math.abs(u),offDrag=(a.surface[0]===2?1:0)+(a.surface[1]===2?1:0)+(a.surface[2]===2?1:0)+(a.surface[3]===2?1:0);
  Fx-=drag+m*G*p.grade+offDrag*.06*m*G*sgn(u);
  let du=Fx/m+v*r,dv=Fy/m-u*r,dr=Mz/Iz;
  a.vx+=du*H;a.vy+=dv*H;a.yawRate+=dr*H;
  const fa=Math.min(1,H/.07);a.ax+=(du-v*r-a.ax)*fa;a.ay+=(dv+u*r-a.ay)*fa;
  // Curvilinear kinematics
  const ux=a.vx,vy=a.vy,cs2=cos(a.heading),sn2=sin(a.heading),scale=1/Math.max(.5,1-p.k*a.d);
  const ds=(ux*cs2-vy*sn2)*scale*H,dd=(ux*sn2+vy*cs2)*H;
  const before=a.s;a.s+=ds;a.d+=dd;a.heading=ang(a.heading+a.yawRate*H-p.k*ds);
  // Guardrails: rigid-body impulse at the deepest body corner
  let deep=0,ci=-1,cside=0;const cs3=cos(a.heading),sn3=sin(a.heading);
  for(let j=0;j<CORNERS.length;j++){const [x,y]=CORNERS[j],dc=a.d+x*sn3+y*cs3,pen=Math.abs(dc)-WALL;if(pen>deep){deep=pen;ci=j;cside=sgn(dc);}}
  if(ci>=0){const [x,y]=CORNERS[ci];a.d-=cside*deep;const nx=-cside*sn3,ny=-cside*cs3;
   const pu=a.vx-a.yawRate*y,pv=a.vy+a.yawRate*x,vn=pu*nx+pv*ny;
   if(vn<0){const tn=x*ny-y*nx,J=-(1.12*vn)/(1/m+tn*tn/Iz);a.vx+=J*nx/m;a.vy+=J*ny/m;a.yawRate+=J*tn/Iz;
    const tx=-ny,tyy=nx,vt=pu*tx+pv*tyy,tt=x*tyy-y*tx,Jt=clamp(-vt/(1/m+tt*tt/Iz),-.2*J,.2*J);a.vx+=Jt*tx/m;a.vy+=Jt*tyy/m;a.yawRate+=Jt*tt/Iz;
    impact=Math.max(impact,-vn);a.yawRate*=.75;}
   contactNow=true;}
  if(a.s>=c.start+c.length&&!a.done){a.done=true;a.time=(a.ticks+(sub+clamp((c.start+c.length-before)/Math.max(a.s-before,1e-6),0,1))/SUB)/HZ+a.penalty;break;}
 }
 // PDK: shift points near the limiter; aggressive downshifts under braking. 0.18 s between shifts.
 a.shift=Math.max(0,a.shift-DT);const wr2=(a.w[2]+a.w[3])/2,rpmNow=rpmFor(wr2,a.gear);
 if(a.reverse){a.gear=1;}else if(a.shift===0){if(a.gear<7&&rpmNow>8850&&a.gas>.5){a.gear++;a.shift=.18;}
  else if(a.gear>1&&rpmFor(wr2,a.gear-1)<(a.brake>.2?8400:6400)&&(a.brake>.2||rpmNow<3800)){a.gear--;a.shift=.18;}}
 a.v=Math.sqrt(a.vx*a.vx+a.vy*a.vy);a.ticks++;a.maxSpeed=Math.max(a.maxSpeed,a.v);a.contact=contactNow;a.impact=impact;
 if(a.ticks%12===1)a.cornerSpeed=safeSpeed(road,a.s);
 // Track limits: all four wheels beyond the white line (plus kerb allowance)
 let off=true;for(let i=0;i<4;i++){const W=TW[i],wd=Math.abs(a.d+W.x*sin(a.heading)+W.y*cos(a.heading));if(wd<PENALTY_LINE)off=false;}
 if(off){a.offTicks++;a.penalty+=DT*.9;}else a.offTicks=Math.max(0,a.offTicks-2);
 if(contactNow){if(a.wallTicks===0&&a.ticks-a.lastContact>60&&impact>.6){a.collisions++;a.penalty+=1.5;a.lastContact=a.ticks;}a.wallTicks++;}else a.wallTicks=0;
 if(!a.done&&a.ticks>=(c.maxTicks||MAX_TICKS)){a.done=true;a.invalid=true;a.reason='Time limit';a.time=null;}
 return a;
}

function replay(c,road,runs){const max=c.maxTicks||MAX_TICKS;if(!Array.isArray(runs)||runs.length>max)throw Error('Bad replay');let a=initial(c);
 for(let i=0;i<runs.length;i++){const x=runs[i];if(!Array.isArray(x)||x.length!==2||!Number.isInteger(x[0])||x[0]<0||x[0]>MAX_CODE||!Number.isInteger(x[1])||x[1]<1||x[1]>max||a.ticks+x[1]>max)throw Error('Bad input');
  for(let j=0;j<x[1];j++){if(a.done)throw Error('Trailing input');step(a,x[0],c,road);}}return a;}

const api={L,HZ,DT,SUB,HALF,WALL,MAX_TICKS,CAR,VERSION,sectors,circuit,challenge,fullLap,initial,step,replay,safeSpeed,decode,encodeAnalog,engineTorque,gearRatio,rpmFor,math:{sin,cos,atan,atan2}};
if(typeof module==='object'&&module.exports)module.exports=api;else root.Race=api;
})(typeof globalThis!=='undefined'?globalThis:this);
