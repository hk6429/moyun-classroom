// 多教師帳號（Google 登入）、雲端教材、校內範本庫、跨課學習儀表板。
// 儀表板只以「班級＋座號」彙整，不寫入學生暱稱。
import {Buffer} from 'node:buffer';
import {randomBytes} from 'node:crypto';
import {isCorrect,graded} from '../activities.mjs';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const list=v=>String(v||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
export const isAdmin=s=>!!s?.teacher&&(!s.email||!!s.admin);
let jwks=null;
async function googleKeys(env){if(env.GOOGLE_JWKS_JSON)return JSON.parse(env.GOOGLE_JWKS_JSON).keys;if(jwks&&jwks.until>Date.now())return jwks.keys;const r=await fetch('https://www.googleapis.com/oauth2/v3/certs');if(!r.ok)throw Error('暫時無法連線 Google，請稍後再試');jwks={keys:(await r.json()).keys,until:Date.now()+3600000};return jwks.keys;}
const b64=s=>Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64');
export async function verifyGoogle(credential,env){
 const parts=String(credential||'').split('.');if(parts.length!==3)throw Error('Google 登入資料不正確');
 const header=JSON.parse(b64(parts[0]).toString()),claims=JSON.parse(b64(parts[1]).toString());
 const jwk=(await googleKeys(env)).find(k=>k.kid===header.kid);if(header.alg!=='RS256'||!jwk)throw Error('Google 登入資料不正確');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error('Google 登入資料不正確');
 if(!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||claims.aud!==env.GOOGLE_CLIENT_ID||claims.exp*1000<Date.now()||claims.email_verified!==true||!claims.email)throw Error('Google 登入已過期或不屬於本站，請重新登入');
 return {email:String(claims.email).toLowerCase(),name:String(claims.name||claims.email).slice(0,60)};
}
// 課堂結束時寫入：題目快照（只留可評分題）與每位有座號學生的對錯
export function lessonRecords(code,room){
 const slides=room.deck.map((s,i)=>graded(s)?{index:i,slide:s}:null).filter(Boolean);
 const rows=Object.entries(room.seats||{}).map(([id,seat])=>{const [cls,no]=seat.split('-');const results={};for(const {index}of slides){const retry=room.retry?.[index]?.[id],first=room.answers[index]?.[id];if(first===undefined)continue;results[index]=[isCorrect(room,index,first)?1:0,retry?(retry.correct?1:0):null];}return {cls,seat:Number(no),results};}).filter(r=>Object.keys(r.results).length);
 return {lesson:{code,owner:room.owner||null,title:room.name||room.deck[0]?.title||'未命名課堂',ended:Date.now(),slides:JSON.stringify(slides.map(({index,slide})=>({index,slide:{...slide,...(slide.type==='arrange'?{shuffle:room.shuffle?.[index]}:{})}})))},rows};
}
export async function saveLesson(db,code,room){const {lesson,rows}=lessonRecords(code,room);await db.batch([{sql:'INSERT OR REPLACE INTO lessons(code,owner,title,ended,slides) VALUES(?,?,?,?,?)',args:[lesson.code,lesson.owner,lesson.title,lesson.ended,lesson.slides]},{sql:'DELETE FROM records WHERE code=?',args:[code]},...rows.map(r=>({sql:'INSERT INTO records(code,class,seat,results) VALUES(?,?,?,?)',args:[code,r.cls,r.seat,JSON.stringify(r.results)]}))],'write');}
export async function accounts(p,request,env,db,session,sid,parsed){
 const teacher=session?.teacher,admins=list(env.TEACHER_ADMINS);
 if(p==='/api/session'&&request.method==='GET')return json({teacher:!!teacher,email:session?.email||null,name:session?.name||null,admin:isAdmin(session),googleClientId:env.GOOGLE_CLIENT_ID||null});
 if(p==='/api/google-login'&&request.method==='POST'){
  if(!env.GOOGLE_CLIENT_ID)return json({error:'尚未啟用 Google 登入'},400);
  let who;try{who=await verifyGoogle(parsed.credential,env);}catch(e){return json({error:e.message},401);}
  const domain=who.email.split('@')[1],admin=admins.includes(who.email);
  const allowed=admin||list(env.TEACHER_DOMAINS).includes(domain)||(await db.execute({sql:'SELECT 1 FROM teachers WHERE email=?',args:[who.email]})).rows.length>0;
  if(!allowed)return json({error:'這個 Google 帳號尚未開通教師權限，請管理者在「教師名單」加入 '+who.email},403);
  const id=randomBytes(24).toString('hex'),s={teacher:true,email:who.email,name:who.name,admin,members:[],expires:Date.now()+43200000};
  await db.execute({sql:'INSERT INTO sessions(id,data,expires) VALUES(?,?,?)',args:[id,JSON.stringify(s),s.expires]});
  if(sid)await db.execute({sql:'DELETE FROM sessions WHERE id=?',args:[sid]});
  return json({ok:true,email:who.email,name:who.name,admin},200,{'Set-Cookie':'moyun_session='+id+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200'});
 }
 if(!['/api/teachers','/api/decks','/api/templates','/api/dashboard'].includes(p))return null;
 if(!teacher)return json({error:'請先登入教師帳號'},401);
 const me=session.email||'';
 if(p==='/api/teachers'){if(!isAdmin(session))return json({error:'只有管理者可以管理教師名單'},403);
  if(request.method==='POST'){const email=String(parsed.email||'').trim().toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>200)return json({error:'請輸入有效的 Email'},400);await db.execute(parsed.remove?{sql:'DELETE FROM teachers WHERE email=?',args:[email]}:{sql:'INSERT OR IGNORE INTO teachers(email,added) VALUES(?,?)',args:[email,Date.now()]});}
  return json({teachers:(await db.execute('SELECT email,added FROM teachers ORDER BY added')).rows.map(r=>({email:String(r.email),added:Number(r.added)})),admins,domains:list(env.TEACHER_DOMAINS)});}
 if(p==='/api/dashboard'){
  const lessons=(await db.execute({sql:'SELECT code,title,ended,slides FROM lessons WHERE owner IS ? ORDER BY ended DESC LIMIT 60',args:[me||null]})).rows;
  if(!lessons.length)return json({lessons:[],records:[]});
  const records=(await db.execute({sql:'SELECT code,class,seat,results FROM records WHERE code IN ('+lessons.map(()=>'?').join(',')+')',args:lessons.map(l=>l.code)})).rows;
  return json({lessons:lessons.map(l=>({code:String(l.code),title:l.title,ended:Number(l.ended),slides:JSON.parse(l.slides)})),records:records.map(r=>({code:String(r.code),class:String(r.class),seat:Number(r.seat),results:JSON.parse(r.results)}))});
 }
 if(!me)return json({error:'雲端教材與範本庫需以 Google 帳號登入'},403);
 if(p==='/api/decks'){
  if(request.method==='POST'){const id=String(parsed.id||'');if(!/^[0-9a-f-]{36}$/.test(id))return json({error:'教材編號不正確'},400);
   const own=(await db.execute({sql:'SELECT owner FROM decks WHERE id=?',args:[id]})).rows[0];if(own&&own.owner!==me)return json({error:'這份教材屬於其他老師'},403);
   if(parsed.remove){await db.execute({sql:'DELETE FROM decks WHERE id=? AND owner=?',args:[id,me]});return json({ok:true});}
   if(typeof parsed.shared==='boolean'&&!parsed.deck){if(!own)return json({error:'請先等教材同步到雲端'},404);await db.execute({sql:'UPDATE decks SET shared=? WHERE id=? AND owner=?',args:[parsed.shared?1:0,id,me]});return json({ok:true});}
   const d=parsed.deck,text=JSON.stringify(d);if(!d||typeof d.name!=='string'||!Array.isArray(d.slides)||!d.slides.length||d.slides.length>300||text.length>1024*1024)return json({error:'教材格式不正確或超過 1 MB'},400);
   if(!own&&Number((await db.execute({sql:'SELECT count(*) n FROM decks WHERE owner=?',args:[me]})).rows[0].n)>=300)return json({error:'雲端教材已達 300 份上限'},409);
   const updated=Number(parsed.updated)||Date.now();await db.execute({sql:'INSERT INTO decks(id,owner,owner_name,data,shared,updated) VALUES(?,?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated,owner_name=excluded.owner_name WHERE owner=excluded.owner',args:[id,me,session.name||me,text,updated]});return json({ok:true,updated});}
  return json({decks:(await db.execute({sql:'SELECT id,data,shared,updated FROM decks WHERE owner=? ORDER BY updated DESC',args:[me]})).rows.map(r=>({id:String(r.id),deck:JSON.parse(r.data),shared:!!r.shared,updated:Number(r.updated)}))});
 }
 if(p==='/api/templates'){const id=new URL(request.url).searchParams.get('id');
  if(id){const r=(await db.execute({sql:'SELECT data,owner_name FROM decks WHERE id=? AND shared=1',args:[id]})).rows[0];return r?json({deck:JSON.parse(r.data),author:r.owner_name}):json({error:'找不到這份範本'},404);}
  return json({templates:(await db.execute({sql:"SELECT id,owner_name,json_extract(data,'$.name') name,json_extract(data,'$.subject') subject,json_array_length(data,'$.slides') n,updated,owner=? mine FROM decks WHERE shared=1 ORDER BY updated DESC LIMIT 200",args:[me]})).rows.map(r=>({id:String(r.id),name:r.name,subject:r.subject,author:r.owner_name,slides:Number(r.n),updated:Number(r.updated),mine:!!r.mine}))});}

}
