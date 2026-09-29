import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createClient} from '@libsql/client';
import {initialize} from './database.mjs';
import {handle} from './worker.mjs';
test('排列題不外洩答案、把握程度、錯答聚合、第二輪、分組、抬頭看老師、離開畫面、拍照上傳',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'moyun-teach-')),url='file:'+path.join(dir,'db.sqlite'),factory=()=>createClient({url});
 const env={TURSO_URL:'https://test',TURSO_TOKEN:'test',TEACHER_PASSWORD:'teach-test-secret',PUBLIC_ORIGIN:'https://classroom.test'};
 const call=async(p,b,cookie='',token='')=>{const r=await handle(new Request(env.PUBLIC_ORIGIN+p,{method:b===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:env.PUBLIC_ORIGIN,'cf-connecting-ip':'teach','Content-Type':'application/json',Authorization:'Bearer '+token},...(b===undefined?{}:{body:JSON.stringify(b)})}),env,factory);return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 const db=factory();await initialize(db);db.close();
 const login=await call('/api/login',{password:'teach-test-secret'});
 assert.equal((await call('/api/create',{deck:[{type:'arrange',mode:'match',title:'壞',options:['只有一行']}]},login.cookie)).status,400);
 const deck=[{type:'quiz',title:'李白的字',options:['太白','子美','摩詰'],correct:0},{type:'arrange',mode:'order',title:'排順序',options:['起','承','轉','合']},{type:'arrange',mode:'group',title:'分類',options:['動詞：跑、寫','名詞：山、書']},{type:'photo',title:'拍學習單'}];
 const {code,token:host}=(await call('/api/create',{deck},login.cookie)).data;
 const [a,b,c]=await Promise.all(['甲','乙','丙'].map(name=>call('/api/join',{code,name}).then(r=>r.data.token)));
 const st=t=>call('/api/state?code='+code,undefined,'',t).then(r=>r.data);
 // 選擇題：把握程度與錯答聚合
 await call('/api/answer',{code,index:0,answer:1,confidence:3},'',a);
 await call('/api/answer',{code,index:0,answer:0,confidence:1},'',b);
 await call('/api/answer',{code,index:0,answer:1},'',c);
 assert.equal((await call('/api/answer',{code,index:0,confidenceOnly:true,confidence:2},'',c)).status,200);
 assert.equal((await st(c)).confidence,2);
 let h=await st(host);
 assert.deepEqual([h.insight.total,h.insight.correct,h.insight.sureWrong,h.insight.guessRight],[3,1,['甲'],['乙']]);
 assert.deepEqual(h.insight.groups,[{label:'子美',names:['甲','丙']}]);
 // 第二輪：保留第一輪、清空作答、前後對照
 assert.equal((await call('/api/control',{code,secondRound:true},'',host)).status,200);
 assert.equal((await call('/api/control',{code,secondRound:true},'',host)).status,409);
 assert.equal((await st(a)).round,2);assert.equal((await st(a)).mine,null);
 await call('/api/answer',{code,index:0,answer:0},'',a);
 h=await st(host);assert.deepEqual([h.insight.peer.firstCorrect,h.insight.peer.secondCorrect,h.insight.peer.fixed],[1,1,['甲']]);
 // 分組、抬頭看老師、離開畫面
 const ids=['甲','乙','丙'].map(n=>h.roster.find(r=>r.name===n).id);
 assert.equal((await call('/api/control',{code,groups:[[ids[0],ids[0]]]},'',host)).status,400);
 assert.equal((await call('/api/control',{code,groups:[[ids[0],ids[1]],[ids[2]]],attention:true},'',host)).status,200);
 const sa=await st(a);assert.equal(sa.attention,true);assert.deepEqual(sa.group,{number:1,members:['甲','乙']});
 assert.equal((await st(c)).group.number,2);
 await call('/api/focus',{code,away:true},'',b);
 h=await st(host);assert.equal(h.roster.find(r=>r.name==='乙').away,true);assert.equal(h.groups.length,2);
 await call('/api/focus',{code,away:false},'',b);assert.equal((await st(host)).roster.find(r=>r.name==='乙').away,false);
 // 排序題：公布前學生拿不到答案
 await call('/api/control',{code,index:1},'',host);
 let s=await st(a);assert.equal(s.slide.arrange.mode,'order');assert.equal(s.slide.arrange.solution,undefined);assert.deepEqual(s.slide.options||[],[]);
 const items=s.slide.arrange.items,right=['起','承','轉','合'].map(x=>items.indexOf(x));
 assert.equal((await call('/api/answer',{code,index:1,answer:[0,0,1,2]},'',a)).status,400);
 assert.equal((await call('/api/answer',{code,index:1,answer:right},'',a)).status,200);
 assert.equal((await call('/api/answer',{code,index:1,answer:[...right].reverse()},'',b)).status,200);
 h=await st(host);assert.deepEqual([h.insight.total,h.insight.correct],[2,1]);
 await call('/api/control',{code,reveal:true},'',host);
 s=await st(a);assert.deepEqual(s.slide.arrange.solution,right);
 // 分類題
 await call('/api/control',{code,index:2,reveal:false},'',host);
 s=await st(a);const g=s.slide.arrange;assert.deepEqual(g.groups,['動詞','名詞']);
 await call('/api/answer',{code,index:2,answer:g.items.map(x=>['跑','寫'].includes(x)?0:1)},'',a);
 assert.equal((await st(host)).insight.correct,1);
 // 拍照上傳
 await call('/api/control',{code,index:3},'',host);
 const png=await readFile(new URL('../fixtures/lesson.png',import.meta.url));
 assert.equal((await call('/api/answer',{code,index:3,answer:{image:'data:text/html;base64,PGI+'}},'',a)).status,400);
 const up=await call('/api/answer',{code,index:3,answer:{image:'data:image/png;base64,'+png.toString('base64')}},'',a);assert.equal(up.status,200);
 const mine=(await st(a)).mine;assert.match(mine.image,/^\/assets\//);assert.equal((await handle(new Request(env.PUBLIC_ORIGIN+mine.image,{headers:{Cookie:login.cookie}}),env,factory)).status,200);
 // 匯出含把握程度與第一輪作答
 const rows=(await call('/api/export?code='+code,undefined,login.cookie,host)).data.rows;
 const r0=rows.find(r=>r.page===1&&r.name==='甲');assert.deepEqual([r0.answer,r0.correct,r0.firstAnswer,r0.firstCorrect,r0.confidence],['太白',true,'子美',false,null]);
 assert.equal(rows.find(r=>r.page===2&&r.name==='甲').answer,'起 → 承 → 轉 → 合');
 }finally{await rm(dir,{recursive:true,force:true});}
});
