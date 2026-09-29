import {createEngine} from '../engine.mjs';
import {database,loadRooms,roomRevision,loadSession,commit,touchPresence,onlineIn,sweep,rate,putAsset,getAsset} from './database.mjs';
import {Buffer} from 'node:buffer';
import {randomBytes,randomInt,timingSafeEqual,createHash} from 'node:crypto';
import path from 'node:path';
const validAsset=u=>typeof u==='string'&&/^\/assets\/[0-9a-f-]{36}\/[a-zA-Z0-9-]+\.(png|jpg|gif|webp)$/.test(u);
function format(b){if(b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'png';if(b[0]===255&&b[1]===216&&b[2]===255)return 'jpg';if(/^GIF8[79]a$/.test(b.subarray(0,6).toString()))return 'gif';if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'webp';throw Error('圖片格式不符或檔案損壞');}
const mime=e=>({png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp'}[e]);
const cookieId=h=>/moyun_session=([a-f0-9]+)/.exec(h||'')?.[1];
const ONLINE_MS=45000;
// 只載入本次請求用到的那一個登入；dirty／removed 記錄要寫回的變動
function access(env,id,loaded){
 const sessions=new Map(loaded?[[id,loaded]]:[]),dirty=new Set(),removed=new Set();
 const session=req=>{const s=sessions.get(cookieId(req.headers.cookie));return s&&s.expires>Date.now()?s:null;};
 const setSession=(req,res,teacher=false,member=null)=>{let sid=cookieId(req.headers.cookie),s=session(req);if(!s||teacher){sid=randomBytes(24).toString('hex');s={teacher:false,members:[],expires:Date.now()+43200000};sessions.set(sid,s);}s.teacher ||=teacher;if(member&&!s.members.includes(member))s.members.push(member);dirty.add(sid);res.setHeader('Set-Cookie','moyun_session='+sid+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200');return s;};
 return {sessions,dirty,removed,session,setSession,rate:()=>true,login(req,res,password){if(typeof password!=='string'||password.length>256)return false;const hash=x=>createHash('sha256').update(x).digest();if(!timingSafeEqual(hash(password),hash(env.TEACHER_PASSWORD)))return false;setSession(req,res,true);return true;},logout(req,res){const sid=cookieId(req.headers.cookie);if(sid){sessions.delete(sid);removed.add(sid);}res.setHeader('Set-Cookie','moyun_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');}};
}
const error=(message,status=503)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// 學生端畫面的指紋：不含人數類計數與伺服器時間，避免每位同學交卷都叫醒全班
function fingerprint(text){const s=JSON.parse(text);delete s.people;delete s.submitted;if(s.race)delete s.race.serverNow;return createHash('sha256').update(JSON.stringify(s)).digest('hex').slice(0,16);}
// 競速測驗倒數與截止是依時間切換，到切換點要重新計算畫面
function nextBoundary(view){const r=view.race,now=Date.now();if(!r||r.phase==='closed')return Infinity;const t=[r.startedAt,r.deadline].find(t=>t&&t>now);return t===undefined?Infinity:t+200;}
export async function handle(request,env,makeDatabase=database){
 if(!env.TURSO_URL||!env.TURSO_TOKEN||!env.TEACHER_PASSWORD)return error('課堂服務尚未完成設定');
 const url=new URL(request.url),db=makeDatabase(env);env={...env,PUBLIC_ORIGIN:env.PUBLIC_ORIGIN||url.origin};
 let body,receivedAt;
 try{
 if(Number(request.headers.get('content-length'))>8*1024*1024)return error('單次資料超過 8 MB，請降低圖片解析度後重試',413);
 body=Buffer.from(await request.arrayBuffer());receivedAt=Date.now();if(body.length>8*1024*1024)return error('單次資料超過 8 MB，請降低圖片解析度後重試',413);
 if(request.method==='POST'){
 const allowed=[env.PUBLIC_ORIGIN,...(env.ALLOWED_ORIGINS||'').split(',')];const origin=request.headers.get('origin');if(origin&&!allowed.includes(origin))return error('請從本站送出請求',403);
 const max=url.pathname==='/api/login'?5:url.pathname==='/api/upload'?600:url.pathname==='/api/join'?300:1000;
 const ip=request.headers.get('cf-connecting-ip')||'unknown';
 if(!await rate(db,ip+':'+url.pathname,max))return error('請求頻繁，請稍後再試',429);
 if(Math.random()<0.01)await sweep(db);
 }
 const p=url.pathname,sid=cookieId(request.headers.get('cookie')),bearer=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 let parsed={};if(request.method==='POST'&&p!=='/api/upload'){try{parsed=JSON.parse(body.toString()||'{}');}catch{}}
 const code=String(url.searchParams.get('code')||parsed?.code||'');
 const loadedSession=p==='/api/state'?null:await loadSession(db,sid);
 const noStore={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
 // 需要跨課堂的教師操作直接用 SQL，不把所有課堂載入 Worker
 if(p==='/api/rooms'&&request.method==='GET'){if(!loadedSession?.teacher)return error('請先登入教師帳號',401);const rows=(await db.execute("SELECT code,json_extract(data,'$.host') host,json_extract(data,'$.deck[0].title') title,json_extract(data,'$.ended') ended,json_extract(data,'$.updated') updated FROM rooms WHERE coalesce(json_extract(data,'$.archived'),0)=0 ORDER BY rowid")).rows;return new Response(JSON.stringify({rooms:rows.map(r=>({code:String(r.code),token:r.host,title:r.title,ended:!!r.ended,updated:Number(r.updated)||null}))}),{headers:noStore});}
 if(p==='/api/storage-trash'&&request.method==='POST'&&loadedSession?.teacher&&!parsed.restore&&/^[0-9a-f-]{36}$/.test(parsed.id||'')){const used=(await db.execute({sql:'SELECT 1 FROM rooms WHERE instr(data,?)>0 LIMIT 1',args:['/'+parsed.id+'/']})).rows.length;if(used)return new Response(JSON.stringify({error:'此圖片仍被課堂使用，請保留'}),{status:409,headers:noStore});}
 const scope=p.startsWith('/assets/')?(loadedSession&&!loadedSession.teacher?(loadedSession.codes||[]).slice(-30):[]):['/api/logout','/api/storage','/api/storage-trash','/api/create','/api/login','/api/session'].includes(p)||!/^\d{6}$/.test(code)?[]:[code];
 // 學生長輪詢：課堂沒變就在伺服器端等，最多約 20 秒才回應，取代每 2.5 秒一次的請求
 const wait=p==='/api/state'&&url.searchParams.has('wait')?Number(url.searchParams.get('wait')):null,clientPrint=url.searchParams.get('h')||'';
 const maxHold=Number(env.LONG_POLL_MS)||20000,step=Number(env.LONG_POLL_STEP_MS)||1500,started=Date.now();
 let presenceDone=false;
 const run=async()=>{
 const assetCache=new Map();
 for(let attempt=0;attempt<12;attempt++){
 const rows=await loadRooms(db,scope),loaded=new Map(rows.map(r=>[r.code,r]));
 const data={rooms:rows.map(r=>[r.code,JSON.parse(r.data)]),sessions:[],owners:{}};
 const auth=access(env,sid,loadedSession?structuredClone(loadedSession):null);
 let next=null,handler,close,ended=false;const changes=[];
 const room=data.rooms[0]?.[1];
 if(p==='/api/state'&&room&&(room.host===bearer||room.people.some(([id])=>id===bearer))){
 if(!presenceDone){await touchPresence(db,bearer,code);presenceDone=true;}
 if(room.host===bearer)room.seen=Object.fromEntries((await onlineIn(db,code,Date.now()-ONLINE_MS)).map(r=>[r.token,Number(r.seen)]));
 }
 const headers=new Headers();let status=200,result=null;
 const res={setHeader(k,v){headers.set(k,String(v));},writeHead(n,h={}){status=n;for(const [k,v]of Object.entries(h))headers.set(k,String(v));},end(b=null){result=b;ended=true;}};
 const req={url:p+url.search,method:request.method,headers:{...Object.fromEntries(request.headers),host:url.host},socket:{remoteAddress:request.headers.get('cf-connecting-ip')||'unknown'},async *[Symbol.asyncIterator](){if(body.length)yield body;}};
 const store={data,save(d){next=d;}};
 const persistImage=async(bytes,name,strokes=null)=>{
 const key=createHash('sha256').update(bytes).update(JSON.stringify(strokes)).digest('hex');
 if(assetCache.has(key))return assetCache.get(key);
 const ext=format(bytes),id=crypto.randomUUID();await putAsset(db,id,name,mime(ext),bytes,strokes);const asset='/assets/'+id+'/source.'+ext;assetCache.set(key,asset);return asset;
 };
 const deps={
 env:{...env,MAX_JSON_BYTES:String(8*1024*1024)},root:'/',dataRoot:'data',path,randomBytes,randomInt,
 persistence:()=>store,access:()=>auth,
 http:{createServer(fn){handler=fn;return {on(event,fn){if(event==='close')close=fn;}};}},
 validAsset,
 async upload(req,name){if(!/\.(png|jpe?g|webp|gif)$/i.test(name))throw Error('免費版支援 PDF 由瀏覽器轉頁、圖片直接匯入；PPT 請先匯出 PDF');const asset=await persistImage(body,name);return {id:asset.split('/')[2],status:'done'};},
 async getJob(id){if(!/^[0-9a-f-]{36}$/.test(id||''))return null;const a=(await db.execute({sql:'SELECT name,mime FROM assets WHERE id=? AND trashed=0',args:[id]})).rows[0];if(!a)return null;const ext=a.mime==='image/jpeg'?'jpg':a.mime.split('/')[1];return {id,status:'done',message:'已匯入 1 頁',slides:[{type:'image',title:String(a.name).slice(0,160),body:'',options:[],asset:'/assets/'+id+'/source.'+ext}]};},
 cancelJob:()=>false,
 converterHealth:async()=>({mode:'browser-pdf',ready:true,formats:['pdf','png','jpg','webp','gif'],pptPending:true}),
 // 素材以隨機編號命名且內容不變，允許瀏覽器私有快取，避免每次重繪都重抓圖片
 async serveAsset(req,res,u){if(!validAsset(u))return false;const a=await getAsset(db,u.split('/')[2]);if(!a){res.writeHead(404);res.end('圖片不存在');return true;}res.writeHead(200,{'Content-Type':a.mime,'Cache-Control':'private, max-age=86400'});res.end(a.data);return true;},
 async readFile(file){const id=file.split('/').at(-2);const a=(await db.execute({sql:'SELECT strokes FROM assets WHERE id=? AND trashed=0',args:[id]})).rows[0];if(!a?.strokes)throw Error('沒有筆畫');return a.strokes;},
 async saveDrawing(answer,strokes){if(strokes!==undefined&&(!Array.isArray(strokes)||JSON.stringify(strokes).length>4*1024*1024||strokes.some(s=>!['pen','pencil','brush','marker','eraser'].includes(s.tool)||!Number.isFinite(s.size)||s.size<1||s.size>32||!/^#[0-9a-f]{6}$/i.test(s.color)||!Array.isArray(s.points)||!s.points.length||s.points.some(p=>!['x','y','p'].every(k=>Number.isFinite(p[k]))))))throw Error('手寫筆畫格式不正確');
 if(typeof answer!=='string'||!answer.startsWith('data:image/png;base64,')||answer.length>8*1024*1024)throw Error('手寫圖片格式錯誤或過大');const bytes=Buffer.from(answer.slice(22),'base64');if(format(bytes)!=='png')throw Error('手寫圖片格式錯誤');return {image:await persistImage(bytes,'手寫作答',strokes)};},
 async savePhoto(image){const m=typeof image==='string'&&/^data:image\/(jpeg|png|webp);base64,/.exec(image);if(!m||image.length>6*1024*1024)throw Error('照片格式錯誤或過大，請重新拍攝');const bytes=Buffer.from(image.slice(m[0].length),'base64');format(bytes);return {image:await persistImage(bytes,'拍照作答')};},
 async storageList(dir){return (await db.execute({sql:'SELECT id,name,bytes FROM assets WHERE trashed=?',args:[dir.endsWith('trash')?1:0]})).rows;},
 async trashAsset(dir,id,restore){if(!/^[0-9a-f-]{36}$/.test(id||''))throw Error('素材編號無效');changes.push({sql:'UPDATE assets SET trashed=? WHERE id=?',args:[restore?0:1,id]});next??=data;}
 };
 try{createEngine({receivedAt},deps);await handler(req,res);}finally{close?.();}
 if(!ended)return {response:error('課堂回應未完成')};
 if(next&&status<400){
 const updates=[],inserts=[];
 for(const [c,r]of next.rooms||[]){const text=JSON.stringify(r),old=loaded.get(c);if(!old)inserts.push({code:c,data:text});else if(old.data!==text)updates.push({code:c,revision:old.revision,data:text});}
 const touched=[...updates,...inserts].map(r=>r.code);
 const sessions=[...auth.dirty].filter(id=>auth.sessions.has(id)).map(id=>{const s=auth.sessions.get(id);if(!s.teacher&&touched.length)s.codes=[...new Set([...(s.codes||[]),...touched])].slice(-30);return [id,s];});
 const owners=Object.entries(next.owners||{});
 if(!await commit(db,{updates,inserts,sessions,removed:[...auth.removed],owners,changes})){await sleep(20+Math.random()*100*(attempt+1));continue;}
 if(p==='/api/logout'&&loadedSession?.teacher)await db.execute("UPDATE rooms SET data=json_set(data,'$.host',lower(hex(randomblob(24)))),revision=revision+1");
 }
 const revision=loaded.get(code)?.revision;
 return {status,headers,result,revision};
 }
 return {response:error('同時更新較多，請稍後再試',409)};
 };
 if(wait===null){const out=await run();if(out.response)return out.response;if(p==='/api/state'&&out.status===200&&out.revision!==undefined){const h=fingerprint(out.result);out.result='{"rev":'+out.revision+',"h":"'+h+'",'+out.result.slice(1);}return new Response(out.result,{status:out.status,headers:out.headers});}
 let rev=wait,deadline=started+maxHold,boundary=0;
 while(true){
 const due=Date.now()>=boundary;
 if(!due){if(Date.now()>=deadline)break;const current=await roomRevision(db,code);if(current===null)break;if(current===rev){await sleep(Math.max(0,Math.min(step,deadline-Date.now(),boundary-Date.now())));continue;}}
 const out=await run();if(out.response)return out.response;if(out.status!==200)return new Response(out.result,{status:out.status,headers:out.headers});
 const h=fingerprint(out.result);rev=out.revision;if(h!==clientPrint)return new Response('{"rev":'+out.revision+',"h":"'+h+'",'+out.result.slice(1),{status:200,headers:out.headers});
 boundary=nextBoundary(JSON.parse(out.result));
 }
 return new Response(JSON.stringify({unchanged:true,rev,h:clientPrint}),{headers:noStore});
 }catch(e){console.error('課堂服務錯誤',e.name,e.message);return error('課堂服務暫時無法處理，請稍後重試');}finally{db.close();}
}
export default {async fetch(request,env){const p=new URL(request.url).pathname;if(p.startsWith('/api/')||p.startsWith('/assets/'))return handle(request,env);return env.ASSETS.fetch(request);}};
