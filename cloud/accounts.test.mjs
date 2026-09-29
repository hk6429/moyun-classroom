import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createClient} from '@libsql/client';
import {initialize} from './database.mjs';
import {handle} from './worker.mjs';
const b64=x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url');
test('Google 多教師：開通名單、各自課堂、雲端教材、範本庫、班級座號儀表板、記憶牌卡',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'moyun-acct-')),url='file:'+path.join(dir,'db.sqlite'),factory=()=>createClient({url});
 const {publicKey,privateKey}=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',publicKey),kid:'k1',alg:'RS256'};
 const env={TURSO_URL:'https://test',TURSO_TOKEN:'test',TEACHER_PASSWORD:'acct-secret',PUBLIC_ORIGIN:'https://classroom.test',GOOGLE_CLIENT_ID:'client-1',TEACHER_ADMINS:'boss@example.com',GOOGLE_JWKS_JSON:JSON.stringify({keys:[jwk]})};
 const token=async(email,extra={})=>{const head=b64({alg:'RS256',kid:'k1'}),body=b64({iss:'https://accounts.google.com',aud:'client-1',exp:Math.floor(Date.now()/1000)+600,email,email_verified:true,name:email.split('@')[0],...extra});return head+'.'+body+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,new TextEncoder().encode(head+'.'+body))).toString('base64url');};
 const call=async(p,b,cookie='',bearer='')=>{const r=await handle(new Request(env.PUBLIC_ORIGIN+p,{method:b===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:env.PUBLIC_ORIGIN,'cf-connecting-ip':'acct','Content-Type':'application/json',Authorization:'Bearer '+bearer},...(b===undefined?{}:{body:JSON.stringify(b)})}),env,factory);return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 const db=factory();await initialize(db);db.close();
 assert.equal((await call('/api/session')).data.googleClientId,'client-1');
 assert.equal((await call('/api/google-login',{credential:await token('amy@school.test')})).status,403,'未開通');
 assert.equal((await call('/api/google-login',{credential:await token('boss@example.com',{aud:'other'})})).status,401,'aud 不符');
 const forged=(await token('boss@example.com')).split('.');forged[1]=b64({iss:'https://accounts.google.com',aud:'client-1',exp:9999999999,email:'boss@example.com',email_verified:true});
 assert.equal((await call('/api/google-login',{credential:forged.join('.')})).status,401,'簽章不符');
 const boss=(await call('/api/google-login',{credential:await token('boss@example.com')})).cookie;
 const me=(await call('/api/session',undefined,boss)).data;assert.deepEqual([me.teacher,me.email,me.admin],[true,'boss@example.com',true]);
 assert.equal((await call('/api/teachers',{email:'amy@school.test'},boss)).status,200);
 const amy=(await call('/api/google-login',{credential:await token('amy@school.test')})).cookie,ben=(await call('/api/teachers',{email:'ben@school.test'},boss))&&(await call('/api/google-login',{credential:await token('ben@school.test')})).cookie;
 assert.equal((await call('/api/teachers',undefined,amy)).status,403);
 assert.equal((await call('/api/storage',undefined,amy)).status,403,'素材管理僅限管理者');
 // 各自課堂
 const deck=[{type:'quiz',title:'詩仙',options:['李白','杜甫'],correct:0},{type:'fill',title:'詩聖',solution:'杜甫'},{type:'cards',title:'牌卡',options:['李白＝詩仙','杜甫＝詩聖']}];
 const a=(await call('/api/create',{deck},amy)).data,bRoom=(await call('/api/create',{deck:[{type:'short',title:'別班'}]},ben)).data;
 assert.deepEqual((await call('/api/rooms',undefined,amy)).data.rooms.map(r=>r.code),[a.code]);
 assert.deepEqual((await call('/api/rooms',undefined,ben)).data.rooms.map(r=>r.code),[bRoom.code]);
 // 雲端教材與範本庫
 const id=randomUUID();
 assert.equal((await call('/api/decks',{id,deck:{name:'唐詩',subject:'國文',slides:deck}},amy)).status,200);
 assert.equal((await call('/api/decks',{id,deck:{name:'搶走',slides:deck}},ben)).status,403);
 assert.deepEqual((await call('/api/decks',undefined,amy)).data.decks.map(d=>d.deck.name),['唐詩']);
 assert.deepEqual((await call('/api/decks',undefined,ben)).data.decks,[]);
 assert.deepEqual((await call('/api/templates',undefined,ben)).data.templates,[]);
 await call('/api/decks',{id,shared:true},amy);
 const t=(await call('/api/templates',undefined,ben)).data.templates;assert.deepEqual(t.map(x=>[x.name,x.author,x.slides,x.mine]),[['唐詩','amy',3,false]]);
 assert.equal((await call('/api/templates?id='+id,undefined,ben)).data.deck.slides.length,3);
 // 班級座號加入、記憶牌卡、結束後進儀表板
 assert.equal((await call('/api/join',{code:a.code,name:'小明',seat:'8a1-5'})).status,400);
 const s1=(await call('/api/join',{code:a.code,name:'小明',seat:'801-5'})).data.token,s2=(await call('/api/join',{code:a.code,name:'小華',seat:'801-12'})).data.token,s3=(await call('/api/join',{code:a.code,name:'訪客'})).data.token;
 await call('/api/answer',{code:a.code,index:0,answer:0},'',s1);await call('/api/answer',{code:a.code,index:0,answer:1},'',s2);await call('/api/answer',{code:a.code,index:0,answer:1},'',s3);
 await call('/api/control',{code:a.code,index:1},'',a.token);await call('/api/answer',{code:a.code,index:1,answer:'李白'},'',s1);
 await call('/api/control',{code:a.code,index:2},'',a.token);
 assert.equal((await call('/api/answer',{code:a.code,index:2,answer:{cards:{5:1}}},'',s1)).status,400);
 assert.equal((await call('/api/answer',{code:a.code,index:2,answer:{cards:{0:1,1:0}}},'',s1)).status,200);
 const host=(await call('/api/state?code='+a.code,undefined,'',a.token)).data;assert.deepEqual(host.roster.map(r=>r.seat),['801-05','801-12',null]);
 const cardsRow=(await call('/api/export?code='+a.code,undefined,amy,a.token)).data.rows.find(r=>r.page===3&&r.name==='小明');assert.equal(cardsRow.answer,'記得 1／2；不熟：杜甫');
 await call('/api/control',{code:a.code,end:true},'',a.token);
 const dash=(await call('/api/dashboard',undefined,amy)).data;
 assert.deepEqual(dash.lessons.map(l=>[l.code,l.slides.map(s=>s.index)]),[[a.code,[0,1]]]);
 assert.deepEqual(dash.records.map(r=>[r.class,r.seat,r.results]).sort((x,y)=>x[1]-y[1]),[['801',5,{0:[1,null],1:[0,null]}],['801',12,{0:[0,null]}]]);
 assert.ok(!JSON.stringify(dash).includes('小明'),'儀表板不含暱稱');
 assert.deepEqual((await call('/api/dashboard',undefined,ben)).data.lessons,[]);
 // 登出只重設自己的課堂
 await call('/api/logout',{},amy);
 assert.equal((await call('/api/control',{code:bRoom.code,index:0},'',bRoom.token)).status,200);
 }finally{await rm(dir,{recursive:true,force:true});}
});
