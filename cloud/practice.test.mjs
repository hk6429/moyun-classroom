import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createClient} from '@libsql/client';
import {initialize} from './database.mjs';
import {handle} from './worker.mjs';
const setup=async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'moyun-practice-')),url='file:'+path.join(dir,'db.sqlite'),factory=()=>createClient({url});
 const env={TURSO_URL:'https://test',TURSO_TOKEN:'test',TEACHER_PASSWORD:'practice-secret',PUBLIC_ORIGIN:'https://classroom.test',REVIEW_DELAY_MS:'300',LONG_POLL_MS:'3000',LONG_POLL_STEP_MS:'50'};
 const raw=(p,init={})=>handle(new Request(env.PUBLIC_ORIGIN+p,{...init,headers:{Origin:env.PUBLIC_ORIGIN,'cf-connecting-ip':'practice','Content-Type':'application/json',...init.headers}}),env,factory);
 const call=async(p,b,cookie='',token='')=>{const r=await raw(p,{method:b===undefined?'GET':'POST',headers:{Cookie:cookie,Authorization:'Bearer '+token},...(b===undefined?{}:{body:JSON.stringify(b)})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const db=factory();await initialize(db);db.close();
 const login=await call('/api/login',{password:'practice-secret'});
 return {dir,raw,call,login};
};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('自主進度：各自翻頁、答後立即看解答、錯題間隔後回流複習、長輪詢到點喚醒',async()=>{
 const {dir,call,login}=await setup();
 try{
 const deck=[{type:'quiz',title:'一',options:['對','錯'],correct:0},{type:'fill',title:'二',solution:'李白'},{type:'content',title:'三'}];
 const {code,token:host}=(await call('/api/create',{deck},login.cookie)).data;
 const a=(await call('/api/join',{code,name:'甲'})).data.token,b=(await call('/api/join',{code,name:'乙'})).data.token;
 const st=t=>call('/api/state?code='+code,undefined,'',t).then(r=>r.data);
 assert.equal((await call('/api/navigate',{code,index:1},'',a)).status,409);
 await call('/api/control',{code,paced:true},'',host);
 assert.equal((await call('/api/navigate',{code,index:1},'',a)).status,200);
 let s=await st(a);assert.equal(s.index,1);assert.equal(s.paced,true);assert.equal(s.slide.solution,undefined);
 assert.equal((await st(b)).index,0);
 const wrong=await call('/api/answer',{code,index:1,answer:'杜甫'},'',a);assert.deepEqual(wrong.data,{ok:true,correct:false});
 s=await st(a);assert.equal(s.reveal,true);assert.equal(s.slide.solution,'李白');assert.equal(s.mine,'杜甫');assert.deepEqual(s.review.due,[]);assert.ok(s.review.nextAt);
 assert.equal((await call('/api/answer',{code,index:1,answer:'李白'},'',a)).status,409,'答後不可改答');
 // 長輪詢在複習到期時喚醒
 const t0=Date.now();const woke=await call(`/api/state?code=${code}&wait=${s.rev}&h=${s.h}`,undefined,'',a);
 assert.ok(Date.now()-t0<1500,'到期即喚醒');assert.deepEqual(woke.data.review.due,[1]);
 s=woke.data;assert.equal(s.reveal,false);assert.equal(s.mine,null);assert.equal(s.slide.solution,undefined);
 const retry=await call('/api/answer',{code,index:1,answer:'李白'},'',a);assert.deepEqual(retry.data,{ok:true,correct:true});
 s=await st(a);assert.deepEqual(s.review,{due:[],waiting:0,nextAt:null});assert.equal(s.mine,'李白');
 await call('/api/answer',{code,index:0,answer:0},'',b);
 const h=await st(host);assert.deepEqual(h.roster.map(r=>[r.name,r.at,r.wrongs]),[['甲',1,0],['乙',0,0]]);
 const rows=(await call('/api/export?code='+code,undefined,login.cookie,host)).data.rows,r1=rows.find(r=>r.page===2&&r.name==='甲');
 assert.deepEqual([r1.answer,r1.correct,r1.retryAnswer,r1.retryCorrect],['杜甫',false,'李白',true]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('影片中途提問、朱批共讀熱度、錄音作答與分段讀取',async()=>{
 const {dir,raw,call,login}=await setup();
 try{
 assert.equal((await call('/api/create',{deck:[{type:'resource',title:'影',url:'https://www.youtube.com/watch?v=abc',cues:['1:00 沒有正解｜甲｜乙']}]},login.cookie)).status,400);
 assert.equal((await call('/api/create',{deck:[{type:'read',title:'空',body:''}]},login.cookie)).status,400);
 const deck=[{type:'resource',title:'影片',url:'https://www.youtube.com/watch?v=abc',cues:['0:30 誰是詩仙？｜*李白｜杜甫','1:10 靜夜思幾句？｜三｜*四']},{type:'read',title:'靜夜思',body:'床前明月光，疑是地上霜。舉頭望明月，低頭思故鄉。'},{type:'audio',title:'朗讀'}];
 const {code,token:host}=(await call('/api/create',{deck},login.cookie)).data;
 const a=(await call('/api/join',{code,name:'甲'})),b=(await call('/api/join',{code,name:'乙'}));
 const st=t=>call('/api/state?code='+code,undefined,'',t).then(r=>r.data);
 let s=await st(a.data.token);assert.deepEqual(s.slide.checkpoints.map(c=>[c.at,c.correct]),[[30,undefined],[70,undefined]]);assert.equal(s.slide.cues,undefined);
 assert.deepEqual((await call('/api/answer',{code,index:0,checkpoint:0,answer:1},'',a.data.token)).data,{ok:true,correct:false});
 assert.deepEqual((await call('/api/answer',{code,index:0,checkpoint:1,answer:1},'',a.data.token)).data,{ok:true,correct:true});
 assert.equal((await call('/api/answer',{code,index:0,checkpoint:5,answer:0},'',a.data.token)).status,400);
 assert.deepEqual((await st(a.data.token)).mine,{checkpoints:{0:1,1:1}});
 await call('/api/control',{code,index:1},'',host);
 s=await st(a.data.token);assert.deepEqual(s.slide.sentences,['床前明月光，疑是地上霜。','舉頭望明月，低頭思故鄉。']);assert.equal(s.reading,undefined);
 assert.equal((await call('/api/answer',{code,index:1,answer:{stamps:{5:'key'}}},'',a.data.token)).status,400);
 await call('/api/answer',{code,index:1,answer:{stamps:{0:'doubt',1:'good'}}},'',a.data.token);
 await call('/api/answer',{code,index:1,answer:{stamps:{1:'good'}}},'',b.data.token);
 assert.deepEqual((await st(host)).reading,[{key:0,doubt:1,good:0},{key:0,doubt:0,good:2}]);
 await call('/api/control',{code,reveal:true},'',host);assert.equal((await st(b.data.token)).reading[1].good,2);
 await call('/api/control',{code,index:2,reveal:false},'',host);
 const webm=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.alloc(2000,7)]);
 assert.equal((await call('/api/answer',{code,index:2,answer:{audio:'data:audio/webm;base64,'+Buffer.from('not audio at all').toString('base64')}},'',a.data.token)).status,400);
 const ok=await call('/api/answer',{code,index:2,answer:{audio:'data:audio/webm;codecs=opus;base64,'+webm.toString('base64')}},'',a.data.token);assert.equal(ok.status,200);
 const url=(await st(a.data.token)).mine.audio;assert.match(url,/^\/assets\/.+\.webm$/);
 const full=await raw(url,{headers:{Cookie:a.cookie}});assert.equal(full.status,200);assert.equal(full.headers.get('content-type'),'audio/webm');
 const part=await raw(url,{headers:{Cookie:a.cookie,Range:'bytes=0-99'}});assert.equal(part.status,206);assert.equal(part.headers.get('content-range'),'bytes 0-99/2004');assert.equal((await part.arrayBuffer()).byteLength,100);
 const rows=(await call('/api/export?code='+code,undefined,login.cookie,host)).data.rows;
 assert.equal(rows.find(r=>r.page===1&&r.name==='甲').answer,'第1問：杜甫；第2問：四');
 assert.equal(rows.find(r=>r.page===2&&r.name==='甲').answer,'疑：床前明月光，疑是地上霜。；妙：舉頭望明月，低頭思故鄉。');
 }finally{await rm(dir,{recursive:true,force:true});}
});
