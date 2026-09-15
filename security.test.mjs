import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createApp} from './server.mjs';
test('教師登入、隔離權限、持久化、完整名冊與回饋',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'moyun-security-'));let server=createApp({dataDir:dir});
 const start=async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;};let base=await start();let cookie='';
 const call=async(p,b,token,cookies=cookie)=>{const r=await fetch(base+'/api/'+p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json',...(cookies?{Cookie:cookies}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(b?{body:JSON.stringify(b)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 const deck=[{type:'quiz',title:'辨識',options:['甲','乙'],correct:1,explanation:'依據詩句'},{type:'short',title:'理解'}];
 assert.equal((await call('create',{deck},null,'')).status,401);
 assert.equal((await call('login',{password:'wrong'})).status,401);
 const login=await call('login',{password:(await readFile(path.join(dir,'teacher-password'),'utf8')).trim()});assert.equal(login.status,200);cookie=login.cookie;
 const h=(await call('create',{deck})).data;assert.ok(h.token);
 const a=(await call('join',{code:h.code,name:'甲'},null,'')).data;
 const b=(await call('join',{code:h.code,name:'乙'},null,'')).data;
 let state=(await call('state?code='+h.code,null,a.token,'')).data;assert.equal(state.slide.correct,undefined);assert.equal(state.slide.explanation,undefined);
 assert.equal((await call('control',{code:h.code,index:1},a.token,'')).status,403);
 await call('answer',{code:h.code,index:0,answer:1},a.token,'');
 await call('control',{code:h.code,feedback:{id:a.token,text:'請補詩句證據'},locked:true},h.token);
 assert.equal((await call('join',{code:h.code,name:'丙'},null,'')).status,409);
 assert.equal((await call('state?code='+h.code,null,a.token,'')).data.feedback,'請補詩句證據');
 const rows=(await call('export?code='+h.code,null,h.token)).data.rows;assert.equal(rows.length,4);assert.equal(rows.filter(r=>!r.submitted).length,3);
 await new Promise(r=>server.close(r));server=createApp({dataDir:dir});base=await start();
 state=(await call('state?code='+h.code,null,a.token,'')).data;assert.equal(state.mine,1);assert.equal(state.feedback,'請補詩句證據');
 assert.equal((await call('rooms',null)).data.rooms.length,1);
 await call('control',{code:h.code,remove:a.token},h.token);assert.equal((await call('state?code='+h.code,null,a.token,'')).status,401);
 const asset=await fetch(base+'/assets/00000000-0000-0000-0000-000000000000/drawing.png');assert.equal(asset.status,403);
 const upload=await fetch(base+'/api/upload?name=x.pdf',{method:'POST',body:'x'});assert.equal(upload.status,401);
 await call('logout',{},null,'');assert.equal((await call('state?code='+h.code,null,h.token)).status,200);const cross=await fetch(base+'/api/create',{method:'POST',headers:{Origin:'https://evil.example',Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({deck})});assert.equal(cross.status,403);await call('logout',{});assert.equal((await call('state?code='+h.code,null,h.token)).status,401);
 }finally{await new Promise(r=>server.close(r));}
});
