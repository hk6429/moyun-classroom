import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {prepareHosting} from './scripts/prepare-hosting.mjs';
test('雙平台套件只含前端並正確代理課堂請求',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'moyun-hosting-'));
 await assert.rejects(()=>prepareHosting('http://example.com',dir));
 await assert.rejects(()=>prepareHosting('https://user:pass@example.com',dir));
 const out=await prepareHosting('https://api.example.test',dir);
 const redirects=await readFile(path.join(out.netlify,'public','_redirects'),'utf8');
 assert.match(redirects,/\/api\/\* https:\/\/api.example.test\/api\/:splat 200!/);
 assert.equal(await stat(path.join(out.netlify,'public','server.mjs')).then(()=>true,()=>false),false);
 const modulePath=path.join(dir,'middleware.mjs');await writeFile(modulePath,await readFile(path.join(out.cloudflare,'functions','_middleware.js')));
 const {onRequest}=await import(pathToFileURL(modulePath));const originalFetch=globalThis.fetch;
 try{let called=false;globalThis.fetch=async(target,request)=>{called=true;assert.equal(target.origin,'https://api.example.test');assert.equal(target.pathname,'/api/login');assert.equal(request.method,'POST');assert.equal(request.headers.get('origin'),'https://classroom.pages.dev');assert.equal(request.headers.get('cookie'),'session=test');assert.equal(await request.text(),'{"test":true}');return new Response('ok',{headers:{'Set-Cookie':'session=new; Secure; HttpOnly'}});};
 const response=await onRequest({request:new Request('https://classroom.pages.dev/api/login',{method:'POST',headers:{Origin:'https://classroom.pages.dev',Cookie:'session=test'},body:'{"test":true}'}),next:()=>{throw Error('不應落至靜態路由');}});assert.ok(called);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.match(response.headers.get('set-cookie'),/HttpOnly/);assert.equal(await response.text(),'ok');
 const pass=await onRequest({request:new Request('https://classroom.pages.dev/style.css'),next:()=>new Response('static')});assert.equal(await pass.text(),'static');
 }finally{globalThis.fetch=originalFetch;}
});
