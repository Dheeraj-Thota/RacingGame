/* Shared deterministic simulation, SI units, version 4. */
(function(root){'use strict';
const L=20832, STEP=6, HZ=120, DT=1/HZ, MAX_TICKS=120*180, HALF=4.7, PI=Math.PI;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),wrap=(v,n)=>((v%n)+n)%n,ang=a=>wrap(a+PI,2*PI)-PI;
function circuit(raw){let points=raw.map(([x,y,z])=>({x,y,z})),n=points.length;for(let i=0;i<n;i++){let a=points[wrap(i-2,n)],b=points[wrap(i+2,n)],p=points[i];p.yaw=Math.atan2(b.x-a.x,b.z-a.z);p.rx=Math.cos(p.yaw);p.rz=-Math.sin(p.yaw);}function at(s){let k=wrap(s,L)/STEP,i=Math.floor(k),f=k-i,a=points[i],b=points[(i+1)%n],yaw=a.yaw+ang(b.yaw-a.yaw)*f;return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f,yaw,rx:Math.cos(yaw),rz:-Math.sin(yaw)};}return {points,at};}
// Each sector uses actual distance along the published circuit outline; no unverified corner names.
const sectors=[{start:120,length:1250},{start:2850,length:1450},{start:5560,length:1250},{start:8250,length:1350},{start:10980,length:1450},{start:14550,length:1450},{start:18120,length:1650}];
function challenge(date){let day=typeof date==='string'?date:new Date().toISOString().slice(0,10),i=wrap(Math.floor(Date.parse(day+'T00:00:00Z')/86400000),sectors.length);return {day,id:'nord-v4-'+day,number:i+1,...sectors[i],rolling:12,car:'911 GT3 RS',mu:1.22};}
function initial(c){return {s:c.start,d:0,v:c.rolling,vy:0,heading:0,yawRate:0,steer:0,gas:0,brake:0,ticks:0,offTicks:0,contact:false,invalid:false,done:false,time:null,reason:'',maxSpeed:c.rolling,gear:1,penalty:0,offActive:false,wallTicks:0,collisions:0,lastContact:-10000,cornerSpeed:82.22};}
// Route-relative keyboard vehicle model, with bounded yaw stabilization.
function safeSpeed(road,s,mu=1.22){let target=82.22;for(let x=0;x<=150;x+=12){const k=Math.abs(ang(road.at(s+x+15).yaw-road.at(s+x-15).yaw)/30);if(k>.0002){let local=Math.sqrt(mu*9.81/Math.max(k-mu*1.30/1450,.00015));target=Math.min(target,Math.sqrt(local*local+2*7.5*x));}}return target;}
function step(a,mask,c,road){if(a.done)return a;const p=road.at(a.s),p0=road.at(a.s-15),p1=road.at(a.s+15),curve=ang(p1.yaw-p0.yaw)/30,grade=(p1.y-p0.y)/30;
 const gas=mask&1?1:0,brake=mask&2?1:0,dir=(mask&8?1:0)-(mask&4?1:0),v=Math.max(a.v,.25),off=Math.abs(a.d)>HALF-.7;
 a.gas+=(gas-a.gas)*Math.min(1,DT*9);a.brake+=(brake-a.brake)*Math.min(1,DT*15);a.steer+=(dir-a.steer)*Math.min(1,DT*(dir?5.5:8.5));
 const mass=1450,mu=off?.58:c.mu,down=1.30*v*v,normal=mass*9.81+down,grip=mu*normal/mass;
 const ratios=[3.75,2.38,1.72,1.34,1.10,.94,.80],final=3.8,r=.345;let gear=1;while(gear<7&&v/r*ratios[gear-1]*final*60/(2*PI)>8700)gear++;a.gear=gear;
 const rpm=clamp(v/r*ratios[gear-1]*final*60/(2*PI),1500,9000),torque=465*(.76+.24*Math.sin(clamp((rpm-1700)/7300,0,1)*PI));
 const drive=(1-a.brake)*a.gas*Math.min(345000/Math.max(v,5),torque*ratios[gear-1]*final*.9/r,normal*mu*.57),bforce=a.brake*Math.min(mass*12.0,normal*mu*.82),drag=.69*v*v+mass*.13+(off?mass*(.75+.025*v):0);
 const longitudinal=(drive-bforce)/mass,latGrip=Math.sqrt(Math.max(grip*grip*.18,grip*grip-longitudinal*longitudinal));
 // Exact centerline tangent change prevents unstable high-speed steering oscillation.
 const ds0=Math.max(0,v*Math.cos(a.heading))/Math.max(.65,1-curve*a.d),baseYaw=ang(road.at(a.s+ds0*DT).yaw-p.yaw)/DT;
 const lateral=a.steer*(2.5+Math.min(v,55)*.075)-clamp(a.d*.42,-2.3,2.3)*(1-Math.abs(a.steer)*.78);
 const desired=Math.atan2(lateral,Math.max(v,4));let yawTarget=baseYaw+clamp(4.6*ang(desired-a.heading)-a.vy*.06,-1.5,1.5);
 const maxYaw=latGrip/Math.max(v,3);yawTarget=clamp(yawTarget,-maxYaw,maxYaw);
 a.yawRate+=(yawTarget-a.yawRate)*Math.min(1,DT*13);a.yawRate=clamp(a.yawRate,-maxYaw,maxYaw);
 const excess=Math.max(0,Math.abs(baseYaw)*v-latGrip);let slipTarget=-Math.sign(baseYaw)*Math.min(4,excess*.20);a.vy+=(slipTarget-a.vy)*Math.min(1,DT*5);
 let accel=longitudinal-drag/mass-9.81*grade; a.v=clamp(a.v+accel*DT,0,82.22);
 const ds=(a.v*Math.cos(a.heading)-a.vy*Math.sin(a.heading))*DT/Math.max(.65,1-curve*a.d),dd=(a.v*Math.sin(a.heading)+a.vy*Math.cos(a.heading))*DT;
 let old=a.s;a.s+=Math.max(0,ds);a.d+=dd;a.heading=ang(a.heading+a.yawRate*DT-ang(road.at(a.s).yaw-p.yaw));a.ticks++;a.maxSpeed=Math.max(a.maxSpeed,a.v);a.contact=false;
 if(a.ticks%12===1)a.cornerSpeed=safeSpeed(road,a.s,c.mu);
 if(Math.abs(a.d)>HALF+.5){a.offTicks++;a.penalty+=DT*.9;}else a.offTicks=Math.max(0,a.offTicks-2);
 // Continuous contact at visible guardrail, not a teleport or abrupt reset.
 const edge=7.20;if(Math.abs(a.d)>edge){let side=Math.sign(a.d);a.d=side*edge;if(a.wallTicks===0&&a.ticks-a.lastContact>60){a.collisions++;a.penalty+=1.5;a.lastContact=a.ticks;}a.contact=true;a.wallTicks++;a.heading=side*clamp(side*a.heading,-.25,0);a.vy=side*Math.min(0,side*a.vy);a.yawRate=clamp(a.yawRate,-.45,.45);a.v=Math.max(0,a.v-(3.5+v*.075)*DT);}else a.wallTicks=0;
 if(a.s>=c.start+c.length&&ds>0){a.done=true;a.time=(a.ticks-1+clamp((c.start+c.length-old)/Math.max(a.s-old,.0001),0,1))/HZ+a.penalty;}
 if(a.ticks>=MAX_TICKS){a.done=true;a.invalid=true;a.reason='Time limit';a.time=null;}return a;
}
function replay(c,road,runs){if(!Array.isArray(runs)||runs.length>MAX_TICKS)throw Error('Bad replay');let a=initial(c);for(let i=0;i<runs.length;i++){let x=runs[i];if(!Array.isArray(x)||x.length!==2||!Number.isInteger(x[0])||x[0]<0||x[0]>15||!Number.isInteger(x[1])||x[1]<1||x[1]>MAX_TICKS||a.ticks+x[1]>MAX_TICKS)throw Error('Bad input');for(let j=0;j<x[1];j++){if(a.done)throw Error('Trailing input');step(a,x[0],c,road);}}return a;}
const api={L,STEP,HZ,DT,HALF,MAX_TICKS,circuit,challenge,initial,step,replay,safeSpeed};if(typeof module==='object'&&module.exports)module.exports=api;else root.Race=api;
})(typeof globalThis!=='undefined'?globalThis:this);
