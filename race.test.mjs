import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createApp} from './server.mjs';
import {raceScore} from './race.mjs';

test('競速分數：千分、遞減、最後一成歸零與錯答',()=>{
 assert.equal(raceScore(0,20,true),1000);
 assert.equal(raceScore(9000,20,true),500);
 assert.equal(raceScore(17999,20,true),1);
 assert.equal(raceScore(18000,20,true),0);
 assert.equal(raceScore(19000,20,true),0);
 assert.equal(raceScore(1,20,false),0);
 assert.equal(raceScore(-1,20,true),0);
});

test('十題競速 API：等候、限時、不可重答、伺服器計分、續課與全班總排名',async()=>{
 const dir=await mkdtemp('/tmp/moyun-race-');let now=Date.now(),server,base;
 async function start(){server=createApp({dataDir:dir,now:()=>now});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
 await start();let cookie='';
 const call=async(p,b,token='')=>{const r=await fetch(base+'/api/'+p,{method:b?'POST':'GET',headers:{Cookie:cookie,Authorization:'Bearer '+token,'Content-Type':'application/json'},...(b?{body:JSON.stringify(b)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 const login=await call('login',{password:(await readFile(dir+'/teacher-password','utf8')).trim()});cookie=login.cookie;
 const deck=Array.from({length:10},(_,i)=>({type:'racequiz',title:'第'+i+'題',options:['甲','乙'],correct:0,seconds:20}));
 assert.equal((await call('create',{deck:deck.slice(1)})).status,400);
 assert.equal((await call('create',{deck:deck.map(s=>({...s,seconds:0}))})).status,400);
 const made=await call('create',{deck});assert.equal(made.status,200);const {code,token:host}=made.data;
 const students=[];for(const name of ['快答','慢答','未作答'])students.push((await call('join',{code,name})).data.token);
 const state=async t=>(await call('state?code='+code,undefined,t)).data;
 const control=b=>call('control',{code,...b},host);
 const answer=(token,index,choice=0)=>call('answer',{code,index,answer:choice,points:1000000,elapsedMs:0},token);
 assert.equal((await state(students[0])).slide.correct,undefined);assert.deepEqual((await state(students[0])).slide.options,[]);
 assert.equal((await answer(students[0],0)).status,409);
 assert.equal((await call('control',{code,raceStart:true,indexExpected:0},students[0])).status,403);
 for(let i=0;i<10;i++){
  assert.equal((await control({raceStart:true,indexExpected:i})).status,200);
  assert.equal((await control({raceStart:true,indexExpected:i})).status,409);
  assert.equal((await state(students[0])).race.phase,'countdown');
  assert.equal((await answer(students[0],i)).status,409);
  now+=3000;
  assert.equal((await state(students[0])).race.phase,'answering');assert.equal((await state(students[0])).slide.correct,undefined);
  assert.equal((await answer(students[0],i)).status,200);
  assert.equal((await answer(students[0],i,1)).status,409);
  assert.equal((await state(students[0])).race.mine,null);assert.equal((await state(students[0])).race.rankings,null);
  now+=18000;assert.equal((await answer(students[1],i)).status,200);
  assert.equal((await control({index:i+1})).status,409);
  now+=2000;assert.equal((await answer(students[2],i)).status,409);
  const closed=await state(students[0]);assert.equal(closed.race.phase,'closed');assert.equal(closed.slide.correct,0);assert.equal(closed.race.mine.points,1000);
  assert.equal(closed.race.rankings[0].total,(i+1)*1000);assert.equal(closed.race.rankings[1].total,0);assert.equal(closed.race.rankings[2].rank,2);
  assert.equal(JSON.stringify(closed.race.rankings).includes(students[0]),false);
  assert.equal((await control({reveal:false})).status,409);
  if(i===4){await new Promise(r=>server.close(r));await start();assert.equal((await state(students[0])).race.rankings[0].total,5000);}
  if(i<9)assert.equal((await control({index:i+1})).status,200);
 }
 assert.equal((await call('join',{code,name:'晚到'})).status,409);
 const final=await state(students[0]);assert.equal(final.race.finished,true);assert.equal(final.race.rankings[0].total,10000);
 assert.equal((await call('export?code='+code,undefined,students[0])).status,403);
 const report=(await call('export?code='+code,undefined,host)).data;assert.equal(report.rows.length,30);assert.equal(report.rankings[0].total,10000);assert.equal(report.rows[1].points,0);assert.equal(report.rows[1].elapsedMs,18000);
 assert.equal((await control({end:true})).status,200);assert.equal((await answer(students[0],9)).status,409);
 }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
