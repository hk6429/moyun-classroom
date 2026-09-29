import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createClient} from '@libsql/client';
import {initialize} from './database.mjs';
import {handle} from './worker.mjs';
const setup=async(extra={})=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'moyun-quota-')),url='file:'+path.join(dir,'db.sqlite');
 const factory=()=>createClient({url});
 const env={TURSO_URL:'https://test',TURSO_TOKEN:'test',TEACHER_PASSWORD:'quota-test-secret',PUBLIC_ORIGIN:'https://classroom.test',LONG_POLL_STEP_MS:'50',...extra};
 const call=async(p,b,cookie='',token='')=>{const r=await handle(new Request(env.PUBLIC_ORIGIN+p,{method:b===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:env.PUBLIC_ORIGIN,'cf-connecting-ip':'quota','Content-Type':'application/json',Authorization:'Bearer '+token},...(b===undefined?{}:{body:JSON.stringify(b)})}),env,factory);return {status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0],data:await r.json()};};
 return {dir,factory,env,call};
};
test('舊版整包資料搬入分表，可重複執行不覆寫',async()=>{
 const {dir,factory,call,env}=await setup();
 try{
 const db=factory();
 await db.execute("CREATE TABLE app_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL)");
 const room={host:'h'.repeat(48),deck:[{type:'short',title:'舊課堂',options:[]}],index:0,reveal:false,ended:false,people:[['s'.repeat(48),'舊學生']],answers:{0:{['s'.repeat(48)]:'舊回答'}},updated:5};
 const legacy={rooms:[['123456',room]],sessions:[['a'.repeat(48),{teacher:true,members:[],expires:Date.now()+60000}],['b'.repeat(48),{teacher:true,members:[],expires:1}]],owners:{x:'teacher'}};
 await db.execute({sql:'INSERT INTO app_state VALUES(1,0,?)',args:[JSON.stringify(legacy)]});
 await initialize(db);await initialize(db);
 assert.equal((await db.execute('SELECT count(*) n FROM rooms')).rows[0].n,1);
 assert.equal((await db.execute('SELECT count(*) n FROM sessions')).rows[0].n,1);
 db.close();
 const teacher='moyun_session='+'a'.repeat(48);
 const list=await call('/api/rooms',undefined,teacher);assert.equal(list.status,200);assert.deepEqual(list.data.rooms.map(r=>[r.code,r.title]),[['123456','舊課堂']]);
 const state=await call('/api/state?code=123456',undefined,'','h'.repeat(48));assert.equal(state.status,200);assert.equal(state.data.people,1);assert.equal(state.data.answers[0].answer,'舊回答');
 assert.equal((await call('/api/rooms',undefined,'moyun_session='+'b'.repeat(48))).status,401);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('學生長輪詢：無變化時在伺服器等待；同學交卷不喚醒；教師換頁立即喚醒；競速倒數到點喚醒',async()=>{
 const {dir,factory,call}=await setup({LONG_POLL_MS:'600'});
 try{
 const db=factory();await initialize(db);db.close();
 const login=await call('/api/login',{password:'quota-test-secret'});
 const made=await call('/api/create',{deck:[{type:'short',title:'第一頁'},{type:'short',title:'第二頁'}]},login.cookie);const {code,token:host}=made.data;
 const [a,b]=await Promise.all(['甲','乙'].map(name=>call('/api/join',{code,name})));
 const first=await call('/api/state?code='+code,undefined,'',a.data.token);assert.equal(typeof first.data.rev,'number');assert.ok(first.data.h);
 const wait=`/api/state?code=${code}&wait=${first.data.rev}&h=${first.data.h}`;
 let t=Date.now();const idle=await call(wait,undefined,'',a.data.token);assert.equal(idle.data.unchanged,true);assert.ok(Date.now()-t>=500,'應在伺服器等待');
 t=Date.now();const [peer]=await Promise.all([call(wait,undefined,'',a.data.token),call('/api/answer',{code,index:0,answer:'乙的回答'},'',b.data.token)]);
 assert.equal(peer.data.unchanged,true,'同學交卷不應喚醒');
 const woke=call(wait,undefined,'',a.data.token);await new Promise(r=>setTimeout(r,100));t=Date.now();
 await call('/api/control',{code,index:1},'',host);
 const moved=await woke;assert.equal(moved.data.index,1);assert.ok(Date.now()-t<400,'換頁應立即喚醒');
 assert.equal((await call(`/api/state?code=${code}&wait=0&h=x`,undefined,'','not-a-member')).status,401);
 const hostState=await call('/api/state?code='+code,undefined,login.cookie,host);assert.ok(hostState.data.roster.find(r=>r.name==='甲').online);
 }finally{await rm(dir,{recursive:true,force:true});}
 const race=await setup({LONG_POLL_MS:'8000'});
 try{
 const db=race.factory();await initialize(db);db.close();
 const login=await race.call('/api/login',{password:'quota-test-secret'});
 const deck=Array.from({length:10},(_,i)=>({type:'racequiz',title:'第'+(i+1)+'題',options:['甲','乙'],correct:0,seconds:5}));
 const {code,token:host}=(await race.call('/api/create',{deck},login.cookie)).data;
 const s=(await race.call('/api/join',{code,name:'丙'})).data.token;
 await race.call('/api/control',{code,raceStart:true,indexExpected:0},'',host);
 const cd=(await race.call('/api/state?code='+code,undefined,'',s)).data;assert.equal(cd.race.phase,'countdown');
 const t=Date.now();const open=await race.call(`/api/state?code=${code}&wait=${cd.rev}&h=${cd.h}`,undefined,'',s);
 assert.equal(open.data.race.phase,'answering');assert.ok(Date.now()-t<4500,'倒數結束就要回應，不可等滿');
 }finally{await rm(race.dir,{recursive:true,force:true});}
});
test('分表後的權限：學生憑自己課堂讀圖、登出撤銷教師權杖、使用中素材不可移除',async()=>{
 const {dir,factory,env,call}=await setup();
 try{
 const db=factory();await initialize(db);db.close();
 const login=await call('/api/login',{password:'quota-test-secret'});
 const png=await readFile(new URL('../fixtures/lesson.png',import.meta.url));
 const up=await handle(new Request(env.PUBLIC_ORIGIN+'/api/upload?name=a.png',{method:'POST',headers:{Cookie:login.cookie,Origin:env.PUBLIC_ORIGIN},body:png}),env,factory);const job=await up.json();
 const slide=(await call('/api/import-status?id='+job.id,undefined,login.cookie)).data.slides[0];
 const {code,token:host}=(await call('/api/create',{deck:[slide]},login.cookie)).data;
 const other=(await call('/api/create',{deck:[{type:'short',title:'別班'}]},login.cookie)).data;
 const mine=await call('/api/join',{code,name:'甲'}),stranger=await call('/api/join',{code:other.code,name:'乙'});
 const get=cookie=>handle(new Request(env.PUBLIC_ORIGIN+slide.asset,{headers:{Cookie:cookie}}),env,factory);
 const ok=await get(mine.cookie);assert.equal(ok.status,200);assert.match(ok.headers.get('cache-control'),/private/);
 assert.equal((await get(stranger.cookie)).status,403);
 assert.equal((await call('/api/storage-trash',{id:job.id},login.cookie)).status,409);
 assert.equal((await call('/api/logout',{},login.cookie)).status,200);
 assert.equal((await call('/api/control',{code,index:0},'',host)).status,401);
 assert.equal((await call('/api/rooms',undefined,login.cookie)).status,401);
 }finally{await rm(dir,{recursive:true,force:true});}
});
