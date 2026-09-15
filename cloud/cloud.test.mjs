import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createClient} from '@libsql/client';
import {initialize} from './database.mjs';
import {handle} from './worker.mjs';
test('雲端 API：並行加入不遺失、答案保護、圖片授權、手寫及重新建立執行個體',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'moyun-cloud-')),url='file:'+path.join(dir,'db.sqlite');
 const factory=()=>createClient({url});const db=factory();await initialize(db);db.close();
 const env={TURSO_URL:'https://test',TURSO_TOKEN:'test',TEACHER_PASSWORD:'test-long-random-secret',PUBLIC_ORIGIN:'https://classroom.test'};
 const call=async(p,b,cookie='',token='')=>{const r=await handle(new Request(env.PUBLIC_ORIGIN+p,{method:b===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:env.PUBLIC_ORIGIN,'cf-connecting-ip':'test','Content-Type':'application/json',Authorization:'Bearer '+token},...(b===undefined?{}:{body:JSON.stringify(b)})}),env,factory);return {status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0],data:await r.json()};};
 try{
 const login=await call('/api/login',{password:env.TEACHER_PASSWORD});assert.equal(login.status,200);const cookie=login.cookie;
 const created=await call('/api/create',{deck:[{type:'quiz',title:'題目',options:['甲','乙'],correct:1,explanation:'答案說明'},{type:'draw',title:'手寫'}]},cookie);assert.equal(created.status,200);
 const {code,token:host}=created.data;
 const joined=await Promise.all(Array.from({length:10},(_,i)=>call('/api/join',{code,name:'學生'+i})));
 for(const j of joined)assert.equal(j.status,200,JSON.stringify(j.data));
 const state=await call('/api/state?code='+code,undefined,cookie,host);assert.equal(state.data.people,10);
 const student=joined[0],t=student.data.token;
 const hidden=await call('/api/state?code='+code,undefined,student.cookie,t);assert.equal(hidden.data.slide.correct,undefined);assert.equal(hidden.data.slide.explanation,undefined);
 assert.equal((await call('/api/answer',{code,index:0,answer:1},student.cookie,t)).status,200);
 assert.equal((await call('/api/control',{code,reveal:true},student.cookie,t)).status,403);
 await call('/api/control',{code,index:1},cookie,host);
 const png=await readFile(new URL('../fixtures/lesson.png',import.meta.url));
 const up=await handle(new Request(env.PUBLIC_ORIGIN+'/api/upload?name=test.png',{method:'POST',headers:{Cookie:cookie,Origin:env.PUBLIC_ORIGIN},body:png}),env,factory);
 assert.equal(up.status,202);const job=await up.json();
 const j=await call('/api/import-status?id='+job.id,undefined,cookie);assert.equal(j.data.status,'done');
 const asset=j.data.slides[0].asset;
 assert.equal((await handle(new Request(env.PUBLIC_ORIGIN+asset),env,factory)).status,403);
 const image=await handle(new Request(env.PUBLIC_ORIGIN+asset,{headers:{Cookie:cookie}}),env,factory);assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
 const strokes=[{tool:'brush',size:5,color:'#123456',points:[{x:5,y:6,p:0.5}]}];
 assert.equal((await call('/api/answer',{code,index:1,answer:{image:'data:image/png;base64,'+png.toString('base64'),strokes}},student.cookie,t)).status,200);
 assert.deepEqual((await call('/api/strokes?code='+code,undefined,student.cookie,t)).data.strokes,strokes);
 assert.equal((await call('/api/export?code='+code,undefined,cookie,host)).data.rows.length,20);
 const resumed=await call('/api/rooms',undefined,cookie);assert.equal(resumed.data.rooms[0].code,code);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('文字雲：詞語合併、更新取代、公布權限、截止、匯出與持久保存',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'moyun-words-')),url='file:'+path.join(dir,'db.sqlite');
 const factory=()=>createClient({url}),db=factory();await initialize(db);db.close();
 const env={TURSO_URL:'https://test',TURSO_TOKEN:'test',TEACHER_PASSWORD:'wordcloud-test-secret',PUBLIC_ORIGIN:'https://classroom.test'};
 const call=async(p,b,token='',cookie='')=>{const r=await handle(new Request(env.PUBLIC_ORIGIN+p,{method:b===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:env.PUBLIC_ORIGIN,'cf-connecting-ip':'words-test','Content-Type':'application/json',Authorization:'Bearer '+token},...(b===undefined?{}:{body:JSON.stringify(b)})}),env,factory);return {status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0],data:await r.json()};};
 try{
 const login=await call('/api/login',{password:env.TEACHER_PASSWORD});
 const made=await call('/api/create',{deck:[{type:'wordcloud',title:'你看見什麼？'}]},'',login.cookie);assert.equal(made.status,200);
 const {code,token:host}=made.data;
 const students=await Promise.all(['甲','乙','丙'].map(name=>call('/api/join',{code,name})));
 const tokens=students.map(s=>s.data.token);
 const answer=(i,text)=>call('/api/answer',{code,index:0,answer:text},tokens[i]);
 const state=t=>call('/api/state?code='+code,undefined,t);
 assert.deepEqual((await state(host)).data.wordcloud,[]);
 for(const bad of ['', ' \t ', '字'.repeat(31), '甲\n乙', '甲\u200b', 12])assert.equal((await answer(0,bad)).status,400);
 await answer(0,' 山水 ');await answer(1,'山水');await answer(2,'清幽');
 assert.deepEqual((await state(host)).data.wordcloud,[{text:'山水',count:2},{text:'清幽',count:1}]);
 assert.equal((await state(tokens[0])).data.wordcloud,undefined);
 assert.equal((await state(tokens[0])).data.answers,undefined);
 await answer(0,'清幽');
 assert.deepEqual((await state(host)).data.wordcloud,[{text:'清幽',count:2},{text:'山水',count:1}]);
 assert.equal((await call('/api/control',{code,reveal:true},tokens[0])).status,403);
 await call('/api/control',{code,reveal:true},host);
 const shown=(await state(tokens[0])).data.wordcloud;
 assert.equal(shown[0].count,2);assert.deepEqual(Object.keys(shown[0]).sort(),['count','text']);
 assert.equal((await answer(0,'晚霞')).status,409);
 await call('/api/control',{code,reveal:false},host);
 await answer(0,'ＡＩ');await answer(1,'ai');
 assert.equal((await state(host)).data.wordcloud.find(w=>w.text==='AI').count,2);
 const report=await call('/api/export?code='+code,undefined,host);assert.equal(report.data.rows.length,3);assert.equal(report.data.rows[0].answer,'AI');assert.equal(report.data.rows[0].attempts,3);
 await call('/api/control',{code,end:true},host);
 assert.equal((await answer(0,'結束')).status,409);
 assert.equal((await state(host)).data.wordcloud[0].count,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
