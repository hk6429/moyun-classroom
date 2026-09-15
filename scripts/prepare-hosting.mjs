import {checkBackend} from './check-backend.mjs';
import {mkdir,cp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function prepareHosting(backend,outRoot=path.join(root,'dist')){
 const url=new URL(backend);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('請提供不含路徑與憑證的 HTTPS 後端網址');
 const origin=url.origin;
 const cf=path.join(outRoot,'cloudflare'),nf=path.join(outRoot,'netlify');
 await mkdir(cf,{recursive:true});await mkdir(nf,{recursive:true});
 await cp(path.join(root,'public'),path.join(cf,'public'),{recursive:true});
 await cp(path.join(root,'public'),path.join(nf,'public'),{recursive:true});
 const headers="/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src https://www.youtube-nocookie.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'\n";
 for(const dir of [cf,nf])await writeFile(path.join(dir,'public','_headers'),headers);
 await writeFile(path.join(nf,'public','_redirects'),'/api/* '+origin+'/api/:splat 200!\n/assets/* '+origin+'/assets/:splat 200!\n');
 await writeFile(path.join(nf,'netlify.toml'),'[build]\n  publish = "public"\n');
 await mkdir(path.join(cf,'functions'),{recursive:true});
 const middleware=`export async function onRequest(context){const incoming=new URL(context.request.url);if(!incoming.pathname.startsWith('/api/')&&!incoming.pathname.startsWith('/assets/'))return context.next();const target=new URL(incoming.pathname+incoming.search,${JSON.stringify(origin)});if(target.origin===incoming.origin)return new Response('後端網址不能指向自己',{status:503});const headers=new Headers(context.request.headers);headers.delete('host');try{const response=await fetch(target,new Request(context.request,{headers,redirect:'manual'}));const out=new Response(response.body,response);out.headers.set('Cache-Control','private, no-store');return out;}catch{return Response.json({error:'課堂服務暫時無法連線，請稍後重試'},{status:503});}}\n`;
 await writeFile(path.join(cf,'functions','_middleware.js'),middleware);
 await writeFile(path.join(cf,'public','_routes.json'),JSON.stringify({version:1,include:['/api/*','/assets/*'],exclude:[]}));
 return {backend:origin,cloudflare:cf,netlify:nf};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(!process.argv[2]){console.error('用法：node scripts/prepare-hosting.mjs https://已就緒的後端網域');process.exitCode=1;}
 else {await checkBackend(process.argv[2]);console.log(JSON.stringify(await prepareHosting(process.argv[2]),null,2));}
}
