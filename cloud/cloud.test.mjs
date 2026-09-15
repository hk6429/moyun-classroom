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
