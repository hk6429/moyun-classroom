import {createEngine} from '../engine.mjs';
import {database,load,save,rate,putAsset,getAsset} from './database.mjs';
import {Buffer} from 'node:buffer';
import {randomBytes,randomInt,timingSafeEqual,createHash} from 'node:crypto';
import path from 'node:path';
const validAsset=u=>typeof u==='string'&&/^\/assets\/[0-9a-f-]{36}\/[a-zA-Z0-9-]+\.(png|jpg|gif|webp)$/.test(u);
function format(b){if(b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'png';if(b[0]===255&&b[1]===216&&b[2]===255)return 'jpg';if(/^GIF8[79]a$/.test(b.subarray(0,6).toString()))return 'gif';if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'webp';throw Error('圖片格式不符或檔案損壞');}
const mime=e=>({png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp'}[e]);
function access(env,data){
 const sessions=new Map((data.sessions||[]).filter(([,s])=>s.expires>Date.now()));
 const session=req=>{const id=/moyun_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1];return sessions.get(id)||null;};
 const setSession=(req,res,teacher=false,member=null)=>{let id=/moyun_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1],s=session(req);if(!s||teacher){id=randomBytes(24).toString('hex');s={teacher:false,members:[],expires:Date.now()+43200000};sessions.set(id,s);}s.teacher ||=teacher;if(member&&!s.members.includes(member))s.members.push(member);res.setHeader('Set-Cookie','moyun_session='+id+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200');return s;};
 return {sessions,session,setSession,rate:()=>true,login(req,res,password){if(typeof password!=='string'||password.length>256)return false;const hash=x=>createHash('sha256').update(x).digest();if(!timingSafeEqual(hash(password),hash(env.TEACHER_PASSWORD)))return false;setSession(req,res,true);return true;},logout(req,res){sessions.delete(/moyun_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1]);res.setHeader('Set-Cookie','moyun_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');}};
}
const error=(message,status=503)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
export async function handle(request,env,makeDatabase=database){
 if(!env.TURSO_URL||!env.TURSO_TOKEN||!env.TEACHER_PASSWORD)return error('課堂服務尚未完成設定');
 const url=new URL(request.url),db=makeDatabase(env);env={...env,PUBLIC_ORIGIN:env.PUBLIC_ORIGIN||url.origin};
 let body;
 try{
 if(Number(request.headers.get('content-length'))>8*1024*1024)return error('單次資料超過 8 MB，請降低圖片解析度後重試',413);
 body=Buffer.from(await request.arrayBuffer());if(body.length>8*1024*1024)return error('單次資料超過 8 MB，請降低圖片解析度後重試',413);
 if(request.method==='POST'){
 const allowed=[env.PUBLIC_ORIGIN,...(env.ALLOWED_ORIGINS||'').split(',')];const origin=request.headers.get('origin');if(origin&&!allowed.includes(origin))return error('請從本站送出請求',403);
 const max=url.pathname==='/api/login'?5:url.pathname==='/api/upload'?600:url.pathname==='/api/join'?300:1000;
 const ip=request.headers.get('cf-connecting-ip')||'unknown';
 if(!await rate(db,ip+':'+url.pathname,max))return error('請求頻繁，請稍後再試',429);
 }
 const assetCache=new Map();
 for(let attempt=0;attempt<12;attempt++){
 const snapshot=await load(db);let next=null,handler,close,ended=false;const changes=[];
 if(url.pathname==='/api/state'){const token=request.headers.get('authorization')?.replace(/^Bearer /,''),room=snapshot.data.rooms.find(([code])=>code===url.searchParams.get('code'))?.[1];if(room&&(room.host===token||room.people.some(([id])=>id===token))){await db.execute({sql:'INSERT INTO presence VALUES(?,?) ON CONFLICT(token) DO UPDATE SET seen=excluded.seen',args:[token,Date.now()]});const online=(await db.execute({sql:'SELECT token,seen FROM presence WHERE seen>?',args:[Date.now()-10000]})).rows;room.seen=Object.fromEntries(online.map(p=>[p.token,Number(p.seen)]));}}
 const headers=new Headers();let status=200,result=null;
 const res={setHeader(k,v){headers.set(k,String(v));},writeHead(n,h={}){status=n;for(const [k,v]of Object.entries(h))headers.set(k,String(v));},end(b=null){result=b;ended=true;}};
 const req={url:url.pathname+url.search,method:request.method,headers:{...Object.fromEntries(request.headers),host:url.host},socket:{remoteAddress:request.headers.get('cf-connecting-ip')||'unknown'},async *[Symbol.asyncIterator](){if(body.length)yield body;}};
 const store={data:snapshot.data,save(d){next=d;}};
 const persistImage=async(bytes,name,strokes=null)=>{
 const key=createHash('sha256').update(bytes).update(JSON.stringify(strokes)).digest('hex');
 if(assetCache.has(key))return assetCache.get(key);
 const ext=format(bytes),id=crypto.randomUUID();await putAsset(db,id,name,mime(ext),bytes,strokes);const asset='/assets/'+id+'/source.'+ext;assetCache.set(key,asset);return asset;
 };
 const deps={
 env:{...env,MAX_JSON_BYTES:String(8*1024*1024)},root:'/',dataRoot:'data',path,randomBytes,randomInt,
 persistence:()=>store,access:()=>access(env,snapshot.data),
 http:{createServer(fn){handler=fn;return {on(event,fn){if(event==='close')close=fn;}};}},
 validAsset,
 async upload(req,name){if(!/\.(png|jpe?g|webp|gif)$/i.test(name))throw Error('免費版支援 PDF 由瀏覽器轉頁、圖片直接匯入；PPT 請先匯出 PDF');const asset=await persistImage(body,name);return {id:asset.split('/')[2],status:'done'};},
 async getJob(id){if(!/^[0-9a-f-]{36}$/.test(id||''))return null;const a=(await db.execute({sql:'SELECT name,mime FROM assets WHERE id=? AND trashed=0',args:[id]})).rows[0];if(!a)return null;const ext=a.mime==='image/jpeg'?'jpg':a.mime.split('/')[1];return {id,status:'done',message:'已匯入 1 頁',slides:[{type:'image',title:String(a.name).slice(0,160),body:'',options:[],asset:'/assets/'+id+'/source.'+ext}]};},
 cancelJob:()=>false,
 converterHealth:async()=>({mode:'browser-pdf',ready:true,formats:['pdf','png','jpg','webp','gif'],pptPending:true}),
 async serveAsset(req,res,u){if(!validAsset(u))return false;const a=await getAsset(db,u.split('/')[2]);if(!a){res.writeHead(404);res.end('圖片不存在');return true;}res.writeHead(200,{'Content-Type':a.mime,'Cache-Control':'private, no-store'});res.end(a.data);return true;},
 async readFile(file){const id=file.split('/').at(-2);const a=(await db.execute({sql:'SELECT strokes FROM assets WHERE id=? AND trashed=0',args:[id]})).rows[0];if(!a?.strokes)throw Error('沒有筆畫');return a.strokes;},
 async saveDrawing(answer,strokes){if(strokes!==undefined&&(!Array.isArray(strokes)||JSON.stringify(strokes).length>4*1024*1024||strokes.some(s=>!['pen','pencil','brush','marker','eraser'].includes(s.tool)||!Number.isFinite(s.size)||s.size<1||s.size>32||!/^#[0-9a-f]{6}$/i.test(s.color)||!Array.isArray(s.points)||!s.points.length||s.points.some(p=>!['x','y','p'].every(k=>Number.isFinite(p[k]))))))throw Error('手寫筆畫格式不正確');
 if(typeof answer!=='string'||!answer.startsWith('data:image/png;base64,')||answer.length>8*1024*1024)throw Error('手寫圖片格式錯誤或過大');const bytes=Buffer.from(answer.slice(22),'base64');if(format(bytes)!=='png')throw Error('手寫圖片格式錯誤');return {image:await persistImage(bytes,'手寫作答',strokes)};},
 async storageList(dir){return (await db.execute({sql:'SELECT id,name,bytes FROM assets WHERE trashed=?',args:[dir.endsWith('trash')?1:0]})).rows;},
 async trashAsset(dir,id,restore){if(!/^[0-9a-f-]{36}$/.test(id||''))throw Error('素材編號無效');changes.push({sql:'UPDATE assets SET trashed=? WHERE id=?',args:[restore?0:1,id]});next??=snapshot.data;}
 };
 try{createEngine({},deps);await handler(req,res);}finally{close?.();}
 if(!ended)return error('課堂回應未完成');
 if(next&&status<400&&!await save(db,snapshot.revision,next,changes)){await new Promise(r=>setTimeout(r,20+Math.random()*100*(attempt+1)));continue;}
 return new Response(result,{status,headers});
 }
 return error('同時更新較多，請稍後再試',409);
 }catch(e){console.error('課堂服務錯誤',e.name);return error('課堂服務暫時無法處理，請稍後重試');}finally{db.close();}
}
export default {async fetch(request,env){const p=new URL(request.url).pathname;if(p.startsWith('/api/')||p.startsWith('/assets/'))return handle(request,env);return env.ASSETS.fetch(request);}};
